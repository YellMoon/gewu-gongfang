/**
 * 服务器入口
 */
require('dotenv').config();
const http = require('http');
const { createApp } = require('./src/app');
const HostWebSocketClient = require('./src/websocket/client');
const { resolveBackendPort } = require('./src/runtimePort');

const PORT = resolveBackendPort();
const app = createApp();
const server = http.createServer(app);

// 初始化 WebSocket 客户端（连接到 Gateway）
const wsClient = new HostWebSocketClient({
  hostDeviceId: process.env.HOST_DEVICE_ID || 'primary-host',
  gatewayUrl: process.env.GATEWAY_WS_URL || 'ws://localhost:3001',
  hostToken: process.env.GEWU_CLOUD_RELAY_HOST_TOKEN,
});

// 监听新任务事件
wsClient.on('new_task', (payload) => {
  console.log('[HostWS] 收到新任务:', payload.taskId);
  // TODO: 处理新任务
});

// 监听任务完成事件
wsClient.on('task_complete', (payload) => {
  console.log('[HostWS] 任务完成:', payload.taskId);
  // TODO: 处理任务完成
});

// 监听连接状态
wsClient.on('connected', () => {
  console.log('[HostWS] 已连接到 Gateway WebSocket 服务器');
});

wsClient.on('disconnected', (code, reason) => {
  console.log(`[HostWS] 与 Gateway 断开连接: ${code} ${reason}`);
});

// 连接到 Gateway WebSocket 服务器
wsClient.connect();

server.listen(PORT, () => {
  console.log(`\n📚 教务管理系统后端 v3.1.0-0504`);
  console.log(`🚀 服务启动: http://localhost:${PORT}`);
  console.log(`📊 健康检查: http://localhost:${PORT}/api/health`);
  console.log(`🔌 WebSocket 客户端: 已连接到 Gateway`);
  console.log(`\n`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n👋 关闭服务器...');
  wsClient.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 关闭服务器...');
  wsClient.disconnect();
  process.exit(0);
});
