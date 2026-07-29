const { stableJson, validateEnvelope } = require('../../../shared/authorityProtocol');

function inboxError(code, statusCode) {
  return Object.assign(new Error(code), { code, statusCode });
}

function createAuthorityCommandInboxService({
  db,
  now = () => new Date().toISOString(),
  targetHostIdFor = envelope => envelope.authorityId,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw inboxError('AUTHORITY_COMMAND_INBOX_DATABASE_REQUIRED', 500);
  }

  function existingFor(envelope) {
    return db.prepare(`SELECT * FROM host_commands
      WHERE actor_user_id=? AND device_id=? AND idempotency_key=?`)
      .get(envelope.actor.userId, envelope.actor.deviceId, envelope.idempotencyKey);
  }

  function enqueue(input) {
    const envelope = validateEnvelope(input);
    const envelopeJson = stableJson(envelope);
    const existing = existingFor(envelope);
    if (existing) {
      const stored = JSON.parse(existing.envelope_json);
      if (stored.payloadHash !== envelope.payloadHash
        || stored.type !== envelope.type
        || stored.authorityId !== envelope.authorityId
        || stored.hostEpochId !== envelope.hostEpochId) {
        throw inboxError('COMMAND_IDEMPOTENCY_CONFLICT', 409);
      }
      return Object.freeze({ id: existing.command_id, status: existing.status, replayed: true });
    }
    const timestamp = now();
    const insert = db.transaction(() => {
      const raced = existingFor(envelope);
      if (raced) return enqueue(envelope);
      db.prepare(`INSERT INTO host_commands
        (command_id,target_host_id,actor_user_id,device_id,idempotency_key,envelope_json,payload_hash,
         status,claim_token,claim_until,row_version,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'pending',NULL,NULL,1,?,?)`)
        .run(
          envelope.commandId,
          String(targetHostIdFor(envelope)),
          envelope.actor.userId,
          envelope.actor.deviceId,
          envelope.idempotencyKey,
          envelopeJson,
          envelope.payloadHash,
          timestamp,
          timestamp,
        );
      return Object.freeze({ id: envelope.commandId, status: 'pending', replayed: false });
    });
    return typeof insert.immediate === 'function' ? insert.immediate() : insert();
  }

  function publishReceipt(receipt = {}, { claimToken } = {}) {
    const commandId = String(receipt.commandId || '').trim();
    const resultHash = String(receipt.resultHash || '').trim();
    const completedAt = String(receipt.completedAt || '').trim();
    const outcomeStatus = String(receipt.status || '');
    if (!commandId || !resultHash || !completedAt
      || !['committed', 'rejected'].includes(outcomeStatus)
      || !Number.isFinite(Date.parse(completedAt))) {
      throw inboxError('AUTHORITY_RECEIPT_INVALID', 400);
    }
    const command = db.prepare('SELECT * FROM host_commands WHERE command_id=?').get(commandId);
    if (!command) throw inboxError('AUTHORITY_COMMAND_NOT_FOUND', 404);
    const token = String(claimToken || '').trim();
    const currentTime = new Date(now());
    if (!token || command.status !== 'claimed' || command.claim_token !== token
      || !Number.isFinite(currentTime.getTime()) || Date.parse(command.claim_until) <= currentTime.getTime()) {
      throw inboxError('AUTHORITY_COMMAND_CLAIM_LOST', 409);
    }
    const receiptJson = stableJson(receipt);
    const existing = db.prepare('SELECT * FROM host_receipts WHERE command_id=?').get(commandId);
    if (existing) {
      if (existing.result_hash !== resultHash || existing.receipt_json !== receiptJson) {
        throw inboxError('AUTHORITY_RECEIPT_CONFLICT', 409);
      }
      return Object.freeze(JSON.parse(existing.receipt_json));
    }
    db.transaction(() => {
      db.prepare(`INSERT INTO host_receipts(command_id,result_hash,receipt_json,completed_at)
        VALUES(?,?,?,?)`).run(commandId, resultHash, receiptJson, new Date(completedAt).toISOString());
      const update = db.prepare(`UPDATE host_commands
        SET status=?, claim_token=NULL, claim_until=NULL, row_version=row_version+1, updated_at=?
        WHERE command_id=? AND status='claimed' AND claim_token=?`)
        .run(outcomeStatus === 'rejected' ? 'rejected' : 'completed',
          currentTime.toISOString(), commandId, token);
      if (update.changes !== 1) throw inboxError('AUTHORITY_COMMAND_CLAIM_LOST', 409);
    })();
    return Object.freeze(JSON.parse(receiptJson));
  }

  function claim({ targetHostId, claimToken, leaseMs = 30_000, limit = 10 } = {}) {
    const hostId = String(targetHostId || '').trim();
    const token = String(claimToken || '').trim();
    if (!hostId || !token || !Number.isSafeInteger(leaseMs) || leaseMs < 1_000
      || leaseMs > 5 * 60_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw inboxError('AUTHORITY_COMMAND_CLAIM_INPUT_INVALID', 400);
    }
    const current = new Date(now());
    if (!Number.isFinite(current.getTime())) throw inboxError('AUTHORITY_COMMAND_CLOCK_INVALID', 500);
    const currentIso = current.toISOString();
    const claimUntil = new Date(current.getTime() + leaseMs).toISOString();
    const transaction = db.transaction(() => {
      const rows = db.prepare(`SELECT * FROM host_commands
        WHERE target_host_id=?
          AND (status='pending' OR (status='claimed' AND claim_until<=?))
        ORDER BY created_at, command_id
        LIMIT ?`).all(hostId, currentIso, limit);
      const claimed = [];
      for (const row of rows) {
        const update = db.prepare(`UPDATE host_commands
          SET status='claimed', claim_token=?, claim_until=?, row_version=row_version+1, updated_at=?
          WHERE command_id=? AND row_version=?
            AND (status='pending' OR (status='claimed' AND claim_until<=?))`)
          .run(token, claimUntil, currentIso, row.command_id, row.row_version, currentIso);
        if (update.changes !== 1) continue;
        claimed.push(Object.freeze({
          commandId: row.command_id,
          envelope: Object.freeze(JSON.parse(row.envelope_json)),
          claimToken: token,
          claimUntil,
          recovered: row.status === 'claimed',
          rowVersion: row.row_version + 1,
        }));
      }
      return Object.freeze(claimed);
    });
    return typeof transaction.immediate === 'function' ? transaction.immediate() : transaction();
  }

  function renew({ commandId, claimToken, leaseMs = 30_000 } = {}) {
    const id = String(commandId || '').trim();
    const token = String(claimToken || '').trim();
    if (!id || !token || !Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 5 * 60_000) {
      throw inboxError('AUTHORITY_COMMAND_RENEW_INPUT_INVALID', 400);
    }
    const current = new Date(now());
    if (!Number.isFinite(current.getTime())) throw inboxError('AUTHORITY_COMMAND_CLOCK_INVALID', 500);
    const currentIso = current.toISOString();
    const claimUntil = new Date(current.getTime() + leaseMs).toISOString();
    const update = db.prepare(`UPDATE host_commands
      SET claim_until=?, row_version=row_version+1, updated_at=?
      WHERE command_id=? AND status='claimed' AND claim_token=? AND claim_until>?`)
      .run(claimUntil, currentIso, id, token, currentIso);
    if (update.changes !== 1) throw inboxError('AUTHORITY_COMMAND_CLAIM_LOST', 409);
    const row = db.prepare('SELECT row_version FROM host_commands WHERE command_id=?').get(id);
    return Object.freeze({ commandId: id, claimToken: token, claimUntil, rowVersion: row.row_version });
  }

  function findReceipt({ commandId, actor } = {}) {
    const row = db.prepare(`SELECT c.actor_user_id, c.device_id, r.receipt_json
      FROM host_commands c LEFT JOIN host_receipts r ON r.command_id=c.command_id
      WHERE c.command_id=?`).get(String(commandId || ''));
    if (!row) return null;
    if (row.actor_user_id !== String(actor?.userId || '') || row.device_id !== String(actor?.deviceId || '')) {
      throw inboxError('AUTHORITY_RECEIPT_FORBIDDEN', 403);
    }
    return row.receipt_json ? Object.freeze(JSON.parse(row.receipt_json)) : null;
  }

  return Object.freeze({ claim, enqueue, findReceipt, publishReceipt, renew });
}

module.exports = { createAuthorityCommandInboxService, inboxError };
