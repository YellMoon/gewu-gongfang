const crypto = require('crypto');
const { stableJson } = require('./authorityProtocol');

const AUTHORITY_PROJECTION_PROTOCOL = 'gewu.authority-projection.v1';
const ROLE_SET = new Set(['visitor', 'student', 'family_member', 'teacher', 'super_admin']);

function projectionError(code) {
  return Object.assign(new Error(code), { code });
}

function requiredText(value, code, maxLength = 128) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw projectionError(code);
  return normalized;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedProjection(input = {}) {
  if (input.protocol !== AUTHORITY_PROJECTION_PROTOCOL) {
    throw projectionError('AUTHORITY_PROJECTION_PROTOCOL_INVALID');
  }
  const role = requiredText(input.role, 'AUTHORITY_PROJECTION_ROLE_INVALID', 32);
  if (!ROLE_SET.has(role)) throw projectionError('AUTHORITY_PROJECTION_ROLE_INVALID');
  const sourceVersion = Number(input.sourceVersion);
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 0) {
    throw projectionError('AUTHORITY_PROJECTION_VERSION_INVALID');
  }
  const generatedAt = requiredText(input.generatedAt, 'AUTHORITY_PROJECTION_TIMESTAMP_INVALID', 64);
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw projectionError('AUTHORITY_PROJECTION_TIMESTAMP_INVALID');
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw projectionError('AUTHORITY_PROJECTION_PAYLOAD_INVALID');
  }
  const payload = JSON.parse(JSON.stringify(input.payload));
  const payloadHash = sha256(stableJson(payload));
  if (input.payloadHash && input.payloadHash !== payloadHash) {
    throw projectionError('AUTHORITY_PROJECTION_PAYLOAD_HASH_INVALID');
  }
  return Object.freeze({
    protocol: AUTHORITY_PROJECTION_PROTOCOL,
    authorityId: requiredText(input.authorityId, 'AUTHORITY_PROJECTION_AUTHORITY_INVALID'),
    hostEpochId: requiredText(input.hostEpochId, 'AUTHORITY_PROJECTION_EPOCH_INVALID'),
    userId: requiredText(input.userId, 'AUTHORITY_PROJECTION_USER_INVALID'),
    role,
    sourceVersion,
    generatedAt,
    payload,
    payloadHash,
  });
}

function signingPayload(projection) {
  return stableJson(normalizedProjection(projection));
}

function createSignedAuthorityProjection({ privateKey, ...input } = {}) {
  const projection = normalizedProjection({
    protocol: AUTHORITY_PROJECTION_PROTOCOL,
    ...input,
  });
  let signature;
  try {
    signature = crypto.sign(
      null,
      Buffer.from(stableJson(projection), 'utf8'),
      privateKey
    ).toString('base64');
  } catch (_error) {
    throw projectionError('AUTHORITY_PROJECTION_SIGNING_FAILED');
  }
  return Object.freeze({ ...projection, signature });
}

function verifySignedAuthorityProjection({ projection, publicKey } = {}) {
  const normalized = normalizedProjection(projection);
  const signature = requiredText(
    projection?.signature,
    'AUTHORITY_PROJECTION_SIGNATURE_INVALID',
    1024
  );
  let valid = false;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(stableJson(normalized), 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64')
    );
  } catch (_error) {
    valid = false;
  }
  if (!valid) throw projectionError('AUTHORITY_PROJECTION_SIGNATURE_INVALID');
  return Object.freeze({ ...normalized, signature });
}

module.exports = {
  AUTHORITY_PROJECTION_PROTOCOL,
  createSignedAuthorityProjection,
  normalizedProjection,
  projectionError,
  signingPayload,
  verifySignedAuthorityProjection,
};
