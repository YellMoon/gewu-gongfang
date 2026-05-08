/**
 * 排课管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

// GET /api/schedules — 获取排课
router.get('/', (req, res) => {
  try {
    const db = getInstance();
    let schedules;
    if (req.query.start && req.query.end) {
      schedules = db.getSchedulesByDateRange(req.query.start, req.query.end);
    } else {
      schedules = db.getAllSchedules();
    }
    // 填充课程信息
    if (req.query.withCourse === 'true') {
      for (const s of schedules) {
        s.course = db.getCourseById(s.course_id);
        s.enrollments = db.getEnrollmentsBySchedule(s.id);
      }
    }
    res.json({ success: true, data: schedules, count: schedules.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const db = getInstance();
    const schedule = db.getScheduleById(req.params.id);
    if (!schedule) return res.status(404).json({ error: '排课不存在' });
    if (req.query.withCourse === 'true') {
      schedule.course = db.getCourseById(schedule.course_id);
      schedule.enrollments = db.getEnrollmentsBySchedule(schedule.id);
    }
    res.json({ success: true, data: schedule });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try {
    const db = getInstance();
    // 冲突检测
    if (req.body.start_time && req.body.end_time) {
      const conflicts = db.checkTimeConflict(req.body.start_time, req.body.end_time);
      if (conflicts.length > 0) {
        return res.status(409).json({ error: '时间冲突', conflicts });
      }
    }
    const schedule = db.createSchedule(req.body);
    res.status(201).json({ success: true, data: schedule });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  try {
    const db = getInstance();
    if (req.body.start_time && req.body.end_time) {
      const conflicts = db.checkTimeConflict(req.body.start_time, req.body.end_time, req.params.id);
      if (conflicts.length > 0) {
        return res.status(409).json({ error: '时间冲突', conflicts });
      }
    }
    const schedule = db.updateSchedule(req.params.id, req.body);
    if (!schedule) return res.status(404).json({ error: '排课不存在' });
    res.json({ success: true, data: schedule });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    const db = getInstance();
    db.deleteSchedule(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 选课关联
router.get('/:id/enrollments', (req, res) => {
  try {
    const db = getInstance();
    const enrollments = db.getEnrollmentsBySchedule(req.params.id);
    res.json({ success: true, data: enrollments });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/enrollments', (req, res) => {
  try {
    const db = getInstance();
    const enrollment = db.createEnrollment({ ...req.body, schedule_id: req.params.id });
    res.status(201).json({ success: true, data: enrollment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/enrollments/:enrollmentId', (req, res) => {
  try {
    const db = getInstance();
    const enrollment = db.updateEnrollment(req.params.enrollmentId, req.body);
    if (!enrollment) return res.status(404).json({ error: '选课关联不存在' });
    res.json({ success: true, data: enrollment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/enrollments/:enrollmentId', (req, res) => {
  try {
    const db = getInstance();
    db.deleteEnrollment(req.params.enrollmentId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
