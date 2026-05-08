/**
 * 题目管理路由
 * view = 做题/查看/手动组卷/导出/批改
 * edit = 创建/编辑/删除题目 + 批量导入 + 管理知识点
 */
const { Router } = require('express');
const { getInstance } = require('../database');
const { requirePermission } = require('../../../../gateway/src/middleware/permission');

const router = Router();

// GET / — 获取题目列表（支持多维筛选 + 分页）— 需要 view 权限
router.get('/', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const result = db.getQuestions(req.query);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:id — 获取单个题目详情 — 需要 view 权限
router.get('/:id', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const question = db.getQuestionById(req.params.id);
    if (!question) return res.status(404).json({ error: '题目不存在' });
    res.json({ success: true, data: question });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / — 创建题目 — 需要 edit 权限
router.post('/', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    if (!req.body.content) return res.status(400).json({ error: '题目内容不能为空' });
    if (!req.body.type) return res.status(400).json({ error: '题型不能为空' });
    if (!req.body.subject_id) return res.status(400).json({ error: '所属学科不能为空' });
    const question = db.createQuestion(req.body);
    res.status(201).json({ success: true, data: question });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /batch — 批量导入题目 — 需要 edit 权限
router.post('/batch', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    if (!Array.isArray(req.body.questions) || req.body.questions.length === 0) {
      return res.status(400).json({ error: '请提供题目数组' });
    }
    const results = db.batchCreateQuestions(req.body.questions);
    res.status(201).json({ success: true, data: results, count: results.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — 更新题目 — 需要 edit 权限
router.put('/:id', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    const question = db.updateQuestion(req.params.id, req.body);
    if (!question) return res.status(404).json({ error: '题目不存在' });
    res.json({ success: true, data: question });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — 删除题目（软删除）— 需要 edit 权限
router.delete('/:id', requirePermission('question-bank', 'edit'), (req, res) => {
  try {
    const db = getInstance();
    db.deleteQuestion(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
