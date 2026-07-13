const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { scopeBusinessSnapshot } = require('../services/dataScopeService');
const { isApprovedActive, roleForUser } = require('../services/authorizationPolicy');
const { issueRelayAssertion } = require('../services/relayAssertionService');
const taskService = require('../services/cloudRelayTaskService');

const router = express.Router();

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
function validateDesktopSyncInput(req, res) {
  const deviceId = String(req.headers['x-device-id'] || req.body.deviceId || '');
  const name = String(req.body.deviceName || '');
  if (!deviceId || deviceId.length > 128 || name.length > 128) return res.status(400).json({ success: false, code: 'INVALID_SYNC_REQUEST' });
  const changes = req.body.pendingChanges;
  if (!Array.isArray(changes) || changes.length > 500) return res.status(changes?.length > 500 ? 413 : 400).json({ success: false, code: changes?.length > 500 ? 'SYNC_REQUEST_TOO_LARGE' : 'INVALID_SYNC_REQUEST' });
  if (Buffer.byteLength(JSON.stringify(req.body)) > 2 * 1024 * 1024) return res.status(413).json({ success: false, code: 'SYNC_REQUEST_TOO_LARGE' });
  for (const operation of changes) {
    if (!operation || typeof operation !== 'object' || !operation.id || !operation.table
      || !['create', 'update', 'delete'].includes(operation.action)
      || Buffer.byteLength(JSON.stringify(operation)) > 128 * 1024) {
      return res.status(400).json({ success: false, code: 'INVALID_SYNC_REQUEST' });
    }
  }
  return null;
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

router.post('/desktop-sync/devices/register', requireApprovedSnapshotUser, (req,res)=>{
  const deviceId=req.headers['x-device-id']||req.body.deviceId;if(!deviceId)return res.status(400).json({success:false,code:'DEVICE_ID_REQUIRED'});
  const db=getDb(),existing=db.prepare('SELECT * FROM cloud_devices WHERE id=?').get(deviceId);
  if(existing?.owner_user_id&&existing.owner_user_id!==req.user.id)return res.status(403).json({success:false,code:'SYNC_DEVICE_OWNER_MISMATCH'});
  const time=now();db.prepare(`INSERT INTO cloud_devices(id,device_name,role,status,owner_user_id,active,created_at,updated_at)VALUES(?,?,?,'active',?,1,?,?)ON CONFLICT(id)DO UPDATE SET owner_user_id=COALESCE(cloud_devices.owner_user_id,excluded.owner_user_id),active=1,updated_at=excluded.updated_at`).run(deviceId,req.body.deviceName||deviceId,'desktop-client',req.user.id,time,time);res.json({success:true,device:{id:deviceId}});
});
router.post('/desktop-sync/requests', requireApprovedSnapshotUser, (req, res) => {
  const invalid = validateDesktopSyncInput(req, res);
  if (invalid) return invalid;
  const db = getDb();
  const deviceId = req.headers['x-device-id'] || req.body.deviceId;
  const device = db.prepare('SELECT * FROM cloud_devices WHERE id=? AND active=1').get(deviceId);
  if (!device || device.owner_user_id !== req.user.id) return res.status(403).json({ success:false, code:'SYNC_DEVICE_OWNER_MISMATCH' });
  const pairing = db.prepare("SELECT id FROM desktop_device_pairings WHERE device_id=? AND user_id=? AND status='approved' ORDER BY updated_at DESC LIMIT 1").get(deviceId, req.user.id);
  if (!pairing) return res.status(403).json({ success:false, code:'PAIRING_NOT_APPROVED' });
  const taskId = id('desktop_sync');
  const time = now();
  let assertion;
  try { assertion = issueRelayAssertion({ taskId, actorUserId:req.user.id, deviceId, pairingApprovalId:pairing.id }, process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || ''); }
  catch (error) { return res.status(403).json({ success:false, code:error.code }); }
  const payload = { deviceId, tenantId:req.body.tenantId || 'default', pendingChanges:req.body.pendingChanges, actorUserId:req.user.id, relayAssertion:assertion, submittedAt:time };
  db.prepare("INSERT INTO miniapp_tasks(id,task_type,status,payload,created_by,created_at,updated_at) VALUES(?,'desktop-sync','pending_host',?,?,?,?)").run(taskId, JSON.stringify(payload), req.user.id, time, time);
  return res.json({ success:true, request:{ id:taskId, status:'pending_host', acceptedChanges:payload.pendingChanges.length } });
});
router.get('/desktop-sync/requests/:id/result', requireApprovedSnapshotUser, (req, res) => {
  const db = getDb();
  const admin = ['super_admin','admin'].includes(roleForUser(req.user));
  const row = admin ? db.prepare("SELECT * FROM miniapp_tasks WHERE id=? AND task_type='desktop-sync'").get(req.params.id) : db.prepare("SELECT * FROM miniapp_tasks WHERE id=? AND task_type='desktop-sync' AND CAST(created_by AS TEXT)=?").get(req.params.id, String(req.user.id));
  if (!row) return res.status(404).json({ success:false, code:'DESKTOP_SYNC_REQUEST_NOT_FOUND' });
  return res.json({ success:true, request:{ ...row, payload:JSON.parse(row.payload || '{}'), result_payload:row.result_payload ? JSON.parse(row.result_payload) : null } });
});

router.post('/tasks', requireApprovedSnapshotUser, (req, res) => {
  const db = getDb();
  const allowed = allowedTasksForUser(req.user);
  if (!allowed.has(req.body.taskType)) return res.status(403).json({ success: false, error: 'task type is not allowed' });
  if (Number(req.body.protocolVersion || req.body.protocol_version || 1) >= 2) {
    try {
      const actorRole = roleForUser(req.user);
      const created = taskService.createV2Task(db, {
        taskType: req.body.taskType,
        payload: req.body.payload || {},
        createdBy: req.user.id,
        tenantId: req.user.tenant_id || req.user.tenantId || 'default',
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
  ).run(taskId, req.body.taskType, JSON.stringify(req.body.payload || {}), req.user.id, time, time);
  res.json({ success: true, task: { id: taskId, status: 'pending_host' } });
});

router.get('/tasks', requireHostToken, (req, res) => {
  const db = getDb();
  const status = req.query.status || 'pending_host';
  const rows = status === 'pending_host' ? (() => {
    const claimed = [];
    const hostDeviceId = String(req.query.hostDeviceId || req.query.host_device_id || 'legacy-shared');
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 100));
    for (let index = 0; index < limit; index += 1) {
      const next = taskService.claimNextLegacyTask(db, { hostDeviceId, leaseMs: req.query.leaseMs || req.query.lease_ms });
      if (!next) break;
      claimed.push({ ...next.task, claimToken: next.claimToken });
    }
    return claimed;
  })() : db.prepare(
    `SELECT * FROM miniapp_tasks WHERE status = ? AND COALESCE(protocol_version,1)<2 ORDER BY created_at ASC LIMIT 100`
  ).all(status);
  res.json({
    success: true,
    tasks: rows.map(row => ({
      ...row,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload || '{}') : (row.payload || {}),
      result_payload: typeof row.result_payload === 'string' ? JSON.parse(row.result_payload) : (row.result_payload || null),
    })),
  });
});

router.post('/tasks/claim', requireHostToken, (req, res) => {
  try {
    const claimed = taskService.claimNextV2Task(getDb(), {
      hostDeviceId: req.body.hostDeviceId || req.body.host_device_id,
      leaseMs: req.body.leaseMs || req.body.lease_ms,
    });
    return res.json({ success: true, task: claimed?.task || null, claimToken: claimed?.claimToken || null });
  } catch (error) { return taskRouteError(res, error); }
});

router.post('/tasks/:id/progress', requireHostToken, (req, res) => {
  try {
    const task = taskService.updateV2TaskProgress(getDb(), req.params.id, req.body || {});
    return res.json({ success: true, task });
  } catch (error) { return taskRouteError(res, error); }
});

router.post('/tasks/:id/fail', requireHostToken, (req, res) => {
  try {
    const task = taskService.failV2Task(getDb(), req.params.id, req.body || {});
    return res.json({ success: true, task });
  } catch (error) { return taskRouteError(res, error); }
});

router.post('/tasks/:id/cancel', requireApprovedSnapshotUser, (req, res) => {
  try {
    const role = roleForUser(req.user);
    const task = taskService.cancelV2Task(getDb(), req.params.id, {
      actorUserId: req.user.id,
      isAdmin: ['super_admin', 'admin'].includes(role),
    });
    return res.json({ success: true, task });
  } catch (error) { return taskRouteError(res, error); }
});

router.post('/tasks/:id/complete', requireHostToken, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT protocol_version FROM miniapp_tasks WHERE id=?').get(req.params.id);
  if (Number(existing?.protocol_version || 1) >= 2) {
    try {
      const task = taskService.completeV2Task(db, req.params.id, req.body || {});
      return res.json({ success: true, task });
    } catch (error) { return taskRouteError(res, error); }
  }
  const resultPayload = {
    ...(req.body.result || req.body.resultPayload || {}),
    completedBy: req.body.completedBy || req.body.hostDeviceId || 'primary-host',
    completedAt: now(),
  };
  let row;
  try {
    row = taskService.completeLegacyTask(db, req.params.id, resultPayload, req.body.success !== false, {
      claimToken: req.body.claimToken || req.body.claim_token,
      expectedRowVersion: req.body.expectedRowVersion ?? req.body.expected_row_version,
      hostDeviceId: req.body.hostDeviceId || req.body.host_device_id,
    });
  } catch (error) { return taskRouteError(res, error); }
  res.json({ success: true, task: row });
});

router.get('/tasks/:id/state', requireHostToken, (req, res) => {
  const hostDeviceId = String(req.query.hostDeviceId || req.query.host_device_id || '');
  if (!hostDeviceId) return res.status(400).json({ success: false, code: 'HOST_DEVICE_ID_REQUIRED' });
  const row = getDb().prepare(`SELECT id,status,result_payload,row_version,error_code,artifact_id,job_key,snapshot_hash
    FROM miniapp_tasks WHERE id=? AND (target_host_device_id=? OR claimed_by=?)`).get(req.params.id, hostDeviceId, hostDeviceId);
  if (!row) return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND', error: 'task not found' });
  return res.json({ success: true, task: { ...row, result_payload: row.result_payload ? JSON.parse(row.result_payload) : null } });
});

router.get('/tasks/:id/result', requireApprovedSnapshotUser, (req, res) => {
  const db = getDb();
  const isAdmin = ['super_admin', 'admin'].includes(roleForUser(req.user));
  const row = isAdmin
    ? db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(String(req.params.id))
    : db.prepare('SELECT * FROM miniapp_tasks WHERE id = ? AND CAST(created_by AS TEXT) = ?').get(String(req.params.id), String(req.user.id));
  if (!row && !isAdmin) return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND' });
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
