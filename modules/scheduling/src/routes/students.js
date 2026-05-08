/**
 * 学生管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

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
router.post('/', (req, res) => {
  try {
    const db = getInstance();
    const student = db.createStudent(req.body);
    // 自动添加学校
    if (req.body.school) db.addOrUpdateSchool(req.body.school);
    res.status(201).json({ success: true, data: student });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/students/:id — 更新学生
router.put('/:id', (req, res) => {
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
router.post('/:id/grades', (req, res) => {
  try {
    const db = getInstance();
    const grade = db.createGrade({ ...req.body, student_id: req.params.id });
    res.status(201).json({ success: true, data: grade });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
