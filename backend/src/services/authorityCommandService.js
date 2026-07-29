const crypto = require('crypto');
const { stableJson, validateEnvelope } = require('../../../shared/authorityProtocol');
const RECEIPT_PROTOCOL = 'gewu.authority-receipt.v1';

function commandError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function validateCommand(input = {}) {
  return validateEnvelope(input);
}

function receiptFrom(row, receipt) {
  return Object.freeze({
    replayed: true,
    command: { id: row.command_id, type: row.command_type, status: row.status },
    receipt: {
      protocol: RECEIPT_PROTOCOL,
      commandId: receipt.command_id,
      payloadHash: row.payload_hash,
      status: row.status,
      resultHash: receipt.result_hash,
      authorityId: row.authority_id,
      hostEpochId: row.host_epoch_id,
      projectionVersion: receipt.projection_version,
      completedAt: receipt.completed_at,
      result: JSON.parse(receipt.result_payload),
    },
  });
}

function createAuthorityCommandService({
  db,
  handlers = {},
  now = () => new Date().toISOString(),
  nextProjectionVersion,
  currentProjectionVersion = () => 0,
  authorizeEnvelope,
  afterCommit = null,
  afterRollback = null,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw commandError('COMMAND_DATABASE_REQUIRED');
  }
  if (typeof nextProjectionVersion !== 'function') {
    throw commandError('COMMAND_PROJECTION_VERSION_REQUIRED');
  }
  if (typeof currentProjectionVersion !== 'function') {
    throw commandError('COMMAND_CURRENT_PROJECTION_VERSION_REQUIRED');
  }
  if (typeof authorizeEnvelope !== 'function') {
    throw commandError('COMMAND_AUTHORIZER_REQUIRED');
  }

  function existingFor(envelope, payloadHash) {
    const row = db.prepare(`SELECT * FROM authority_command_ledger
      WHERE actor_user_id=? AND device_id=? AND idempotency_key=?`)
      .get(envelope.actor.userId, envelope.actor.deviceId, envelope.idempotencyKey);
    if (!row) return null;
    if (row.payload_hash !== payloadHash || row.command_type !== envelope.type
      || row.authority_id !== envelope.authorityId || row.host_epoch_id !== envelope.hostEpochId) {
      throw commandError('COMMAND_IDEMPOTENCY_CONFLICT');
    }
    const receipt = db.prepare('SELECT * FROM authority_command_receipts WHERE command_id=?').get(row.command_id);
    if (!receipt) throw commandError('COMMAND_RECEIPT_REQUIRED');
    return receiptFrom(row, receipt);
  }

  function persistOutcome({
    envelope,
    payloadHash,
    status,
    result,
    projectionVersion,
    createdAt,
  }) {
    const resultJson = stableJson(result || {});
    const resultHash = digest(resultJson);
    db.prepare(`INSERT INTO authority_command_ledger
      (command_id,authority_id,host_epoch_id,actor_user_id,device_id,idempotency_key,command_type,payload_hash,status,result_hash,created_at,committed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        envelope.commandId,
        envelope.authorityId,
        envelope.hostEpochId,
        envelope.actor.userId,
        envelope.actor.deviceId,
        envelope.idempotencyKey,
        envelope.type,
        payloadHash,
        status,
        resultHash,
        createdAt,
        createdAt,
      );
    db.prepare(`INSERT INTO authority_command_receipts
      (command_id,result_hash,result_payload,projection_version,completed_at)
      VALUES(?,?,?,?,?)`)
      .run(envelope.commandId, resultHash, resultJson, projectionVersion, createdAt);
    return Object.freeze({
      replayed: false,
      command: { id: envelope.commandId, type: envelope.type, status },
      receipt: {
        protocol: RECEIPT_PROTOCOL,
        commandId: envelope.commandId,
        payloadHash,
        status,
        resultHash,
        authorityId: envelope.authorityId,
        hostEpochId: envelope.hostEpochId,
        projectionVersion,
        completedAt: createdAt,
        result: JSON.parse(resultJson),
      },
    });
  }

  function reject(envelope, payloadHash, error) {
    const commit = db.transaction(() => {
      const raced = existingFor(envelope, payloadHash);
      if (raced) return raced;
      const projectionVersion = Number(currentProjectionVersion(envelope));
      if (!Number.isSafeInteger(projectionVersion) || projectionVersion < 0) {
        throw commandError('COMMAND_PROJECTION_VERSION_INVALID');
      }
      const code = String(error?.code || 'AUTHORITY_COMMAND_INTERNAL_ERROR');
      return persistOutcome({
        envelope,
        payloadHash,
        status: 'rejected',
        result: {
          ok: false,
          error: {
            code,
            statusCode: Number(error?.statusCode || error?.status || 500),
          },
        },
        projectionVersion,
        createdAt: now(),
      });
    });
    return typeof commit.immediate === 'function' ? commit.immediate() : commit();
  }

  function execute(input = {}) {
    const envelope = validateCommand(input);
    const payloadJson = stableJson(envelope.payload);
    const computedPayloadHash = digest(payloadJson);
    const payloadHash = envelope.payloadHash;
    const replay = existingFor(envelope, payloadHash);
    if (replay) return replay;
    const handler = handlers[envelope.type];
    if (envelope.payloadHash !== computedPayloadHash) {
      return reject(envelope, payloadHash, commandError('AUTHORITY_PAYLOAD_HASH_MISMATCH'));
    }
    if (typeof handler !== 'function') {
      return reject(envelope, payloadHash, commandError('COMMAND_TYPE_UNSUPPORTED'));
    }
    const commit = db.transaction(() => {
      const raced = existingFor(envelope, payloadHash);
      if (raced) return raced;
      const createdAt = now();
      const authorization = authorizeEnvelope(envelope);
      if (authorization && typeof authorization.then === 'function') {
        throw commandError('COMMAND_AUTHORIZER_ASYNC_UNSUPPORTED');
      }
      const result = handler(
        Object.freeze({ ...envelope, payload: Object.freeze({ ...envelope.payload }) }),
        Object.freeze(authorization || {}),
      );
      if (result && typeof result.then === 'function') throw commandError('COMMAND_HANDLER_ASYNC_UNSUPPORTED');
      const projectionVersion = Number(nextProjectionVersion(envelope));
      if (!Number.isSafeInteger(projectionVersion) || projectionVersion < 0) {
        throw commandError('COMMAND_PROJECTION_VERSION_INVALID');
      }
      return persistOutcome({
        envelope,
        payloadHash,
        status: 'committed',
        result,
        projectionVersion,
        createdAt,
      });
    });
    let response;
    try {
      response = typeof commit.immediate === 'function' ? commit.immediate() : commit();
    } catch (error) {
      if (typeof afterRollback === 'function') {
        afterRollback({
          envelope,
          error,
        });
      }
      return reject(envelope, payloadHash, error);
    }
    if (!response.replayed && typeof afterCommit === 'function') afterCommit(response);
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { RECEIPT_PROTOCOL, commandError, createAuthorityCommandService, digest, stableJson, validateCommand };
