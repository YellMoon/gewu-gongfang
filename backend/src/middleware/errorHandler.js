/**
 * 统一错误处理中间件
 */
function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体格式错误' });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message
  });
}

module.exports = { errorHandler };
