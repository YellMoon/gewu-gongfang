/**
 * JWT 认证中间件
 * 预留微信小程序登录流程，当前默认允许所有请求
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// 必须认证中间件（预留）
function authMiddleware(req, res, next) {
  // 开发阶段跳过认证
  if (process.env.NODE_ENV === 'development' || !process.env.JWT_SECRET) {
    req.user = { id: 'dev-user', role: 'admin' };
    return next();
  }

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
    return res.status(401).json({ error: '认证令牌无效或已过期' });
  }
}

// 可选认证（不存在token也放行）
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      // token无效也放行
    }
  }
  next();
}

// 生成JWT
function generateToken(user) {
  return jwt.sign(
    { id: user.id, openid: user.wechat_openid, nickname: user.nickname, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { authMiddleware, optionalAuth, generateToken, JWT_SECRET };
