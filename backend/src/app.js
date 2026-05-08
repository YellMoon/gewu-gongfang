/**
 * Express 应用配置
 */
const express = require('express');
const cors = require('cors');
const { authMiddleware, optionalAuth } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

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
const dataRouter = require('./routes/export');
const billImportRouter = require('./routes/billImport');
const syncRouter = require('./routes/sync');
const authRouter = require('./routes/auth');

function createApp() {
  const app = express();

  // CORS
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  }));

  // Body parsing
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 请求日志
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // 健康检查
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString(), version: '3.1.0-0504' });
  });

  // 公开路由（无需认证）
  app.use('/api/auth', authRouter);
  app.use('/api/sync', syncRouter);

  // 半公开路由（可选认证）
  app.use('/api/students', optionalAuth, studentsRouter);
  app.use('/api/courses', optionalAuth, coursesRouter);
  app.use('/api/schedules', optionalAuth, schedulesRouter);
  app.use('/api/payments', optionalAuth, paymentsRouter);
  app.use('/api/consumptions', optionalAuth, consumptionsRouter);
  app.use('/api/teachers', optionalAuth, teachersRouter);
  app.use('/api/rooms', optionalAuth, roomsRouter);
  app.use('/api/schools', optionalAuth, schoolsRouter);
  app.use('/api/institutions', optionalAuth, institutionsRouter);
  app.use('/api/stats', optionalAuth, statsRouter);
  app.use('/api', dataRouter);
  app.use('/api/bill-import', billImportRouter);

  // 错误处理
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
