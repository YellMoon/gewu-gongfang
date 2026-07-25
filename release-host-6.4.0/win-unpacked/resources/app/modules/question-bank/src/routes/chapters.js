/**
 * 章节管理路由
 * view = 查看章节列表和详情
 * edit = 创建/编辑/删除章节
 */
const { Router } = require('express');
const { getInstance } = require('../database');
const { requirePermission } = require('../../../../gateway/src/middleware/permission');

const router = Router();

// GET / — 获取章节列表（可按学科筛选）— 需要 view 权限
router.get('/', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    let chapters;
    if (req.query.subject_id) {
      chapters = db.getChaptersBySubject(req.query.subject_id);
    } else {
      chapters = db.getAllChapters();
    }
    res.json({ success: true, data: chapters, count: chapters.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:id — 获取单个章节 — 需要 view 权限
router.get('/:id', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const chapter = db.getChapterById(req.params.id);
    if (!chapter) return res.status(404).json({ error: '章节不存在' });
    res.json({ success: true, data: chapter });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / — 创建章节 — 需要 edit 权限
router.post('/', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    if (!req.body.name) return res.status(400).json({ error: '章节名称不能为空' });
    if (!req.body.subject_id) return res.status(400).json({ error: '所属学科不能为空' });
    const chapter = db.createChapter(req.body);
    res.status(201).json({ success: true, data: chapter });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — 更新章节 — 需要 edit 权限
router.put('/:id', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    const chapter = db.updateChapter(req.params.id, req.body);
    if (!chapter) return res.status(404).json({ error: '章节不存在' });
    res.json({ success: true, data: chapter });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — 删除章节（软删除）— 需要 edit 权限
router.delete('/:id', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    db.deleteChapter(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
