/**
 * 服务器入口
 */
require('dotenv').config();
const { createApp } = require('./src/app');

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`\n📚 教务管理系统后端 v3.1.0-0504`);
  console.log(`🚀 服务启动: http://localhost:${PORT}`);
  console.log(`📊 健康检查: http://localhost:${PORT}/api/health`);
  console.log(`\n`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n👋 关闭服务器...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 关闭服务器...');
  process.exit(0);
});
