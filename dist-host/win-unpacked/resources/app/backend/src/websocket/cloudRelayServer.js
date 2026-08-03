const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { getInstance } = require('../database');
const { createPrimaryHostIdentityService } = require('../services/primaryHostIdentityService');
const { createAuthorityDeviceRequestAuth } = require('../services/authorityDeviceRequestAuth');
const { createAuthorityCommandAuthorizationService } = require('../services/authorityCommandAuthorizationService');
const { createAuthorityCommandPolicy } = require('../services/authorityCommandRegistry');
const { validateEnvelope } = require('../../../shared/authorityProtocol');
const { createAuthorityRelayRouter } = require('./authorityRelayRouter');

function reject(socket, code = 401) {
  socket.write(`HTTP/1.1 ${code} ${code === 403 ? 'Forbidden' : 'Unauthorized'}\r\n\r\n`);
  socket.destroy();
}

function hostIdentity(req, db = getInstance().db) {
  const deviceId = String(req.headers['x-gewu-host-device-id'] || '').trim();
  const generation = Number(req.headers['x-gewu-host-generation']);
  const credential = String(req.headers['x-gewu-host-credential'] || '').trim();
  const epoch = createPrimaryHostIdentityService({ db })
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
  constructor(server, options = {}) {
    this.connections = new Map();
    this.wss = new WebSocket.Server({ noServer: true });
    const authorityMaxPayloadBytes = Number.isSafeInteger(options.authorityMaxPayloadBytes)
      ? options.authorityMaxPayloadBytes : 1024 * 1024;
    this.authorityWss = new WebSocket.Server({
      noServer: true,
      maxPayload: authorityMaxPayloadBytes,
    });
    this.authorityConnections = new Set();
    this.authorityUnauthenticatedConnections = new Set();
    this.authorityDeviceConnections = new Map();
    this.authorityDeviceInFlight = new Map();
    const db = options.db || getInstance().db;
    const resolveHostIdentity = options.hostIdentity || (req => hostIdentity(req, db));
    const resolveDesktopIdentity = options.desktopIdentity || desktopIdentity;
    const deviceAuth = createAuthorityDeviceRequestAuth({ db });
    const authorization = createAuthorityCommandAuthorizationService({
      db,
      commandPolicy: options.authorityCommandPolicy || createAuthorityCommandPolicy(),
    });
    this.authenticateAuthorityConnection = options.authenticateAuthorityConnection || (frame => (
      deviceAuth.authenticate({
        method: 'GET',
        originalUrl: '/ws/authority',
        url: '/ws/authority',
        headers: Object.fromEntries(Object.entries(frame.auth || {}).map(([key, value]) => [
          String(key).toLowerCase(), String(value),
        ])),
        body: null,
        params: {},
      })
    ));
    this.authorityAuthenticationTimeoutMs = Number.isSafeInteger(options.authorityAuthenticationTimeoutMs)
      ? options.authorityAuthenticationTimeoutMs : 5000;
    this.authorityMaxConcurrentMessages = Number.isSafeInteger(options.authorityMaxConcurrentMessages)
      ? options.authorityMaxConcurrentMessages : 4;
    this.authorityMaxConcurrentMessagesPerDevice = Number.isSafeInteger(
      options.authorityMaxConcurrentMessagesPerDevice,
    ) ? options.authorityMaxConcurrentMessagesPerDevice : 8;
    this.authorityMaxConnections = Number.isSafeInteger(options.authorityMaxConnections)
      ? options.authorityMaxConnections : 128;
    this.authorityMaxUnauthenticatedConnections = Number.isSafeInteger(
      options.authorityMaxUnauthenticatedConnections,
    ) ? options.authorityMaxUnauthenticatedConnections : 32;
    this.authorityMessageLimit = Number.isSafeInteger(options.authorityMessageLimit)
      ? options.authorityMessageLimit : 60;
    this.authorityMessageWindowMs = Number.isSafeInteger(options.authorityMessageWindowMs)
      ? options.authorityMessageWindowMs : 10_000;
    this.authorityRelayRouter = createAuthorityRelayRouter({
      authenticateFrame: options.authenticateAuthorityFrame || (frame => {
        validateEnvelope(frame.envelope);
        return deviceAuth.authenticate({
          method: 'POST',
          originalUrl: '/api/authority/commands',
          url: '/api/authority/commands',
          headers: Object.fromEntries(Object.entries(frame.auth || {}).map(([key, value]) => [
            String(key).toLowerCase(), String(value),
          ])),
          body: frame.envelope,
          params: {},
        });
      }),
      authorizeCommand: options.authorizeAuthorityCommand || (envelope => authorization.authorize(envelope)),
      targetHostFor: options.targetHostFor || (envelope => {
        const epoch = db.prepare(`SELECT device_id,db_authority_id FROM primary_host_epochs
          WHERE id=? AND status='active'`).get(envelope.hostEpochId);
        return epoch?.db_authority_id === envelope.authorityId ? epoch.device_id : '';
      }),
      sendToHost: (hostDeviceId, message) => this.send(hostDeviceId, message.type, message.payload),
      createRelayId: options.createRelayId,
      maxPendingPerClient: Number.isSafeInteger(options.authorityMaxPendingPerConnection)
        ? options.authorityMaxPendingPerConnection : 32,
      maxPendingPerDevice: Number.isSafeInteger(options.authorityMaxPendingPerDevice)
        ? options.authorityMaxPendingPerDevice : 32,
    });
    this.authorityEnabled = options.authorityEnabled !== false;
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    this.wss.on('connection', (socket, req) => this.connected(socket, req));
    this.authorityWss.on('connection', socket => this.authorityConnected(socket));
    this.resolveHostIdentity = resolveHostIdentity;
    this.resolveDesktopIdentity = resolveDesktopIdentity;
  }

  upgrade(req, socket, head) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/ws/authority') {
      if (!this.authorityEnabled) return;
      this.authorityWss.handleUpgrade(req, socket, head,
        ws => this.authorityWss.emit('connection', ws, req));
      return;
    }
    if (url.pathname !== '/ws/cloud-relay') return;
    try {
      const identity = url.searchParams.get('role') === 'host'
        ? this.resolveHostIdentity(req)
        : this.resolveDesktopIdentity(req);
      if (!identity.deviceId) throw new Error('WEBSOCKET_DEVICE_REQUIRED');
      req.cloudRelayIdentity = identity;
      this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req));
    } catch (_error) {
      reject(socket, 401);
    }
  }

  connected(socket, req) {
    const identity = req.cloudRelayIdentity;
    socket.gewuIdentity = identity;
    const previous = this.connections.get(identity.deviceId);
    if (previous && previous.readyState === WebSocket.OPEN) previous.close(1000, 'replaced');
    this.connections.set(identity.deviceId, socket);
    socket.send(JSON.stringify({ type: 'connected', deviceId: identity.deviceId, serverTime: Date.now() }));
    socket.on('message', raw => {
      try {
        const message = JSON.parse(raw);
        if (message.type === 'ping' || message.type === 'heartbeat') {
          socket.send(JSON.stringify({ type: 'pong', serverTime: Date.now() }));
        } else if (message.type === 'authority_command_result'
          && identity.role === 'primary-host') {
          this.authorityRelayRouter.handleHostResult(identity.deviceId, message.payload);
        }
      } catch (_error) { /* malformed client messages do not change authentication */ }
    });
    socket.on('close', () => { if (this.connections.get(identity.deviceId) === socket) this.connections.delete(identity.deviceId); });
    socket.on('error', () => { if (this.connections.get(identity.deviceId) === socket) this.connections.delete(identity.deviceId); });
  }

  authorityConnected(socket) {
    this.authorityConnections.add(socket);
    this.authorityUnauthenticatedConnections.add(socket);
    socket.gewuAuthorityInFlight = 0;
    socket.gewuAuthorityRate = { startedAt: Date.now(), count: 0 };
    const cleanupLimitedConnection = () => {
      this.authorityConnections.delete(socket);
      this.authorityUnauthenticatedConnections.delete(socket);
    };
    if (this.authorityConnections.size > this.authorityMaxConnections) {
      socket.once('close', cleanupLimitedConnection);
      socket.once('error', cleanupLimitedConnection);
      socket.close(1013, 'server connection limit');
      return;
    }
    if (this.authorityUnauthenticatedConnections.size > this.authorityMaxUnauthenticatedConnections) {
      socket.once('close', cleanupLimitedConnection);
      socket.once('error', cleanupLimitedConnection);
      socket.close(1013, 'unauthenticated connection limit');
      return;
    }
    const authenticationTimer = setTimeout(() => {
      if (!socket.gewuAuthorityActor) socket.close(1008, 'authentication required');
    }, this.authorityAuthenticationTimeoutMs);
    socket.on('message', async raw => {
      let frame = null;
      try {
        const currentTime = Date.now();
        if (currentTime - socket.gewuAuthorityRate.startedAt >= this.authorityMessageWindowMs) {
          socket.gewuAuthorityRate = { startedAt: currentTime, count: 0 };
        }
        socket.gewuAuthorityRate.count += 1;
        if (socket.gewuAuthorityRate.count > this.authorityMessageLimit) {
          socket.close(1008, 'message rate limit');
          return;
        }
        frame = JSON.parse(raw.toString('utf8'));
        if (!socket.gewuAuthorityActor) {
          if (frame?.protocol !== 'gewu.authority-socket.v1'
            || frame?.type !== 'connection.authenticate' || !frame.auth) {
            socket.close(1008, 'authentication required');
            return;
          }
          const actor = await this.authenticateAuthorityConnection(frame);
          if (!actor?.userId || !actor?.deviceId || !actor?.role) {
            socket.close(1008, 'authentication required');
            return;
          }
          socket.gewuAuthorityActor = Object.freeze({
            userId: String(actor.userId),
            deviceId: String(actor.deviceId),
            role: String(actor.role),
          });
          const deviceId = socket.gewuAuthorityActor.deviceId;
          const previous = this.authorityDeviceConnections.get(deviceId);
          this.authorityDeviceConnections.set(deviceId, socket);
          this.authorityUnauthenticatedConnections.delete(socket);
          if (previous && previous !== socket && previous.readyState === WebSocket.OPEN) {
            previous.gewuAuthorityReplaced = true;
            previous.close(1000, 'replaced');
          }
          clearTimeout(authenticationTimer);
          socket.send(JSON.stringify({ protocol: 'gewu.authority-socket.v1', type: 'ready' }));
          return;
        }
        if (frame?.envelope?.actor?.userId !== socket.gewuAuthorityActor.userId
          || frame?.envelope?.actor?.deviceId !== socket.gewuAuthorityActor.deviceId
          || frame?.envelope?.actor?.role !== socket.gewuAuthorityActor.role) {
          throw Object.assign(new Error('AUTHORITY_SOCKET_CONNECTION_ACTOR_MISMATCH'), {
            code: 'AUTHORITY_SOCKET_CONNECTION_ACTOR_MISMATCH',
          });
        }
        if (socket.gewuAuthorityInFlight >= this.authorityMaxConcurrentMessages) {
          socket.send(JSON.stringify({
            protocol: 'gewu.authority-socket.v1',
            type: 'command.error',
            requestId: String(frame?.requestId || ''),
            error: { code: 'AUTHORITY_SOCKET_CONCURRENCY_LIMIT', retryable: true },
          }));
          return;
        }
        const deviceId = socket.gewuAuthorityActor.deviceId;
        const deviceInFlight = Number(this.authorityDeviceInFlight.get(deviceId) || 0);
        if (deviceInFlight >= this.authorityMaxConcurrentMessagesPerDevice) {
          socket.send(JSON.stringify({
            protocol: 'gewu.authority-socket.v1',
            type: 'command.error',
            requestId: String(frame?.requestId || ''),
            error: { code: 'AUTHORITY_SOCKET_DEVICE_CONCURRENCY_LIMIT', retryable: true },
          }));
          return;
        }
        socket.gewuAuthorityInFlight += 1;
        this.authorityDeviceInFlight.set(deviceId, deviceInFlight + 1);
        try {
          await this.authorityRelayRouter.handleDesktopFrame(socket, frame);
        } finally {
          socket.gewuAuthorityInFlight -= 1;
          const remaining = Number(this.authorityDeviceInFlight.get(deviceId) || 1) - 1;
          if (remaining > 0) this.authorityDeviceInFlight.set(deviceId, remaining);
          else this.authorityDeviceInFlight.delete(deviceId);
        }
      } catch (error) {
        if (!socket.gewuAuthorityActor) {
          socket.close(1008, 'authentication failed');
          return;
        }
        socket.send(JSON.stringify({
          protocol: 'gewu.authority-socket.v1',
          type: 'command.error',
          requestId: String(frame?.requestId || error?.requestId || ''),
          error: { code: error?.code || 'AUTHORITY_SOCKET_FRAME_INVALID', retryable: false },
        }));
      }
    });
    const cleanup = () => {
      clearTimeout(authenticationTimer);
      this.authorityConnections.delete(socket);
      this.authorityUnauthenticatedConnections.delete(socket);
      const deviceId = socket.gewuAuthorityActor?.deviceId;
      if (deviceId && this.authorityDeviceConnections.get(deviceId) === socket) {
        this.authorityDeviceConnections.delete(deviceId);
      }
      this.authorityRelayRouter.removeClient(socket);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
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
