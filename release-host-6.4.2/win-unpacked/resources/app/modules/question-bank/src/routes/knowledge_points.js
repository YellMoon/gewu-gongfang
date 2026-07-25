/**
 * 知识点管理路由
 * view = 查看知识点列表和详情
 * edit = 创建/编辑/删除知识点
 */
const { Router } = require('express');
const { getInstance } = require('../database');
const { requirePermission } = require('../../../../gateway/src/middleware/permission');

const router = Router();

// GET / — 获取知识点列表（可按章节筛选）— 需要 view 权限
router.get('/', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    let kps;
    if (req.query.chapter_id) {
      kps = db.getKnowledgePointsByChapter(req.query.chapter_id);
    } else {
      kps = db.getAllKnowledgePoints();
    }
    res.json({ success: true, data: kps, count: kps.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:id — 获取单个知识点 — 需要 view 权限
router.get('/:id', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const kp = db.getKnowledgePointById(req.params.id);
    if (!kp) return res.status(404).json({ error: '知识点不存在' });
    res.json({ success: true, data: kp });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / — 创建知识点 — 需要 edit 权限
router.post('/', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    if (!req.body.name) return res.status(400).json({ error: '知识点名称不能为空' });
    if (!req.body.chapter_id) return res.status(400).json({ error: '所属章节不能为空' });
    const kp = db.createKnowledgePoint(req.body);
    res.status(201).json({ success: true, data: kp });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — 更新知识点 — 需要 edit 权限
router.put('/:id', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    const kp = db.updateKnowledgePoint(req.params.id, req.body);
    if (!kp) return res.status(404).json({ error: '知识点不存在' });
    res.json({ success: true, data: kp });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — 删除知识点（软删除）— 需要 edit 权限
router.delete('/:id', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    db.deleteKnowledgePoint(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
