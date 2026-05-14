/**
 * 学生管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

function badRequest(res, message, details) {
  return res.status(400).json({ error: message, details });
}

function requireFields(body, fields) {
  return fields.filter(field => body[field] === undefined || body[field] === null || body[field] === '');
}

function validateStudent(req, res, next) {
  if (req.method === 'POST') {
    const missing = requireFields(req.body, ['name']);
    if (missing.length > 0) return badRequest(res, '参数校验失败', { missing });
  }
  if (req.body.balance_hours !== undefined && Number(req.body.balance_hours) < 0) {
    return badRequest(res, '参数校验失败', { field: 'balance_hours', reason: '不能小于 0' });
  }
  if (req.body.balance_money !== undefined && Number(req.body.balance_money) < 0) {
    return badRequest(res, '参数校验失败', { field: 'balance_money', reason: '不能小于 0' });
  }
  return next();
}

function validateGrade(req, res, next) {
  const missing = requireFields(req.body, ['subject', 'score']);
  if (missing.length > 0) return badRequest(res, '参数校验失败', { missing });
  const score = Number(req.body.score);
  if (!Number.isFinite(score) || score < 0) {
    return badRequest(res, '参数校验失败', { field: 'score', reason: '必须是非负数字' });
  }
  return next();
}

// GET /api/students — 获取所有学生
router.get('/', (req, res) => {
  try {
    const db = getInstance();
    const students = db.getAllStudents();
    // 解析成绩
    if (req.query.withGrades === 'true') {
      for (const s of students) {
        s.grades = db.getGrades(s.id);
      }
    }
    res.json({ success: true, data: students, count: students.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/students/:id — 获取单个学生
router.get('/:id', (req, res) => {
  try {
    const db = getInstance();
    const student = db.getStudentById(req.params.id);
    if (!student) return res.status(404).json({ error: '学生不存在' });
    if (req.query.withGrades === 'true') {
      student.grades = db.getGrades(req.params.id);
    }
    if (req.query.withPayments === 'true') {
      student.payments = db.getPaymentsByStudent(req.params.id);
    }
    if (req.query.withConsumptions === 'true') {
      student.consumptions = db.getConsumptionsByStudent(req.params.id);
    }
    res.json({ success: true, data: student });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/students — 创建学生
router.post('/', validateStudent, (req, res) => {
  try {
    const db = getInstance();
    const student = db.createStudent(req.body);
    // 自动添加学校
    if (req.body.school) db.addOrUpdateSchool(req.body.school);
    res.status(201).json({ success: true, data: student });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/students/:id — 更新学生
router.put('/:id', validateStudent, (req, res) => {
  try {
    const db = getInstance();
    const student = db.updateStudent(req.params.id, req.body);
    if (!student) return res.status(404).json({ error: '学生不存在' });
    if (req.body.school) db.addOrUpdateSchool(req.body.school);
    res.json({ success: true, data: student });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/students/:id — 删除学生（软删除）
router.delete('/:id', (req, res) => {
  try {
    const db = getInstance();
    db.deleteStudent(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/students/:id/grades — 获取学生成绩
router.get('/:id/grades', (req, res) => {
  try {
    const db = getInstance();
    const grades = db.getGrades(req.params.id);
    res.json({ success: true, data: grades });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/students/:id/grades — 添加成绩
router.post('/:id/grades', validateGrade, (req, res) => {
  try {
    const db = getInstance();
    const grade = db.createGrade({ ...req.body, student_id: req.params.id });
    res.status(201).json({ success: true, data: grade });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
