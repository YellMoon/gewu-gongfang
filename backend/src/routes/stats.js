/**
 * 统计路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

// GET /api/stats/revenue
router.get('/revenue', (req, res) => {
  try {
    const db = getInstance();
    const start = req.query.start || '2000-01-01';
    const end = req.query.end || '2099-12-31';
    const stats = db.getRevenueStats(start, end);
    res.json({ success: true, data: stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/stats/consumption
router.get('/consumption', (req, res) => {
  try {
    const db = getInstance();
    const start = req.query.start || '2000-01-01';
    const end = req.query.end || '2099-12-31';
    const stats = db.getConsumptionStats(start, end);
    res.json({ success: true, data: stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/stats/overview — 概览
router.get('/overview', (req, res) => {
  try {
    const db = getInstance();
    res.json({
      success: true,
      data: {
        students: db._count('students'),
        courses: db._count('courses'),
        schedules: db._count('schedules'),
        teachers: db._count('teachers'),
        active_courses: db._count('courses', 'active = 1 AND deleted = 0'),
        planned_schedules: db._count('schedules', 'status = 1 AND deleted = 0'),
        completed_schedules: db._count('schedules', 'status = 2 AND deleted = 0'),
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
