/**
 * 桌面端 WebSocket 客户端
 * 连接到 Gateway WebSocket 服务器，接收主机任务通知
 */
import WebSocket from 'ws';
import { EventEmitter } from 'events';

class DesktopWebSocketClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.deviceId = options.deviceId;
    this.gatewayUrl = options.gatewayUrl || 'ws://localhost:3001';
    this.sessionToken = options.sessionToken;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.messageQueue = [];
    this.reconnectAttempts = 0;
    // 防止未捕获的错误事件导致进程崩溃
    this.on('error', () => {});
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[DesktopWS] 已连接');
      return;
    }

    const url = new URL(this.gatewayUrl);
    url.pathname = '/ws/cloud-relay';
    url.searchParams.set('token', this.sessionToken);
    url.searchParams.set('deviceId', this.deviceId);
    url.searchParams.set('role', 'desktop');

    console.log(`[DesktopWS] 连接到 ${url.toString()}`);

    this.ws = new WebSocket(url.toString());

    this.ws.on('open', () => {
      console.log('[DesktopWS] 连接成功');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.flushMessageQueue();
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        console.log('[DesktopWS] 收到消息:', message.type);
        this.handleMessage(message);
      } catch (error) {
        console.error('[DesktopWS] 消息解析失败:', error);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[DesktopWS] 连接关闭: ${code} ${reason}`);
      this.isConnected = false;
      this.stopHeartbeat();
      this.emit('disconnected', code, reason);
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      console.error('[DesktopWS] 连接错误:', error.message);
      // 防止未捕获的错误事件导致进程崩溃
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
        console.log('[DesktopWS] 未知消息类型:', message.type);
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
        this.send('ping', { deviceId: this.deviceId });
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
      console.log(`[DesktopWS] 已达到最大重连次数 ${this.maxReconnectAttempts}，停止重连`);
      this.emit('max_reconnect_attempts');
      return;
    }
    this.reconnectAttempts++;
    console.log(`[DesktopWS] ${this.reconnectInterval / 1000}秒后重连... (尝试 ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
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
      deviceId: this.deviceId,
      gatewayUrl: this.gatewayUrl,
    };
  }
}

export default DesktopWebSocketClient;