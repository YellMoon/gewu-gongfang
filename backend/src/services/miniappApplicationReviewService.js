const { v4: uuidv4 } = require('uuid');
const { canReviewApplications, roleForUser } = require('./authorizationPolicy');
const { createV2Task, retryV2Task, taskRow } = require('./cloudRelayTaskService');

const REVIEWABLE_STATUSES = new Set([
  'submitted',
  'provisioning',
  'manual_resolution_required',
  'rejected',
  'withdrawn',
  'approved',
]);

function reviewError(code, statusCode = 409, details) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

function parseJson(value, fallback) {
  try { return value === null || value === undefined ? fallback : JSON.parse(value); } catch (_error) { return fallback; }
}

function presentApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    applicantUserId: row.applicant_user_id,
    applicationType: row.application_type,
    status: row.status,
    revision: Number(row.revision),
    payload: parseJson(row.payload_json, {}),
    applicantIdentityKind: row.applicant_identity_kind,
    hostTaskId: row.host_task_id || null,
    hostEntityId: row.host_entity_id || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    rejectionReason: row.rejection_reason || null,
    submittedAt: row.submitted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function auditState(application) {
  return {
    applicationId: application.id,
    revision: application.revision,
    status: application.status,
    hostTaskId: application.hostTaskId,
    rejectionReason: application.rejectionReason,
  };
}

function asIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw reviewError('APPLICATION_REVIEW_TIME_INVALID', 500);
  return date.toISOString();
}

function capabilitiesOf(row) {
  const capabilities = parseJson(row?.capabilities, []);
  return Array.isArray(capabilities) ? capabilities.map(item => String(item)) : [];
}

function rejectionReason(value) {
  if (typeof value !== 'string') throw reviewError('APPLICATION_REJECTION_REASON_REQUIRED', 400);
  const reason = value.trim();
  if (reason.length < 2 || reason.length > 500) {
    throw reviewError('APPLICATION_REJECTION_REASON_INVALID', 400);
  }
  if (/[<>]/.test(reason) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) {
    throw reviewError('APPLICATION_REJECTION_REASON_INVALID', 400);
  }
  return reason;
}

