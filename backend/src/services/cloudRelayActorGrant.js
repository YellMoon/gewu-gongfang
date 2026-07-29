const taskService = require('./cloudRelayTaskService');

const ACTIVE_ROLES = new Set(['super_admin', 'admin', 'teacher', 'student']);

function grantError(code, statusCode = 403) {
  return Object.assign(new Error(code), { code, statusCode });
}

function text(value, max = 128) {
  const normalized = String(value || '').trim();
  return normalized && normalized.length <= max ? normalized : '';
}

function actorGrantFromSyncActor(actor = {}) {
  const userId = text(actor.userId);
  const deviceId = text(actor.deviceId);
  const activeRole = text(actor.activeRole || actor.role, 32);
  const eligibleRoles = Array.from(new Set((Array.isArray(actor.eligibleRoles) ? actor.eligibleRoles : [])
    .map(role => text(role, 32)).filter(role => ACTIVE_ROLES.has(role))));
  if (!userId || !deviceId || !ACTIVE_ROLES.has(activeRole) || !eligibleRoles.includes(activeRole)) {
    throw grantError('RELAY_ACTOR_GRANT_INVALID', 400);
  }
  const teacherId = actor.teacherId ? text(actor.teacherId) : null;
  const studentId = actor.studentId ? text(actor.studentId) : null;
  if ((activeRole === 'teacher' && !teacherId) || (activeRole === 'student' && !studentId)) {
    throw grantError('RELAY_ACTOR_GRANT_INVALID', 400);
  }
  return Object.freeze({
    kind: ['super_admin', 'admin'].includes(activeRole) ? 'admin' : activeRole,
    role: activeRole,
    activeRole,
    eligibleRoles: Object.freeze(eligibleRoles),
    userId,
    teacherId,
    studentId,
    deviceId,
    authorizationId: text(actor.authorizationId) || null,
    sessionId: text(actor.sessionId) || null,
    authVersion: Number(actor.authVersion),
    credentialVersion: Number(actor.credentialVersion),
    scope: actor.scope && typeof actor.scope === 'object' ? Object.freeze({ ...actor.scope }) : Object.freeze({ kind: activeRole }),
    userApproved: true,
    deviceTrusted: true,
    deviceActive: true,
    deviceOwnerUserId: userId,
    clientType: 'desktop',
  });
}

function resolveTaskActorGrant(db, input = {}) {
  const taskId = text(input.taskId);
  const hostDeviceId = text(input.hostDeviceId);
  if (!taskId || !hostDeviceId) throw grantError('RELAY_TASK_GRANT_INPUT_REQUIRED', 400);
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(taskId);
  const task = taskService.taskRow(row);
  if (!task || !['desktop-sync', 'desktop-identity'].includes(task.task_type)) {
    throw grantError('RELAY_TASK_GRANT_NOT_FOUND', 404);
  }
  if (task.target_host_device_id && task.target_host_device_id !== hostDeviceId) {
    throw grantError('RELAY_TASK_HOST_MISMATCH');
  }
  if (task.claimed_by && task.claimed_by !== hostDeviceId) {
    throw grantError('RELAY_TASK_HOST_MISMATCH');
  }
  if (!['pending_host', 'processing', 'completed'].includes(task.status)) {
    throw grantError('RELAY_TASK_GRANT_UNAVAILABLE', 409);
  }
  return actorGrantFromSyncActor(task.payload?.actorGrant);
}

module.exports = { actorGrantFromSyncActor, resolveTaskActorGrant };
