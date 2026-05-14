/**
 * 缴费管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

function badRequest(res, message, details) {
  return res.status(400).json({ error: message, details });
}

function validatePayment(req, res, next) {
  const missing = ['student_id', 'amount', 'payment_type', 'payment_date']
    .filter(field => req.body[field] === undefined || req.body[field] === null || req.body[field] === '');
  if (missing.length > 0) return badRequest(res, '参数校验失败', { missing });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return badRequest(res, '参数校验失败', { field: 'amount', reason: '必须大于 0' });
  }
  if (Number(req.body.payment_type) !== 1 && Number(req.body.payment_type) !== 2) {
    return badRequest(res, '参数校验失败', { field: 'payment_type', reason: '必须是 1 或 2' });
  }
  return next();
}

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

router.post('/', validatePayment, (req, res) => {
  try {
    const db = getInstance();
    const payment = db.createPayment(req.body);
    res.status(201).json({ success: true, data: payment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