function createMiniappApplicationReviewService({
  db,
  targetHostDeviceId,
  hostHeartbeatTtlMs = Number(process.env.GEWU_HOST_HEARTBEAT_TTL_MS || 5 * 60 * 1000),
  now = () => new Date(),
  uuid = uuidv4,
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('db is required');

  const findApplication = db.prepare('SELECT * FROM miniapp_role_applications WHERE id=?');
  const findLatestRevision = db.prepare(`SELECT MAX(revision) AS revision
    FROM miniapp_role_applications WHERE applicant_user_id=?`);
  const findTask = db.prepare('SELECT * FROM miniapp_tasks WHERE id=?');
  const findHost = db.prepare('SELECT * FROM host_heartbeats WHERE host_device_id=? ORDER BY updated_at DESC LIMIT 1');
  const updateApprovedForProvisioning = db.prepare(`UPDATE miniapp_role_applications
    SET status='provisioning', host_task_id=?, reviewed_by=?, reviewed_at=?,
        rejection_reason=NULL, updated_at=?
    WHERE id=? AND revision=? AND status='submitted'`);
  const updateRejected = db.prepare(`UPDATE miniapp_role_applications
    SET status='rejected', reviewed_by=?, reviewed_at=?, rejection_reason=?, updated_at=?
    WHERE id=? AND revision=? AND status='submitted'`);
  const updateRetried = db.prepare(`UPDATE miniapp_role_applications
    SET status='provisioning', reviewed_by=?, reviewed_at=?, updated_at=?
    WHERE id=? AND revision=? AND status IN ('manual_resolution_required','provisioning')`);
  const insertAudit = db.prepare(`INSERT INTO authorization_audit_log
    (id, actor_user_id, actor_phone, target_user_id, action, before_json, after_json, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`);

  function requireReviewer(actor) {
    if (!canReviewApplications(actor)) throw reviewError('APPLICATION_REVIEW_FORBIDDEN', 403);
    return roleForUser(actor);
  }

  function currentApplication({ actor, applicationId, expectedRevision }) {
    requireReviewer(actor);
    const row = findApplication.get(applicationId);
    if (!row) throw reviewError('APPLICATION_NOT_FOUND', 404);
    if (String(row.applicant_user_id) === String(actor.id)) {
      throw reviewError('APPLICATION_REVIEW_SELF_FORBIDDEN', 403);
    }
    const revision = Number(expectedRevision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw reviewError('APPLICATION_REVISION_REQUIRED', 400);
    }
    const latest = Number(findLatestRevision.get(row.applicant_user_id)?.revision || 0);
    if (revision !== Number(row.revision) || revision !== latest) {
      throw reviewError('APPLICATION_REVISION_STALE', 409);
    }
    return row;
  }

  function availableHost() {
    const hostDeviceId = String(targetHostDeviceId || process.env.GEWU_PRIMARY_HOST_DEVICE_ID || '').trim();
    if (!hostDeviceId) throw reviewError('TARGET_HOST_REQUIRED', 409);
    const row = findHost.get(hostDeviceId);
    const timestamp = row?.updated_at ? Date.parse(row.updated_at) : 0;
    const age = new Date(now()).getTime() - timestamp;
    if (!row || row.status !== 'online' || !timestamp || age > hostHeartbeatTtlMs) {
      throw reviewError('TARGET_HOST_OFFLINE', 409);
    }
    if (!capabilitiesOf(row).includes('identity-provisioning-v1')) {
      throw reviewError('IDENTITY_PROVISIONING_UNSUPPORTED', 409);
    }
    return hostDeviceId;
  }

  function writeAudit({ actor, row, action, before, after, timestamp }) {
    insertAudit.run(
      uuid('application-review-audit'),
      actor.id,
      row.applicant_user_id,
      action,
      JSON.stringify(auditState(before)),
      JSON.stringify(auditState(after)),
      timestamp,
    );
  }

  const approveTransaction = db.transaction(input => {
    const row = currentApplication(input);
    if (row.status === 'provisioning' && row.host_task_id) {
      const existingTask = findTask.get(row.host_task_id);
      if (!existingTask || existingTask.task_type !== 'identity-provisioning') {
        throw reviewError('APPLICATION_TASK_MISMATCH', 409);
      }
      return { application: presentApplication(row), task: taskRow(existingTask), replayed: true };
    }
    if (row.status !== 'submitted') throw reviewError('APPLICATION_REVIEW_STATE_CONFLICT', 409);
    const hostDeviceId = availableHost();
    const timestamp = asIso(now());
    const payload = parseJson(row.payload_json, null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw reviewError('APPLICATION_PAYLOAD_INVALID', 409);
    }
    const taskPayload = {
      applicationId: row.id,
      revision: Number(row.revision),
      applicationType: row.application_type,
      payload,
      reviewedBy: input.actor.id,
      tenantId: input.tenantId || input.actor.tenant_id || input.actor.tenantId || 'default',
    };
    const created = createV2Task(db, {
      taskType: 'identity-provisioning',
      payload: taskPayload,
      createdBy: 'internal:miniapp-application-review',
      tenantId: taskPayload.tenantId,
      actorRole: roleForUser(input.actor),
      allowDraft: false,
      targetHostDeviceId: hostDeviceId,
      idempotencyKey: `identity-provisioning:${row.id}:${row.revision}`,
    }, {
      internal: true,
      now: timestamp,
      idFactory: () => uuid('identity-provisioning-task'),
    });
    const update = updateApprovedForProvisioning.run(
      created.task.id,
      input.actor.id,
      timestamp,
      timestamp,
      row.id,
      row.revision,
    );
    if (update.changes !== 1) throw reviewError('APPLICATION_REVIEW_STATE_CONFLICT', 409);
    const updated = findApplication.get(row.id);
    writeAudit({
      actor: input.actor,
      row,
      action: 'approve_miniapp_application',
      before: presentApplication(row),
      after: presentApplication(updated),
      timestamp,
    });
    return { application: presentApplication(updated), task: created.task, replayed: created.replayed };
  });

  const rejectTransaction = db.transaction(input => {
    const row = currentApplication(input);
    if (row.status !== 'submitted') throw reviewError('APPLICATION_REVIEW_STATE_CONFLICT', 409);
    const reason = rejectionReason(input.reason);
    const timestamp = asIso(now());
    const update = updateRejected.run(
      input.actor.id,
      timestamp,
      reason,
      timestamp,
      row.id,
      row.revision,
    );
    if (update.changes !== 1) throw reviewError('APPLICATION_REVIEW_STATE_CONFLICT', 409);
    const updated = findApplication.get(row.id);
    writeAudit({
      actor: input.actor,
      row,
      action: 'reject_miniapp_application',
      before: presentApplication(row),
      after: presentApplication(updated),
      timestamp,
    });
    return { application: presentApplication(updated) };
  });

  const retryTransaction = db.transaction(input => {
    const row = currentApplication(input);
    if (roleForUser(input.actor) !== 'super_admin') throw reviewError('SUPER_ADMIN_REQUIRED', 403);
    if (!['manual_resolution_required', 'provisioning'].includes(row.status) || !row.host_task_id) {
      throw reviewError('APPLICATION_RETRY_NOT_ALLOWED', 409);
    }
    availableHost();
    const existingTask = findTask.get(row.host_task_id);
    if (!existingTask || existingTask.task_type !== 'identity-provisioning') {
      throw reviewError('APPLICATION_TASK_MISMATCH', 409);
    }
    const timestamp = asIso(now());
    const task = retryV2Task(db, row.host_task_id, { internal: true, now: timestamp });
    const update = updateRetried.run(
      input.actor.id,
      timestamp,
      timestamp,
      row.id,
      row.revision,
    );
    if (update.changes !== 1) throw reviewError('APPLICATION_RETRY_NOT_ALLOWED', 409);
    const updated = findApplication.get(row.id);
    writeAudit({
      actor: input.actor,
      row,
      action: 'retry_miniapp_application',
      before: presentApplication(row),
      after: presentApplication(updated),
      timestamp,
    });
    return { application: presentApplication(updated), task };
  });

  function list({ actor, status, limit = 100 } = {}) {
    requireReviewer(actor);
    const normalizedStatus = status ? String(status) : null;
    if (normalizedStatus && !REVIEWABLE_STATUSES.has(normalizedStatus)) {
      throw reviewError('APPLICATION_STATUS_INVALID', 400);
    }
    const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 100));
    const rows = normalizedStatus
      ? db.prepare(`SELECT * FROM miniapp_role_applications WHERE status=?
          ORDER BY updated_at DESC, revision DESC LIMIT ?`).all(normalizedStatus, boundedLimit)
      : db.prepare(`SELECT * FROM miniapp_role_applications
          ORDER BY updated_at DESC, revision DESC LIMIT ?`).all(boundedLimit);
    return { items: rows.map(presentApplication), count: rows.length };
  }

  return {
    approve: approveTransaction,
    list,
    reject: rejectTransaction,
    retry: retryTransaction,
  };
}

module.exports = {
  createMiniappApplicationReviewService,
};
