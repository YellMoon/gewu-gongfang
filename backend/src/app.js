/**
 * Express 搴旂敤閰嶇疆
 */
const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authMiddleware, optionalAuth, tenantScopeMiddleware, requireCoreReadAccess, requireWriteAccess } = require('./middleware/auth');
const { unrecognizedStudentGuard } = require('./middleware/unrecognizedStudentGuard');
const { buildErrorPayload, errorHandler } = require('./middleware/errorHandler');
const { getInstance } = require('./database');
const { createMiniappProvisioningReconciler } = require('./services/miniappProvisioningReconciler');
const HostWebSocketClient = require('./websocket/client');

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
const questionBankRouter = require('./routes/questionBank');
const opsRouter = require('./routes/ops');
const cloudRelayHostRouter = require('./routes/cloudRelayHost');
const paperArtifactAccessRouter = require('./routes/paperArtifactAccess');
const modulesRouter = require('./routes/modules');
const cloudRelayRouter = require('./routes/cloudRelay');
const permissionsRouter = require('./routes/permissions');
const adminUsersRouter = require('./routes/adminUsers');
const desktopPairingRouter = require('./routes/desktopPairing');
const { createDesktopIdentityRouter } = require('./routes/desktopIdentity');
const { createPrimaryHostIdentityService } = require('./services/primaryHostIdentityService');
const { createPrimaryHostLocalValidationService } = require('./services/primaryHostLocalValidationService');
const { getSingleUserDesktopIdentityService } = require('./services/singleUserDesktopIdentityService');
const miniappApplicationsRouter = require('./routes/miniappApplications');
const miniappWechatBindingsRouter = require('./routes/miniappWechatBindings');
const { createUnrecognizedExperienceRouter } = require('./routes/unrecognizedExperience');
const { createUnrecognizedExperienceSandbox } = require('./services/unrecognizedExperienceSandbox');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const writeRateLimitStore = new Map();
const nonceStore = new Map();
const idempotencyStore = new Map();
let sharedUnrecognizedExperienceSandbox = null;

function unrecognizedExperienceSandboxForApp(options = {}) {
  if (options.unrecognizedExperienceSandbox) return options.unrecognizedExperienceSandbox;
  if (!sharedUnrecognizedExperienceSandbox) {
    sharedUnrecognizedExperienceSandbox = createUnrecognizedExperienceSandbox();
  }
  return sharedUnrecognizedExperienceSandbox;
}

function isWriteRequest(req) {
  return WRITE_METHODS.has(req.method);
}

function clientKey(req) {
  const userId = req.user?.id || req.user?.openid || 'anonymous';
  return `${userId}:${req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'}`;
}

function requestIdentityKey(req) {
  const authorization = req.headers.authorization || '';
  if (authorization.startsWith('Bearer ')) {
    return `bearer:${crypto.createHash('sha256').update(authorization).digest('hex')}`;
  }
  return clientKey(req);
}

function hasDurableIdempotency(req) {
  return req.method === 'POST' && req.path === '/api/miniapp/applications';
}

function cleanupStore(store, now = Date.now()) {
  for (const [key, value] of store.entries()) {
    if (value.expiresAt <= now) store.delete(key);
  }
}

function stableRequestValue(value) {
  if (Array.isArray(value)) return value.map(stableRequestValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableRequestValue(value[key])]));
  }
  return value;
}

function requestBodyHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(stableRequestValue(body ?? null))).digest('hex');
}

function createWriteRateLimiter() {
  const windowMs = Number(process.env.WRITE_RATE_LIMIT_WINDOW_MS || 60000);
  const max = Number(process.env.WRITE_RATE_LIMIT_MAX || 120);

  return (req, res, next) => {
    if (!isWriteRequest(req)) return next();

    const now = Date.now();
    cleanupStore(writeRateLimitStore, now);

    const key = clientKey(req);
    const bucket = writeRateLimitStore.get(key) || { count: 0, expiresAt: now + windowMs };
    if (bucket.expiresAt <= now) {
      bucket.count = 0;
      bucket.expiresAt = now + windowMs;
    }

    bucket.count += 1;
    writeRateLimitStore.set(key, bucket);
    res.setHeader('x-ratelimit-limit', max);
    res.setHeader('x-ratelimit-remaining', Math.max(0, max - bucket.count));
    res.setHeader('x-ratelimit-reset', new Date(bucket.expiresAt).toISOString());

    if (bucket.count > max) {
      return res.status(429).json(buildErrorPayload(req, 429, '请求过于频繁，请稍后再试', {
        code: 'RATE_LIMITED',
      }));
    }
    return next();
  };
}

