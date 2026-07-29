const WebSocket = require('ws');
const url = require('url');
const { authenticateWebSocket } = require('./authMiddleware');
const ConnectionManager = require('./connectionManager');
const { getDb } = require('../db/database');
const {
  createAuthorityDeviceRequestAuth,
} = require('../services/authorityDeviceRequestAuth');
const {
  createAuthorityCommandAuthorizationService,
} = require('../../../backend/src/services/authorityCommandAuthorizationService');
const {
  createAuthorityCommandPolicy,
} = require('../../../backend/src/services/authorityCommandRegistry');
const { validateEnvelope } = require('../../../shared/authorityProtocol');
const { createAuthorityRelayRouter } = require('./authorityRelayRouter');

class CloudWebSocketServer {
  constructor(server, options = {}) {
    this.wss = new WebSocket.Server({ noServer: true });
    this.authorityWss = new WebSocket.Server({ noServer: true });
    this.connectionManager = new ConnectionManager();
    const db = options.db || getDb();
    this.db = db;
    const deviceAuth = createAuthorityDeviceRequestAuth({ db });
    const authorization = createAuthorityCommandAuthorizationService({
      db,
      commandPolicy: options.authorityCommandPolicy || createAuthorityCommandPolicy(),
    });
    this.authorityRelayRouter = createAuthorityRelayRouter({
      authenticateFrame: frame => {
        validateEnvelope(frame.envelope);
        return deviceAuth.authenticate({
          method: 'POST',
          originalUrl: '/api/authority/commands',
          url: '/api/authority/commands',
          headers: Object.fromEntries(Object.entries(frame.auth || {}).map(([key, value]) => [
            String(key).toLowerCase(),
            String(value),
          ])),
          body: frame.envelope,
          params: {},
        });
      },
      authorizeCommand: envelope => authorization.authorize(envelope),
      targetHostFor: envelope => {
        const epoch = db.prepare(`SELECT device_id, db_authority_id FROM primary_host_epochs
          WHERE id=? AND status='active'`).get(envelope.hostEpochId);
        return epoch?.db_authority_id === envelope.authorityId ? epoch.device_id : '';
      },
      sendToHost: (hostDeviceId, message) => (
        this.connectionManager.sendToDevice(hostDeviceId, message)
      ),
    });
    this.setupWebSocket(server);
    this.setupMessageHandlers();
  }

  setupWebSocket(server) {
    // 处理升级请求
    server.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/ws/authority') {
        this.authorityWss.handleUpgrade(req, socket, head, ws => {
          this.authorityWss.emit('connection', ws, req);
        });
        return;
      }
      if (pathname !== '/ws/cloud-relay') return;
      // 先进行认证
      authenticateWebSocket(req, socket, (err) => {
        if (err) return;
        
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      }, { db: this.db });
    });

    // 处理连接
    this.wss.on('connection', (ws, req) => {
      const user = req.user;
      ws.gewuIdentity = user;
      console.log(`[WebSocket] New connection from device: ${user.deviceId}`);

      // 添加到连接管理器
      this.connectionManager.addConnection(user.deviceId, ws, user.userId, user.activeRole);

      // 发送连接成功消息
      ws.send(JSON.stringify({
        type: 'connected',
        deviceId: user.deviceId,
        serverTime: Date.now(),
      }));

      // 处理断开连接
      ws.on('close', () => {
        this.connectionManager.removeConnection(user.deviceId);
      });

      // 处理错误
      ws.on('error', (error) => {
        console.error(`[WebSocket] Error for device ${user.deviceId}:`, error);
        this.connectionManager.removeConnection(user.deviceId);
      });
    });

    this.authorityWss.on('connection', ws => {
      ws.send(JSON.stringify({ protocol: 'gewu.authority-socket.v1', type: 'ready' }));
      ws.on('message', data => {
        try {
          const frame = JSON.parse(data.toString('utf8'));
          void this.authorityRelayRouter.handleDesktopFrame(ws, frame);
        } catch (_error) {
          ws.send(JSON.stringify({
            protocol: 'gewu.authority-socket.v1',
            type: 'command.error',
            requestId: '',
            error: { code: 'AUTHORITY_SOCKET_FRAME_INVALID', retryable: false },
          }));
        }
      });
      ws.on('close', () => this.authorityRelayRouter.removeClient(ws));
      ws.on('error', () => this.authorityRelayRouter.removeClient(ws));
    });
  }

  setupMessageHandlers() {
    // 心跳处理
    this.wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          
          switch (message.type) {
            case 'heartbeat':
            case 'ping':
              this.handleHeartbeat(ws, message);
              break;
            case 'task_ack':
              this.handleTaskAck(ws, message);
              break;
            case 'authority_command_result':
              if (ws.gewuIdentity?.activeRole === 'host') {
                this.authorityRelayRouter.handleHostResult(
                  ws.gewuIdentity.deviceId,
                  message.payload,
                );
              }
              break;
            default:
              console.log('[WebSocket] Unknown message type:', message.type);
          }
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      });
    });
  }

  handleHeartbeat(ws, message) {
    const deviceId = message.deviceId || message.payload?.deviceId;
    this.connectionManager.updateHeartbeat(deviceId);
    
    ws.send(JSON.stringify({
      type: 'pong',
      serverTime: Date.now(),
    }));
  }

  handleTaskAck(ws, message) {
    const { taskId, status } = message;
    console.log(`[WebSocket] Task ${taskId} acknowledged with status: ${status}`);
    
    // 这里可以添加任务确认逻辑
  }

  notifyHostNewTask(hostDeviceId, taskInfo) {
    const sent = this.connectionManager.sendToDevice(hostDeviceId, {
      type: 'new_task',
      payload: taskInfo,
      timestamp: Date.now(),
    });
    
    if (!sent) {
      console.log(`[WebSocket] Host ${hostDeviceId} not connected, task will be picked up via HTTP`);
    }
    
    return sent;
  }

  notifyDesktopTaskComplete(deviceId, taskResult) {
    const sent = this.connectionManager.sendToDevice(deviceId, {
      type: 'task_complete',
      payload: taskResult,
      timestamp: Date.now(),
    });
    
    if (!sent) {
      console.log(`[WebSocket] Desktop ${deviceId} not connected, result will be available via HTTP`);
    }
    
    return sent;
  }

  // 广播主机状态更新
  broadcastHostStatus(hostDeviceId, status) {
    this.connectionManager.broadcastToRole('desktop-client', {
      type: 'host_status_update',
      hostDeviceId,
      status,
      timestamp: Date.now(),
    });
  }

  // 获取服务器统计
  getStats() {
    return this.connectionManager.getStats();
  }
}

module.exports = CloudWebSocketServer;
