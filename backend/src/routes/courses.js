/**
 * 课程管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

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

router.post('/', (req, res) => {
  try {
    const db = getInstance();
    const course = db.createCourse(req.body);
    res.status(201).json({ success: true, data: course });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
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
