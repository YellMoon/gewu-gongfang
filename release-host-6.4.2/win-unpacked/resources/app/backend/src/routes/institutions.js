/**
 * 机构管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

function tenantOptions(req) {
  return { tenantId: req.tenantId || req.query.tenant_id || req.body?.tenant_id || 'default' };
}

function validateInstitution(req, res, next) {
  if (req.method === 'POST' && !req.body.name) {
    return res.status(400).json({ error: '参数校验失败', details: { missing: ['name'] } });
  }
  if (req.body.revenue_share !== undefined && Number(req.body.revenue_share) < 0) {
    return res.status(400).json({ error: '参数校验失败', details: { field: 'revenue_share', reason: '不能小于 0' } });
  }
  return next();
}

router.get('/', (req, res) => {
  try { res.json({ success: true, data: getInstance().getAllInstitutions(tenantOptions(req)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const inst = getInstance().getInstitutionById(req.params.id, tenantOptions(req));
    if (!inst) return res.status(404).json({ error: '机构不存在' });
    res.json({ success: true, data: inst });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', validateInstitution, (req, res) => {
  try { res.status(201).json({ success: true, data: getInstance().createInstitution(req.body, tenantOptions(req)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', validateInstitution, (req, res) => {
  try {
    const inst = getInstance().updateInstitution(req.params.id, req.body, tenantOptions(req));
    if (!inst) return res.status(404).json({ error: '机构不存在' });
    res.json({ success: true, data: inst });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    const deleted = getInstance().deleteInstitution(req.params.id, tenantOptions(req));
    if (!deleted) return res.status(404).json({ error: '鏈烘瀯涓嶅瓨鍦?' });
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
