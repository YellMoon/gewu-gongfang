/**
 * 老师管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

function tenantOptions(req) {
  return { tenantId: req.tenantId || req.query.tenant_id || req.body?.tenant_id || 'default' };
}

function validateTeacher(req, res, next) {
  if (req.method === 'POST' && !req.body.name) {
    return res.status(400).json({ error: '参数校验失败', details: { missing: ['name'] } });
  }
  if (req.body.hourly_rate !== undefined && Number(req.body.hourly_rate) < 0) {
    return res.status(400).json({ error: '参数校验失败', details: { field: 'hourly_rate', reason: '不能小于 0' } });
  }
  return next();
}

router.get('/', (req, res) => {
  try { res.json({ success: true, data: getInstance().getAllTeachers(tenantOptions(req)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const teacher = getInstance().getTeacherById(req.params.id, tenantOptions(req));
    if (!teacher) return res.status(404).json({ error: '老师不存在' });
    res.json({ success: true, data: teacher });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', validateTeacher, (req, res) => {
  try { res.status(201).json({ success: true, data: getInstance().createTeacher(req.body, tenantOptions(req)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', validateTeacher, (req, res) => {
  try {
    const teacher = getInstance().updateTeacher(req.params.id, req.body, tenantOptions(req));
    if (!teacher) return res.status(404).json({ error: '老师不存在' });
    res.json({ success: true, data: teacher });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    const deleted = getInstance().deleteTeacher(req.params.id, tenantOptions(req));
    if (!deleted) return res.status(404).json({ error: '鑰佸笀涓嶅瓨鍦?' });
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
