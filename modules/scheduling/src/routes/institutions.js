/**
 * 机构管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

router.get('/', (req, res) => {
  try { res.json({ success: true, data: getInstance().getAllInstitutions() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const inst = getInstance().getInstitutionById(req.params.id);
    if (!inst) return res.status(404).json({ error: '机构不存在' });
    res.json({ success: true, data: inst });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try { res.status(201).json({ success: true, data: getInstance().createInstitution(req.body) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  try {
    const inst = getInstance().updateInstitution(req.params.id, req.body);
    if (!inst) return res.status(404).json({ error: '机构不存在' });
    res.json({ success: true, data: inst });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try { getInstance().deleteInstitution(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
