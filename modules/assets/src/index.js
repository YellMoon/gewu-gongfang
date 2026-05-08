/**
 * 资产统计模块 - 入口
 */
const express = require('express');
const router = express.Router();
const records = require('./routes/records');
const categories = require('./routes/categories');
const stats = require('./routes/stats');

router.use('/records', records);
router.use('/categories', categories);
router.use('/stats', stats);

// 健康检查
router.get('/health', (req, res) => {
  res.json({ status: 'ok', module: 'asset-statistics' });
});

module.exports = router;
