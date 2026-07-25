const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { roleContextForUser } = require('./userRoleGrantService');
const { scopeForUser } = require('./authorizationPolicy');

const TOKEN_ISSUER = 'gewu-auth';
const TOKEN_AUDIENCE = 'gewu-api';
const TOKEN_USE = 'desktop-session';
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;
const RECENT_ELEVATION_MS = 15 * 60 * 1000;
const ELEVATION_PROOF_MAX_AGE_MS = 2 * 60 * 1000;
const PRIVILEGED_ROLES = new Set(['super_admin', 'admin']);

function serviceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
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

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_error) {
    return [];
  }
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every(function (value, index) { return value === right[index]; });
}

function desktopRoleElevationSigningPayload({
  sessionId,
  deviceId,
  activeRole,
  sessionVersion,
  elevationIssuedAt,
} = {}) {
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedDeviceId = String(deviceId || '').trim();
  const normalizedRole = String(activeRole || '').trim();
  const normalizedIssuedAt = String(elevationIssuedAt || '').trim();
  const version = Number(sessionVersion);
  if (!normalizedSessionId || !normalizedDeviceId || !normalizedRole
    || !Number.isSafeInteger(version) || version < 1
    || !Number.isFinite(Date.parse(normalizedIssuedAt))) {
    throw serviceError('DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID');
  }
  return [
    'gewu-desktop-role-elevation-v1',
    normalizedSessionId,
    normalizedDeviceId,
    normalizedRole,
    String(version),
    normalizedIssuedAt,
  ].join('\n');
}

function presentSession(row, roleContext) {
  return Object.freeze({
    id: row.sid,
    sid: row.sid,
    userId: row.user_id,
    deviceId: row.device_id,
    activeRole: row.active_role,
    eligibleRoles: Object.freeze(roleContext.eligibleRoles.slice()),
    teacherId: roleContext.teacherId,
    studentId: roleContext.studentId,
    authorizationId: row.authorization_id,
    authVersion: Number(row.auth_version),
    credentialVersion: Number(row.credential_version),
    authTime: row.auth_time || null,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    status: row.status,
    rowVersion: Number(row.row_version),
  });
}

function presentAuthorization(row) {
  return Object.freeze({
    id: row.id,
    deviceId: row.device_id,
    userId: row.user_id,
    status: row.status,
    credentialVersion: Number(row.credential_version),
    rowVersion: Number(row.row_version),
    revokedAt: row.revoked_at || null,
    replacedByDeviceId: row.replaced_by_device_id || null,
  });
}

