/**
 * 排课管理模块入口
 * 聚合所有排课相关路由
 */
const express = require('express');
const router = express.Router();

// 导入各子路由
const studentsRouter = require('./routes/students');
const coursesRouter = require('./routes/courses');
const schedulesRouter = require('./routes/schedules');
const paymentsRouter = require('./routes/payments');
const consumptionsRouter = require('./routes/consumptions');
const teachersRouter = require('./routes/teachers');
const roomsRouter = require('./routes/rooms');
const schoolsRouter = require('./routes/schools');
const institutionsRouter = require('./routes/institutions');
const statsRouter = require('./routes/stats');
const exportRouter = require('./routes/export');

// 挂载子路由 (去掉 /api/scheduling 前缀)
router.use('/students', studentsRouter);
router.use('/courses', coursesRouter);
router.use('/schedules', schedulesRouter);
router.use('/payments', paymentsRouter);
router.use('/consumptions', consumptionsRouter);
router.use('/teachers', teachersRouter);
router.use('/rooms', roomsRouter);
router.use('/schools', schoolsRouter);
router.use('/institutions', institutionsRouter);
router.use('/stats', statsRouter);
router.use('/export', exportRouter);

module.exports = router;
