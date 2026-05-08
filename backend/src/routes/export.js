/**
 * 数据导出/导入路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

// GET /api/export — 导出全部数据
router.get('/export', (req, res) => {
  try {
    const db = getInstance();
    const data = db.exportAll();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=scheduling-backup-${date}.json`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/import — 导入数据
router.post('/import', (req, res) => {
  try {
    const db = getInstance();
    const result = db.importAll(req.body);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
