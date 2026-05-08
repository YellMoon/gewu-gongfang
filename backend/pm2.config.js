/**
 * PM2 生产环境配置
 * 使用: pm2 start pm2.config.js
 */
module.exports = {
  apps: [{
    name: 'scheduling-backend',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    // 日志
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    max_memory_restart: '500M',
    // 自动重启
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    // 监听文件变化（生产环境关闭）
    watch: false,
    // 优雅关闭
    kill_timeout: 5000,
    listen_timeout: 10000
  }]
};
