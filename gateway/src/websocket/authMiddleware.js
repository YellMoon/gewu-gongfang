const jwt = require('jsonwebtoken');

function authenticateWebSocket(req, socket, next) {
  try {
    // 从查询参数或头部获取token
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // 验证token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 检查是否为桌面端会话
    if (decoded.clientType !== 'desktop' || decoded.tokenUse !== 'desktop-session') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // 将用户信息附加到请求对象
    req.user = {
      userId: decoded.userId,
      deviceId: decoded.deviceId,
      sessionId: decoded.sessionId,
      activeRole: decoded.activeRole,
      teacherId: decoded.teacherId,
      authVersion: decoded.authVersion,
      credentialVersion: decoded.credentialVersion,
    };

    next();
  } catch (error) {
    console.error('[WebSocket] Authentication failed:', error.message);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
}

module.exports = { authenticateWebSocket };
