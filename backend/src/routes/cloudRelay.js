const { Router } = require('express');
const crypto = require('crypto');
const { getInstance } = require('../database');
const {
  filterSnapshotForUser,
  isAdminUser,
  isAllowedMiniappTaskForUser,
} = require('../services/miniappAccessPolicy');
const { roleForUser } = require('../services/authorizationPolicy');
const { actorGrantFromSyncActor, resolveTaskActorGrant } = require('../services/cloudRelayActorGrant');
const { createPrimaryHostIdentityService } = require('../services/primaryHostIdentityService');
const taskService = require('../services/cloudRelayTaskService');
const { createMiniappProvisioningReconciler } = require('../services/miniappProvisioningReconciler');
const { buildQuestionPreviewIndex, safeHostBaseUrl } = require('../services/questionPreviewIndex');
const { createLegacyArchitectureGate } = require('../services/legacyArchitectureGate');

const router = Router();
router.use(['/desktop-session', '/desktop-sync'], (req, res, next) => (
  createLegacyArchitectureGate({ db: getInstance().db, hardRetire: true })(req, res, next)
));

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function taskRouteError(res, error) {
  return res.status(Number(error.statusCode) || 500).json({ success: false, code: error.code || 'TASK_OPERATION_FAILED', error: error.message });
}

function targetHostForTask(db, requested) {
  const target = String(requested || process.env.GEWU_PRIMARY_HOST_DEVICE_ID || '').trim();
  if (target) {
    const exists = db.prepare('SELECT 1 FROM host_heartbeats WHERE host_device_id=?').get(target);
    if (!exists) throw taskService.taskError('TARGET_HOST_NOT_FOUND', 'target host is not registered', 400);
    return target;
  }
  const latest = db.prepare("SELECT host_device_id FROM host_heartbeats WHERE status='online' ORDER BY updated_at DESC LIMIT 1").get();
  if (!latest) throw taskService.taskError('TARGET_HOST_REQUIRED', 'no target host is available', 409);
  return latest.host_device_id;
}

function notifyHostTask(req, task, fallbackHostDeviceId = '') {
  const hostDeviceId = String(task?.target_host_device_id || fallbackHostDeviceId || '').trim();
  if (hostDeviceId) req.app?.get('cloudRelaySocketServer')?.notifyHostNewTask(hostDeviceId, task);
}

function createDesktopRelayTask(db, req, input) {
  const idempotencyKey = String(
    req.headers['x-idempotency-key'] || input.requestId || input.payload?.requestId || id(`request_${input.taskType}`)
  ).trim();
  return taskService.createV2Task(db, {
    taskType: input.taskType,
    payload: input.payload,
    createdBy: input.createdBy,
    tenantId: input.tenantId || 'default',
    actorRole: input.actorRole,
    allowDraft: false,
    targetHostDeviceId: targetHostForTask(db, input.targetHostDeviceId),
    idempotencyKey,
  }, { internal: true });
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return fallback;
  }
}

function normalizeLanUrls(value) {
  const raw = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map(item => String(item || '').replace(/\/+$/, '')).filter(Boolean)));
}

function normalizeCapabilities(value) {
  const raw = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw
    .map(item => String(item || '').trim())
    .filter(item => item && item.length <= 64 && /^[a-z0-9][a-z0-9._-]*$/i.test(item))))
    .slice(0, 32);
}

function sendForbidden(res, code, message = 'Forbidden') {
  return res.status(code === 'UNAUTHORIZED' ? 401 : 403).json({ success: false, code, error: message });
}
function requireManagedHostCredential(req) {
  const deviceId = String(req.headers['x-gewu-host-device-id'] || '').trim();
  const generation = Number(req.headers['x-gewu-host-generation']);
  const credential = String(req.headers['x-gewu-host-credential'] || '').trim();
  const service = createPrimaryHostIdentityService({ db: getInstance().db });
  const epoch = service.assertActiveHostCredential({ deviceId, generation, credential });
  const bodyDeviceId = String(req.body?.hostDeviceId || req.body?.host_device_id || req.body?.deviceId || '').trim();
  const queryDeviceId = String(req.query?.hostDeviceId || req.query?.host_device_id || '').trim();
  if ((bodyDeviceId && bodyDeviceId !== epoch.deviceId)
    || (queryDeviceId && queryDeviceId !== epoch.deviceId)) {
    throw Object.assign(new Error('PRIMARY_HOST_REQUEST_DEVICE_MISMATCH'), {
      code: 'PRIMARY_HOST_REQUEST_DEVICE_MISMATCH',
    });
  }
  return epoch;
}

function isDevBypass() {
  return process.env.NODE_ENV === 'test' && process.env.GEWU_TEST_AUTH_BYPASS === '1';
}

