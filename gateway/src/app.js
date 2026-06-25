/**
 * 教育综合服务平台 — API Gateway
 * 统一入口：认证 → 权限校验 → 路由分发
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db/database');
const { authMiddleware, optionalAuth } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');
const { loadModules } = require('./config/moduleLoader');
const { loadUserPermissions } = require('./middleware/permission');

// 路由
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const invitationsRouter = require('./routes/invitations');
const permissionsRouter = require('./routes/permissions');
const modulesRouter = require('./routes/modules');
const cloudRelayRouter = require('./routes/cloudRelay');

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

  // ===================== 健康检查 =====================
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString(), version: '4.0.0' });
  });

  // ===================== 公开路由（无需认证） =====================
  app.use('/api/auth', authRouter);
  app.use('/api/invitations/use', invitationsRouter);  // 邀请码使用是公开的
  app.use('/api/cloud', cloudRelayRouter);

  // ===================== 需要认证的路由 =====================
  app.use('/api/admin', authMiddleware, loadUserPermissions, adminRouter);
  app.use('/api/invitations', authMiddleware, loadUserPermissions, invitationsRouter);
  app.use('/api/permissions', authMiddleware, loadUserPermissions, permissionsRouter);
  app.use('/api/modules', authMiddleware, loadUserPermissions, modulesRouter);

  // ===================== 动态加载模块路由 =====================
  const moduleRoutes = loadModules();
  for (const mod of moduleRoutes) {
    const { routePrefix, router, permission } = mod;
    if (permission) {
      const { requirePermission } = require('./middleware/permission');
      app.use(routePrefix, authMiddleware, loadUserPermissions, requirePermission(permission.module, permission.action), router);
    } else {
      app.use(routePrefix, authMiddleware, loadUserPermissions, router);
    }
    console.log(`[Gateway] 模块已挂载: ${mod.id} → ${routePrefix}`);
  }

  // ===================== 404 =====================
  app.use((_req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  // ===================== 错误处理 =====================
  app.use(errorHandler);

  return app;
}

// ===================== 启动 =====================
async function main() {
  // 初始化数据库
  initDatabase();
  console.log('[Gateway] 数据库初始化完成');

  const app = createApp();
  const PORT = process.env.GATEWAY_PORT || 3001;

  app.listen(PORT, () => {
    console.log(`[Gateway] 教育综合服务平台已启动 → http://localhost:${PORT}`);
    console.log(`[Gateway] 健康检查: http://localhost:${PORT}/api/health`);
  });
}

main().catch(err => {
  console.error('[Gateway] 启动失败:', err);
  process.exit(1);
});

module.exports = createApp;