function createDesktopSessionService({
  db,
  jwtSecret,
  now = function () { return new Date(); },
  uuid = uuidv4,
  maxSessionMs = MAX_SESSION_MS,
  isSingleUserModeActive = function () {
    return process.env.GEWU_DESKTOP_IDENTITY_MODE === 'single-user';
  },
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw serviceError('DESKTOP_SESSION_DB_REQUIRED');
  }
  if (!jwtSecret) throw serviceError('JWT_SECRET_REQUIRED');
  if (!Number.isSafeInteger(maxSessionMs) || maxSessionMs < 60 * 1000 || maxSessionMs > MAX_SESSION_MS) {
    throw serviceError('DESKTOP_SESSION_DURATION_INVALID');
  }

  const findUser = db.prepare('SELECT * FROM users WHERE id=? AND deleted=0');
  const findAuthorization = db.prepare(
    'SELECT * FROM desktop_device_authorizations WHERE device_id=?'
  );
  const findSession = db.prepare('SELECT * FROM desktop_sessions WHERE sid=?');
  const findActiveHostEpoch = db.prepare(
    "SELECT * FROM primary_host_epochs WHERE status='active' ORDER BY generation DESC LIMIT 1"
  );
  const insertAudit = db.prepare(`INSERT INTO authorization_audit_log
    (id, actor_user_id, target_user_id, action, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  function currentDate() {
    const value = now();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw serviceError('DESKTOP_SESSION_CLOCK_INVALID');
    return date;
  }

  function normalizeAuthTime(value, current) {
    if (value === undefined || value === null || value === '') return null;
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getTime() > current.getTime() + 30 * 1000) {
      throw serviceError('DESKTOP_SESSION_AUTH_TIME_INVALID');
    }
    return date.toISOString();
  }

  function assertAuthorizationSource(authorization, at) {
    const source = authorization.authorization_source || 'wechat_phone';
    if (source === 'wechat_phone') {
      if (Date.parse(authorization.phone_reverify_due_at) <= at.getTime()) {
        throw serviceError('DESKTOP_PHONE_REVERIFICATION_REQUIRED');
      }
      return authorization;
    }
    if (source !== 'single_user_pairing' && source !== 'single_user_local_bootstrap') {
      throw serviceError('DESKTOP_AUTHORIZATION_SOURCE_INVALID');
    }
    if (isSingleUserModeActive() !== true) {
      throw serviceError('DESKTOP_SINGLE_USER_AUTHORIZATION_DISABLED');
    }
    if (source === 'single_user_pairing') {
      if (authorization.device_kind !== 'desktop-client') {
        throw serviceError('DESKTOP_SINGLE_USER_AUTHORIZATION_KIND_INVALID');
      }
      return authorization;
    }
    const epoch = findActiveHostEpoch.get();
    if (authorization.device_kind !== 'primary-host' || !epoch
      || epoch.device_id !== authorization.device_id
      || epoch.user_id !== authorization.user_id
      || epoch.authorization_id !== authorization.id) {
      throw serviceError('DESKTOP_SINGLE_USER_HOST_EPOCH_MISMATCH');
    }
    return authorization;
  }

  function assertAuthorizationActive(authorization, userId, at) {
    if (!authorization || authorization.status !== 'active') {
      throw serviceError('DESKTOP_DEVICE_NOT_ACTIVE');
    }
    if (authorization.user_id !== userId) throw serviceError('DESKTOP_DEVICE_OWNER_MISMATCH');
    return assertAuthorizationSource(authorization, at);
  }

  function issueSessionAt(input = {}, current) {
    const userId = String(input.userId || '').trim();
    const deviceId = String(input.deviceId || '').trim();
    if (!userId || !deviceId) throw serviceError('DESKTOP_SESSION_INPUT_REQUIRED');
    const durationMs = input.durationMs === undefined ? maxSessionMs : Number(input.durationMs);
    if (!Number.isSafeInteger(durationMs) || durationMs < 60 * 1000 || durationMs > maxSessionMs) {
      throw serviceError('DESKTOP_SESSION_DURATION_INVALID');
    }
    const user = findUser.get(userId);
    if (!approvedUser(user)) throw serviceError('DESKTOP_SESSION_USER_NOT_ACTIVE');
    const authorization = assertAuthorizationActive(findAuthorization.get(deviceId), userId, current);
    const roleContext = roleContextForUser(db, userId, input.activeRole);
    const authTime = normalizeAuthTime(input.authTime, current);
    const issuedAt = current.toISOString();
    const expiresAt = new Date(current.getTime() + durationMs).toISOString();
    const sid = uuid();
    const eligibleRolesJson = JSON.stringify(roleContext.eligibleRoles);
    const authVersion = Number(user.auth_version || 1);
    const credentialVersion = Number(authorization.credential_version || 1);

    db.prepare(`INSERT INTO desktop_sessions
      (sid, user_id, device_id, authorization_id, active_role, eligible_roles_json,
       auth_version, credential_version, auth_time, status, issued_at, expires_at,
       row_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)`)
      .run(
        sid,
        userId,
        deviceId,
        authorization.id,
        roleContext.activeRole,
        eligibleRolesJson,
        authVersion,
        credentialVersion,
        authTime,
        issuedAt,
        expiresAt,
        issuedAt,
        issuedAt
      );
    const claims = {
      sub: userId,
      sid,
      device_id: deviceId,
      eligible_roles: roleContext.eligibleRoles,
      active_role: roleContext.activeRole,
      auth_version: authVersion,
      credential_version: credentialVersion,
      session_version: 1,
      auth_time: authTime ? Math.floor(Date.parse(authTime) / 1000) : null,
      token_use: TOKEN_USE,
      iss: TOKEN_ISSUER,
      aud: TOKEN_AUDIENCE,
      iat: Math.floor(current.getTime() / 1000),
      exp: Math.floor(Date.parse(expiresAt) / 1000),
    };
    const token = jwt.sign(claims, jwtSecret, { algorithm: 'HS256' });
    const row = findSession.get(sid);
    return Object.freeze({
      token,
      claims: Object.freeze({ ...claims, eligible_roles: Object.freeze(claims.eligible_roles.slice()) }),
      session: presentSession(row, roleContext),
    });
  }

  function issueSession(input = {}) {
    return issueSessionAt(input, currentDate());
  }

  function validateSessionClaims(claims = {}) {
    if (claims.token_use !== TOKEN_USE || claims.iss !== TOKEN_ISSUER || claims.aud !== TOKEN_AUDIENCE) {
      throw serviceError('DESKTOP_SESSION_TOKEN_INVALID');
    }
    const sid = String(claims.sid || '').trim();
    const userId = String(claims.sub || '').trim();
    const deviceId = String(claims.device_id || claims.deviceId || '').trim();
    if (!sid || !userId || !deviceId) throw serviceError('DESKTOP_SESSION_TOKEN_INVALID');
    const row = findSession.get(sid);
    if (!row) throw serviceError('DESKTOP_SESSION_NOT_FOUND');
    if (row.status === 'revoked') throw serviceError('DESKTOP_SESSION_REVOKED');
    if (row.status !== 'active') throw serviceError('DESKTOP_SESSION_EXPIRED');
    const current = currentDate();
    if (Date.parse(row.expires_at) <= current.getTime()) {
      db.prepare(`UPDATE desktop_sessions
        SET status='expired', row_version=row_version+1, updated_at=?
        WHERE sid=? AND status='active'`).run(current.toISOString(), sid);
      throw serviceError('DESKTOP_SESSION_EXPIRED');
    }
    if (row.user_id !== userId || row.device_id !== deviceId || row.active_role !== claims.active_role) {
      throw serviceError('DESKTOP_SESSION_CLAIMS_MISMATCH');
    }
    if (Number(claims.session_version) !== Number(row.row_version)) {
      throw serviceError('DESKTOP_SESSION_VERSION_MISMATCH');
    }
    const user = findUser.get(userId);
    if (!approvedUser(user)) throw serviceError('DESKTOP_SESSION_USER_NOT_ACTIVE');
    const userAuthVersion = Number(user.auth_version || 1);
    if (Number(row.auth_version) !== userAuthVersion || Number(claims.auth_version) !== userAuthVersion) {
      throw serviceError('DESKTOP_SESSION_AUTH_VERSION_MISMATCH');
    }
    const authorization = findAuthorization.get(deviceId);
    if (!authorization || authorization.status !== 'active') throw serviceError('DESKTOP_DEVICE_NOT_ACTIVE');
    if (authorization.id !== row.authorization_id || authorization.user_id !== userId) {
      throw serviceError('DESKTOP_DEVICE_OWNER_MISMATCH');
    }
    const credentialVersion = Number(authorization.credential_version || 1);
    if (Number(row.credential_version) !== credentialVersion
      || Number(claims.credential_version) !== credentialVersion) {
      throw serviceError('DESKTOP_SESSION_CREDENTIAL_VERSION_MISMATCH');
    }
    assertAuthorizationSource(authorization, current);
    const roleContext = roleContextForUser(db, userId, row.active_role);
    const persistedEligibleRoles = parseJsonArray(row.eligible_roles_json);
    if (!sameStringArray(roleContext.eligibleRoles, persistedEligibleRoles)
      || !sameStringArray(roleContext.eligibleRoles, claims.eligible_roles)) {
      throw serviceError('DESKTOP_SESSION_ROLE_VERSION_MISMATCH');
    }
    const expectedAuthTime = row.auth_time ? Math.floor(Date.parse(row.auth_time) / 1000) : null;
    if ((claims.auth_time ?? null) !== expectedAuthTime) {
      throw serviceError('DESKTOP_SESSION_CLAIMS_MISMATCH');
    }
    const scope = scopeForUser({
      ...user,
      ...roleContext,
    });
    return Object.freeze({
      userId,
      deviceId,
      sessionId: sid,
      tokenUse: TOKEN_USE,
      activeRole: roleContext.activeRole,
      role: roleContext.activeRole,
      eligibleRoles: Object.freeze(roleContext.eligibleRoles.slice()),
      teacherId: roleContext.teacherId,
      studentId: roleContext.studentId,
      authTime: row.auth_time || null,
      sessionExpiresAt: row.expires_at,
      authVersion: userAuthVersion,
      credentialVersion,
      authorizationId: authorization.id,
      authorizationRowVersion: Number(authorization.row_version),
      deviceKind: authorization.device_kind,
      sessionRowVersion: Number(row.row_version),
      scope: Object.freeze(scope),
      userApproved: true,
      deviceActive: true,
      deviceTrusted: true,
      clientType: 'desktop',
    });
  }

  function verifySessionToken(token) {
    let claims;
    try {
      claims = jwt.verify(String(token || ''), jwtSecret, {
        algorithms: ['HS256'],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        ignoreExpiration: true,
      });
    } catch (_error) {
      throw serviceError('DESKTOP_SESSION_TOKEN_INVALID');
    }
    return validateSessionClaims(claims);
  }

  function assertSuperAdmin(context) {
    if (!context || context.activeRole !== 'super_admin') {
      throw serviceError('DESKTOP_SUPER_ADMIN_ROLE_REQUIRED');
    }
    return context;
  }

  function assertRecentSuperAdmin(context, options = {}) {
    assertSuperAdmin(context);
    if (options.targetDeviceId && context.deviceId === options.targetDeviceId) {
      throw serviceError('DESKTOP_DEVICE_SELF_APPROVAL_FORBIDDEN');
    }
    const authTime = Date.parse(context.authTime || '');
    const current = currentDate().getTime();
    const maxAgeMs = options.maxAgeMs === undefined ? RECENT_ELEVATION_MS : Number(options.maxAgeMs);
    if (!Number.isFinite(authTime)
      || authTime > current + 30 * 1000
      || current - authTime > maxAgeMs) {
      throw serviceError('DESKTOP_RECENT_ELEVATION_REQUIRED');
    }
    return context;
  }

  function assertElevationProof(input, context, authorization, current) {
    const signature = String(input.elevationSignature || '').trim();
    if (!signature) throw serviceError('DESKTOP_ROLE_ELEVATION_SIGNATURE_REQUIRED');
    const issuedAt = String(input.elevationIssuedAt || '').trim();
    const issuedAtMs = Date.parse(issuedAt);
    if (!Number.isFinite(issuedAtMs)
      || issuedAtMs > current.getTime() + 30 * 1000
      || current.getTime() - issuedAtMs > ELEVATION_PROOF_MAX_AGE_MS) {
      throw serviceError('DESKTOP_ROLE_ELEVATION_PROOF_STALE');
    }
    const payload = desktopRoleElevationSigningPayload({
      sessionId: context.sessionId,
      deviceId: context.deviceId,
      activeRole: input.activeRole,
      sessionVersion: context.sessionRowVersion,
      elevationIssuedAt: issuedAt,
    });
    const signatureBuffer = Buffer.from(signature, 'base64');
    if (signatureBuffer.length !== 64) {
      throw serviceError('DESKTOP_ROLE_ELEVATION_SIGNATURE_INVALID');
    }
    let verified = false;
    try {
      verified = crypto.verify(
        null,
        Buffer.from(payload, 'utf8'),
        crypto.createPublicKey(authorization.public_key),
        signatureBuffer
      );
    } catch (_error) {
      verified = false;
    }
    if (!verified) throw serviceError('DESKTOP_ROLE_ELEVATION_SIGNATURE_INVALID');
  }

  function switchActiveRole(input = {}) {
    const context = input.actorContext;
    const activeRole = String(input.activeRole || '').trim();
    if (!context || !context.sessionId || !context.userId || !context.deviceId || !activeRole) {
      throw serviceError('DESKTOP_ROLE_SWITCH_INPUT_INVALID');
    }
    if (context.activeRole === activeRole) throw serviceError('DESKTOP_ACTIVE_ROLE_UNCHANGED');
    const roleContext = roleContextForUser(db, context.userId, activeRole);
    const current = currentDate();
    const authorization = assertAuthorizationActive(
      findAuthorization.get(context.deviceId),
      context.userId,
      current
    );
    const elevationRequired = (activeRole === 'super_admin' && context.activeRole !== 'super_admin')
      || (activeRole === 'admin' && !PRIVILEGED_ROLES.has(context.activeRole));
    if (elevationRequired) assertElevationProof(input, context, authorization, current);

    const rotate = db.transaction(function () {
      const previousSession = findSession.get(context.sessionId);
      if (!previousSession || previousSession.status !== 'active') {
        throw serviceError('DESKTOP_SESSION_REVOKED');
      }
      if (previousSession.user_id !== context.userId
        || previousSession.device_id !== context.deviceId
        || previousSession.active_role !== context.activeRole) {
        throw serviceError('DESKTOP_SESSION_CLAIMS_MISMATCH');
      }
      if (Number(previousSession.row_version) !== Number(context.sessionRowVersion)) {
        throw serviceError('DESKTOP_SESSION_VERSION_MISMATCH');
      }
      const remainingMs = Date.parse(previousSession.expires_at) - current.getTime();
      if (!Number.isSafeInteger(remainingMs) || remainingMs < 60 * 1000) {
        throw serviceError('DESKTOP_SESSION_EXPIRED');
      }
      const issued = issueSessionAt({
        userId: context.userId,
        deviceId: context.deviceId,
        activeRole: roleContext.activeRole,
        authTime: elevationRequired ? current : null,
        durationMs: Math.min(maxSessionMs, remainingMs),
      }, current);
      const revoked = db.prepare(`UPDATE desktop_sessions
        SET status='revoked', revoke_reason='role_switch', revoked_at=?,
            row_version=row_version+1, updated_at=?
        WHERE sid=? AND status='active' AND row_version=?`)
        .run(current.toISOString(), current.toISOString(), previousSession.sid, previousSession.row_version);
      if (revoked.changes !== 1) throw serviceError('DESKTOP_SESSION_VERSION_MISMATCH');
      insertAudit.run(
        uuid(),
        context.userId,
        context.userId,
        'desktop_session_active_role_switched',
        JSON.stringify({
          sessionId: previousSession.sid,
          deviceId: context.deviceId,
          activeRole: context.activeRole,
        }),
        JSON.stringify({
          sessionId: issued.session.sid,
          deviceId: context.deviceId,
          activeRole: roleContext.activeRole,
          elevated: elevationRequired,
        }),
        current.toISOString()
      );
      return issued;
    });
    return rotate();
  }

  function revokeDeviceAuthorization(input = {}) {
    const deviceId = String(input.deviceId || '').trim();
    if (!deviceId || !Number.isSafeInteger(input.expectedRowVersion)) {
      throw serviceError('DESKTOP_DEVICE_REVOCATION_INPUT_INVALID');
    }
    assertRecentSuperAdmin(input.actorContext, { targetDeviceId: deviceId });
    const allowedReasons = new Set(['lost', 'replaced', 'user_request', 'security']);
    const reason = String(input.reason || 'user_request');
    if (!allowedReasons.has(reason)) throw serviceError('DESKTOP_DEVICE_REVOCATION_REASON_INVALID');
    const replacementDeviceId = String(input.replacementDeviceId || '').trim();
    if ((reason === 'replaced' && (!replacementDeviceId || replacementDeviceId === deviceId))
      || (reason !== 'replaced' && replacementDeviceId)) {
      throw serviceError('DESKTOP_DEVICE_REPLACEMENT_INVALID');
    }
    const current = currentDate().toISOString();
    const revoke = db.transaction(function () {
      const authorization = findAuthorization.get(deviceId);
      if (!authorization) throw serviceError('DESKTOP_DEVICE_NOT_FOUND');
      if (Number(authorization.row_version) !== input.expectedRowVersion) {
        throw serviceError('DESKTOP_DEVICE_VERSION_STALE');
      }
      if (authorization.status !== 'active') throw serviceError('DESKTOP_DEVICE_NOT_ACTIVE');
      if (reason === 'replaced') {
        const replacement = findAuthorization.get(replacementDeviceId);
        if (!replacement
          || replacement.status !== 'active'
          || replacement.user_id !== authorization.user_id
          || !Number.isFinite(Date.parse(replacement.created_at))
          || !Number.isFinite(Date.parse(authorization.created_at))
          || Date.parse(replacement.created_at) <= Date.parse(authorization.created_at)) {
          throw serviceError('DESKTOP_DEVICE_REPLACEMENT_INVALID');
        }
      }
      const nextStatus = reason === 'replaced' ? 'replaced' : 'revoked';
      const updated = db.prepare(`UPDATE desktop_device_authorizations
        SET status=?, credential_version=credential_version+1,
            row_version=row_version+1, revoked_at=?, replaced_by_device_id=?, updated_at=?
        WHERE id=? AND status='active' AND row_version=?`)
        .run(nextStatus, current, replacementDeviceId || null, current, authorization.id, authorization.row_version);
      if (updated.changes !== 1) throw serviceError('DESKTOP_DEVICE_VERSION_STALE');
      db.prepare(`UPDATE desktop_sessions
        SET status='revoked', revoke_reason=?, revoked_at=?, row_version=row_version+1, updated_at=?
        WHERE device_id=? AND status='active'`)
        .run(reason, current, current, deviceId);
      insertAudit.run(
        uuid(),
        input.actorContext.userId,
        authorization.user_id,
        'desktop_device_authorization_revoked',
        JSON.stringify({
          authorizationId: authorization.id,
          deviceId,
          status: authorization.status,
          rowVersion: Number(authorization.row_version),
        }),
        JSON.stringify({
          authorizationId: authorization.id,
          deviceId,
          status: nextStatus,
          rowVersion: Number(authorization.row_version) + 1,
          reason,
          replacementDeviceId: replacementDeviceId || null,
        }),
        current
      );
      return findAuthorization.get(deviceId);
    });
    return presentAuthorization(revoke());
  }

  function revokeSessionsForDevice(deviceId, reason = 'security') {
    const current = currentDate().toISOString();
    return db.prepare(`UPDATE desktop_sessions
      SET status='revoked', revoke_reason=?, revoked_at=?, row_version=row_version+1, updated_at=?
      WHERE device_id=? AND status='active'`)
      .run(String(reason), current, current, String(deviceId)).changes;
  }

  return Object.freeze({
    assertRecentSuperAdmin,
    assertSuperAdmin,
    issueSession,
    revokeDeviceAuthorization,
    revokeSessionsForDevice,
    switchActiveRole,
    validateSessionClaims,
    verifySessionToken,
  });
}

module.exports = {
  MAX_SESSION_MS,
  RECENT_ELEVATION_MS,
  ELEVATION_PROOF_MAX_AGE_MS,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  TOKEN_USE,
  createDesktopSessionService,
  desktopRoleElevationSigningPayload,
};