function requireHostWrite(req, res, next) {
  if (isDevBypass()) return next();
  const active = getInstance().db.prepare(
    "SELECT 1 FROM primary_host_epochs WHERE status='active' LIMIT 1"
  ).get();
  if (!active && isAdminUser(req.user)) return next();
  if (active) {
    try {
      req.hostEpoch = requireManagedHostCredential(req);
      return next();
    } catch (error) {
      return sendForbidden(res, error?.code || 'HOST_WRITE_FORBIDDEN', 'Active primary-host credential required');
    }
  }
  return sendForbidden(res, 'HOST_WRITE_FORBIDDEN', 'Host relay write is not allowed');
}

function requireDesktopSyncAccess(req, res, next) {
  const actor = req.authz || {};
  const headerDeviceId = String(req.headers['x-device-id'] || '').trim();
  const expiresAt = Date.parse(String(actor.sessionExpiresAt || ''));
  if (actor.clientType !== 'desktop'
    || !['desktop-session', 'desktop-relay-session'].includes(actor.tokenUse)
    || !actor.userId || !actor.deviceId || !actor.sessionId || !actor.activeRole
    || !Number.isSafeInteger(Number(actor.authVersion)) || Number(actor.authVersion) < 1
    || !Number.isSafeInteger(Number(actor.credentialVersion)) || Number(actor.credentialVersion) < 1
    || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return res.status(401).json({ success:false, code:'ONLINE_DESKTOP_SESSION_REQUIRED' });
  }
  if (headerDeviceId && headerDeviceId !== actor.deviceId) {
    return res.status(403).json({ success:false, code:'DESKTOP_DEVICE_HEADER_MISMATCH' });
  }
  req.syncActor = actor;
  return next();
}

function requireSnapshotRead(req, res, next) {
  if (!req.user) return sendForbidden(res, 'UNAUTHORIZED', 'Authentication required');
  if (roleForUser(req.user) === 'pending') return sendForbidden(res, 'USER_NOT_APPROVED', 'Approved active user required');
  return next();
}

function requireMiniappTaskAccess(req, res, next) {
  if (taskService.isInternalTaskType(req.body.taskType)) {
    return sendForbidden(res, 'INTERNAL_TASK_TYPE_FORBIDDEN', 'Internal task types cannot be created through this endpoint');
  }
  if (!req.user && !isDevBypass()) return sendForbidden(res, 'UNAUTHORIZED', 'Authentication required');
  if (!isAllowedMiniappTaskForUser(req.user, req.body.taskType)) {
    return sendForbidden(res, 'TASK_TYPE_FORBIDDEN', 'Task type is not allowed');
  }
  return next();
}

function canReadTaskResult(task, user) {
  if (!task) return true;
  if (isDevBypass() || isAdminUser(user)) return true;
  return user?.id && task.created_by === user.id;
}

router.use('/snapshots/publish', requireHostWrite);
router.use('/tasks', (req, res, next) => {
  if (req.method === 'GET' && req.path === '/') return requireHostWrite(req, res, next);
  if (req.method === 'POST' && /^\/[^/]+\/complete$/.test(req.path)) return requireHostWrite(req, res, next);
  return next();
});

router.post('/host/heartbeat', requireHostWrite, (req, res) => {
  const db = getInstance().db;
  const time = now();
  const hostDeviceId = req.body.hostDeviceId || req.body.deviceId;
  if (!hostDeviceId) return res.status(400).json({ success: false, error: 'hostDeviceId is required' });

  db.prepare(
    `INSERT INTO host_heartbeats (id, host_device_id, status, base_url, lan_urls, capabilities, last_snapshot_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       base_url = excluded.base_url,
       lan_urls = excluded.lan_urls,
       capabilities = excluded.capabilities,
       last_snapshot_at = excluded.last_snapshot_at,
       updated_at = excluded.updated_at`
  ).run(
    hostDeviceId,
    hostDeviceId,
    req.body.status || 'online',
    req.body.baseUrl || '',
    JSON.stringify(normalizeLanUrls(req.body.lanUrls || req.body.lan_urls)),
    JSON.stringify(normalizeCapabilities(req.body.capabilities)),
    req.body.lastSnapshotAt || null,
    time,
    time
  );

  res.json({ success: true, serverTime: time });
});

