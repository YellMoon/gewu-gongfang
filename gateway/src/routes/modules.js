/**
 * 模块发现路由
 * GET /api/modules — 查询已注册模块列表
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

router.get('/', (req, res) => {
  const db = getDb();

  const modules = db.prepare(`
    SELECT id, name, description, icon, route_prefix, sort_order, status
    FROM modules
    WHERE status = 1
    ORDER BY sort_order
  `).all();

  res.json({ modules });
});

module.exports = router;
