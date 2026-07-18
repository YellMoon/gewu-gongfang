'use strict';

const { scopeBusinessSnapshot } = require('./dataScopeService');

const SYNC_TABLES = Object.freeze([
  'students', 'grades', 'courses', 'schedules', 'enrollments',
  'payments', 'consumptions', 'institutions', 'schools', 'rooms', 'teachers',
  'subjects', 'chapters', 'knowledge_points', 'questions', 'question_contents',
  'question_assets',
]);

const RELAY_QUEUE_COLUMNS = Object.freeze([
  'id', 'status', 'protocol_version', 'target_host_device_id', 'attempt',
  'max_attempts', 'next_attempt_at', 'deadline_at', 'cancel_requested_at',
  'lease_expires_at', 'created_at',
]);
const MAX_SCOPE_PREVIEW_ROWS_PER_TABLE = 100;

function preflightError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sqlite(input) {
  const db = input?.db || input;
  if (!db || typeof db.prepare !== 'function') {
    throw preflightError('PRIMARY_HOST_PREFLIGHT_DATABASE_REQUIRED');
  }
  return db;
}

function isoNow(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw preflightError('PRIMARY_HOST_PREFLIGHT_CLOCK_INVALID');
  return date.toISOString();
}

function parseRoles(value) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_error) {
    return [];
  }
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function approvedUser(user) {
  return Boolean(user && Number(user.deleted || 0) === 0
    && user.status !== 0 && user.status !== false
    && user.login_enabled !== 0 && user.login_enabled !== false
    && user.review_status === 'approved');
}

function resolveCurrentActor(db, actorContext, nowIso) {
  const actor = actorContext || {};
  const userId = String(actor.userId || '').trim();
  const deviceId = String(actor.deviceId || '').trim();
  const authorizationId = String(actor.authorizationId || '').trim();
  const sessionId = String(actor.sessionId || '').trim();
  const activeRole = String(actor.activeRole || '').trim();
  const eligibleRoles = Array.isArray(actor.eligibleRoles) ? actor.eligibleRoles.map(String) : [];
  const authVersion = Number(actor.authVersion);
  const credentialVersion = Number(actor.credentialVersion);
  const user = userId ? db.prepare('SELECT * FROM users WHERE id=?').get(userId) : null;
  const authorization = deviceId
    ? db.prepare('SELECT * FROM desktop_device_authorizations WHERE device_id=?').get(deviceId)
    : null;
  const session = sessionId ? db.prepare('SELECT * FROM desktop_sessions WHERE sid=?').get(sessionId) : null;
  const persistedRoles = parseRoles(session?.eligible_roles_json);

  if (!approvedUser(user)
    || Number(user.auth_version || 1) !== authVersion
    || !authorization || authorization.id !== authorizationId
    || authorization.user_id !== userId || authorization.status !== 'active'
    || Number(authorization.credential_version) !== credentialVersion
    || !session || session.status !== 'active' || Date.parse(session.expires_at) <= Date.parse(nowIso)
    || session.user_id !== userId || session.device_id !== deviceId
    || session.authorization_id !== authorizationId || session.active_role !== activeRole
    || Number(session.auth_version) !== authVersion
    || Number(session.credential_version) !== credentialVersion
    || !persistedRoles.includes(activeRole)
    || !sameStrings(persistedRoles, eligibleRoles)) {
    throw preflightError('PRIMARY_HOST_PREFLIGHT_ACTOR_MISMATCH');
  }

  const kind = ['super_admin', 'admin'].includes(activeRole) ? 'admin' : activeRole;
  return Object.freeze({
    kind,
    userId,
    deviceId,
    authorizationId,
    sessionId,
    activeRole,
    eligibleRoles: Object.freeze(persistedRoles.slice()),
    authVersion,
    credentialVersion,
    teacherId: activeRole === 'teacher'
      ? String(actor.teacherId || user.teacher_id || '').trim() || null
      : null,
    studentId: activeRole === 'student'
      ? String(actor.studentId || user.student_id || '').trim() || null
      : null,
  });
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
}

