/**
 * JWT authentication and lightweight authorization helpers.
 */
const jwt = require('jsonwebtoken');
const { getInstance } = require('../database');
const { roleForUser, scopeForUser } = require('../services/authorizationPolicy');
const {
  FORMAL_AUDIENCE,
  FORMAL_TOKEN_USE,
  TOKEN_ISSUER,
  VISITOR_TOKEN_USE,
  createMiniappIdentityService,
} = require('../services/miniappIdentityService');
const { createDesktopSessionService } = require('../services/desktopSessionService');

const JWT_SECRET = process.env.JWT_SECRET || null;
let cachedIdentityDb = null;
let cachedIdentityService = null;
let cachedDesktopSessionDb = null;
let cachedDesktopSessionService = null;

function identityServiceFor(db) {
  if (!cachedIdentityService || cachedIdentityDb !== db) {
    cachedIdentityDb = db;
    cachedIdentityService = createMiniappIdentityService({ db, jwtSecret: JWT_SECRET });
  }
  return cachedIdentityService;
}

function desktopSessionServiceFor(db) {
  if (!cachedDesktopSessionService || cachedDesktopSessionDb !== db) {
    cachedDesktopSessionDb = db;
    cachedDesktopSessionService = createDesktopSessionService({ db, jwtSecret: JWT_SECRET });
  }
  return cachedDesktopSessionService;
}

function verifyToken(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET_REQUIRED');
  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  if (decoded.token_use === 'review-demo') {
    const error = new Error('REVIEW_TOKEN_NOT_ACCEPTED_BY_BACKEND');
    error.code = 'REVIEW_TOKEN_NOT_ACCEPTED_BY_BACKEND';
    throw error;
  }
  if (!decoded.token_use
    && (Object.prototype.hasOwnProperty.call(decoded, 'phone')
      || Object.prototype.hasOwnProperty.call(decoded, 'openid'))) {
    const error = new Error('LEGACY_MINIAPP_TOKEN_RELOGIN_REQUIRED');
    error.code = 'LEGACY_MINIAPP_TOKEN_RELOGIN_REQUIRED';
    throw error;
  }
  if (['desktop-session', 'desktop-relay-session'].includes(decoded.token_use)
    && (decoded.iss !== 'gewu-auth' || decoded.aud !== 'gewu-api')) {
    throw new Error('TOKEN_AUDIENCE_INVALID');
  }
  if (decoded.token_use === FORMAL_TOKEN_USE && (decoded.iss !== TOKEN_ISSUER || decoded.aud !== FORMAL_AUDIENCE)) {
    throw new Error('TOKEN_AUDIENCE_INVALID');
  }
  if (decoded.token_use === 'unrecognized-student') {
    const error = new Error('LEGACY_MINIAPP_TOKEN_RELOGIN_REQUIRED');
    error.code = 'LEGACY_MINIAPP_TOKEN_RELOGIN_REQUIRED';
    throw error;
  }
  if (decoded.token_use === VISITOR_TOKEN_USE
    && (decoded.iss !== TOKEN_ISSUER || decoded.aud !== FORMAL_AUDIENCE)) {
    throw new Error('TOKEN_AUDIENCE_INVALID');
  }
  return decoded;
}

function sendAuthError(res, status, message, code) {
  return res.status(status).json({
    success: false,
    error: message,
    code,
    message,
    traceId: res.req?.traceId,
  });
}

function isDevAuthBypassed() {
  return process.env.NODE_ENV === 'test' && process.env.GEWU_TEST_AUTH_BYPASS === '1';
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.split(' ')[1];
}

