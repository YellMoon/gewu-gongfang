/**
 * 课程管理路由
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

function validateCourse(req, res, next) {
  if (req.method === 'POST') {
    const missing = requireFields(req.body, ['name']);
    if (missing.length > 0) return badRequest(res, '参数校验失败', { missing });
  }
  for (const field of ['price_tuition', 'price_teacher', 'default_duration_minutes']) {
    if (req.body[field] !== undefined && Number(req.body[field]) < 0) {
      return badRequest(res, '参数校验失败', { field, reason: '不能小于 0' });
    }
  }
  return next();
}

router.get('/', (req, res) => {
  try {
    const db = getInstance();
    const courses = db.getAllCourses();
    res.json({ success: true, data: courses, count: courses.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const db = getInstance();
    const course = db.getCourseById(req.params.id);
    if (!course) return res.status(404).json({ error: '课程不存在' });
    res.json({ success: true, data: course });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', validateCourse, (req, res) => {
  try {
    const db = getInstance();
    const course = db.createCourse(req.body);
    res.status(201).json({ success: true, data: course });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', validateCourse, (req, res) => {
  try {
    const db = getInstance();
    const course = db.updateCourse(req.params.id, req.body);
    if (!course) return res.status(404).json({ error: '课程不存在' });
    res.json({ success: true, data: course });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    const db = getInstance();
    db.deleteCourse(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
