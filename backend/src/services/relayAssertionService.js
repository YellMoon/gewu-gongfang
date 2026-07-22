const crypto = require('crypto');
const { roleContextForUser } = require('./userRoleGrantService');
const { scopeForUser } = require('./authorizationPolicy');

const ASSERTION_VERSION = 2;
const MAX_ASSERTION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const ACTIVE_ROLES = new Set(['super_admin', 'admin', 'teacher', 'student']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function requiredString(value) {
  const normalized = String(value || '').trim();
  return normalized && normalized.length <= 128 ? normalized : '';
}

function requiredVersion(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 1 ? normalized : null;
}

function normalizeClaims(claims = {}) {
  const issuedAt = Number(claims.issuedAt);
  const expiresAt = Number(claims.expiresAt);
  const payload = {
    version: ASSERTION_VERSION,
    taskId: requiredString(claims.taskId),
    actorUserId: requiredString(claims.actorUserId),
    deviceId: requiredString(claims.deviceId),
    sessionId: requiredString(claims.sessionId),
    activeRole: requiredString(claims.activeRole),
    teacherId: claims.teacherId ? requiredString(claims.teacherId) : null,
    authVersion: requiredVersion(claims.authVersion),
    credentialVersion: requiredVersion(claims.credentialVersion),
    issuedAt,
    expiresAt,
    nonce: requiredString(claims.nonce),
  };
  if (!payload.taskId || !payload.actorUserId || !payload.deviceId || !payload.sessionId
    || !ACTIVE_ROLES.has(payload.activeRole) || !payload.authVersion || !payload.credentialVersion
    || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)
    || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_ASSERTION_LIFETIME_MS
    || !payload.nonce || (payload.activeRole === 'teacher' && !payload.teacherId)) {
    fail('RELAY_ASSERTION_INVALID');
  }
  return payload;
}

function canonical(value) {
  return JSON.stringify([
    ASSERTION_VERSION,
    value.taskId,
    value.actorUserId,
    value.deviceId,
    value.sessionId,
    value.activeRole,
    value.teacherId,
    value.authVersion,
    value.credentialVersion,
    value.issuedAt,
    value.expiresAt,
    value.nonce,
  ]);
}

function issueRelayAssertion(claims, secret) {
  if (!secret) fail('RELAY_ASSERTION_SECRET_REQUIRED');
  const current = Date.now();
  const payload = normalizeClaims({
    ...claims,
    issuedAt: claims?.issuedAt ?? current,
    nonce: claims?.nonce || crypto.randomBytes(18).toString('hex'),
  });
  return {
    ...payload,
    signature: crypto.createHmac('sha256', secret).update(canonical(payload)).digest('hex'),
  };
}

function verifyRelayAssertion(assertion, secret, options = {}) {
  if (!secret) fail('RELAY_ASSERTION_SECRET_REQUIRED');
  if (!assertion?.signature || Number(assertion.version || ASSERTION_VERSION) !== ASSERTION_VERSION) {
    fail('RELAY_ASSERTION_INVALID');
  }
  const payload = normalizeClaims(assertion);
  const expected = crypto.createHmac('sha256', secret).update(canonical(payload)).digest();
  const supplied = Buffer.from(String(assertion.signature), 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    fail('RELAY_ASSERTION_INVALID');
  }
  const now = Number(options.now ?? Date.now());
  const maxAgeMs = Number(options.maxAgeMs ?? MAX_ASSERTION_LIFETIME_MS);
  if (!Number.isFinite(now) || payload.issuedAt > now + 30000 || payload.expiresAt <= now
    || now - payload.issuedAt > maxAgeMs) {
    fail('RELAY_ASSERTION_EXPIRED');
  }
  return Object.freeze({ ...payload });
}

function approvedUser(user) {
  return Boolean(user)
    && user.deleted !== 1
    && user.deleted !== true
    && user.status !== 0
    && user.status !== false
    && user.status !== 'inactive'
    && user.status !== 'disabled'
    && user.login_enabled !== 0
    && user.login_enabled !== false
    && user.review_status === 'approved';
}

