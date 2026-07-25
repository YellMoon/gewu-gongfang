const WebSocket = require('ws');

class ConnectionManager {
  constructor() {
    this.connections = new Map(); // deviceId -> { ws, userId, role, lastHeartbeat }
    this.heartbeatInterval = 30000; // 30秒心跳间隔
    this.heartbeatTimeout = 60000; // 60秒超时
    this.startHeartbeatCheck();
  }

  // 添加连接
  addConnection(deviceId, ws, userId, role) {
    // 关闭现有连接
    const existing = this.connections.get(deviceId);
    if (existing && existing.ws.readyState === WebSocket.OPEN) {
      existing.ws.close(1000, 'New connection established');
    }

    this.connections.set(deviceId, {
      ws,
      userId,
      role,
      lastHeartbeat: Date.now(),
      connectedAt: Date.now(),
    });

    console.log(`[WebSocket] Device connected: ${deviceId} (user: ${userId}, role: ${role})`);
  }

  // 移除连接
  removeConnection(deviceId) {
    const connection = this.connections.get(deviceId);
    if (connection) {
      console.log(`[WebSocket] Device disconnected: ${deviceId}`);
      this.connections.delete(deviceId);
    }
  }

  // 更新心跳
  updateHeartbeat(deviceId) {
    const connection = this.connections.get(deviceId);
    if (connection) {
      connection.lastHeartbeat = Date.now();
    }
  }

  // 发送消息到指定设备
  sendToDevice(deviceId, message) {
    const connection = this.connections.get(deviceId);
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // 广播消息到所有连接
  broadcast(message, excludeDeviceId = null) {
    const messageStr = JSON.stringify(message);
    for (const [deviceId, connection] of this.connections.entries()) {
      if (deviceId !== excludeDeviceId && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(messageStr);
      }
    }
  }

  // 广播消息到指定角色的设备
  broadcastToRole(role, message, excludeDeviceId = null) {
    const messageStr = JSON.stringify(message);
    for (const [deviceId, connection] of this.connections.entries()) {
      if (deviceId !== excludeDeviceId && connection.role === role && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(messageStr);
      }
    }
  }

  // 检查心跳超时
  startHeartbeatCheck() {
    setInterval(() => {
      const now = Date.now();
      for (const [deviceId, connection] of this.connections.entries()) {
        if (now - connection.lastHeartbeat > this.heartbeatTimeout) {
          console.log(`[WebSocket] Heartbeat timeout for device: ${deviceId}`);
          connection.ws.close(1000, 'Heartbeat timeout');
          this.removeConnection(deviceId);
        }
      }
    }, this.heartbeatInterval);
  }

  // 获取连接统计
  getStats() {
    return {
      totalConnections: this.connections.size,
      connectionsByRole: Array.from(this.connections.values()).reduce((acc, conn) => {
        acc[conn.role] = (acc[conn.role] || 0) + 1;
        return acc;
      }, {}),
    };
  }
}

module.exports = ConnectionManager;
