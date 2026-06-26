const { Router } = require('express');
const crypto = require('crypto');
const { getInstance } = require('../database');

const router = Router();

const ADMIN_TASK_TYPES = new Set(['asset-import', 'question-paper', 'paper-export-word', 'paper-export-pdf']);
const STUDENT_TASK_TYPES = new Set(['question-paper', 'paper-export-word', 'paper-export-pdf']);

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function roleOf(user = {}) {
  return user.role || user.user_type || 'guest';
}

function allowedTasksForUser(user = {}) {
  const role = roleOf(user);
  if (role === 'student') return STUDENT_TASK_TYPES;
  if (role === 'admin' || role === 'operator') return ADMIN_TASK_TYPES;
  return new Set();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return fallback;
  }
}

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

router.get('/snapshots/read', (req, res) => {
  const db = getInstance().db;
  const snapshotType = req.query.snapshotType || 'full';
  const row = db.prepare(
    `SELECT * FROM readonly_snapshots WHERE snapshot_type = ? ORDER BY created_at DESC LIMIT 1`
  ).get(snapshotType);
  const snapshot = row ? { ...row, payload: parseJson(row.payload, {}) } : null;
  res.json({ success: true, snapshot });
});

router.post('/tasks', (req, res) => {
  const allowed = allowedTasksForUser(req.user);
  if (!allowed.has(req.body.taskType)) {
    return res.status(403).json({ success: false, error: 'task type is not allowed' });
  }

  const db = getInstance().db;
  const taskId = id('task');
  const time = now();
  db.prepare(
    `INSERT INTO miniapp_tasks (id, task_type, status, payload, created_by, created_at, updated_at)
     VALUES (?, ?, 'pending_host', ?, ?, ?, ?)`
  ).run(taskId, req.body.taskType, JSON.stringify(req.body.payload || {}), req.user?.id || 'miniapp', time, time);
  res.json({ success: true, task: { id: taskId, status: 'pending_host' } });
});

router.get('/tasks/:id/result', (req, res) => {
  const db = getInstance().db;
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(req.params.id);
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