function writeSafetyMiddleware(req, res, next) {
  if (!isWriteRequest(req)) return next();

  const now = Date.now();
  const ttlMs = Number(process.env.NONCE_TTL_MS || 10 * 60 * 1000);
  cleanupStore(nonceStore, now);
  cleanupStore(idempotencyStore, now);

  const idempotencyKey = hasDurableIdempotency(req) ? null : req.headers['x-idempotency-key'];
  const idemKey = idempotencyKey
    ? `${requestIdentityKey(req)}:${req.method}:${req.originalUrl}:${idempotencyKey}:${requestBodyHash(req.body)}`
    : null;
  if (idemKey) {
    const existing = idempotencyStore.get(idemKey);
    if (existing?.status === 'done') {
      res.setHeader('x-idempotency-replayed', 'true');
      return res.status(existing.statusCode).json(existing.body);
    }
    if (existing?.status === 'pending') {
      return res.status(409).json(buildErrorPayload(req, 409, '幂等请求处理中', {
        code: 'IDEMPOTENCY_PENDING',
      }));
    }
  }

  const nonce = req.headers['x-request-nonce'];
  if (process.env.REQUIRE_NONCE === 'true' && !nonce) {
    return res.status(400).json(buildErrorPayload(req, 400, '缺少请求 nonce', {
      code: 'NONCE_REQUIRED',
    }));
  }

  if (nonce) {
    const nonceKey = `${requestIdentityKey(req)}:${nonce}`;
    if (nonceStore.has(nonceKey)) {
      return res.status(409).json(buildErrorPayload(req, 409, '重复请求 nonce', {
        code: 'NONCE_REPLAYED',
      }));
    }
    nonceStore.set(nonceKey, { expiresAt: now + ttlMs, method: req.method, path: req.path });
    res.setHeader('x-request-nonce-recorded', 'true');
  }

  if (!idemKey) return next();

  idempotencyStore.set(idemKey, { status: 'pending', expiresAt: now + ttlMs });
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 500) {
      idempotencyStore.set(idemKey, {
        status: 'done',
        statusCode: res.statusCode,
        body,
        expiresAt: Date.now() + ttlMs,
      });
      res.setHeader('x-idempotency-recorded', 'true');
    } else {
      idempotencyStore.delete(idemKey);
    }
    return originalJson(body);
  };
  return next();
}

function normalizeErrorResponses(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (
      res.statusCode >= 400 &&
      body &&
      typeof body === 'object' &&
      body.error &&
      !body.code
    ) {
      return originalJson({
        ...body,
        success: body.success === undefined ? false : body.success,
        code: res.statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: body.message || body.error,
        traceId: body.traceId || req.traceId,
      });
    }
    return originalJson(body);
  };
  next();
}

function requestLogger(req, res, next) {
  const traceId = req.headers['x-trace-id'] || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = Date.now();
  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const payload = {
      time: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      traceId,
      method: req.method,
      path: req.originalUrl || req.path,
      status: res.statusCode,
      durationMs,
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
      monitorProvider: process.env.MONITORING_PROVIDER || null,
    };
    if (durationMs >= Number(process.env.SLOW_REQUEST_MS || 1000)) payload.slow = true;
    console.log(JSON.stringify(payload));
  });
  next();
}

function resolvePackageVersion(options = {}) {
  const candidates = options.candidates || [
    path.join(__dirname, '..', 'package.json'),
    path.join(__dirname, '..', '..', 'package.json'),
    path.join(process.cwd(), 'package.json'),
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (pkg.version) return pkg.version;
    } catch {
      // Try the next candidate. Health checks must stay available even if one
      // manifest path is missing in a particular deployment layout.
    }
  }
  return 'unknown';
}

function getAppVersion() {
  return process.env.GEWU_APP_VERSION || process.env.APP_VERSION || resolvePackageVersion();
}

