/**
 * 后端 WebSocket 客户端（主机端）
 * 连接到 Gateway WebSocket 服务器，接收实时任务通知
 */
const WebSocket = require('ws');
const EventEmitter = require('events');

class HostWebSocketClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.hostDeviceId = options.hostDeviceId;
    this.gatewayUrl = options.gatewayUrl || process.env.GATEWAY_WS_URL || 'ws://localhost:3001';
    this.hostToken = options.hostToken || process.env.GEWU_CLOUD_RELAY_HOST_TOKEN;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.messageQueue = [];
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[HostWS] 已连接');
      return;
    }

    const url = new URL(this.gatewayUrl);
    url.pathname = '/ws/cloud-relay';
    url.searchParams.set('token', this.hostToken);
    url.searchParams.set('deviceId', this.hostDeviceId);
    url.searchParams.set('role', 'host');

    console.log(`[HostWS] 连接到 ${url.toString()}`);

    this.ws = new WebSocket(url.toString());

    this.ws.on('open', () => {
      console.log('[HostWS] 连接成功');
      this.isConnected = true;
      this.startHeartbeat();
      this.flushMessageQueue();
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        console.log('[HostWS] 收到消息:', message.type);
        this.handleMessage(message);
      } catch (error) {
        console.error('[HostWS] 消息解析失败:', error);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[HostWS] 连接关闭: ${code} ${reason}`);
      this.isConnected = false;
      this.stopHeartbeat();
      this.emit('disconnected', code, reason);
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      console.error('[HostWS] 连接错误:', error.message);
      this.emit('error', error);
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'new_task':
        this.emit('new_task', message.payload);
        break;
      case 'task_complete':
        this.emit('task_complete', message.payload);
        break;
      case 'task_progress':
        this.emit('task_progress', message.payload);
        break;
      case 'host_status':
        this.emit('host_status', message.payload);
        break;
      case 'pong':
        // 心跳响应
        break;
      default:
        console.log('[HostWS] 未知消息类型:', message.type);
    }
  }

  send(type, payload) {
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(message);
      }
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        this.send('ping', { deviceId: this.hostDeviceId });
      }
    }, this.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`[HostWS] ${this.reconnectInterval / 1000}秒后重连...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  getStatus() {
    return {
      connected: this.isConnected,
      hostDeviceId: this.hostDeviceId,
      gatewayUrl: this.gatewayUrl,
    };
  }
}

module.exports = HostWebSocketClient;