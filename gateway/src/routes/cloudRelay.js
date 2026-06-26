const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/database');

const router = express.Router();

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function isStudentUser(user) {
  return user?.user_type === 'student';
}

const adminTaskTypes = new Set(['asset-import', 'question-paper', 'paper-export-word', 'paper-export-pdf']);
const studentTaskTypes = new Set(['question-paper', 'paper-export-word', 'paper-export-pdf']);

function allowedTasksForUser(user) {
  if (user?.user_type === 'student') return studentTaskTypes;
  if (user?.user_type === 'admin') return adminTaskTypes;
  return new Set();
}

function getLinkedStudentIds(user = {}) {
  const ids = [
    user.student_id,
    user.studentId,
    user.linked_student_id,
    user.linkedStudentId,
    ...(user.linked_student_ids || []),
    ...(user.linkedStudentIds || []),
    user.user_type === 'student' ? user.id : undefined,
  ];
  return Array.from(new Set(ids.filter(Boolean)));
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

function filterSnapshotForUser(snapshot, user) {
  if (!snapshot || !isStudentUser(user)) return snapshot;

  const linkedStudentIds = getLinkedStudentIds(user);
  if (linkedStudentIds.length === 0) {
    return {
      ...snapshot,
      payload: {
        redactedForRole: 'student',
        linkedStudentIds: [],
        students: [],
        courses: [],
        schedules: [],
        payments: [],
      },
    };
  }

  const payload = snapshot.payload || {};
  const courseById = new Map((payload.courses || []).map(course => [course.id, course]));
  const courses = (payload.courses || []).filter(course =>
    hasAnyStudentLink(courseStudentIds(course), linkedStudentIds)
  );
  const allowedCourseIds = new Set(courses.map(course => course.id));
  const schedules = (payload.schedules || []).filter(schedule =>
    allowedCourseIds.has(schedule.course_id)
    || hasAnyStudentLink(scheduleStudentIds(schedule, courseById), linkedStudentIds)
  );
  const students = (payload.students || []).filter(student => linkedStudentIds.includes(student.id));
  const payments = (payload.payments || []).filter(payment => linkedStudentIds.includes(payment.student_id || payment.studentId));
  const teachers = (payload.teachers || []).filter(teacher =>
    courses.some(course => course.teacher_id === teacher.id || course.teacherId === teacher.id)
  );

  return {
    ...snapshot,
    payload: {
      ...payload,
      redactedForRole: 'student',
      linkedStudentIds,
      students,
      courses,
      schedules,
      payments,
      teachers,
    },
  };
}

router.post('/host/heartbeat', (req, res) => {
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

router.post('/snapshots/publish', (req, res) => {
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

router.get('/snapshots/read', (req, res) => {
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

router.post('/tasks', (req, res) => {
  const db = getDb();
  const allowed = allowedTasksForUser(req.user);
  if (!allowed.has(req.body.taskType)) return res.status(403).json({ success: false, error: 'task type is not allowed' });
  const taskId = id('task');
  const time = now();
  db.prepare(
    `INSERT INTO miniapp_tasks (id, task_type, status, payload, created_by, created_at, updated_at)
     VALUES (?, ?, 'pending_host', ?, ?, ?, ?)`
  ).run(taskId, req.body.taskType, JSON.stringify(req.body.payload || {}), req.body.createdBy || 'miniapp', time, time);
  res.json({ success: true, task: { id: taskId, status: 'pending_host' } });
});

router.get('/tasks', (req, res) => {
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

router.post('/tasks/:id/complete', (req, res) => {
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

router.get('/tasks/:id/result', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(req.params.id);
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
