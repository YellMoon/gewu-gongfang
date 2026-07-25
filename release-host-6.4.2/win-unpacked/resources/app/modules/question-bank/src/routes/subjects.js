/**
 * 学科管理路由
 * view = 查看学科列表和详情
 * edit = 创建/编辑/删除学科
 */
const { Router } = require('express');
const { getInstance } = require('../database');
const { requirePermission } = require('../../../../gateway/src/middleware/permission');

const router = Router();

// GET / — 获取所有学科 — 需要 view 权限
router.get('/', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const subjects = db.getAllSubjects();
    res.json({ success: true, data: subjects, count: subjects.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:id — 获取单个学科 — 需要 view 权限
router.get('/:id', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const subject = db.getSubjectById(req.params.id);
    if (!subject) return res.status(404).json({ error: '学科不存在' });
    res.json({ success: true, data: subject });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / — 创建学科 — 需要 edit 权限
router.post('/', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    if (!req.body.name) return res.status(400).json({ error: '学科名称不能为空' });
    const subject = db.createSubject(req.body);
    res.status(201).json({ success: true, data: subject });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — 更新学科 — 需要 edit 权限
router.put('/:id', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    const subject = db.updateSubject(req.params.id, req.body);
    if (!subject) return res.status(404).json({ error: '学科不存在' });
    res.json({ success: true, data: subject });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — 删除学科（软删除）— 需要 edit 权限
router.delete('/:id', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    db.deleteSubject(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