function attachRelayedDesktopAuthorizationContext(req, tokenUser) {
  if (tokenUser?.token_use !== 'desktop-relay-session') return false;
  const requestScope = String(req.originalUrl || req.baseUrl || '').split('?')[0];
  if (requestScope !== '/api/cloud' && !requestScope.startsWith('/api/cloud/')) {
    const error = new Error('DESKTOP_RELAY_SESSION_SCOPE_INVALID');
    error.code = 'DESKTOP_RELAY_SESSION_SCOPE_INVALID';
    throw error;
  }
  const allowedRoles = new Set(['super_admin', 'admin', 'teacher', 'student']);
  const userId = String(tokenUser.sub || '').trim();
  const sessionId = String(tokenUser.sid || '').trim();
  const deviceId = String(tokenUser.device_id || '').trim();
  const activeRole = String(tokenUser.active_role || '').trim();
  const eligibleRoles = Array.isArray(tokenUser.eligible_roles)
    ? Array.from(new Set(tokenUser.eligible_roles.map(role => String(role || '').trim())))
    : [];
  const teacherId = tokenUser.teacher_id ? String(tokenUser.teacher_id).trim() : null;
  const studentId = tokenUser.student_id ? String(tokenUser.student_id).trim() : null;
  const authVersion = Number(tokenUser.auth_version);
  const credentialVersion = Number(tokenUser.credential_version);
  const sessionExpiresAt = Number.isFinite(Number(tokenUser.exp))
    ? new Date(Number(tokenUser.exp) * 1000).toISOString()
    : null;
  const valid = userId && userId.length <= 128
    && sessionId && sessionId.length <= 128
    && deviceId && deviceId.length <= 128
    && allowedRoles.has(activeRole)
    && eligibleRoles.length > 0
    && eligibleRoles.every(role => allowedRoles.has(role))
    && eligibleRoles.includes(activeRole)
    && Number.isSafeInteger(authVersion) && authVersion >= 1
    && Number.isSafeInteger(credentialVersion) && credentialVersion >= 1
    && sessionExpiresAt
    && (activeRole !== 'teacher' || Boolean(teacherId))
    && (activeRole !== 'student' || Boolean(studentId));
  if (!valid) {
    const error = new Error('DESKTOP_RELAY_SESSION_CLAIMS_INVALID');
    error.code = 'DESKTOP_RELAY_SESSION_CLAIMS_INVALID';
    throw error;
  }
  const headerDeviceId = String(req.headers['x-device-id'] || '').trim();
  if (headerDeviceId && headerDeviceId !== deviceId) {
    const error = new Error('DESKTOP_DEVICE_HEADER_MISMATCH');
    error.code = 'DESKTOP_DEVICE_HEADER_MISMATCH';
    throw error;
  }
  const user = {
    id: userId,
    role: activeRole,
    user_type: activeRole,
    activeRole,
    eligibleRoles,
    teacher_id: teacherId,
    teacherId,
    student_id: studentId,
    studentId,
    status: 1,
    login_enabled: 1,
    review_status: 'approved',
    deleted: 0,
    is_super_admin_identity: activeRole === 'super_admin',
  };
  req.user = user;
  req.authz = {
    userId,
    phone: null,
    role: activeRole,
    activeRole,
    eligibleRoles,
    scope: scopeForUser(user),
    teacherId,
    studentId,
    deviceId,
    tokenDeviceId: deviceId,
    tokenUse: 'desktop-relay-session',
    authVersion,
    sessionId,
    sessionExpiresAt,
    authTime: Number.isFinite(Number(tokenUser.iat))
      ? new Date(Number(tokenUser.iat) * 1000).toISOString()
      : null,
    credentialVersion,
    authorizationId: null,
    authorizationRowVersion: null,
    deviceKind: 'desktop-client',
    identityKind: 'desktop-relay',
    accountState: 'formal',
    runtimeNodeRole: process.env.GEWU_NODE_ROLE || 'desktop-client',
    deviceTrusted: true,
    deviceActive: true,
    deviceOwnerUserId: userId,
    userApproved: true,
    clientType: 'desktop',
    isPrimaryHost: false,
  };
  return true;
}

