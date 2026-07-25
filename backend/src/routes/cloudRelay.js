const { Router } = require('express');
const crypto = require('crypto');
const { getInstance } = require('../database');
const {
  filterSnapshotForUser,
  isAdminUser,
  isAllowedMiniappTaskForUser,
} = require('../services/miniappAccessPolicy');
const { roleForUser } = require('../services/authorizationPolicy');
const { issueRelayAssertion } = require('../services/relayAssertionService');
const { createPrimaryHostIdentityService } = require('../services/primaryHostIdentityService');
const taskService = require('../services/cloudRelayTaskService');
const { createMiniappProvisioningReconciler } = require('../services/miniappProvisioningReconciler');
const { buildQuestionPreviewIndex, safeHostBaseUrl } = require('../services/questionPreviewIndex');
const { createDesktopSessionRelayService } = require('../services/desktopSessionRelayService');

const router = Router();

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
function validateDesktopSyncInput(req,res){const deviceId=String(req.headers['x-device-id']||req.body.deviceId||'');const name=String(req.body.deviceName||'');if(!deviceId||deviceId.length>128||name.length>128)return res.status(400).json({success:false,code:'INVALID_SYNC_REQUEST'});const changes=req.body.pendingChanges;if(!Array.isArray(changes)||changes.length>500)return res.status(changes?.length>500?413:400).json({success:false,code:changes?.length>500?'SYNC_REQUEST_TOO_LARGE':'INVALID_SYNC_REQUEST'});if(Buffer.byteLength(JSON.stringify(req.body))>2*1024*1024)return res.status(413).json({success:false,code:'SYNC_REQUEST_TOO_LARGE'});for(const op of changes){if(!op||typeof op!=='object'||!op.id||!op.table||!['create','update','delete'].includes(op.action)||Buffer.byteLength(JSON.stringify(op))>128*1024)return res.status(400).json({success:false,code:'INVALID_SYNC_REQUEST'});}return null;}

