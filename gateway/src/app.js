/**
 * Gewu Workshop compatibility gateway.
 * The formal runtime exposes health plus permanent retirement tombstones.
 */
const express = require('express');
const http = require('http');
const cors = require('cors');
const proxyaddr = require('proxy-addr');
const gatewayPackage = require('../package.json');

function reviewDemoRemoved(_req, res) {
  return res.status(410).json({
    success: false,
    code: 'REVIEW_DEMO_REMOVED',
    error: 'Legacy review demo has been removed; use the scheduling backend experience APIs',
  });
}

function retired(code, error) {
  return (_req, res) => res.status(410).json({ success: false, code, error });
}

const cloudRelayRetired = retired(
  'CLOUD_RELAY_RETIRED',
  'Legacy cloud relay has been retired; use the cloud business authority and storage agent APIs',
);
const gatewayAuthRetired = retired(
  'GATEWAY_AUTH_RETIRED',
  'Gateway authentication has been retired; use the cloud business account API',
);
const gatewayAdminRetired = retired(
  'GATEWAY_ADMIN_RETIRED',
  'Gateway administration has been retired; use the cloud business authority API',
);
const gatewayPermissionsRetired = retired(
  'GATEWAY_PERMISSIONS_RETIRED',
  'Gateway permission lookup has been retired; use the cloud business authority API',
);

function getHealthVersion() {
  const deployedVersion = String(process.env.GEWU_APP_VERSION || '').trim();
  if (deployedVersion) return deployedVersion;
  return String(gatewayPackage.version || 'local').trim() || 'local';
}

function createApp() {
  const app = express();
  const trustedCidrs = ['loopback', ...String(process.env.TRUST_PROXY_CIDRS || '').split(',').map(value => value.trim()).filter(Boolean)];
  app.set('trust proxy', proxyaddr.compile(trustedCidrs));

  // CORS
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    preflightContinue: true,
  }));

  // Permanent compatibility tombstones run before body parsing,
  // authentication, and every retired runtime module. Even preflight and
  // malformed legacy writes are rejected without processing their input.
  app.use('/api/auth/review-demo', reviewDemoRemoved);
  app.use('/api/review-demo', reviewDemoRemoved);
  app.use('/api/cloud', cloudRelayRetired);
  app.use('/api/auth', gatewayAuthRetired);
  app.use('/api/admin', gatewayAdminRetired);
  app.use('/api/permissions', gatewayPermissionsRetired);

  // 请求日志
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // ===================== 健康检查 =====================
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      version: getHealthVersion(),
      legacyAuthority: 'retired',
    });
  });

  // ===================== 404 =====================
  app.use((_req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  return app;
}

function createGatewayServer() {
  const app = createApp();
  return { app, server: http.createServer(app) };
}

// ===================== 启动 =====================
async function main() {
  const { server } = createGatewayServer();
  const PORT = process.env.GATEWAY_PORT || 3001;

  server.listen(PORT, () => {
    console.log(`[Gateway] 教育综合服务平台已启动 → http://localhost:${PORT}`);
    console.log(`[Gateway] 健康检查: http://localhost:${PORT}/api/health`);
  });
}

if (require.main === module) main().catch(err => {
  console.error('[Gateway] 启动失败:', err);
  process.exit(1);
});

module.exports = createApp;
module.exports.createGatewayServer = createGatewayServer;
