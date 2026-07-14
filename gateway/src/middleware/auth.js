/**
 * JWT 认证中间件
 * 支持微信小程序手机号验证登录和审核后授权
 */
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');
const { roleForUser } = require('../services/authorizationPolicy');
const {
  looksLikeReviewDemoToken,
  parseReviewDemoToken,
  reviewDemoUserFromClaims,
} = require('../services/reviewDemoSession');

const JWT_SECRET = process.env.JWT_SECRET || null;
function verifyToken(token){if(!JWT_SECRET)throw new Error('JWT_SECRET_REQUIRED');if(looksLikeReviewDemoToken(token))return parseReviewDemoToken(token);const decoded=jwt.verify(token,JWT_SECRET,{algorithms:['HS256']});if(decoded.token_use==='desktop-session'&&(decoded.iss!=='gewu-auth'||decoded.aud!=='gewu-api'))throw new Error('TOKEN_AUDIENCE_INVALID');return decoded;}

function attachReviewDemo(req, decoded) {
  const user = reviewDemoUserFromClaims(decoded);
  req.user = user;
  req.authz = {
    userId: user.id, phone: null, role: user.user_type,
    teacherId: null, studentId: user.student_id || null,
    reviewStatus: 'approved', status: 1, loginEnabled: 1,
    deviceId: null, clientType: 'miniapp-review', isPrimaryHost: false,
    isReviewDemo: true, readOnly: true, reviewDemoSessionId: user.review_demo_session_id,
  };
}

function attachPersisted(req, decoded) {
  const persisted = getDb().prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
  if (!persisted) return false;
  req.user = persisted;
  req.authz = { userId: persisted.id, phone: persisted.phone || null, role: roleForUser(persisted),
    teacherId: persisted.teacher_id || null, studentId: persisted.student_id || null,
    reviewStatus: persisted.review_status, status: persisted.status, loginEnabled: persisted.login_enabled,
    deviceId: null, clientType: 'gateway', isPrimaryHost: false, isReviewDemo: false, readOnly: false };
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
    const decoded = verifyToken(token);
    if (decoded.token_use === 'review-demo') attachReviewDemo(req, decoded);
    else if (!attachPersisted(req, decoded)) return res.status(401).json({ error: 'Authenticated user not found', code: 'UNAUTHORIZED' });
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
      const decoded = verifyToken(token);
      if (decoded.token_use === 'review-demo') attachReviewDemo(req, decoded);
      else attachPersisted(req, decoded);
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
