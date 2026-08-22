'use strict';

const crypto = require('crypto');
const { types } = require('util');

const ENVELOPE_KEYS = Object.freeze([
  'version', 'ephemeralPublicKey', 'keyDerivationSalt', 'wrappedKeyNonce', 'wrappedKeyCiphertext', 'wrappedKeyTag',
  'contentNonce', 'contentTag', 'ciphertextSha256', 'ciphertextBytes', 'plaintextSha256', 'plaintextBytes',
]);

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, keys) {
  if (!plainObject(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
  }
  return value;
}

function id(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
  return value;
}

function text(value, { nullable = false, max = 255 } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max) throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
  return value;
}

function canonicalBase64url(value, { length = null, max = 4096 } = {}) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > max) throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || (length !== null && bytes.length !== length) || bytes.toString('base64url') !== value) throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
  return bytes;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function envelope(value) {
  const relay = exact(value, ENVELOPE_KEYS);
  if (relay.version !== 'x25519-aes-256-gcm-v1'
    || !/^[0-9a-f]{64}$/.test(relay.ciphertextSha256)
    || !/^[0-9a-f]{64}$/.test(relay.plaintextSha256)
    || !Number.isSafeInteger(relay.ciphertextBytes) || relay.ciphertextBytes < 1 || relay.ciphertextBytes > 64 * 1024 * 1024
    || !Number.isSafeInteger(relay.plaintextBytes) || relay.plaintextBytes < 0 || relay.plaintextBytes > 64 * 1024 * 1024) {
    throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
  }
  canonicalBase64url(relay.ephemeralPublicKey, { max: 512 });
  canonicalBase64url(relay.keyDerivationSalt, { length: 16 });
  canonicalBase64url(relay.wrappedKeyNonce, { length: 12 });
  canonicalBase64url(relay.wrappedKeyCiphertext, { length: 32 });
  canonicalBase64url(relay.wrappedKeyTag, { length: 16 });
  canonicalBase64url(relay.contentNonce, { length: 12 });
  canonicalBase64url(relay.contentTag, { length: 16 });
  return relay;
}

function expiry(value, now) {
  if (typeof value !== 'string' || value.length > 64) throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value
    || parsed.getTime() <= now.getTime() || parsed.getTime() > now.getTime() + (15 * 60 * 1000)) {
    throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
  }
  return parsed;
}

function createEncryptedStorageRelayRepository({ query, now = () => new Date() } = {}) {
  if (typeof query !== 'function' || typeof now !== 'function') throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
  return Object.freeze({
    async create(input) {
      const request = exact(input, [
        'tenantId', 'actorAccountId', 'questionId', 'assetId', 'taskId', 'objectId', 'objectVersion',
        'assetType', 'fileName', 'mimeType', 'agentKeyFingerprint', 'envelope', 'ciphertext', 'expiresAt',
      ]);
      const currentNow = now();
      if (!(currentNow instanceof Date) || !Number.isFinite(currentNow.getTime())) throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
      const tenantId = text(request.tenantId, { max: 128 });
      const actorAccountId = text(request.actorAccountId, { max: 128 });
      const questionId = text(request.questionId, { max: 128 });
      const assetId = id(request.assetId, /^asset_[A-Za-z0-9_-]{1,128}$/);
      const taskId = id(request.taskId, /^task_[A-Za-z0-9_-]{8,128}$/);
      const objectId = id(request.objectId, /^obj_[A-Za-z0-9_-]{1,128}$/);
      if (!Number.isSafeInteger(request.objectVersion) || request.objectVersion < 1) throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
      const assetType = text(request.assetType, { max: 128 });
      const fileName = request.fileName === null ? null : text(request.fileName, { max: 512 });
      const mimeType = text(request.mimeType, { max: 255 });
      const agentKeyFingerprint = id(request.agentKeyFingerprint, /^[0-9a-f]{64}$/);
      const currentEnvelope = envelope(request.envelope);
      const ciphertext = Buffer.isBuffer(request.ciphertext) ? Buffer.from(request.ciphertext) : null;
      if (!ciphertext || ciphertext.length !== currentEnvelope.ciphertextBytes || sha256(ciphertext) !== currentEnvelope.ciphertextSha256) {
        throw failure('ENCRYPTED_RELAY_INPUT_INVALID');
      }
      const expiresAt = expiry(request.expiresAt, currentNow);
      const result = await query(
        `WITH target_question AS (
           SELECT id FROM business.questions WHERE tenant_id=$1 AND id=$2 AND deleted=false
         ), inserted_asset AS (
           INSERT INTO business.question_assets (id,tenant_id,question_id,asset_type,file_name,mime_type,size_bytes,storage_object_id,storage_object_version,content_hash,state)
           SELECT $3,$1,q.id,$4,$5,$6,$7,$8,$9,$10,'queued' FROM target_question q
           RETURNING id
         ), inserted_task AS (
           INSERT INTO business.storage_object_tasks (task_id,object_id,object_version,expected_sha256,expected_bytes,media_type,state)
           SELECT $11,$8,$9,$10,$7,$6,'queued' FROM inserted_asset
           RETURNING task_id
         ), inserted_relay AS (
           INSERT INTO business.encrypted_storage_relays (task_id,tenant_id,question_asset_id,actor_account_id,agent_key_fingerprint,envelope_json,ciphertext,ciphertext_sha256,expires_at)
           SELECT task_id,$1,$3,$12,$13,$14::jsonb,$15,$16,$17::timestamptz FROM inserted_task
           RETURNING task_id AS "taskId",question_asset_id AS "assetId",expires_at AS "expiresAt"
         ) SELECT * FROM inserted_relay`,
        [tenantId, questionId, assetId, assetType, fileName, mimeType, currentEnvelope.plaintextBytes, objectId,
          request.objectVersion, currentEnvelope.plaintextSha256, taskId, actorAccountId, agentKeyFingerprint,
          JSON.stringify(currentEnvelope), ciphertext, currentEnvelope.ciphertextSha256, expiresAt.toISOString()],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('ENCRYPTED_RELAY_UNAVAILABLE');
      const row = result.rows[0];
      if (!plainObject(row) || row.taskId !== taskId || row.assetId !== assetId || !(row.expiresAt instanceof Date)) throw failure('ENCRYPTED_RELAY_UNAVAILABLE');
      return { taskId, assetId, expiresAt: row.expiresAt.toISOString() };
    },
  });
}

module.exports = Object.freeze({ createEncryptedStorageRelayRepository });
