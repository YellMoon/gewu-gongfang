const jwt = require('jsonwebtoken');
const url = require('url');

/**
 * WebSocket 认证中间件
 * 支持两种认证方式：
 * 1. 桌面端：JWT token（clientType=desktop, tokenUse=desktop-session）
 * 2. 主机端：plain-text host token（通过 x-gewu-host-token 验证）
 */
function authenticateWebSocket(req, socket, next) {
  try {
    // HTTP upgrade 时 req.query 未解析，需手动解析 URL
    const parsed = url.parse(req.url, true);
    const query = parsed.query || {};
    const token = query.token || req.headers.authorization?.replace('Bearer ', '');
    const role = query.role;
    const deviceId = query.deviceId;

    if (!token || !deviceId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // 主机端：plain-text host token
    if (role === 'host') {
      const hostToken = process.env.GEWU_CLOUD_RELAY_HOST_TOKEN;
      if (!hostToken || token !== hostToken) {
        console.error('[WebSocket] Host token mismatch');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      req.user = {
        userId: null,
        deviceId,
        sessionId: null,
        activeRole: 'host',
        teacherId: null,
        authVersion: null,
        credentialVersion: null,
      };
      return next();
    }

    // 桌面端：JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.clientType !== 'desktop' || decoded.tokenUse !== 'desktop-session') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    req.user = {
      userId: decoded.userId,
      deviceId: decoded.deviceId || deviceId,
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