function resolveRelaySessionActorContext(database, claims, options = {}) {
  const db = database?.db || database;
  if (!db || typeof db.prepare !== 'function') fail('RELAY_SESSION_DB_REQUIRED');
  const now = Number(options.now ?? Date.now());
  if (!Number.isFinite(now)) fail('RELAY_SESSION_CLOCK_INVALID');

  const user = db.prepare('SELECT * FROM users WHERE id=? AND deleted=0').get(claims.actorUserId);
  if (!approvedUser(user)) fail('RELAY_SESSION_USER_NOT_ACTIVE');
  if (Number(user.auth_version || 1) !== Number(claims.authVersion)) {
    fail('RELAY_SESSION_AUTH_VERSION_MISMATCH');
  }

  const authorization = db.prepare(
    'SELECT * FROM desktop_device_authorizations WHERE device_id=?'
  ).get(claims.deviceId);
  if (!authorization || authorization.status !== 'active') fail('RELAY_SESSION_DEVICE_NOT_ACTIVE');
  if (authorization.user_id !== claims.actorUserId) fail('RELAY_SESSION_DEVICE_OWNER_MISMATCH');
  if (Number(authorization.credential_version) !== Number(claims.credentialVersion)) {
    fail('RELAY_SESSION_CREDENTIAL_VERSION_MISMATCH');
  }

  const session = db.prepare('SELECT * FROM desktop_sessions WHERE sid=?').get(claims.sessionId);
  if (!session || session.status !== 'active' || Date.parse(session.expires_at) <= now) {
    fail('RELAY_SESSION_NOT_ACTIVE');
  }
  if (session.user_id !== claims.actorUserId
    || session.device_id !== claims.deviceId
    || session.authorization_id !== authorization.id
    || session.active_role !== claims.activeRole
    || Number(session.auth_version) !== Number(claims.authVersion)
    || Number(session.credential_version) !== Number(claims.credentialVersion)
    || Number(claims.expiresAt) > Date.parse(session.expires_at)) {
    fail('RELAY_SESSION_CLAIMS_MISMATCH');
  }

  let roleContext;
  try {
    roleContext = roleContextForUser(db, claims.actorUserId, claims.activeRole);
  } catch (_error) {
    fail('RELAY_SESSION_ROLE_MISMATCH');
  }
  if (roleContext.activeRole !== claims.activeRole
    || (claims.activeRole === 'teacher' && roleContext.teacherId !== claims.teacherId)) {
    fail('RELAY_SESSION_ROLE_MISMATCH');
  }

  let syncDevice = db.prepare('SELECT * FROM sync_devices WHERE id=?').get(claims.deviceId);
  if (!syncDevice && typeof database?.registerSyncDevice === 'function') {
    database.registerSyncDevice(claims.deviceId, {
      ownerUserId: claims.actorUserId,
      deviceName: authorization.device_name || claims.deviceId,
      role: 'desktop-client',
      trusted: true,
    });
    syncDevice = db.prepare('SELECT * FROM sync_devices WHERE id=?').get(claims.deviceId);
  }
  if (!syncDevice || syncDevice.active !== 1 || syncDevice.owner_user_id !== claims.actorUserId) {
    fail('RELAY_SESSION_SYNC_DEVICE_MISMATCH');
  }

  const role = roleContext.activeRole;
  return Object.freeze({
    kind: ['super_admin', 'admin'].includes(role) ? 'admin' : role,
    role,
    activeRole: role,
    eligibleRoles: Object.freeze(roleContext.eligibleRoles.slice()),
    userId: claims.actorUserId,
    teacherId: roleContext.teacherId,
    studentId: roleContext.studentId,
    deviceId: claims.deviceId,
    authorizationId: authorization.id,
    sessionId: claims.sessionId,
    authVersion: Number(claims.authVersion),
    credentialVersion: Number(claims.credentialVersion),
    scope: Object.freeze(scopeForUser({ ...user, ...roleContext })),
    userApproved: true,
    deviceTrusted: true,
    deviceActive: true,
    deviceOwnerUserId: claims.actorUserId,
  });
}

module.exports = {
  ASSERTION_VERSION,
  issueRelayAssertion,
  resolveRelaySessionActorContext,
  verifyRelayAssertion,
};
