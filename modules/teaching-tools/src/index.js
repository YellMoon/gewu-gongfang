/**
 * 教学工具模块 - 入口
 * 提供插件注册中心 + 客户端同步 API
 */
const express = require('express');
const router = express.Router();
const toolsRouter = require('./routes/tools');

// 健康检查
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', module: 'teaching-tools', version: '1.4.0' });
});

// 插件注册 API
router.use('/tools', toolsRouter);

module.exports = router;
