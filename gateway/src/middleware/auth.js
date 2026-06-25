/**
 * JWT 认证中间件
 * 支持微信小程序登录 + 邀请码注册
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'edu-platform-secret-2026';

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
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
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
      req.user = jwt.verify(token, JWT_SECRET);
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
