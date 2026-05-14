/**
 * 课时消耗路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

function tenantOptions(req) {
  return { tenantId: req.tenantId || req.query.tenant_id || req.body?.tenant_id || 'default' };
}

function badRequest(res, message, details) {
  return res.status(400).json({ error: message, details });
}

function validateConsumption(req, res, next) {
  const missing = ['student_id', 'hours', 'amount', 'consumption_date']
    .filter(field => req.body[field] === undefined || req.body[field] === null || req.body[field] === '');
  if (missing.length > 0) return badRequest(res, '参数校验失败', { missing });
  for (const field of ['hours', 'amount']) {
    const value = Number(req.body[field]);
    if (!Number.isFinite(value) || value < 0) {
      return badRequest(res, '参数校验失败', { field, reason: '必须是非负数字' });
    }
  }
  return next();
}

router.get('/', (req, res) => {
  try {
    const db = getInstance();
    let consumptions;
    if (req.query.student_id) {
      consumptions = db.getConsumptionsByStudent(req.query.student_id, tenantOptions(req));
    } else {
      consumptions = db.getAllConsumptions(tenantOptions(req));
    }
    res.json({ success: true, data: consumptions, count: consumptions.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const db = getInstance();
    const consumption = db.db.prepare('SELECT * FROM consumptions WHERE id = ? AND deleted = 0 AND tenant_id = ?').get(req.params.id, tenantOptions(req).tenantId);
    if (!consumption) return res.status(404).json({ error: '消耗记录不存在' });
    res.json({ success: true, data: consumption });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', validateConsumption, (req, res) => {
  try {
    const db = getInstance();
    const student = db.getStudentById(req.body.student_id, tenantOptions(req));
    const schedule = req.body.schedule_id ? db.getScheduleById(req.body.schedule_id, tenantOptions(req)) : true;
    if (!student || !schedule) return res.status(404).json({ error: '瀛︾敓鎴栨帓璇句笉瀛樺湪' });
    const consumption = db.createConsumption(req.body, tenantOptions(req));
    res.status(201).json({ success: true, data: consumption });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
