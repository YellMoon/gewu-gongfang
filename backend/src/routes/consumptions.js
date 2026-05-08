/**
 * 课时消耗路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

router.get('/', (req, res) => {
  try {
    const db = getInstance();
    let consumptions;
    if (req.query.student_id) {
      consumptions = db.getConsumptionsByStudent(req.query.student_id);
    } else {
      consumptions = db.getAllConsumptions();
    }
    res.json({ success: true, data: consumptions, count: consumptions.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const db = getInstance();
    const consumption = db.db.prepare('SELECT * FROM consumptions WHERE id = ? AND deleted = 0').get(req.params.id);
    if (!consumption) return res.status(404).json({ error: '消耗记录不存在' });
    res.json({ success: true, data: consumption });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try {
    const db = getInstance();
    const consumption = db.createConsumption(req.body);
    res.status(201).json({ success: true, data: consumption });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
