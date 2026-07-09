const { Router } = require('express');
const crypto = require('crypto');
const { getInstance } = require('../database');
const {
  filterSnapshotForUser,
  isAdminUser,
  isAllowedMiniappTaskForUser,
} = require('../services/miniappAccessPolicy');

const router = Router();

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return fallback;
  }
}

function sendForbidden(res, code, message = 'Forbidden') {
  return res.status(code === 'UNAUTHORIZED' ? 401 : 403).json({ success: false, code, error: message });
}

function isHostTokenValid(req) {
  const expected = process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || '';
  if (!expected) return false;
  const provided = req.headers['x-gewu-host-token'] || req.headers['x-host-token'];
  return provided === expected;
}

function isDevBypass() {
  return process.env.NODE_ENV === 'development' || !process.env.JWT_SECRET;
}

function requireHostWrite(req, res, next) {
  if (isDevBypass() || isAdminUser(req.user) || isHostTokenValid(req)) return next();
  return sendForbidden(res, 'HOST_WRITE_FORBIDDEN', 'Host relay write is not allowed');
}

function requireSnapshotRead(req, res, next) {
  if (isDevBypass() || req.user) return next();
  return sendForbidden(res, 'UNAUTHORIZED', 'Authentication required');
}

function requireMiniappTaskAccess(req, res, next) {
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

router.use('/host', requireHostWrite);
router.use('/snapshots/publish', requireHostWrite);
router.use('/tasks', (req, res, next) => {
  if (req.method === 'GET' && req.path === '/') return requireHostWrite(req, res, next);
  if (req.method === 'POST' && /^\/[^/]+\/complete$/.test(req.path)) return requireHostWrite(req, res, next);
  return next();
});

router.post('/host/heartbeat', (req, res) => {
  const db = getInstance().db;
  const time = now();
  const hostDeviceId = req.body.hostDeviceId || req.body.deviceId;
  if (!hostDeviceId) return res.status(400).json({ success: false, error: 'hostDeviceId is required' });

  db.prepare(
    `INSERT INTO host_heartbeats (id, host_device_id, status, base_url, last_snapshot_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       base_url = excluded.base_url,
       last_snapshot_at = excluded.last_snapshot_at,
       updated_at = excluded.updated_at`
  ).run(
    hostDeviceId,
    hostDeviceId,
    req.body.status || 'online',
    req.body.baseUrl || '',
    req.body.lastSnapshotAt || null,
    time,
    time
  );

  res.json({ success: true, serverTime: time });
});

router.get('/host/status', (_req, res) => {
  const db = getInstance().db;
  const row = db.prepare(
    `SELECT * FROM host_heartbeats ORDER BY updated_at DESC LIMIT 1`
  ).get();
  const updatedAt = row?.updated_at ? Date.parse(row.updated_at) : 0;
  const heartbeatTtlMs = Number(process.env.GEWU_HOST_HEARTBEAT_TTL_MS || 5 * 60 * 1000);
  const online = Boolean(row && row.status !== 'offline' && Date.now() - updatedAt <= heartbeatTtlMs);
  res.json({
    success: true,
    online,
    host: row || null,
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

function requireDesktopSyncAccess(req, res, next) {
  const expected = process.env.GEWU_DESKTOP_SYNC_TOKEN || '';
  const provided = req.headers['x-gewu-desktop-sync-token'] || '';
  if (expected && provided === expected) return next();
  if (isDevBypass() || req.user) return next();
  return sendForbidden(res, 'UNAUTHORIZED', 'Authentication required');
}

router.post('/desktop-sync/requests', requireDesktopSyncAccess, (req, res) => {
  const db = getInstance().db;
  const taskId = id('desktop_sync');
  const time = now();
  const payload = {
    deviceId: req.body.deviceId || req.body.device_id || 'unknown',
    tenantId: req.body.tenantId || req.body.tenant_id || 'default',
    pendingChanges: req.body.pendingChanges || req.body.changes || [],
    preview: req.body.preview || null,
    submittedAt: time,
  };
  db.prepare(
    `INSERT INTO miniapp_tasks (id, task_type, status, payload, created_by, created_at, updated_at)
     VALUES (?, ?, 'pending_host', ?, ?, ?, ?)`
  ).run(taskId, 'desktop-sync', JSON.stringify(payload), req.user?.id || payload.deviceId, time, time);
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

router.get('/desktop-sync/requests/:id/result', requireDesktopSyncAccess, (req, res) => {
  const db = getInstance().db;
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ? AND task_type = ?').get(req.params.id, 'desktop-sync');
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

router.post('/tasks', requireMiniappTaskAccess, (req, res) => {
  const db = getInstance().db;
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
  const rows = db.prepare(
    `SELECT * FROM miniapp_tasks WHERE status = ? ORDER BY created_at DESC LIMIT 200`
  ).all(status);
  const tasks = rows.map(row => ({
    ...row,
    payload: parseJson(row.payload, {}),
    result_payload: parseJson(row.result_payload, null),
  }));
  res.json({ success: true, tasks });
});

router.post('/tasks/:id/complete', (req, res) => {
  const db = getInstance().db;
  const time = now();
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'task not found' });

  const status = req.body.success === false ? 'failed' : 'completed';
  db.prepare(
    `UPDATE miniapp_tasks
     SET status = ?, result_payload = ?, updated_at = ?
     WHERE id = ?`
  ).run(status, JSON.stringify(req.body || {}), time, req.params.id);

  const updated = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(req.params.id);
  res.json({
    success: true,
    task: {
      ...updated,
      payload: parseJson(updated.payload, {}),
      result_payload: parseJson(updated.result_payload, null),
    },
  });
});

router.get('/tasks/:id/result', (req, res) => {
  const db = getInstance().db;
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(req.params.id);
  if (!canReadTaskResult(row, req.user)) {
    return sendForbidden(res, 'TASK_RESULT_FORBIDDEN', 'Task result is not allowed');
  }
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
