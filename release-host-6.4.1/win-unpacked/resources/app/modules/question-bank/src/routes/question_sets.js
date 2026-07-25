/**
 * 试卷/题集管理路由
 * view 权限覆盖: 查看 + 手动组卷 + 随机抽题
 */
const { Router } = require('express');
const { getInstance } = require('../database');
const { requirePermission } = require('../../../../gateway/src/middleware/permission');

const router = Router();

// GET / — 获取试卷列表（支持分页）— 需要 view 权限
router.get('/', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const result = db.getQuestionSets(req.query);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:id — 获取试卷详情（含题目列表）— 需要 view 权限
router.get('/:id', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const set = db.getQuestionSetWithItems(req.params.id);
    if (!set) return res.status(404).json({ error: '试卷不存在' });
    res.json({ success: true, data: set });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / — 创建试卷（学生可手动组卷）— 需要 view 权限
router.post('/', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    if (!req.body.name) return res.status(400).json({ error: '试卷名称不能为空' });
    const set = db.createQuestionSet(req.body);
    res.status(201).json({ success: true, data: set });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — 更新试卷信息 — 需要 view 权限
router.put('/:id', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const set = db.updateQuestionSet(req.params.id, req.body);
    if (!set) return res.status(404).json({ error: '试卷不存在' });
    res.json({ success: true, data: set });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — 删除试卷（软删除）— 需要 view 权限
router.delete('/:id', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    db.deleteQuestionSet(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/items — 手动添加题目到试卷（学生可操作）— 需要 view 权限
router.post('/:id/items', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const set = db.getQuestionSetById(req.params.id);
    if (!set) return res.status(404).json({ error: '试卷不存在' });
    if (!req.body.question_id) return res.status(400).json({ error: '题目ID不能为空' });
    const item = db.addItemToSet(
      req.params.id,
      req.body.question_id,
      req.body.score || 0,
      req.body.sort_order || 0
    );
    res.status(201).json({ success: true, data: item });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /items/:itemId — 从试卷移除题目 — 需要 view 权限
router.delete('/items/:itemId', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    db.removeItemFromSet(req.params.itemId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/random — 随机抽题组卷（学生可操作）— 需要 view 权限
router.post('/:id/random', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const set = db.getQuestionSetById(req.params.id);
    if (!set) return res.status(404).json({ error: '试卷不存在' });

    const questions = db.randomPickQuestions({
      subject_id: req.body.subject_id || set.subject_id,
      chapter_id: req.body.chapter_id,
      type: req.body.type,
      difficulty: req.body.difficulty,
      count: req.body.count || 10
    });

    // 将抽到的题目加入试卷
    const maxSort = (db.getQuestionSetWithItems(req.params.id)?.items?.length) || 0;
    const addedItems = [];
    for (let i = 0; i < questions.length; i++) {
      const item = db.addItemToSet(req.params.id, questions[i].id, req.body.score || 0, maxSort + i + 1);
      addedItems.push(item);
    }

    res.json({ success: true, data: addedItems, count: addedItems.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