function isHostTokenValid(req) {
  const active = getInstance().db.prepare(
    "SELECT 1 FROM primary_host_epochs WHERE status='active' LIMIT 1"
  ).get();
  if (active) return false;
  const expected = process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || '';
  if (!expected) return false;
  const provided = req.headers['x-gewu-host-token'] || req.headers['x-host-token'] || '';
  const expectedBuffer = Buffer.from(String(expected));
  const providedBuffer = Buffer.from(String(provided));
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
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
  if (!active && (isAdminUser(req.user) || isHostTokenValid(req))) return next();
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

function desktopSessionRelayService(db) {
  return createDesktopSessionRelayService({
    db,
    relayAssertionSecret: process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || '',
    jwtSecret: process.env.JWT_SECRET || '',
  });
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

router.post('/desktop-session/challenges/start', (req, res) => {
  try {
    const db = getInstance().db;
    const request = desktopSessionRelayService(db).createStartRequest({
      authorizationId: req.body.authorizationId,
      deviceId: req.body.deviceId,
      requestSecretHash: req.body.requestSecretHash,
      targetHostDeviceId: targetHostForTask(db, req.body.targetHostDeviceId),
    });
    return res.json({ success: true, request });
  } catch (error) {
    return taskRouteError(res, error);
  }
});

router.get('/desktop-session/requests/:id', (req, res) => {
  try {
    const request = desktopSessionRelayService(getInstance().db).readRequest({
      requestId: req.params.id,
      requestSecret: req.headers['x-desktop-session-request-secret'],
    });
    return res.json({ success: true, request });
  } catch (error) {
    return taskRouteError(res, error);
  }
});

router.post('/desktop-session/challenges/:id/exchange', (req, res) => {
  try {
    const request = desktopSessionRelayService(getInstance().db).createExchangeRequest({
      startRequestId: req.body.startRequestId,
      challengeId: req.params.id,
      signature: req.body.signature,
      expectedRowVersion: req.body.expectedRowVersion,
      requestSecret: req.headers['x-desktop-session-request-secret'],
    });
    return res.json({ success: true, request });
  } catch (error) {
    return taskRouteError(res, error);
  }
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

router.post('/desktop-sync/requests', requireDesktopSyncAccess, (req, res) => {
  const invalid=validateDesktopSyncInput(req,res);if(invalid)return invalid;
  const db = getInstance().db;
  const taskId = id('desktop_sync');
  const time = now();
  const actor = req.syncActor;
  const deviceId = actor.deviceId;
  const device = db.prepare('SELECT * FROM sync_devices WHERE id=? AND active=1').get(deviceId);
  if (!device || device.owner_user_id !== actor.userId) return sendForbidden(res, 'SYNC_DEVICE_OWNER_MISMATCH');
  let relayAssertion;
  try {
    relayAssertion = issueRelayAssertion({
      taskId, actorUserId:actor.userId, deviceId, sessionId:actor.sessionId,
      activeRole:actor.activeRole, teacherId:actor.teacherId || null,
      authVersion:Number(actor.authVersion), credentialVersion:Number(actor.credentialVersion),
      issuedAt:Date.now(), expiresAt:Date.parse(actor.sessionExpiresAt),
    },
      process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || '');
  } catch (error) { return sendForbidden(res, error.code || 'RELAY_ASSERTION_SECRET_REQUIRED'); }
  const payload = {
    deviceId,
    tenantId: req.body.tenantId || req.body.tenant_id || 'default',
    pendingChanges: req.body.pendingChanges || req.body.changes || [],
    preview: req.body.preview || null,
    submittedAt: time,
    actorUserId: actor.userId,
    relayAssertion,
  };
  db.prepare(
    `INSERT INTO miniapp_tasks (id, task_type, status, payload, created_by, created_at, updated_at)
     VALUES (?, ?, 'pending_host', ?, ?, ?, ?)`
  ).run(taskId, 'desktop-sync', JSON.stringify(payload), actor.userId, time, time);
  res.json({
    success: true,
    request: {
      id: taskId,
      taskType: 'desktop-sync',
      status: 'pending_host',
      acceptedChanges: payload.pendingChanges.length,
    },
  });
});

router.post('/desktop-sync/devices/register', requireDesktopSyncAccess, (req, res) => {
  const actor = req.syncActor;
  const deviceId = actor.deviceId;
  try {
    const device = getInstance().registerSyncDevice(deviceId, { ownerUserId:actor.userId,
      deviceName:req.body.deviceName || deviceId, role:'desktop-client' });
    return res.json({ success:true, device:{ id:device.id, ownerUserId:device.owner_user_id } });
  } catch (error) { return sendForbidden(res, error.code || 'SYNC_DEVICE_OWNER_MISMATCH'); }
});

router.get('/desktop-sync/requests/:id/result', requireDesktopSyncAccess, (req, res) => {
  const db = getInstance().db;
  const actor = req.syncActor;
  const admin = ['super_admin','admin'].includes(actor.activeRole);
  const row = admin
    ? db.prepare('SELECT * FROM miniapp_tasks WHERE id = ? AND task_type = ?').get(req.params.id, 'desktop-sync')
    : db.prepare('SELECT * FROM miniapp_tasks WHERE id = ? AND task_type = ? AND CAST(created_by AS TEXT)=?').get(req.params.id, 'desktop-sync', String(actor.userId));
  if (!row) return res.status(404).json({ success: false, error: 'desktop sync request not found' });
  res.json({
    success: true,
    request: {
      ...row,
      payload: parseJson(row.payload, {}),
      result_payload: parseJson(row.result_payload, null),
    },
  });
});

// 外网（云中继）身份与设备查询：客户端建任务，数据主机轮询处理后回填结果。
// 设备数据只存在主机本地库，云端仅做转发，不落任何设备明细。
router.post('/desktop-identity/requests', requireDesktopSyncAccess, (req, res) => {
  const query = String(req.body.query || '').trim();
  if (query !== 'devices') {
    return res.status(400).json({ success: false, code: 'DESKTOP_IDENTITY_RELAY_QUERY_UNSUPPORTED' });
  }
  const db = getInstance().db;
  const taskId = id('desktop_identity');
  const time = now();
  const actor = req.syncActor;
  let relayAssertion;
  try {
    relayAssertion = issueRelayAssertion({
      taskId, actorUserId:actor.userId, deviceId:actor.deviceId, sessionId:actor.sessionId,
      activeRole:actor.activeRole, teacherId:actor.teacherId || null,
      authVersion:Number(actor.authVersion), credentialVersion:Number(actor.credentialVersion),
      issuedAt:Date.now(), expiresAt:Date.parse(actor.sessionExpiresAt),
    }, process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || '');
  } catch (error) { return sendForbidden(res, error.code || 'RELAY_ASSERTION_SECRET_REQUIRED'); }
  const payload = {
    deviceId: actor.deviceId,
    query,
    submittedAt: time,
    actorUserId: actor.userId,
    relayAssertion,
  };
  db.prepare(
    `INSERT INTO miniapp_tasks (id, task_type, status, payload, created_by, created_at, updated_at)
     VALUES (?, ?, 'pending_host', ?, ?, ?, ?)`
  ).run(taskId, 'desktop-identity', JSON.stringify(payload), actor.userId, time, time);
  res.json({
    success: true,
    request: { id: taskId, taskType: 'desktop-identity', status: 'pending_host' },
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
  if (Number(req.body.protocolVersion || req.body.protocol_version || 1) >= 2) {
    try {
      const actorRole = roleForUser(req.user || {});
      const created = taskService.createV2Task(db, {
        taskType: req.body.taskType,
        payload: req.body.payload || {},
        createdBy: req.user?.id || 'miniapp',
        tenantId: req.tenantId || req.user?.tenant_id || req.user?.tenantId || 'default',
        actorRole,
        allowDraft: ['super_admin', 'admin'].includes(actorRole),
        targetHostDeviceId: targetHostForTask(db, req.body.targetHostDeviceId || req.body.target_host_device_id),
        idempotencyKey: req.headers['x-idempotency-key'] || req.body.idempotencyKey || req.body.idempotency_key,
      });
      return res.json({ success: true, task: created.task, replayed: created.replayed });
    } catch (error) { return taskRouteError(res, error); }
  }
  const taskId = id('task');
  const time = now();
  db.prepare(
    `INSERT INTO miniapp_tasks (id, task_type, status, payload, created_by, created_at, updated_at)
     VALUES (?, ?, 'pending_host', ?, ?, ?, ?)`
  ).run(taskId, req.body.taskType, JSON.stringify(req.body.payload || {}), req.user?.id || 'miniapp', time, time);
  res.json({ success: true, task: { id: taskId, status: 'pending_host' } });
});

router.get('/tasks', (req, res) => {
  const db = getInstance().db;
  const status = req.query.status || 'pending_host';
  const rows = status === 'pending_host' ? (() => {
    const claimed = [];
    const hostDeviceId = String(req.query.hostDeviceId || req.query.host_device_id || 'legacy-shared');
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 200));
    for (let index = 0; index < limit; index += 1) {
      const next = taskService.claimNextLegacyTask(db, { hostDeviceId, leaseMs: req.query.leaseMs || req.query.lease_ms });
      if (!next) break;
      claimed.push({ ...next.task, claimToken: next.claimToken });
    }
    return claimed;
  })() : db.prepare(
    `SELECT * FROM miniapp_tasks WHERE status = ? AND COALESCE(protocol_version,1)<2 ORDER BY created_at DESC LIMIT 200`
  ).all(status);
  const tasks = rows.map(row => ({
    ...row,
    payload: parseJson(row.payload, {}),
    result_payload: parseJson(row.result_payload, null),
  }));
  res.json({ success: true, tasks });
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

router.post('/tasks/:id/complete', (req, res) => {
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

  let updated;
  try {
    updated = taskService.completeLegacyTask(db, req.params.id, req.body.result || req.body.resultPayload || req.body || {}, req.body.success !== false, {
      claimToken: req.body.claimToken || req.body.claim_token,
      expectedRowVersion: req.body.expectedRowVersion ?? req.body.expected_row_version,
      hostDeviceId: req.body.hostDeviceId || req.body.host_device_id,
    });
  } catch (error) { return taskRouteError(res, error); }
  res.json({
    success: true,
    task: {
      ...updated,
      payload: parseJson(updated.payload, {}),
      result_payload: parseJson(updated.result_payload, null),
    },
  });
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
