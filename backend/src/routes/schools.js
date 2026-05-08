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
  try { res.status(201).json({ success: true, data: getInstance().addOrUpdateSchool(req.body.name) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
