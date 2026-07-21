/**
 * JWT 认证中间件
 * 支持微信小程序手机号验证登录和审核后授权
 */
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');
const { roleForUser } = require('../services/authorizationPolicy');

const JWT_SECRET = process.env.JWT_SECRET || null;
function verifyToken(token){if(!JWT_SECRET)throw new Error('JWT_SECRET_REQUIRED');const decoded=jwt.verify(token,JWT_SECRET,{algorithms:['HS256']});if(decoded.token_use==='desktop-session'&&(decoded.iss!=='gewu-auth'||decoded.aud!=='gewu-api'))throw new Error('TOKEN_AUDIENCE_INVALID');return decoded;}

const EXPERIENCE_ONLY_TOKEN_USES = new Set(['review-demo', 'unrecognized-student']);

function rejectExperienceOnlyToken(token, res) {
  const tokenUse = jwt.decode(token)?.token_use;
  if (!EXPERIENCE_ONLY_TOKEN_USES.has(tokenUse)) return false;
  res.status(401).json({
    success: false,
    code: 'EXPERIENCE_TOKEN_NOT_ACCEPTED_BY_GATEWAY',
    error: 'Experience-only tokens are not accepted by the legacy gateway',
  });
  return true;
}

function attachPersisted(req, decoded) {
  const persisted = getDb().prepare('SELECT * FROM users WHERE id = ?').get(decoded.sub || decoded.id);
  if (!persisted) return false;
  if (decoded.token_use === 'desktop-session') {
    const activeRole = String(decoded.active_role || '').trim();
    const eligibleRoles = Array.isArray(decoded.eligible_roles) ? decoded.eligible_roles.map(String) : [];
    const deviceId = String(decoded.device_id || '').trim();
    const sessionId = String(decoded.sid || '').trim();
    const authVersion = Number(decoded.auth_version);
    const credentialVersion = Number(decoded.credential_version);
    const headerDeviceId = String(req.headers['x-device-id'] || '').trim();
    if (!sessionId || !deviceId || !activeRole || !eligibleRoles.includes(activeRole)
      || !Number.isSafeInteger(authVersion) || authVersion < 1
      || !Number.isSafeInteger(credentialVersion) || credentialVersion < 1
      || Number(persisted.auth_version || 1) !== authVersion
      || (headerDeviceId && headerDeviceId !== deviceId)
      || persisted.review_status !== 'approved' || persisted.status !== 1 || persisted.login_enabled !== 1
      || (activeRole === 'teacher' && !persisted.teacher_id)) {
      const error = new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
      error.code = 'ONLINE_DESKTOP_SESSION_REQUIRED';
      throw error;
    }
    req.user = { ...persisted, activeRole, eligibleRoles };
    req.authz = {
      userId: persisted.id,
      phone: persisted.phone || null,
      role: activeRole,
      activeRole,
      eligibleRoles,
      tenantId: persisted.tenant_id || persisted.tenantId || 'default',
      teacherId: activeRole === 'teacher' ? persisted.teacher_id : null,
      studentId: persisted.student_id || null,
      reviewStatus: persisted.review_status,
      status: persisted.status,
      loginEnabled: persisted.login_enabled,
      deviceId,
      sessionId,
      sessionExpiresAt: Number.isFinite(Number(decoded.exp))
        ? new Date(Number(decoded.exp) * 1000).toISOString()
        : null,
      authVersion,
      credentialVersion,
      tokenUse: 'desktop-session',
      clientType: 'desktop',
      isPrimaryHost: false,
      readOnly: false,
      userApproved: true,
    };
    return true;
  }
  req.user = persisted;
  req.authz = { userId: persisted.id, phone: persisted.phone || null, role: roleForUser(persisted),
    tenantId: persisted.tenant_id || persisted.tenantId || 'default',
    teacherId: persisted.teacher_id || null, studentId: persisted.student_id || null,
    reviewStatus: persisted.review_status, status: persisted.status, loginEnabled: persisted.login_enabled,
    deviceId: null, clientType: 'gateway', isPrimaryHost: false, readOnly: false };
  return true;
}

/**
 * 必须认证中间件
 * 验证 JWT token，提取 user 信息到 req.user
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  try {
    const token = authHeader.split(' ')[1];
    if (rejectExperienceOnlyToken(token, res)) return undefined;
    const decoded = verifyToken(token);
    if (!attachPersisted(req, decoded)) return res.status(401).json({ error: 'Authenticated user not found', code: 'UNAUTHORIZED' });
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '认证令牌已过期' });
    }
    return res.status(401).json({ error: '认证令牌无效' });
  }
}

/**
 * 可选认证中间件
 * 有 token 则解析，没有也放行
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      if (rejectExperienceOnlyToken(token, res)) return undefined;
      const decoded = verifyToken(token);
      attachPersisted(req, decoded);
    } catch (err) {
      // token 无效也放行
    }
  }
  next();
}

/**
 * 签发 JWT Token
 * @param {Object} user - 用户对象 { id, user_type, name }
 * @returns {string} JWT token
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      user_type: user.user_type,
      name: user.name,
      student_id: user.student_id || user.studentId || null,
      linked_student_ids: user.linked_student_ids || user.linkedStudentIds || []
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * 刷新 Token
 * @param {string} token - 旧 token
 * @returns {string|null} 新 token 或 null
 */
function refreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
    if (decoded.token_use === 'review-demo') return null;
    // 生成新 token
    return jwt.sign(
      {
        id: decoded.id,
        user_type: decoded.user_type,
        name: decoded.name,
        student_id: decoded.student_id || null,
        linked_student_ids: decoded.linked_student_ids || []
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
  } catch (err) {
    return null;
  }
}

module.exports = { authMiddleware, optionalAuth, generateToken, refreshToken, JWT_SECRET };
