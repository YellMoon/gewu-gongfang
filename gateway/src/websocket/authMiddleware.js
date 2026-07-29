const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function safeCredentialEqual(raw, expectedHash) {
  const actual = Buffer.from(
    crypto.createHash('sha256').update(String(raw || '')).digest('hex'),
    'hex',
  );
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === 32 && expected.length === 32
    && crypto.timingSafeEqual(actual, expected);
}

/**
 * WebSocket 认证中间件
 * 支持两种认证方式：
 * 1. 桌面端：JWT token（clientType=desktop, tokenUse=desktop-session）
 * 2. 主机端：每个活动 epoch 的 managed host credential（仅放请求头）
 */
function authenticateWebSocket(req, socket, next, { db } = {}) {
  try {
    // HTTP upgrade 时 req.query 未解析，需手动解析 URL
    const parsed = new URL(req.url, 'http://localhost');
    const query = Object.fromEntries(parsed.searchParams.entries());
    const token = query.token || req.headers.authorization?.replace('Bearer ', '');
    const role = query.role;
    const deviceId = query.deviceId;

    if (!deviceId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // 主机端：活动 epoch 的专属凭据；旧共享 token 不再是正常认证路径。
    if (role === 'host') {
      const headerDeviceId = String(req.headers['x-gewu-host-device-id'] || '').trim();
      const generation = Number(req.headers['x-gewu-host-generation']);
      const credential = String(req.headers['x-gewu-host-credential'] || '');
      const epoch = db && headerDeviceId === String(deviceId)
        && Number.isSafeInteger(generation) && generation > 0
        ? db.prepare(`SELECT device_id, generation, credential_version, host_credential_hash
          FROM primary_host_epochs
          WHERE device_id=? AND generation=? AND status='active'`)
          .get(headerDeviceId, generation)
        : null;
      if (!epoch || !credential || !safeCredentialEqual(credential, epoch.host_credential_hash)) {
        console.error('[WebSocket] Managed host credential mismatch');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      req.user = {
        userId: null,
        deviceId: headerDeviceId,
        sessionId: null,
        activeRole: 'host',
        teacherId: null,
        authVersion: null,
        credentialVersion: Number(epoch.credential_version || 1),
      };
      return next();
    }

    // 桌面端：JWT token
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
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

module.exports = { authenticateWebSocket, safeCredentialEqual };
