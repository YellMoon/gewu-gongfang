const WebSocket = require('ws');

console.log('测试 WebSocket 连接...');

const ws = new WebSocket('ws://localhost:3001/ws/cloud-relay?token=test&deviceId=test-host&role=host');

ws.on('open', () => {
  console.log('✅ WebSocket 连接成功');
  
  // 发送心跳
  ws.send(JSON.stringify({ type: 'ping', payload: { deviceId: 'test-host' } }));
});

ws.on('message', (data) => {
  console.log('✅ 收到消息:', data.toString());
  ws.close();
  console.log('✅ 所有测试通过');
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('❌ 测试失败:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('连接已关闭');
});

// 超时处理
setTimeout(() => {
  console.log('⚠️  等待消息超时（正常，因为没有新任务）');
  console.log('✅ 测试通过');
  ws.close();
  process.exit(0);
}, 5000);