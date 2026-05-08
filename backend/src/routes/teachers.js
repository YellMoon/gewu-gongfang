/**
 * 老师管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

router.get('/', (req, res) => {
  try { res.json({ success: true, data: getInstance().getAllTeachers() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const teacher = getInstance().getTeacherById(req.params.id);
    if (!teacher) return res.status(404).json({ error: '老师不存在' });
    res.json({ success: true, data: teacher });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try { res.status(201).json({ success: true, data: getInstance().createTeacher(req.body) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  try {
    const teacher = getInstance().updateTeacher(req.params.id, req.body);
    if (!teacher) return res.status(404).json({ error: '老师不存在' });
    res.json({ success: true, data: teacher });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try { getInstance().deleteTeacher(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
