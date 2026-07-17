const crypto = require('crypto');

const ASSERTION_VERSION = 2;
const MAX_ASSERTION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const ACTIVE_ROLES = new Set(['super_admin', 'admin', 'teacher', 'student']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function normalizeClaims(claims = {}) {
  const issuedAt = Number(claims.issuedAt);
  const expiresAt = Number(claims.expiresAt);
  const value = {
    version: ASSERTION_VERSION,
    taskId: String(claims.taskId || '').trim(),
    actorUserId: String(claims.actorUserId || '').trim(),
    deviceId: String(claims.deviceId || '').trim(),
    sessionId: String(claims.sessionId || '').trim(),
    activeRole: String(claims.activeRole || '').trim(),
    teacherId: claims.teacherId ? String(claims.teacherId).trim() : null,
    authVersion: Number(claims.authVersion),
    credentialVersion: Number(claims.credentialVersion),
    issuedAt,
    expiresAt,
    nonce: String(claims.nonce || '').trim(),
  };
  if (!value.taskId || !value.actorUserId || !value.deviceId || !value.sessionId
    || !ACTIVE_ROLES.has(value.activeRole)
    || !Number.isSafeInteger(value.authVersion) || value.authVersion < 1
    || !Number.isSafeInteger(value.credentialVersion) || value.credentialVersion < 1
    || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)
    || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_ASSERTION_LIFETIME_MS
    || !value.nonce || (value.activeRole === 'teacher' && !value.teacherId)) {
    fail('RELAY_ASSERTION_INVALID');
  }
  return value;
}

function canonical(value) {
  return JSON.stringify([
    ASSERTION_VERSION, value.taskId, value.actorUserId, value.deviceId, value.sessionId,
    value.activeRole, value.teacherId, value.authVersion, value.credentialVersion,
    value.issuedAt, value.expiresAt, value.nonce,
  ]);
}

function issueRelayAssertion(claims, secret) {
  if (!secret) fail('RELAY_ASSERTION_SECRET_REQUIRED');
  const issuedAt = claims?.issuedAt ?? Date.now();
  const value = normalizeClaims({
    ...claims,
    issuedAt,
    nonce: claims?.nonce || crypto.randomBytes(18).toString('hex'),
  });
  return {
    ...value,
    signature: crypto.createHmac('sha256', secret).update(canonical(value)).digest('hex'),
  };
}

module.exports = { ASSERTION_VERSION, issueRelayAssertion };