function createApp(options = {}) {
  const app = express();
  const database = getInstance().db;
  const primaryHostIdentityService = createPrimaryHostIdentityService({ db: database });
  const primaryHostLocalValidationService = createPrimaryHostLocalValidationService({
    db: database,
    collectEvidence: input => primaryHostIdentityService.collectLocalEvidence(input),
    backupRoot: process.env.GEWU_LOCAL_CACHE_PATH
      ? path.join(process.env.GEWU_LOCAL_CACHE_PATH, 'primary-host-validation')
      : undefined,
  });
  const singleUserIdentityService = getSingleUserDesktopIdentityService({
    db: database,
    localValidationService: primaryHostLocalValidationService,
  });

  try {
    createMiniappProvisioningReconciler({ db: database }).reconcilePendingCompletedTasks();
  } catch (error) {
    console.warn('[miniapp-provisioning] startup reconciliation skipped', error?.code || error?.message || 'unknown');
  }

  // CORS
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  }));

  // Resolve an optional identity once at the API boundary so restricted
  // unrecognized-student sessions cannot fall through to formal business APIs.
  app.use('/api', optionalAuth, unrecognizedStudentGuard);

  const unrecognizedExperienceSandbox = unrecognizedExperienceSandboxForApp(options);
  app.locals.unrecognizedExperienceSandbox = unrecognizedExperienceSandbox;
  app.use('/api/experience', authMiddleware, createUnrecognizedExperienceRouter({
    ...(options.unrecognizedExperienceRouteOptions || {}),
    sandbox: unrecognizedExperienceSandbox,
  }));

  // Body parsing
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 璇锋眰鏃ュ織
  app.use(requestLogger);

  app.use(normalizeErrorResponses);
  app.use(tenantScopeMiddleware);
  app.use(createWriteRateLimiter());
  app.use(writeSafetyMiddleware);

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString(), version: getAppVersion(), traceId: req.traceId });
  });

  // 公开路由（无需认证）
  app.use('/api/auth', authRouter);
  app.use('/api/desktop-identity', createDesktopIdentityRouter({
    db: database,
    primaryHostIdentityService,
    primaryHostLocalValidationService,
    singleUserIdentityService,
  }));
  app.use('/api/desktop-pairing', desktopPairingRouter);
  app.use('/api/sync', optionalAuth, syncRouter);
  app.use('/api/cloud-relay-host/artifacts', optionalAuth, paperArtifactAccessRouter);
  app.use('/api/cloud-relay-host', optionalAuth, requireWriteAccess, cloudRelayHostRouter);
  app.use('/api/modules', optionalAuth, modulesRouter);
  app.use('/api/cloud', optionalAuth, cloudRelayRouter);
  app.use('/api/admin/users', authMiddleware, adminUsersRouter);
  app.use('/api/permissions', authMiddleware, permissionsRouter);
  app.use('/api/miniapp/applications', authMiddleware, miniappApplicationsRouter);
  app.use('/api/miniapp/wechat-bindings', authMiddleware, miniappWechatBindingsRouter);

  // 鍗婂叕寮€璺敱锛堝彲閫夎璇侊級
  app.use('/api/students', optionalAuth, requireCoreReadAccess, requireWriteAccess, studentsRouter);
  app.use('/api/courses', optionalAuth, requireCoreReadAccess, requireWriteAccess, coursesRouter);
  app.use('/api/schedules', optionalAuth, requireCoreReadAccess, requireWriteAccess, schedulesRouter);
  app.use('/api/payments', optionalAuth, requireCoreReadAccess, requireWriteAccess, paymentsRouter);
  app.use('/api/consumptions', optionalAuth, requireCoreReadAccess, requireWriteAccess, consumptionsRouter);
  app.use('/api/teachers', optionalAuth, requireCoreReadAccess, requireWriteAccess, teachersRouter);
  app.use('/api/rooms', optionalAuth, requireCoreReadAccess, requireWriteAccess, roomsRouter);
  app.use('/api/schools', optionalAuth, requireCoreReadAccess, requireWriteAccess, schoolsRouter);
  app.use('/api/institutions', optionalAuth, requireCoreReadAccess, requireWriteAccess, institutionsRouter);
  app.use('/api/stats', optionalAuth, requireCoreReadAccess, requireWriteAccess, statsRouter);
  app.use('/api/question-bank', optionalAuth, requireWriteAccess, questionBankRouter);
  app.use('/api/ops', optionalAuth, requireWriteAccess, opsRouter);
  app.use('/api', optionalAuth, requireWriteAccess, dataRouter);
  app.use('/api/bill-import', optionalAuth, requireWriteAccess, billImportRouter);

  // 閿欒澶勭悊
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, getAppVersion, resolvePackageVersion, HostWebSocketClient };