router.get('/host/status', requireDesktopSyncAccess, (_req, res) => {
  const db = getInstance().db;
  const row = db.prepare(
    `SELECT * FROM host_heartbeats ORDER BY updated_at DESC LIMIT 1`
  ).get();
  const updatedAt = row?.updated_at ? Date.parse(row.updated_at) : 0;
  const heartbeatTtlMs = Number(process.env.GEWU_HOST_HEARTBEAT_TTL_MS || 5 * 60 * 1000);
  const online = Boolean(row && row.status !== 'offline' && Date.now() - updatedAt <= heartbeatTtlMs);
  const host = row ? {
    ...row,
    lanUrls: normalizeLanUrls(row.lan_urls),
  } : null;
  res.json({
    success: true,
    online,
    host,
    serverTime: now(),
  });
});

router.post('/snapshots/publish', (req, res) => {
  const db = getInstance().db;
  const snapshotId = id('snap');
  const time = now();

  db.prepare(
    `INSERT INTO readonly_snapshots (id, snapshot_type, payload, source_device_id, version, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    snapshotId,
    req.body.snapshotType || 'full',
    JSON.stringify(req.body.payload || {}),
    req.body.sourceDeviceId || 'unknown',
    req.body.version || time,
    time
  );

  res.json({ success: true, id: snapshotId, createdAt: time });
});

router.get('/snapshots/read', requireSnapshotRead, (req, res) => {
  const db = getInstance().db;
  const snapshotType = req.query.snapshotType || 'full';
  const row = db.prepare(
    `SELECT * FROM readonly_snapshots WHERE snapshot_type = ? ORDER BY created_at DESC LIMIT 1`
  ).get(snapshotType);
  const snapshot = row ? { ...row, payload: parseJson(row.payload, {}) } : null;
  res.json({ success: true, snapshot: filterSnapshotForUser(snapshot, req.user) });
});

router.get('/snapshots/questions', requireSnapshotRead, (req, res) => {
  const db = getInstance().db;
  const row = db.prepare("SELECT * FROM readonly_snapshots WHERE snapshot_type='full' ORDER BY created_at DESC LIMIT 1").get();
  const host = db.prepare("SELECT host_device_id,status,base_url,updated_at FROM host_heartbeats ORDER BY updated_at DESC LIMIT 1").get();
  const hostAvailable = Boolean(host && host.status !== 'offline' && Date.now() - Date.parse(host.updated_at) <= Number(process.env.GEWU_HOST_HEARTBEAT_TTL_MS || 300000));
  const snapshot = row ? { ...row, payload: parseJson(row.payload, {}) } : null;
  res.json({ success: true, ...buildQuestionPreviewIndex(snapshot, { ...req.user, tenantId: req.tenantId }), hostAvailable, targetHostDeviceId: hostAvailable ? host.host_device_id : null, hostBaseUrl: hostAvailable ? safeHostBaseUrl(host.base_url) : null });
});

router.get('/tasks/:id/actor-grant', requireHostWrite, (req, res) => {
  try {
    const actor = resolveTaskActorGrant(getInstance().db, {
      taskId: req.params.id,
      hostDeviceId: req.hostEpoch?.deviceId,
    });
    return res.json({ success: true, actor });
  } catch (error) {
    return taskRouteError(res, error);
  }
});

// 外网（云中继）身份与设备查询：客户端建任务，数据主机轮询处理后回填结果。
// 设备数据只存在主机本地库，云端仅做转发，不落任何设备明细。
router.post('/desktop-identity/requests', requireDesktopSyncAccess, (req, res) => {
  const query = String(req.body.query || '').trim();
  if (query !== 'devices') {
    return res.status(400).json({ success: false, code: 'DESKTOP_IDENTITY_RELAY_QUERY_UNSUPPORTED' });
  }
  const db = getInstance().db;
  const time = now();
  const actor = req.syncActor;
  const payload = {
    deviceId: actor.deviceId,
    query,
    submittedAt: time,
    actorGrant: actorGrantFromSyncActor(actor),
  };
  let created;
  try {
    created = createDesktopRelayTask(db, req, {
      taskType: 'desktop-identity', payload, createdBy: actor.userId, actorRole: actor.activeRole,
      tenantId: req.tenantId || 'default', targetHostDeviceId: req.body.targetHostDeviceId || req.body.target_host_device_id,
      requestId: req.body.requestId || req.body.request_id,
    });
  } catch (error) { return taskRouteError(res, error); }
  notifyHostTask(req, created.task);
  res.json({
    success: true,
    request: { id: created.task.id, taskType: 'desktop-identity', status: 'pending_host' },
  });
});

router.get('/desktop-identity/requests/:id/result', requireDesktopSyncAccess, (req, res) => {
  const db = getInstance().db;
  const actor = req.syncActor;
  // 设备清单属于个人数据：只允许创建者本人读取，不给管理员放行通道。
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ? AND task_type = ? AND CAST(created_by AS TEXT)=?')
    .get(req.params.id, 'desktop-identity', String(actor.userId));
  if (!row) return res.status(404).json({ success: false, code: 'DESKTOP_IDENTITY_REQUEST_NOT_FOUND' });
  res.json({
    success: true,
    request: {
      id: row.id,
      status: row.status,
      error_code: row.error_code || null,
      result_payload: parseJson(row.result_payload, null),
    },
  });
});

router.post('/tasks', requireMiniappTaskAccess, (req, res) => {
  const db = getInstance().db;
  try {
    const actorRole = roleForUser(req.user || {});
    const created = taskService.createV2Task(db, {
      taskType: req.body.taskType,
      payload: req.body.payload || {},
      createdBy: req.user?.id || 'miniapp',
      tenantId: req.tenantId || req.user?.tenant_id || req.user?.tenantId || 'default',
      actorRole,
      allowDraft: actorRole === 'super_admin',
      targetHostDeviceId: targetHostForTask(db, req.body.targetHostDeviceId || req.body.target_host_device_id),
      idempotencyKey: req.headers['x-idempotency-key'] || req.body.idempotencyKey || req.body.idempotency_key,
    });
    notifyHostTask(req, created.task);
    return res.json({ success: true, task: created.task, replayed: created.replayed });
  } catch (error) { return taskRouteError(res, error); }
});

router.post('/tasks/claim', requireHostWrite, (req, res) => {
  try {
    const claimed = taskService.claimNextV2Task(getInstance().db, {
      hostDeviceId: req.body.hostDeviceId || req.body.host_device_id,
      leaseMs: req.body.leaseMs || req.body.lease_ms,
    });
    return res.json({ success: true, task: claimed?.task || null, claimToken: claimed?.claimToken || null });
  } catch (error) { return taskRouteError(res, error); }
});

router.post('/tasks/:id/progress', requireHostWrite, (req, res) => {
  try { return res.json({ success: true, task: taskService.updateV2TaskProgress(getInstance().db, req.params.id, req.body || {}) }); }
  catch (error) { return taskRouteError(res, error); }
});

router.post('/tasks/:id/fail', requireHostWrite, (req, res) => {
  try { return res.json({ success: true, task: taskService.failV2Task(getInstance().db, req.params.id, req.body || {}) }); }
  catch (error) { return taskRouteError(res, error); }
});

router.post('/tasks/:id/cancel', (req, res) => {
  try {
    const task = taskService.cancelV2Task(getInstance().db, req.params.id, {
      actorUserId: req.user?.id,
      isAdmin: isAdminUser(req.user),
    });
    return res.json({ success: true, task });
  } catch (error) { return taskRouteError(res, error); }
});

router.post('/tasks/:id/complete', requireHostWrite, (req, res) => {
  const db = getInstance().db;
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'task not found' });

  if (Number(row.protocol_version || 1) >= 2) {
    try {
      const task = taskService.completeV2Task(db, req.params.id, req.body || {});
      const reconciliation = task.task_type === 'identity-provisioning'
        ? createMiniappProvisioningReconciler({ db }).reconcileCompletedTask(task.id)
        : null;
      return res.json({ success: true, task, reconciliation });
    }
    catch (error) { return taskRouteError(res, error); }
  }

  return taskRouteError(res, taskService.taskError('TASK_PROTOCOL_RETIRED', 'only V2 cloud relay tasks are supported', 410));
});

router.get('/tasks/:id/state', requireHostWrite, (req, res) => {
  const hostDeviceId = String(req.query.hostDeviceId || req.query.host_device_id || '');
  if (!hostDeviceId) return res.status(400).json({ success: false, code: 'HOST_DEVICE_ID_REQUIRED' });
  const row = getInstance().db.prepare(`SELECT id,status,result_payload,row_version,error_code,artifact_id,job_key,snapshot_hash
    FROM miniapp_tasks WHERE id=? AND (target_host_device_id=? OR claimed_by=?)`).get(req.params.id, hostDeviceId, hostDeviceId);
  if (!row) return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND', error: 'task not found' });
  return res.json({ success: true, task: { ...row, result_payload: parseJson(row.result_payload, null) } });
});

router.get('/tasks/:id/result', (req, res) => {
  const db = getInstance().db;
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(req.params.id);
  if (!row || !canReadTaskResult(row, req.user)) return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND', error: 'task not found' });
  res.json({
    success: true,
    task: row ? {
      ...row,
      payload: parseJson(row.payload, {}),
      result_payload: parseJson(row.result_payload, null),
    } : null,
  });
});

module.exports = router;
module.exports.filterSnapshotForUser = filterSnapshotForUser;
module.exports.requireMiniappTaskAccess = requireMiniappTaskAccess;
