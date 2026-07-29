const crypto = require('crypto');

const MIN_LEASE_MS = 15 * 60 * 1000;
const MAX_LEASE_MS = 60 * 60 * 1000;

function leaseError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function canonicalLease(lease = {}) {
  return [
    lease.id, lease.userId, lease.deviceId, lease.authorityId,
    String(lease.grantVersion), lease.activeRole,
    JSON.stringify(lease.scope || {}), lease.issuedAt, lease.expiresAt,
  ].join('\n');
}

function createDeviceLeaseService({ secret, now = () => new Date(), randomId = () => crypto.randomUUID() } = {}) {
  const key = String(secret || '');
  if (key.length < 16) throw leaseError('DEVICE_LEASE_SECRET_REQUIRED');
  function sign(lease) {
    return crypto.createHmac('sha256', key).update(canonicalLease(lease)).digest('base64url');
  }
  function issue(input = {}) {
    const issuedAt = now();
    const current = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
    const durationMs = Number(input.durationMs || input.duration_ms || MIN_LEASE_MS);
    const userId = String(input.userId || input.user_id || '').trim();
    const deviceId = String(input.deviceId || input.device_id || '').trim();
    const authorityId = String(input.authorityId || input.authority_id || '').trim();
    const activeRole = String(input.activeRole || input.active_role || '').trim();
    const grantVersion = Number(input.grantVersion || input.grant_version);
    if (!Number.isFinite(current.getTime()) || !userId || !deviceId || !authorityId || !activeRole
      || !Number.isSafeInteger(grantVersion) || grantVersion < 1) throw leaseError('DEVICE_LEASE_INPUT_INVALID');
    if (!Number.isSafeInteger(durationMs) || durationMs < MIN_LEASE_MS || durationMs > MAX_LEASE_MS) {
      throw leaseError('DEVICE_LEASE_DURATION_INVALID');
    }
    const lease = {
      id: String(randomId()), userId, deviceId, authorityId, grantVersion, activeRole,
      scope: input.scope && typeof input.scope === 'object' ? input.scope : {},
      issuedAt: current.toISOString(), expiresAt: new Date(current.getTime() + durationMs).toISOString(),
    };
    return Object.freeze({ ...lease, signature: sign(lease) });
  }
  function verify(lease = {}, verification = {}) {
    const expected = sign(lease);
    const actual = String(lease.signature || '');
    if (!actual || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
      throw leaseError('DEVICE_LEASE_SIGNATURE_INVALID');
    }
    const current = verification.now instanceof Date ? verification.now : verification.now ? new Date(verification.now) : now();
    const issuedAt = Date.parse(String(lease.issuedAt || ''));
    const expiresAt = Date.parse(String(lease.expiresAt || ''));
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= current.getTime() || expiresAt - issuedAt > MAX_LEASE_MS) {
      throw leaseError('DEVICE_LEASE_EXPIRED');
    }
    if (verification.grantVersion !== undefined && Number(verification.grantVersion) !== Number(lease.grantVersion)) {
      throw leaseError('DEVICE_LEASE_GRANT_VERSION_STALE');
    }
    return Object.freeze({ ...lease });
  }
  return Object.freeze({ issue, verify });
}

module.exports = { MAX_LEASE_MS, MIN_LEASE_MS, createDeviceLeaseService, leaseError };