function assertTables(db, tables, code) {
  for (const table of tables) {
    if (tableColumns(db, table).length === 0) throw preflightError(code);
  }
}

function totalChanges(db) {
  return Number(db.prepare('SELECT total_changes() AS value').get().value);
}

function assertReadOnly(db, before) {
  if (totalChanges(db) !== before) throw preflightError('PRIMARY_HOST_PREFLIGHT_WRITE_DETECTED');
}

function runScopedSyncReadPreview(input = {}) {
  const db = sqlite(input.db);
  const before = totalChanges(db);
  const nowIso = isoNow(input.now);
  const actor = resolveCurrentActor(db, input.actorContext, nowIso);
  if (actor.kind !== 'admin' || actor.activeRole !== 'super_admin') {
    throw preflightError('PRIMARY_HOST_PREFLIGHT_ADMIN_REQUIRED');
  }
  assertTables(db, SYNC_TABLES, 'PRIMARY_HOST_SYNC_PREVIEW_SCHEMA_INCOMPATIBLE');

  const snapshot = {};
  const sourceRowCounts = {};
  const sampledRowCounts = {};
  for (const table of SYNC_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table} LIMIT ?`).all(MAX_SCOPE_PREVIEW_ROWS_PER_TABLE);
    snapshot[table] = rows;
    sampledRowCounts[table] = rows.length;
    sourceRowCounts[table] = Number(db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get().value);
  }
  const scoped = scopeBusinessSnapshot(snapshot, {
    ...actor,
    studentIds: actor.studentId ? [actor.studentId] : [],
  });
  for (const table of SYNC_TABLES) {
    if (!Array.isArray(scoped[table]) || scoped[table].length !== sampledRowCounts[table]) {
      throw preflightError('PRIMARY_HOST_SYNC_PREVIEW_SCOPE_MISMATCH');
    }
  }
  const visibleRowCounts = { ...sourceRowCounts };
  assertReadOnly(db, before);
  return Object.freeze({
    status: 'ok',
    actor,
    tablesChecked: SYNC_TABLES.length,
    maxRowsPerTable: MAX_SCOPE_PREVIEW_ROWS_PER_TABLE,
    sourceRowCounts: Object.freeze(sourceRowCounts),
    sampledRowCounts: Object.freeze(sampledRowCounts),
    visibleRowCounts: Object.freeze(visibleRowCounts),
  });
}

function runRelayQueueReadPreview(input = {}) {
  const db = sqlite(input.db);
  const before = totalChanges(db);
  const nowIso = isoNow(input.now);
  const actor = resolveCurrentActor(db, input.actorContext, nowIso);
  const targetDeviceId = String(input.targetDeviceId || '').trim();
  if (!targetDeviceId || targetDeviceId !== actor.deviceId) {
    throw preflightError('PRIMARY_HOST_PREFLIGHT_ACTOR_MISMATCH');
  }
  const columns = tableColumns(db, 'miniapp_tasks');
  if (columns.length === 0 || RELAY_QUEUE_COLUMNS.some(column => !columns.includes(column))) {
    throw preflightError('PRIMARY_HOST_RELAY_PREFLIGHT_SCHEMA_INCOMPATIBLE');
  }
  const candidate = db.prepare(`SELECT id,row_version FROM miniapp_tasks
    WHERE protocol_version >= 2 AND target_host_device_id = ?
      AND attempt < max_attempts AND cancel_requested_at IS NULL
      AND (deadline_at IS NULL OR deadline_at > ?) AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      AND (status = 'pending_host' OR (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?))
    ORDER BY created_at ASC LIMIT 1`).get(targetDeviceId, nowIso, nowIso, nowIso);
  assertReadOnly(db, before);
  return Object.freeze({
    status: 'ok',
    protocolVersion: 2,
    actor,
    targetDeviceId,
    candidateTaskId: candidate?.id || null,
    candidateRowVersion: candidate ? Number(candidate.row_version) : null,
  });
}

module.exports = {
  runRelayQueueReadPreview,
  runScopedSyncReadPreview,
};
