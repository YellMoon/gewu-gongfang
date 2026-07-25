const WebSocket = require('ws');
const url = require('url');
const { authenticateWebSocket } = require('./authMiddleware');
const ConnectionManager = require('./connectionManager');

class CloudWebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ noServer: true });
    this.connectionManager = new ConnectionManager();
    this.setupWebSocket(server);
    this.setupMessageHandlers();
  }

  setupWebSocket(server) {
    // 处理升级请求
    server.on('upgrade', (req, socket, head) => {
      // 先进行认证
      authenticateWebSocket(req, socket, (err) => {
        if (err) return;
        
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      });
    });

    // 处理连接
    this.wss.on('connection', (ws, req) => {
      const user = req.user;
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
