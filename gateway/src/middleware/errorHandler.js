/**
 * 统一错误处理中间件
 */
function errorHandler(err, req, res, _next) {
  console.error(`[Error] ${err.message}`, err.stack);

  // 数据库错误
  if (err.code === 'SQLITE_CONSTRAINT') {
    return res.status(400).json({ error: '数据冲突', detail: err.message });
  }

  // JWT 错误
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: '认证令牌无效' });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: '认证令牌已过期' });
  }

  // 默认 500
  res.status(err.status || 500).json({
    error: err.message || '服务器内部错误'
  });
}

module.exports = { errorHandler };
