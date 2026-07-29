const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { getInstance } = require('../database');
const { createPrimaryHostIdentityService } = require('../services/primaryHostIdentityService');

function reject(socket, code = 401) {
  socket.write(`HTTP/1.1 ${code} ${code === 403 ? 'Forbidden' : 'Unauthorized'}\r\n\r\n`);
  socket.destroy();
}

function hostIdentity(req) {
  const deviceId = String(req.headers['x-gewu-host-device-id'] || '').trim();
  const generation = Number(req.headers['x-gewu-host-generation']);
  const credential = String(req.headers['x-gewu-host-credential'] || '').trim();
  const epoch = createPrimaryHostIdentityService({ db: getInstance().db })
    .assertActiveHostCredential({ deviceId, generation, credential });
  return { deviceId: epoch.deviceId, role: 'primary-host', userId: epoch.userId };
}

function desktopIdentity(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const claims = jwt.verify(token, process.env.JWT_SECRET || '', { algorithms: ['HS256'] });
  if (!['desktop-session', 'desktop-relay-session'].includes(claims.token_use)
    || claims.iss !== 'gewu-auth' || claims.aud !== 'gewu-api') throw new Error('DESKTOP_WEBSOCKET_TOKEN_INVALID');
  return { deviceId: String(claims.device_id || '').trim(), role: 'desktop-client', userId: String(claims.sub || '').trim() };
}

class CloudRelaySocketServer {
  constructor(server) {
    this.connections = new Map();
    this.wss = new WebSocket.Server({ noServer: true });
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    this.wss.on('connection', (socket, req) => this.connected(socket, req));
  }

  upgrade(req, socket, head) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws/cloud-relay') return;
    try {
      const identity = url.searchParams.get('role') === 'host' ? hostIdentity(req) : desktopIdentity(req);
      if (!identity.deviceId) throw new Error('WEBSOCKET_DEVICE_REQUIRED');
      req.cloudRelayIdentity = identity;
      this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req));
    } catch (_error) {
      reject(socket, 401);
    }
  }

  connected(socket, req) {
    const identity = req.cloudRelayIdentity;
    const previous = this.connections.get(identity.deviceId);
    if (previous && previous.readyState === WebSocket.OPEN) previous.close(1000, 'replaced');
    this.connections.set(identity.deviceId, socket);
    socket.send(JSON.stringify({ type: 'connected', deviceId: identity.deviceId, serverTime: Date.now() }));
    socket.on('message', raw => {
      try {
        const message = JSON.parse(raw);
        if (message.type === 'ping' || message.type === 'heartbeat') socket.send(JSON.stringify({ type: 'pong', serverTime: Date.now() }));
      } catch (_error) { /* malformed client messages do not change authentication */ }
    });
    socket.on('close', () => { if (this.connections.get(identity.deviceId) === socket) this.connections.delete(identity.deviceId); });
    socket.on('error', () => { if (this.connections.get(identity.deviceId) === socket) this.connections.delete(identity.deviceId); });
  }

  send(deviceId, type, payload) {
    const socket = this.connections.get(String(deviceId || ''));
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
    return true;
  }

  notifyHostNewTask(hostDeviceId, task) { return this.send(hostDeviceId, 'new_task', { taskId: task.id, taskType: task.task_type }); }
  notifyDesktopTaskComplete(deviceId, task) { return this.send(deviceId, 'task_complete', { taskId: task.id, result: task.result_payload || null }); }
}

module.exports = { CloudRelaySocketServer };
