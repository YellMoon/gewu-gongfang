'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  RECEIPT_TTL_MS,
  normalizePrimaryHostLocalReceipt,
  primaryHostOperationManifestHash,
  verifyPrimaryHostLocalReceiptSignature,
} = require('./primaryHostReceiptProtocol');
const { runRelayQueueReadPreview } = require('./primaryHostSyncPreflightService');

const PREFLIGHT_PROOF_TTL_MS = 2 * 60 * 1000;
const OPERATIONS = new Set(['transfer', 'recovery']);

function proofError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requiredText(value, code, maxLength = 512) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw proofError(code);
  return normalized;
}

function positiveInteger(value, code) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw proofError(code);
  return normalized;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeHashEqual(value, expected) {
  const actualBuffer = Buffer.from(hash(value), 'hex');
  const expectedBuffer = Buffer.from(String(expected || ''), 'hex');
  return actualBuffer.length === expectedBuffer.length
    && actualBuffer.length === 32
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function createPrimaryHostPreflightProofService({
  db,
  now = () => new Date(),
  uuid = uuidv4,
  randomBytes = crypto.randomBytes,
  ttlMs = PREFLIGHT_PROOF_TTL_MS,
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw proofError('PRIMARY_HOST_PREFLIGHT_DB_REQUIRED');
  const proofTtlMs = Math.min(RECEIPT_TTL_MS, Math.max(1000, Number(ttlMs) || PREFLIGHT_PROOF_TTL_MS));

  function currentDate() {
    const value = now();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw proofError('PRIMARY_HOST_PREFLIGHT_CLOCK_INVALID');
    return date;
  }

  function resolveContext(input, { verifyReceipt = false } = {}) {
    const operation = requiredText(input.operation, 'PRIMARY_HOST_PREFLIGHT_OPERATION_REQUIRED', 32);
    if (!OPERATIONS.has(operation)) throw proofError('PRIMARY_HOST_PREFLIGHT_OPERATION_INVALID');
    const challengeId = requiredText(input.challengeId, 'PRIMARY_HOST_PREFLIGHT_CHALLENGE_REQUIRED', 128);
    const sourceEpochId = requiredText(input.sourceEpochId, 'PRIMARY_HOST_PREFLIGHT_EPOCH_REQUIRED', 128);
    const sourceGeneration = positiveInteger(input.sourceGeneration, 'PRIMARY_HOST_PREFLIGHT_GENERATION_INVALID');
    const targetGeneration = positiveInteger(input.targetGeneration, 'PRIMARY_HOST_PREFLIGHT_GENERATION_INVALID');
    if (targetGeneration !== sourceGeneration + 1) {
      throw proofError('PRIMARY_HOST_PREFLIGHT_GENERATION_INVALID');
    }
    const manifestHash = primaryHostOperationManifestHash(input.operationManifest);
    const localPreview = input.operationManifest?.localPreflight;
    const expectedActor = input.actorContext || {};
    if (!localPreview || localPreview.status !== 'ok'
      || !Number.isSafeInteger(Number(localPreview.tablesChecked)) || Number(localPreview.tablesChecked) < 1
      || localPreview.actor?.userId !== expectedActor.userId
      || localPreview.actor?.deviceId !== expectedActor.deviceId
      || localPreview.actor?.sessionId !== expectedActor.sessionId) {
      throw proofError('PRIMARY_HOST_LOCAL_PREFLIGHT_INVALID');
    }

    const active = db.prepare("SELECT * FROM primary_host_epochs WHERE status='active' ORDER BY generation DESC LIMIT 1").get();
    if (!active || active.id !== sourceEpochId || Number(active.generation) !== sourceGeneration) {
      throw proofError('PRIMARY_HOST_PREFLIGHT_EPOCH_CHANGED');
    }
    const challenge = db.prepare('SELECT * FROM primary_host_operation_challenges WHERE id=?').get(challengeId);
    const requiredChallengeStatus = operation === 'transfer' ? 'consumed' : 'identity_verified';
    if (!challenge || challenge.operation !== operation || challenge.status !== requiredChallengeStatus
      || challenge.requested_by_user_id !== expectedActor.userId
      || challenge.target_device_id !== expectedActor.deviceId) {
      throw proofError('PRIMARY_HOST_PREFLIGHT_CHALLENGE_CONTEXT_MISMATCH');
    }

    let transfer = null;
    let transferId = null;
    if (operation === 'transfer') {
      transferId = requiredText(input.transferId, 'PRIMARY_HOST_PREFLIGHT_TRANSFER_REQUIRED', 128);
      transfer = db.prepare('SELECT * FROM host_transfers WHERE id=?').get(transferId);
      if (!transfer || transfer.status !== 'pending_validation'
        || transfer.challenge_id !== challenge.id || transfer.source_epoch_id !== active.id
        || transfer.target_device_id !== expectedActor.deviceId || transfer.user_id !== expectedActor.userId
        || Number(transfer.source_generation) !== sourceGeneration
        || Number(transfer.target_generation) !== targetGeneration) {
        throw proofError('PRIMARY_HOST_PREFLIGHT_TRANSFER_CONTEXT_MISMATCH');
      }
    }

    const cloudPreflight = runRelayQueueReadPreview({
      db,
      actorContext: expectedActor,
      targetDeviceId: expectedActor.deviceId,
      now: currentDate(),
    });
    const authorization = db.prepare('SELECT * FROM desktop_device_authorizations WHERE id=?').get(
      cloudPreflight.actor.authorizationId
    );
    const session = db.prepare('SELECT * FROM desktop_sessions WHERE sid=?').get(cloudPreflight.actor.sessionId);
    if (!authorization || !session) throw proofError('PRIMARY_HOST_PREFLIGHT_ACTOR_MISMATCH');

    let receipt = null;
    if (verifyReceipt) {
      if (!input.localReceipt?.receipt || !input.localReceipt?.signature) {
        throw proofError('PRIMARY_HOST_PREFLIGHT_LOCAL_RECEIPT_INVALID');
      }
      receipt = normalizePrimaryHostLocalReceipt(input.localReceipt.receipt);
      verifyPrimaryHostLocalReceiptSignature({
        receipt,
        signature: input.localReceipt.signature,
        publicKey: authorization.public_key,
      });
      const current = currentDate().getTime();
      if (Date.parse(receipt.issuedAt) > current + 30000 || Date.parse(receipt.expiresAt) <= current) {
        throw proofError('PRIMARY_HOST_PREFLIGHT_LOCAL_RECEIPT_EXPIRED');
      }
      if (receipt.operation !== operation || receipt.challengeId !== challenge.id
        || receipt.userId !== cloudPreflight.actor.userId
        || receipt.deviceId !== cloudPreflight.actor.deviceId
        || receipt.authorizationId !== cloudPreflight.actor.authorizationId
        || receipt.credentialVersion !== cloudPreflight.actor.credentialVersion
        || receipt.operationManifestHash !== manifestHash) {
        throw proofError('PRIMARY_HOST_PREFLIGHT_LOCAL_RECEIPT_CONTEXT_MISMATCH');
      }
    }

    return {
      operation,
      challenge,
      transfer,
      transferId,
      active,
      sourceEpochId,
      sourceGeneration,
      targetGeneration,
      manifestHash,
      cloudPreflight,
      actor: cloudPreflight.actor,
      authorization,
      session,
      receipt,
    };
  }

  function issue(input = {}) {
    const context = resolveContext(input, { verifyReceipt: true });
    if (Object.hasOwn(input.operationManifest || {}, 'cloudPreflight')) {
      throw proofError('PRIMARY_HOST_PREFLIGHT_CLOUD_RESULT_FORBIDDEN');
    }
    const finalManifest = Object.freeze({
      ...input.operationManifest,
      cloudPreflight: context.cloudPreflight,
    });
    const finalManifestHash = primaryHostOperationManifestHash(finalManifest);
    const id = requiredText(uuid(), 'PRIMARY_HOST_PREFLIGHT_PROOF_ID_INVALID', 128);
    const token = Buffer.from(randomBytes(32)).toString('base64url');
    if (token.length < 32) throw proofError('PRIMARY_HOST_PREFLIGHT_PROOF_GENERATION_FAILED');
    const issuedAt = currentDate();
    const expiresAt = new Date(issuedAt.getTime() + proofTtlMs);
    db.prepare(`INSERT INTO primary_host_preflight_proofs
      (id,token_hash,operation,user_id,device_id,authorization_id,authorization_row_version,
       session_id,session_row_version,auth_version,credential_version,challenge_id,challenge_row_version,
       transfer_id,transfer_row_version,source_epoch_id,source_epoch_row_version,source_generation,
       target_generation,local_manifest_hash,manifest_hash,local_receipt_nonce,
       local_receipt_signature_hash,cloud_preflight_json,status,issued_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'issued',?,?)`)
      .run(
        id, hash(token), context.operation, context.actor.userId, context.actor.deviceId,
        context.authorization.id, context.authorization.row_version,
        context.session.sid, context.session.row_version, context.actor.authVersion,
        context.actor.credentialVersion, context.challenge.id, context.challenge.row_version,
        context.transferId, context.transfer?.row_version ?? null, context.active.id,
        context.active.row_version, context.sourceGeneration, context.targetGeneration,
        context.manifestHash, finalManifestHash, context.receipt.nonce, hash(input.localReceipt.signature),
        JSON.stringify(context.cloudPreflight), issuedAt.toISOString(), expiresAt.toISOString()
      );
    return Object.freeze({
      id,
      token,
      operation: context.operation,
      expiresAt: expiresAt.toISOString(),
      cloudPreflight: context.cloudPreflight,
      operationManifest: finalManifest,
    });
  }

  function consume(input = {}) {
    const proofId = requiredText(input.preflightProof?.id, 'PRIMARY_HOST_PREFLIGHT_PROOF_REQUIRED', 128);
    const token = requiredText(input.preflightProof?.token, 'PRIMARY_HOST_PREFLIGHT_PROOF_REQUIRED');
    const row = db.prepare('SELECT * FROM primary_host_preflight_proofs WHERE id=?').get(proofId);
    if (!row || !safeHashEqual(token, row.token_hash)) {
      throw proofError('PRIMARY_HOST_PREFLIGHT_PROOF_INVALID');
    }
    if (row.status !== 'issued' || row.consumed_at) {
      throw proofError('PRIMARY_HOST_PREFLIGHT_PROOF_REPLAYED');
    }
    const current = currentDate();
    if (Date.parse(row.expires_at) <= current.getTime()) {
      throw proofError('PRIMARY_HOST_PREFLIGHT_PROOF_EXPIRED');
    }
    const context = resolveContext(input);
    const mismatched = row.operation !== context.operation
      || row.user_id !== context.actor.userId || row.device_id !== context.actor.deviceId
      || row.authorization_id !== context.authorization.id
      || Number(row.authorization_row_version) !== Number(context.authorization.row_version)
      || row.session_id !== context.session.sid
      || Number(row.session_row_version) !== Number(context.session.row_version)
      || Number(row.auth_version) !== context.actor.authVersion
      || Number(row.credential_version) !== context.actor.credentialVersion
      || row.challenge_id !== context.challenge.id
      || Number(row.challenge_row_version) !== Number(context.challenge.row_version)
      || String(row.transfer_id || '') !== String(context.transferId || '')
      || Number(row.transfer_row_version || 0) !== Number(context.transfer?.row_version || 0)
      || row.source_epoch_id !== context.active.id
      || Number(row.source_epoch_row_version) !== Number(context.active.row_version)
      || Number(row.source_generation) !== context.sourceGeneration
      || Number(row.target_generation) !== context.targetGeneration
      || row.manifest_hash !== context.manifestHash
      || hash(input.localReceipt?.signature) !== row.local_receipt_signature_hash;
    if (mismatched) throw proofError('PRIMARY_HOST_PREFLIGHT_PROOF_CONTEXT_MISMATCH');
    const consumed = db.prepare(`UPDATE primary_host_preflight_proofs
      SET status='consumed', consumed_at=?
      WHERE id=? AND status='issued' AND consumed_at IS NULL`)
      .run(current.toISOString(), row.id);
    if (consumed.changes !== 1) throw proofError('PRIMARY_HOST_PREFLIGHT_PROOF_REPLAYED');
    return Object.freeze({
      id: row.id,
      operation: row.operation,
      manifestHash: row.manifest_hash,
      consumedAt: current.toISOString(),
    });
  }

  return Object.freeze({ consume, issue });
}

module.exports = {
  PREFLIGHT_PROOF_TTL_MS,
  createPrimaryHostPreflightProofService,
};