function attachAuthorizationContext(req, tokenUser) {
  if (attachRelayedDesktopAuthorizationContext(req, tokenUser)) return true;
  let user = null;
  const database = getInstance().db;
  const miniappToken = tokenUser?.token_use === FORMAL_TOKEN_USE
    || tokenUser?.token_use === VISITOR_TOKEN_USE
    ;
  const desktopToken = tokenUser?.token_use === 'desktop-session';
  let desktopContext = null;
  if (desktopToken) {
    desktopContext = desktopSessionServiceFor(database).validateSessionClaims(tokenUser);
    user = database.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(desktopContext.userId);
  } else if (miniappToken) {
    user = identityServiceFor(database).readIdentityForToken(tokenUser);
  } else {
    try {
      const userId = tokenUser?.sub || tokenUser?.id;
      const persisted = userId ? database.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(userId) : null;
      if (persisted) user = persisted;
    } catch (error) {
      console.error('[Auth] persisted identity lookup failed', error?.code || error?.message || 'unknown');
    }
  }
  if (!user) {
    req.user = undefined;
    req.authz = undefined;
    return false;
  }
  req.user = desktopContext
    ? {
      ...user,
      role: desktopContext.activeRole,
      user_type: desktopContext.activeRole,
      activeRole: desktopContext.activeRole,
      eligibleRoles: desktopContext.eligibleRoles,
      teacherId: desktopContext.teacherId,
      studentId: desktopContext.studentId,
    }
    : user;
  const tokenDeviceId = tokenUser?.device_id || tokenUser?.deviceId || null;
  const headerDeviceId = req.headers['x-device-id'] || null;
  if (desktopContext && headerDeviceId && tokenDeviceId !== headerDeviceId) {
    const error = new Error('DESKTOP_DEVICE_HEADER_MISMATCH');
    error.code = 'DESKTOP_DEVICE_HEADER_MISMATCH';
    throw error;
  }
  const deviceId = desktopContext
    ? desktopContext.deviceId
    : tokenDeviceId && tokenDeviceId === headerDeviceId ? tokenDeviceId : null;
  const device = !desktopContext && deviceId
    ? database.prepare('SELECT * FROM sync_devices WHERE id = ?').get(deviceId)
    : null;
  const userApproved = user.review_status === 'approved' && user.status !== 'inactive' && user.status !== 0 && user.login_enabled !== 0;
  const isPrimaryHost = process.env.GEWU_NODE_ROLE === 'primary-host'
    && desktopToken && desktopContext?.deviceTrusted && desktopContext?.deviceActive
    && desktopContext?.deviceKind === 'primary-host'
    && desktopContext?.userId === user.id && userApproved;
  req.authz = {
    userId: user?.id || null,
    phone: user?.phone || null,
    role: desktopContext?.activeRole || roleForUser(user),
    activeRole: desktopContext?.activeRole || roleForUser(user),
    eligibleRoles: desktopContext?.eligibleRoles || [roleForUser(user)],
    scope: desktopContext?.scope || scopeForUser(req.user),
    teacherId: desktopContext ? desktopContext.teacherId : user?.teacher_id || null,
    studentId: desktopContext ? desktopContext.studentId : user?.student_id || null,
    deviceId, tokenDeviceId, tokenUse: tokenUser?.token_use || null,
    authVersion: Number(user?.auth_version || 1), sessionId: desktopContext?.sessionId || tokenUser?.sid || null,
    sessionExpiresAt: desktopContext?.sessionExpiresAt || null,
    authTime: desktopContext?.authTime || null,
    credentialVersion: desktopContext?.credentialVersion || null,
    authorizationId: desktopContext?.authorizationId || null,
    authorizationRowVersion: desktopContext?.authorizationRowVersion || null,
    deviceKind: desktopContext?.deviceKind || null,
    identityKind: user?.identity_kind || null,
    accountState: tokenUser?.token_use === VISITOR_TOKEN_USE ? 'visitor' : 'formal',
    authorityId: tokenUser?.authority_id || null,
    runtimeNodeRole: process.env.GEWU_NODE_ROLE || 'desktop-client',
    deviceTrusted: desktopContext?.deviceTrusted || device?.trusted === 1,
    deviceActive: desktopContext?.deviceActive || device?.active === 1,
    deviceOwnerUserId: desktopContext?.userId || device?.owner_user_id || null,
    userApproved,
    clientType: desktopToken
      ? 'desktop'
      : miniappToken ? 'miniapp' : 'non-desktop',
    isPrimaryHost,
  };
  return true;
}

function readTenantFromRequest(req) {
  return req.headers['x-tenant-id']
    || req.headers['x-tenantid']
    || req.query?.tenantId
    || req.query?.tenant_id
    || req.body?.tenantId
    || req.body?.tenant_id
    || null;
}

function tenantScopeMiddleware(req, _res, next) {
  req.requestedTenantId = readTenantFromRequest(req);
  if (!req.tenantId && req.requestedTenantId) req.tenantId = req.requestedTenantId;
  return next();
}

function applyAuthenticatedTenant(req, res) {
  const userTenant = req.user?.tenantId || req.user?.tenant_id || null;
  const requestedTenant = req.requestedTenantId || readTenantFromRequest(req);

  if (userTenant && requestedTenant && requestedTenant !== userTenant) {
    sendAuthError(res, 403, '租户不匹配', 'TENANT_FORBIDDEN');
    return false;
  }

  const tenantId = userTenant || requestedTenant || process.env.DEFAULT_TENANT_ID || 'default';
  req.tenantId = tenantId;
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    req.body.tenant_id = tenantId;
    req.body.tenantId = tenantId;
  }
  return true;
}

function authMiddleware(req, res, next) {
  if (isDevAuthBypassed()) {
    req.user = {
      id: 'dev-user',
      role: 'admin',
      tenantId: req.requestedTenantId || process.env.DEFAULT_TENANT_ID || 'default',
    };
    applyAuthenticatedTenant(req, res);
    return next();
  }

  const token = getBearerToken(req);
  if (!token) {
    return sendAuthError(res, 401, '未提供认证令牌', 'UNAUTHORIZED');
  }

  try {
    if (!attachAuthorizationContext(req, verifyToken(token))) {
      return sendAuthError(res, 401, '认证用户不存在', 'AUTH_USER_NOT_FOUND');
    }
    if (!applyAuthenticatedTenant(req, res)) return undefined;
    return next();
  } catch (_err) {
    return sendAuthError(res, 401, '认证令牌无效或已过期', 'TOKEN_INVALID');
  }
}

