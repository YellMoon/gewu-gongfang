/**
 * 排课管理路由
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

function validateSchedule(req, res, next) {
  if (req.method === 'POST') {
    const missing = requireFields(req.body, ['course_id', 'start_time', 'end_time']);
    if (missing.length > 0) return badRequest(res, '参数校验失败', { missing });
  }
  if (req.body.start_time !== undefined || req.body.end_time !== undefined) {
    if (!req.body.start_time || !req.body.end_time) {
      return badRequest(res, '参数校验失败', { field: 'time_range', reason: '开始时间和结束时间需要同时提供' });
    }
    const start = Date.parse(req.body.start_time);
    const end = Date.parse(req.body.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return badRequest(res, '参数校验失败', { field: 'time_range', reason: '结束时间必须晚于开始时间' });
    }
  }
  return next();
}

function validateEnrollment(req, res, next) {
  if (req.method === 'POST') {
    const missing = requireFields(req.body, ['student_id']);
    if (missing.length > 0) return badRequest(res, '参数校验失败', { missing });
  }
  for (const field of ['custom_price', 'hours_consumed']) {
    if (req.body[field] !== undefined && Number(req.body[field]) < 0) {
      return badRequest(res, '参数校验失败', { field, reason: '不能小于 0' });
    }
  }
  return next();
}

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

router.post('/', validateSchedule, (req, res) => {
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

router.put('/:id', validateSchedule, (req, res) => {
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

router.post('/:id/enrollments', validateEnrollment, (req, res) => {
  try {
    const db = getInstance();
    const enrollment = db.createEnrollment({ ...req.body, schedule_id: req.params.id });
    res.status(201).json({ success: true, data: enrollment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/enrollments/:enrollmentId', validateEnrollment, (req, res) => {
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
