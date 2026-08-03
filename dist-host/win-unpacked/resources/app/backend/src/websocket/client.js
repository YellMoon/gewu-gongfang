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
    this.hostCredential = options.hostCredential || process.env.GEWU_PRIMARY_HOST_CREDENTIAL || '';
    this.hostGeneration = Number(options.hostGeneration || process.env.GEWU_PRIMARY_HOST_GENERATION || 0);
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.reconnectMaxMs = options.reconnectMaxMs || 60000;
    this.reconnectJitter = options.reconnectJitter || Math.random;
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.WebSocket = options.WebSocketImpl || WebSocket;
    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.messageQueue = [];
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;
    this.nextRetryAt = null;
    this.lastError = null;
    this.now = options.now || (() => Date.now());
    this.setTimeoutImpl = options.setTimeoutImpl || setTimeout;
    this.clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
    this.log = typeof options.log === 'function' ? options.log : () => {};
    // 防止未捕获的错误事件导致进程崩溃
    this.on('error', () => {});
  }

  connect() {
    this.shouldReconnect = true;
    if (this.ws && this.ws.readyState === this.WebSocket.OPEN) {
      this.log('[HostWS] already connected');
      return;
    }

    const url = new URL(this.gatewayUrl);
    const basePath = url.pathname.replace(/\/+$/, '');
    url.pathname = basePath.endsWith('/ws/cloud-relay')
      ? basePath
      : `${basePath}/ws/cloud-relay`;
    url.searchParams.set('deviceId', this.hostDeviceId);
    url.searchParams.set('role', 'host');
    if (!this.hostCredential || !this.hostDeviceId || !Number.isSafeInteger(this.hostGeneration) || this.hostGeneration < 1) {
      const error = Object.assign(new Error('MANAGED_HOST_IDENTITY_INCOMPLETE'), { code: 'MANAGED_HOST_IDENTITY_INCOMPLETE' });
      this.lastError = error.code;
      this.emit('error', error);
      return;
    }

    this.log('[HostWS] connecting');

    this.ws = new this.WebSocket(url.toString(), {
      headers: {
        'x-gewu-host-device-id': this.hostDeviceId,
        'x-gewu-host-generation': String(this.hostGeneration),
        'x-gewu-host-credential': this.hostCredential,
      },
    });

    this.ws.on('open', () => {
      this.log('[HostWS] connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.nextRetryAt = null;
      this.lastError = null;
      this.startHeartbeat();
      this.flushMessageQueue();
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.log(`[HostWS] message ${message.type}`);
        this.handleMessage(message);
      } catch (error) {
        this.lastError = error?.code || error?.message || 'HOST_WEBSOCKET_MESSAGE_INVALID';
        this.emit('error', error);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.log(`[HostWS] closed ${code}`);
      this.isConnected = false;
      this.stopHeartbeat();
      this.emit('disconnected', code, reason);
      if (this.shouldReconnect) this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.lastError = error?.code || error?.message || 'HOST_WEBSOCKET_ERROR';
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
      case 'authority_command_forward':
        this.emit('authority_command_forward', message.payload);
        break;
      case 'pong':
        // 心跳响应
        break;
      default:
        this.log(`[HostWS] unknown message ${message.type}`);
    }
  }

  send(type, payload) {
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    if (this.isConnected && this.ws.readyState === this.WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (this.ws.readyState === this.WebSocket.OPEN) {
        this.ws.send(message);
      }
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws.readyState === this.WebSocket.OPEN) {
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.nextRetryAt = null;
      this.log('[HostWS] reconnect disabled');
      this.emit('max_reconnect_attempts');
      return;
    }
    this.reconnectAttempts++;
    const baseDelay = Math.min(this.reconnectMaxMs, this.reconnectInterval * (2 ** Math.max(0, this.reconnectAttempts - 1)));
    const jitter = Math.max(0, Math.min(0.25, Number(this.reconnectJitter()) || 0));
    const delay = Math.min(this.reconnectMaxMs, Math.round(baseDelay * (1 + jitter)));
    this.nextRetryAt = Number(this.now()) + delay;
    this.log(`[HostWS] reconnect scheduled ${delay}`);
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect() {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      this.clearTimeoutImpl(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  getStatus() {
    return Object.freeze({
      connected: this.isConnected,
      hostDeviceId: this.hostDeviceId,
      gatewayUrl: this.gatewayUrl,
      state: this.isConnected ? 'connected' : (this.nextRetryAt ? 'backoff' : (this.shouldReconnect ? 'connecting' : 'disabled')),
      nextRetryAt: this.nextRetryAt,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
    });
  }
}

module.exports = HostWebSocketClient;
