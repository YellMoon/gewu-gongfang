/**
 * 学生做题记录路由
 * view 权限: 提交做题记录 + 查看自己的记录和统计
 * 教师/管理员可查看所有学生的记录
 */
const { Router } = require('express');
const { getInstance } = require('../database');
const { requirePermission } = require('../../../../gateway/src/middleware/permission');

const router = Router();

/**
 * 学生数据所有权校验中间件
 * 学生只能查看自己的记录，教师/管理员可查看任意学生
 */
function requireStudentOwnership(paramKey = 'studentId') {
  return (req, res, next) => {
    const targetStudentId = req.params[paramKey];
    // 管理员和教师可以查看任意学生数据
    if (req.user.user_type === 'admin' || req.user.user_type === 'teacher') {
      return next();
    }
    // 学生只能查看自己的数据
    if (req.user.id === targetStudentId) {
      return next();
    }
    return res.status(403).json({ error: '只能查看自己的记录' });
  };
}

// POST / — 提交做题记录 — 需要 view 权限（学生可操作）
router.post('/', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    if (!req.body.student_id) return res.status(400).json({ error: '学生ID不能为空' });
    if (!req.body.question_id) return res.status(400).json({ error: '题目ID不能为空' });
    const record = db.submitRecord(req.body);
    res.status(201).json({ success: true, data: record });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /student/:studentId — 查询学生做题历史 — 需要 view 权限 + 所有权校验
router.get('/student/:studentId', requirePermission('question-bank', 'view'), requireStudentOwnership('studentId'), (req, res) => {
  try {
    const db = getInstance();
    const result = db.getRecordsByStudent(req.params.studentId, req.query);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /set/:setId — 查询试卷的做题记录 — 需要 view 权限
router.get('/set/:setId', requirePermission('question-bank', 'view'), (req, res) => {
  try {
    const db = getInstance();
    const records = db.getRecordsByQuestionSet(req.params.setId);
    res.json({ success: true, data: records, count: records.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /stats/:studentId — 学生做题统计 — 需要 view 权限 + 所有权校验
router.get('/stats/:studentId', requirePermission('question-bank', 'view'), requireStudentOwnership('studentId'), (req, res) => {
  try {
    const db = getInstance();
    const stats = db.getStudentStats(req.params.studentId, req.query.subject_id);
    const byType = db.getStatsByType(req.params.studentId, req.query.subject_id);
    res.json({ success: true, data: { ...stats, by_type: byType } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
