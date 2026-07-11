const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { scopeBusinessSnapshot } = require('../services/dataScopeService');
const { isApprovedActive, roleForUser } = require('../services/authorizationPolicy');

const router = express.Router();

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function requireHostToken(req, res, next) {
  const expected = process.env.GEWU_CLOUD_RELAY_HOST_TOKEN;
  const supplied = req.headers['x-gewu-host-token'] || req.headers['x-host-token'];
  if (!expected || !secureEqual(supplied, expected)) return res.status(403).json({ success: false, code: 'HOST_TOKEN_INVALID' });
  return next();
}

function isStudentUser(user) {
  return user?.user_type === 'student';
}

const adminTaskTypes = new Set(['asset-import', 'question-paper', 'paper-export-word', 'paper-export-pdf']);
const studentTaskTypes = new Set(['question-paper', 'paper-export-word', 'paper-export-pdf']);

function allowedTasksForUser(user) {
  if (user?.user_type === 'student') return studentTaskTypes;
  if (['super_admin', 'admin'].includes(user?.user_type)) return adminTaskTypes;
  return new Set();
}

function getLinkedStudentIds(user = {}) {
  const ids = [
    user.student_id,
    user.studentId,
    user.linked_student_id,
    user.linkedStudentId,
    ...parseArray(user.linked_student_ids),
    ...parseArray(user.linkedStudentIds),
    user.user_type === 'student' ? user.id : undefined,
  ];
  return Array.from(new Set(ids.filter(Boolean).map(String)));
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return value.split(',').map(item => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function courseStudentIds(course = {}) {
  return [
    ...parseArray(course.student_ids),
    ...parseArray(course.student_pricings).map(pricing => pricing.student_id || pricing.studentId),
  ].filter(Boolean);
}

function scheduleStudentIds(schedule = {}, courseById = new Map()) {
  const directIds = [
    ...parseArray(schedule.student_ids),
    ...parseArray(schedule.student_pricings).map(pricing => pricing.student_id || pricing.studentId),
  ].filter(Boolean);
  const course = courseById.get(schedule.course_id);
  return Array.from(new Set([...directIds, ...courseStudentIds(course)]));
}

function hasAnyStudentLink(candidateIds, allowedIds) {
  const allowed = new Set(allowedIds);
  return candidateIds.some(idValue => allowed.has(idValue));
}

function pick(record, keys) {
  const result = {};
  for (const key of keys) {
    if (record && record[key] !== undefined) result[key] = record[key];
  }
  return result;
}

function redactStudentForStudent(student = {}) {
  return pick(student, ['id', 'name', 'school', 'grade_year', 'grade_current', 'source_type']);
}

function redactCourseForStudent(course = {}) {
  return pick(course, ['id', 'name', 'display_name', 'type', 'year', 'semester', 'teacher_id', 'teacher_name', 'room_id', 'room_name', 'active', 'default_duration_minutes', 'notes', 'created_at', 'updated_at']);
}

function redactScheduleForStudent(schedule = {}) {
  return pick(schedule, ['id', 'course_id', 'start_time', 'end_time', 'recurring_rule', 'status', 'room', 'service_type', 'notes', 'created_at', 'updated_at']);
}

function redactTeacherForStudent(teacher = {}) {
  return pick(teacher, ['id', 'name', 'subject']);
}

function filterSnapshotForUser(snapshot, user) {
  if (!snapshot) return snapshot;
  const role = roleForUser(user || {});
  if (role === 'teacher') {
    return { ...snapshot, payload: scopeBusinessSnapshot(snapshot.payload || {}, {
      kind: 'teacher', teacherId: user.teacher_id || user.teacherId, userId: user.id || user.user_id || user.userId,
    }) };
  }
  if (['super_admin', 'admin'].includes(role)) return snapshot;
  if (role === 'student') {
    return { ...snapshot, payload: scopeBusinessSnapshot(snapshot.payload || {}, {
      kind: 'student', studentIds: getLinkedStudentIds(user), userId: user.id,
    }) };
  }
  return { ...snapshot, payload: {} };
}

router.post('/host/heartbeat', requireHostToken, (req, res) => {
  const db = getDb();
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
  ).run(hostDeviceId, hostDeviceId, req.body.status || 'online', req.body.baseUrl || '', req.body.lastSnapshotAt || null, time, time);
  res.json({ success: true, serverTime: time });
});

router.post('/snapshots/publish', requireHostToken, (req, res) => {
  const db = getDb();
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

function requireApprovedSnapshotUser(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: 'Authentication required' });
  if (!isApprovedActive(req.user) || roleForUser(req.user) === 'pending') {
    return res.status(403).json({ success: false, code: 'USER_NOT_APPROVED', error: 'Approved active user required' });
  }
  return next();
}

router.get('/snapshots/read', requireApprovedSnapshotUser, (req, res) => {
  const db = getDb();
  const snapshotType = req.query.snapshotType || 'full';
  const row = db.prepare(
    `SELECT * FROM readonly_snapshots WHERE snapshot_type = ? ORDER BY created_at DESC LIMIT 1`
  ).get(snapshotType);
  const snapshot = row ? { ...row, payload: JSON.parse(row.payload || '{}') } : null;
  res.json({
    success: true,
    snapshot: filterSnapshotForUser(snapshot, req.user),
  });
});

router.post('/tasks', requireApprovedSnapshotUser, (req, res) => {
  const db = getDb();
  const allowed = allowedTasksForUser(req.user);
  if (!allowed.has(req.body.taskType)) return res.status(403).json({ success: false, error: 'task type is not allowed' });
  const taskId = id('task');
  const time = now();
  db.prepare(
    `INSERT INTO miniapp_tasks (id, task_type, status, payload, created_by, created_at, updated_at)
     VALUES (?, ?, 'pending_host', ?, ?, ?, ?)`
  ).run(taskId, req.body.taskType, JSON.stringify(req.body.payload || {}), req.user.id, time, time);
  res.json({ success: true, task: { id: taskId, status: 'pending_host' } });
});

router.get('/tasks', requireHostToken, (req, res) => {
  const db = getDb();
  const status = req.query.status || 'pending_host';
  const rows = db.prepare(
    `SELECT * FROM miniapp_tasks WHERE status = ? ORDER BY created_at ASC LIMIT 100`
  ).all(status);
  res.json({
    success: true,
    tasks: rows.map(row => ({
      ...row,
      payload: JSON.parse(row.payload || '{}'),
      result_payload: row.result_payload ? JSON.parse(row.result_payload) : null,
    })),
  });
});

router.post('/tasks/:id/complete', requireHostToken, (req, res) => {
  const db = getDb();
  const time = now();
  const status = req.body.success === false ? 'failed' : 'completed';
  const resultPayload = {
    ...(req.body.result || req.body.resultPayload || {}),
    completedBy: req.body.completedBy || req.body.hostDeviceId || 'primary-host',
    completedAt: time,
  };
  const info = db.prepare(
    `UPDATE miniapp_tasks
     SET status = ?, result_payload = ?, updated_at = ?
     WHERE id = ?`
  ).run(status, JSON.stringify(resultPayload), time, req.params.id);
  if (info.changes === 0) return res.status(404).json({ success: false, error: 'task not found' });
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(req.params.id);
  res.json({
    success: true,
    task: {
      ...row,
      payload: JSON.parse(row.payload || '{}'),
      result_payload: row.result_payload ? JSON.parse(row.result_payload) : null,
    },
  });
});

router.get('/tasks/:id/result', requireApprovedSnapshotUser, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(req.params.id);
  if (row && !['super_admin', 'admin'].includes(roleForUser(req.user)) && row.created_by !== req.user.id) {
    return res.status(403).json({ success: false, code: 'TASK_SCOPE_VIOLATION' });
  }
  res.json({
    success: true,
    task: row ? {
      ...row,
      payload: JSON.parse(row.payload || '{}'),
      result_payload: row.result_payload ? JSON.parse(row.result_payload) : null,
    } : null,
  });
});

module.exports = router;
module.exports.filterSnapshotForUser = filterSnapshotForUser;
module.exports.requireApprovedSnapshotUser = requireApprovedSnapshotUser;
module.exports.requireHostToken = requireHostToken;
