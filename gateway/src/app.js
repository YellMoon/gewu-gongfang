/**
 * 教育综合服务平台 — API Gateway
 * 统一入口：认证 → 权限校验 → 路由分发
 */
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const proxyaddr = require('proxy-addr');
const { getDb, initDatabase } = require('./db/database');
const { authMiddleware, optionalAuth } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');
const { loadModules } = require('./config/moduleLoader');
const { loadUserPermissions } = require('./middleware/permission');
const CloudWebSocketServer = require('./websocket/server');

// 路由
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const permissionsRouter = require('./routes/permissions');
const modulesRouter = require('./routes/modules');
const cloudRelayRouter = require('./routes/cloudRelay');
const { createGatewayAuthorityProtocolRouter } = require('./routes/authorityProtocol');
const gatewayPackage = require('../package.json');

function reviewDemoRemoved(_req, res) {
  return res.status(410).json({
    success: false,
    code: 'REVIEW_DEMO_REMOVED',
    error: 'Legacy review demo has been removed; use the scheduling backend experience APIs',
  });
}

function getHealthVersion() {
  const deployedVersion = String(process.env.GEWU_APP_VERSION || '').trim();
  if (deployedVersion) return deployedVersion;
  return String(gatewayPackage.version || 'local').trim() || 'local';
}

function createApp(options = {}) {
  const app = express();
  const database = options.db || initDatabase();
  const trustedCidrs = ['loopback', ...String(process.env.TRUST_PROXY_CIDRS || '').split(',').map(value => value.trim()).filter(Boolean)];
  app.set('trust proxy', proxyaddr.compile(trustedCidrs));

  // CORS
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  }));

  // 请求日志
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Permanent compatibility tombstone. Keep this before the general body
  // parser so removed endpoints cannot buffer or process legacy payloads.
  app.use('/api/review-demo', reviewDemoRemoved);

  // Body parsing
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ===================== 健康检查 =====================
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString(), version: getHealthVersion() });
  });

  // ===================== 公开路由（无需认证） =====================
  app.use('/api/auth', authRouter);
  app.use('/api', optionalAuth);
  app.use('/api/authority', createGatewayAuthorityProtocolRouter({
    db: database,
    commandPolicy: options.authorityCommandPolicy,
    hostToken: options.authorityHostToken,
  }));
  app.use('/api/cloud', optionalAuth, cloudRelayRouter);

  // ===================== 需要认证的路由 =====================
  app.use('/api/admin', authMiddleware, loadUserPermissions, adminRouter);
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
  const server = http.createServer(app);
  const PORT = process.env.GATEWAY_PORT || 3001;

  // 初始化WebSocket服务器
  const wsServer = new CloudWebSocketServer(server, { db: getDb() });
  app.set('wsServer', wsServer);

  server.listen(PORT, () => {
    console.log(`[Gateway] 教育综合服务平台已启动 → http://localhost:${PORT}`);
    console.log(`[Gateway] 健康检查: http://localhost:${PORT}/api/health`);
    console.log(`[Gateway] WebSocket服务器已启动 → ws://localhost:${PORT}`);
  });
}

if (require.main === module) main().catch(err => {
  console.error('[Gateway] 启动失败:', err);
  process.exit(1);
});

module.exports = createApp;
module.exports.CloudWebSocketServer = CloudWebSocketServer;
