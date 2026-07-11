/**
 * JWT authentication and lightweight authorization helpers.
 */
const jwt = require('jsonwebtoken');
const { getInstance } = require('../database');
const { roleForUser } = require('../services/authorizationPolicy');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

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
  return process.env.NODE_ENV === 'development' || !process.env.JWT_SECRET;
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.split(' ')[1];
}

function attachAuthorizationContext(req, tokenUser) {
  let user = null;
  try {
    const persisted = tokenUser?.id ? getInstance().db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(tokenUser.id) : null;
    if (persisted) user = persisted;
  } catch (error) {
    console.error('[Auth] persisted identity lookup failed', error?.code || error?.message || 'unknown');
  }
  if (!user) {
    req.user = undefined;
    req.authz = undefined;
    return false;
  }
  req.user = user;
  const deviceId = req.headers['x-device-id'] || null;
  let isPrimaryHost = false;
  if (process.env.GEWU_TRUSTED_PRIMARY_HOST === 'true' && deviceId) {
    try {
      const device = getInstance().getSyncDevice(deviceId);
      isPrimaryHost = Boolean(device && device.trusted === 1 && ['primary-host', 'host'].includes(device.role));
    } catch (_) { isPrimaryHost = false; }
  }
  req.authz = {
    userId: user?.id || null, phone: user?.phone || null, role: roleForUser(user),
    teacherId: user?.teacher_id || null, studentId: user?.student_id || null,
    deviceId, clientType: req.headers['x-client-type'] || 'unknown', isPrimaryHost,
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
    if (!attachAuthorizationContext(req, jwt.verify(token, JWT_SECRET))) {
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
      attachAuthorizationContext(req, jwt.verify(token, JWT_SECRET));
      if (!applyAuthenticatedTenant(req, res)) return undefined;
    } catch (_err) {
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

  const allowedRoles = (process.env.WRITE_ROLES || 'admin,operator')
    .split(',')
    .map(role => role.trim())
    .filter(Boolean);

  if (!allowedRoles.includes(req.user.role)) {
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
  return jwt.sign(
    {
      id: user.id,
      openid: user.wechat_openid,
      nickname: user.nickname,
      name: user.name || user.nickname,
      role: user.role || user.user_type,
      user_type: user.user_type || user.role,
      phone: user.phone || null,
      student_id: user.student_id || user.studentId || null,
      linked_student_ids: user.linked_student_ids || user.linkedStudentIds || [],
      tenantId: user.tenantId || user.tenant_id || process.env.DEFAULT_TENANT_ID || 'default',
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
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
