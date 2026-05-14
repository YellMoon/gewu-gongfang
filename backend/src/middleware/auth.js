/**
 * JWT authentication and lightweight authorization helpers.
 */
const jwt = require('jsonwebtoken');

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

function authMiddleware(req, res, next) {
  if (isDevAuthBypassed()) {
    req.user = { id: 'dev-user', role: 'admin' };
    return next();
  }

  const token = getBearerToken(req);
  if (!token) {
    return sendAuthError(res, 401, '未提供认证令牌', 'UNAUTHORIZED');
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (_err) {
    return sendAuthError(res, 401, '认证令牌无效或已过期', 'TOKEN_INVALID');
  }
}

function optionalAuth(req, _res, next) {
  if (isDevAuthBypassed()) {
    req.user = { id: 'dev-user', role: 'admin' };
    return next();
  }

  const token = getBearerToken(req);
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (_err) {
      // Optional auth keeps old behavior: invalid tokens do not block reads.
    }
  }
  return next();
}

function requireWriteAccess(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (isDevAuthBypassed()) {
    req.user = req.user || { id: 'dev-user', role: 'admin' };
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

function generateToken(user) {
  return jwt.sign(
    { id: user.id, openid: user.wechat_openid, nickname: user.nickname, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = {
  authMiddleware,
  optionalAuth,
  requireWriteAccess,
  generateToken,
  JWT_SECRET,
};
