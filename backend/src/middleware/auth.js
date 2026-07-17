/**
 * JWT authentication and lightweight authorization helpers.
 */
const jwt = require('jsonwebtoken');
const { getInstance } = require('../database');
const { roleForUser } = require('../services/authorizationPolicy');
const {
  EXPERIENCE_AUDIENCE,
  FORMAL_AUDIENCE,
  FORMAL_TOKEN_USE,
  TOKEN_ISSUER,
  UNRECOGNIZED_TOKEN_USE,
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
  if (decoded.token_use === 'desktop-session' && (decoded.iss !== 'gewu-auth' || decoded.aud !== 'gewu-api')) {
    throw new Error('TOKEN_AUDIENCE_INVALID');
  }
  if (decoded.token_use === FORMAL_TOKEN_USE && (decoded.iss !== TOKEN_ISSUER || decoded.aud !== FORMAL_AUDIENCE)) {
    throw new Error('TOKEN_AUDIENCE_INVALID');
  }
  if (decoded.token_use === UNRECOGNIZED_TOKEN_USE
    && (decoded.iss !== TOKEN_ISSUER || decoded.aud !== EXPERIENCE_AUDIENCE)) {
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

function attachAuthorizationContext(req, tokenUser) {
  let user = null;
  const database = getInstance().db;
  const miniappToken = tokenUser?.token_use === FORMAL_TOKEN_USE || tokenUser?.token_use === UNRECOGNIZED_TOKEN_USE;
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
    ? { ...user, role: desktopContext.activeRole, user_type: desktopContext.activeRole }
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
    eligibleRoles: desktopContext?.eligibleRoles || null,
    scope: desktopContext?.scope || null,
    teacherId: desktopContext?.teacherId || user?.teacher_id || null,
    studentId: desktopContext?.studentId || user?.student_id || null,
    deviceId, tokenDeviceId, tokenUse: tokenUser?.token_use || null,
    authVersion: Number(user?.auth_version || 1), sessionId: desktopContext?.sessionId || tokenUser?.sid || null,
    authTime: desktopContext?.authTime || null,
    credentialVersion: desktopContext?.credentialVersion || null,
    authorizationId: desktopContext?.authorizationId || null,
    authorizationRowVersion: desktopContext?.authorizationRowVersion || null,
    deviceKind: desktopContext?.deviceKind || null,
    identityKind: user?.identity_kind || null,
    accountState: tokenUser?.token_use === UNRECOGNIZED_TOKEN_USE ? 'unrecognized' : 'formal',
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

  const token = getBearerToken(req);
  if (token) {
    try {
      attachAuthorizationContext(req, verifyToken(token));
      if (!applyAuthenticatedTenant(req, res)) return undefined;
    } catch (error) {
      const tokenHint = jwt.decode(token) || {};
      if (error?.code === 'REVIEW_TOKEN_NOT_ACCEPTED_BY_BACKEND'
        || tokenHint.token_use === FORMAL_TOKEN_USE
        || tokenHint.token_use === UNRECOGNIZED_TOKEN_USE
        || tokenHint.token_use === 'desktop-session') {
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
  const expectedDesktopSyncToken = process.env.GEWU_DESKTOP_SYNC_TOKEN || '';
  const providedDesktopSyncToken = req.headers['x-gewu-desktop-sync-token'] || '';
  if (req.baseUrl === '/api/cloud-relay-host' && expectedDesktopSyncToken && providedDesktopSyncToken === expectedDesktopSyncToken) {
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

function generateToken(user) {
  return identityServiceFor(getInstance().db).issueFormalToken(user).token;
}

module.exports = {
  authMiddleware,
  optionalAuth,
  tenantScopeMiddleware,
  requireCoreReadAccess,
  requireWriteAccess,
  generateToken,
  JWT_SECRET,
  attachAuthorizationContext,
};
