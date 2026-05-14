/**
 * 统计路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

function tenantOptions(req) {
  return { tenantId: req.tenantId || req.query.tenant_id || req.body?.tenant_id || 'default' };
}

// GET /api/stats/revenue
router.get('/revenue', (req, res) => {
  try {
    const db = getInstance();
    const start = req.query.start || '2000-01-01';
    const end = req.query.end || '2099-12-31';
    const stats = db.getRevenueStats(start, end, tenantOptions(req));
    res.json({ success: true, data: stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/stats/consumption
router.get('/consumption', (req, res) => {
  try {
    const db = getInstance();
    const start = req.query.start || '2000-01-01';
    const end = req.query.end || '2099-12-31';
    const stats = db.getConsumptionStats(start, end, tenantOptions(req));
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
        students: db._count('students', 'deleted = 0', [], tenantOptions(req)),
        courses: db._count('courses', 'deleted = 0', [], tenantOptions(req)),
        schedules: db._count('schedules', 'deleted = 0', [], tenantOptions(req)),
        teachers: db._count('teachers', 'deleted = 0', [], tenantOptions(req)),
        active_courses: db._count('courses', 'active = 1 AND deleted = 0', [], tenantOptions(req)),
        planned_schedules: db._count('schedules', 'status = 1 AND deleted = 0', [], tenantOptions(req)),
        completed_schedules: db._count('schedules', 'status = 2 AND deleted = 0', [], tenantOptions(req)),
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
