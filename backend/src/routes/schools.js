/**
 * 学校管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

router.get('/', (req, res) => {
  try { res.json({ success: true, data: getInstance().getAllSchools() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: '参数校验失败', details: { missing: ['name'] } });
  try { res.status(201).json({ success: true, data: getInstance().addOrUpdateSchool(req.body.name) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