function isElectronLocalEvidenceBridgeRequest(req) {
  const route = String(req?.originalUrl || req?.url || req?.path || '')
    .split('?')[0];
  const bridge = String(req?.headers?.['x-gewu-electron-local-bridge'] || '').trim();
  return String(req?.method || '').toUpperCase() === 'POST'
    && route === '/api/desktop-identity/primary-host/local-evidence'
    && bridge.length > 0;
}

function optionalAuth(req, res, next) {
  if (isDevAuthBypassed()) {
    req.user = {
      id: 'dev-user',
      role: 'admin',
      tenantId: req.requestedTenantId || process.env.DEFAULT_TENANT_ID || 'default',
    };
    applyAuthenticatedTenant(req, res);
    return next();
  }

  // A newly adopted data host has a local JWT issuer distinct from the
  // managed cloud issuer.  Let this one Electron-main-only request reach the
  // route-level loopback + constant-time bridge-secret check; it remains
  // unusable to ordinary HTTP callers and its signed receipt is verified by
  // the cloud before any host epoch is activated.
  if (isElectronLocalEvidenceBridgeRequest(req)) {
    if (!req.tenantId) req.tenantId = req.requestedTenantId || process.env.DEFAULT_TENANT_ID || 'default';
    return next();
  }

  const token = getBearerToken(req);
  if (token) {
    try {
      attachAuthorizationContext(req, verifyToken(token));
      if (!applyAuthenticatedTenant(req, res)) return undefined;
    } catch (error) {
      const tokenHint = jwt.decode(token) || {};
      if (error?.code === 'REVIEW_TOKEN_NOT_ACCEPTED_BY_BACKEND'
        || tokenHint.token_use === FORMAL_TOKEN_USE
        || tokenHint.token_use === VISITOR_TOKEN_USE
        || tokenHint.token_use === 'desktop-session'
        || tokenHint.token_use === 'desktop-relay-session') {
        return sendAuthError(res, 401, 'Invalid or expired authentication token', 'TOKEN_INVALID');
      }
      // Optional auth keeps old behavior: invalid tokens do not block reads.
    }
  }
  if (!req.tenantId) req.tenantId = req.requestedTenantId || process.env.DEFAULT_TENANT_ID || 'default';
  return next();
}

function requireWriteAccess(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (isDevAuthBypassed()) {
    req.user = req.user || {
      id: 'dev-user',
      role: 'admin',
      tenantId: req.tenantId || process.env.DEFAULT_TENANT_ID || 'default',
    };
    return next();
  }
  if (!req.user) return sendAuthError(res, 401, '未登录', 'UNAUTHORIZED');

  const allowedRoles = (process.env.WRITE_ROLES || 'super_admin,admin,operator,teacher')
    .split(',')
    .map(role => role.trim())
    .filter(Boolean);

  const studentHostDeleteCandidate = req.user.role === 'student' && req.baseUrl === '/api/question-bank'
    && req.method === 'DELETE' && /^\/questions\/[^/]+$/.test(req.path);
  if (!allowedRoles.includes(req.user.role) && !studentHostDeleteCandidate) {
    return sendAuthError(res, 403, '无写入权限', 'FORBIDDEN');
  }
  return next();
}

function requireCoreReadAccess(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (isDevAuthBypassed()) return next();
  if (!req.user) return sendAuthError(res, 401, 'Authentication required', 'UNAUTHORIZED');

  const role = req.user.role || req.user.user_type;
  const allowedRoles = (process.env.CORE_READ_ROLES || 'admin,operator')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  if (!allowedRoles.includes(role)) {
    return sendAuthError(res, 403, 'Core business read forbidden', 'CORE_READ_FORBIDDEN');
  }
  return next();
}

function requireQuestionBankReadAccess(req, res, next) {
  if (isDevAuthBypassed()) return next();
  if (!req.user) return sendAuthError(res, 401, 'Authentication required', 'UNAUTHORIZED');
  const role = req.authz?.role || req.user?.role || req.user?.user_type;
  if (['super_admin', 'admin', 'operator'].includes(role)) return next();
  const scope = scopeForUser({
    role,
    teacherId: req.authz?.teacherId || req.user?.teacher_id || req.user?.teacherId,
    studentId: req.authz?.studentId || req.user?.student_id || req.user?.studentId,
  });
  if (['all', 'teacher', 'student'].includes(scope.kind)) return next();
  return sendAuthError(res, 403, 'Local subject binding required', 'QUESTION_BANK_SUBJECT_REQUIRED');
}

function generateToken(user) {
  return identityServiceFor(getInstance().db).issueFormalToken(user).token;
}

module.exports = {
  authMiddleware,
  optionalAuth,
  tenantScopeMiddleware,
  requireCoreReadAccess,
  requireQuestionBankReadAccess,
  requireWriteAccess,
  generateToken,
  JWT_SECRET,
  attachAuthorizationContext,
};
