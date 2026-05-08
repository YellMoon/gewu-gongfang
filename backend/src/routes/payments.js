/**
 * 缴费管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

router.get('/', (req, res) => {
  try {
    const db = getInstance();
    let payments;
    if (req.query.student_id) {
      payments = db.getPaymentsByStudent(req.query.student_id);
    } else {
      payments = db.getAllPayments();
    }
    res.json({ success: true, data: payments, count: payments.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const db = getInstance();
    const payment = db.db.prepare('SELECT * FROM payments WHERE id = ? AND deleted = 0').get(req.params.id);
    if (!payment) return res.status(404).json({ error: '缴费记录不存在' });
    res.json({ success: true, data: payment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try {
    const db = getInstance();
    const payment = db.createPayment(req.body);
    res.status(201).json({ success: true, data: payment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
