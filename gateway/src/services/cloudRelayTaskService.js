const crypto = require('crypto');
const {
  TASK_STATUS,
  INTERNAL_TASK_TYPES,
  stableValue,
  requestHash,
  canonicalResultJson,
  resultHash,
  taskError,
  isInternalTaskType,
  parseJson,
  taskRow,
} = require('../../../shared/cloudRelayLogic');

const PROGRESS_PHASES = new Set(['processing', 'selecting', 'rendering', 'exporting', 'uploading', 'finalizing']);

function createV2Task(db, input, options = {}) {
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  const targetHostDeviceId = String(input.targetHostDeviceId || '').trim();
  if (!idempotencyKey) throw taskError('IDEMPOTENCY_KEY_REQUIRED', 'V2 tasks require an idempotency key', 400);
  if (!targetHostDeviceId) throw taskError('TARGET_HOST_REQUIRED', 'V2 tasks require a target host', 400);
  const createdBy = String(input.createdBy || '');
  const hash = requestHash(input);
  const existing = db.prepare('SELECT * FROM miniapp_tasks WHERE created_by = ? AND idempotency_key = ?').get(createdBy, idempotencyKey);
  if (existing) {
    if (existing.request_hash !== hash) throw taskError('IDEMPOTENCY_KEY_CONFLICT', 'idempotency key was already used for a different request', 409);
    return { task: taskRow(existing), replayed: true };
  }
  const now = options.now || new Date().toISOString();
  const id = (options.idFactory || (() => `task_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`))();
  const selectionContext = {
    tenantId: input.tenantId || 'default',
    actorRole: input.actorRole || '',
    allowDraft: Boolean(input.allowDraft),
  };
  try {
    db.prepare(`INSERT INTO miniapp_tasks
      (id,task_type,status,payload,result_payload,created_by,created_at,updated_at,protocol_version,
       idempotency_key,request_hash,target_host_device_id,selection_context,phase,progress,row_version,
       attempt,max_attempts,next_attempt_at,deadline_at,result_expires_at)
      VALUES(?,?,'pending_host',?,NULL,?,?,?,?,?,?,?,?, 'queued',0,0,0,?,NULL,?,?)`)
      .run(id, input.taskType, JSON.stringify(input.payload || {}), createdBy, now, now, 2,
        idempotencyKey, hash, targetHostDeviceId, JSON.stringify(selectionContext),
        Math.max(1, Number(input.maxAttempts || 3)), input.deadlineAt || null, input.resultExpiresAt || null);
  } catch (error) {
    if (!/UNIQUE constraint failed/.test(error.message || '')) throw error;
    const raced = db.prepare('SELECT * FROM miniapp_tasks WHERE created_by = ? AND idempotency_key = ?').get(createdBy, idempotencyKey);
    if (!raced || raced.request_hash !== hash) throw taskError('IDEMPOTENCY_KEY_CONFLICT', 'idempotency key was already used for a different request', 409);
    return { task: taskRow(raced), replayed: true };
  }
  return { task: taskRow(db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(id)), replayed: false };
}

function claimNextV2Task(db, input = {}) {
  const hostDeviceId = String(input.hostDeviceId || '').trim();
  if (!hostDeviceId) throw taskError('HOST_DEVICE_ID_REQUIRED', 'hostDeviceId is required', 400);
  const now = input.now || new Date().toISOString();
  const leaseMs = Math.max(100, Number(input.leaseMs || 60000));
  const leaseExpiresAt = new Date(new Date(now).getTime() + leaseMs).toISOString();
  const claimToken = (input.tokenFactory || (() => crypto.randomBytes(32).toString('hex')))();
  const claimTokenHash = crypto.createHash('sha256').update(claimToken).digest('hex');
  const execute = db.transaction(() => {
    const candidate = db.prepare(`SELECT * FROM miniapp_tasks
      WHERE protocol_version >= 2 AND target_host_device_id = ?
        AND attempt < max_attempts AND cancel_requested_at IS NULL
        AND (deadline_at IS NULL OR deadline_at > ?) AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        AND (status = 'pending_host' OR (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?))
      ORDER BY created_at ASC LIMIT 1`).get(hostDeviceId, now, now, now);
    if (!candidate) return null;
    const info = db.prepare(`UPDATE miniapp_tasks
      SET status='processing',phase='claimed',claimed_by=?,claim_token_hash=?,lease_expires_at=?,
          updated_at=?,row_version=row_version+1,attempt=attempt+1
      WHERE id=? AND row_version=? AND protocol_version>=2
        AND (status='pending_host' OR (status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?))`)
      .run(hostDeviceId, claimTokenHash, leaseExpiresAt, now, candidate.id, candidate.row_version, now);
    if (info.changes !== 1) return null;
    return { task: taskRow(db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(candidate.id)), claimToken };
  });
  return execute.immediate();
}

function claimedTask(db, id, input) {
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(id);
  if (!row) throw taskError('TASK_NOT_FOUND', 'task not found', 404);
  if (Number(row.protocol_version || 1) < 2) throw taskError('TASK_PROTOCOL_MISMATCH', 'task is not a V2 task', 409);
  if (row.status !== 'processing') throw taskError('TASK_STATE_CONFLICT', 'task is not processing', 409);
  const tokenHash = crypto.createHash('sha256').update(String(input.claimToken || '')).digest('hex');
  if (!input.claimToken || tokenHash !== row.claim_token_hash) throw taskError('TASK_CLAIM_INVALID', 'claim token is invalid or stale', 409);
  if (Number(input.expectedRowVersion) !== Number(row.row_version)) throw taskError('TASK_VERSION_CONFLICT', 'task row version is stale', 409);
  return row;
}

function updateV2TaskProgress(db, id, input = {}) {
  const row = claimedTask(db, id, input);
  const phase = String(input.phase || row.phase || 'processing');
  if (!PROGRESS_PHASES.has(phase)) throw taskError('TASK_PHASE_INVALID', 'task progress phase is invalid', 400);
  const progress = Math.max(Number(row.progress || 0), Math.min(99, Math.max(0, Number(input.progress || 0))));
  const now = input.now || new Date().toISOString();
  const leaseExpiresAt = new Date(new Date(now).getTime() + Math.max(100, Number(input.leaseMs || 60000))).toISOString();
  const info = db.prepare(`UPDATE miniapp_tasks SET phase=?,progress=?,lease_expires_at=?,updated_at=?,row_version=row_version+1
    WHERE id=? AND row_version=? AND status='processing'`)
    .run(phase, progress, leaseExpiresAt, now, id, row.row_version);
  if (info.changes !== 1) throw taskError('TASK_VERSION_CONFLICT', 'task row version is stale', 409);
  return taskRow(db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(id));
}

function completeV2Task(db, id, input = {}) {
  const operationId = String(input.operationId || input.operation_id || '').trim();
  const suppliedHash = String(input.resultHash || input.result_hash || '').trim().toLowerCase();
  if (!operationId) throw taskError('TASK_COMPLETION_OPERATION_REQUIRED', 'completion operation id is required', 400);
  const existing = db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(id);
  if (existing?.status === 'completed') {
    if (existing.completion_operation_id === operationId && existing.completion_result_hash === suppliedHash) return taskRow(existing);
    throw taskError('TASK_COMPLETION_CONFLICT', 'task was completed by a different operation or result', 409);
  }
  const canonicalJson = canonicalResultJson(input.result || {});
  if (suppliedHash !== resultHash(input.result || {})) throw taskError('TASK_RESULT_HASH_MISMATCH', 'completion result hash does not match canonical result payload', 400);
  const row = claimedTask(db, id, input);
  const now = input.now || new Date().toISOString();
  const info = db.prepare(`UPDATE miniapp_tasks
    SET status='completed',phase='completed',progress=100,result_payload=?,completion_operation_id=?,completion_result_hash=?,error_code=NULL,
        lease_expires_at=NULL,updated_at=?,row_version=row_version+1
    WHERE id=? AND row_version=? AND status='processing'`)
    .run(canonicalJson, operationId, suppliedHash, now, id, row.row_version);
  if (info.changes !== 1) throw taskError('TASK_VERSION_CONFLICT', 'task row version is stale', 409);
  return taskRow(db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(id));
}

function failV2Task(db, id, input = {}) {
  const row = claimedTask(db, id, input);
  const now = input.now || new Date().toISOString();
  const result = { ...(input.result || {}), error: input.error || input.message || input.errorCode || 'task failed' };
  const info = db.prepare(`UPDATE miniapp_tasks
    SET status='failed',phase='failed',result_payload=?,error_code=?,lease_expires_at=NULL,
        updated_at=?,row_version=row_version+1
    WHERE id=? AND row_version=? AND status='processing'`)
    .run(JSON.stringify(result), String(input.errorCode || 'TASK_FAILED'), now, id, row.row_version);
  if (info.changes !== 1) throw taskError('TASK_VERSION_CONFLICT', 'task row version is stale', 409);
  return taskRow(db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(id));
}

function cancelV2Task(db, id, input = {}) {
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(id);
  if (!row) throw taskError('TASK_NOT_FOUND', 'task not found', 404);
  if (Number(row.protocol_version || 1) < 2) throw taskError('TASK_PROTOCOL_MISMATCH', 'task is not a V2 task', 409);
  if (!input.isAdmin && String(row.created_by) !== String(input.actorUserId || '')) throw taskError('TASK_CANCEL_FORBIDDEN', 'task cancellation is forbidden', 403);
  if (!['pending_host', 'processing'].includes(row.status)) throw taskError('TASK_STATE_CONFLICT', 'terminal task cannot be cancelled', 409);
  const now = input.now || new Date().toISOString();
  const info = db.prepare(`UPDATE miniapp_tasks
    SET status='cancelled',phase='cancelled',cancel_requested_at=?,lease_expires_at=NULL,
        updated_at=?,row_version=row_version+1
    WHERE id=? AND row_version=? AND status IN ('pending_host','processing')`)
    .run(now, now, id, row.row_version);
  if (info.changes !== 1) throw taskError('TASK_VERSION_CONFLICT', 'task row version is stale', 409);
  return taskRow(db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(id));
}

function listLegacyPending(db, limit = 100) {
  return db.prepare(`SELECT * FROM miniapp_tasks
    WHERE status='pending_host' AND COALESCE(protocol_version,1)<2
    ORDER BY created_at ASC LIMIT ?`).all(Math.max(1, Math.min(200, Number(limit) || 100))).map(taskRow);
}

function claimNextLegacyTask(db, input = {}) {
  const hostDeviceId = String(input.hostDeviceId || '').trim();
  if (!hostDeviceId) throw taskError('HOST_DEVICE_ID_REQUIRED', 'hostDeviceId is required', 400);
  const now = input.now || new Date().toISOString();
  const leaseMs = Math.max(100, Number(input.leaseMs || 60000));
  const leaseExpiresAt = new Date(new Date(now).getTime() + leaseMs).toISOString();
  const claimToken = (input.tokenFactory || (() => crypto.randomBytes(32).toString('hex')))();
  const claimTokenHash = crypto.createHash('sha256').update(claimToken).digest('hex');
  const execute = db.transaction(() => {
    const candidate = db.prepare(`SELECT * FROM miniapp_tasks
      WHERE COALESCE(protocol_version,1)<2
        AND (status='pending_host' OR (status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?))
      ORDER BY created_at ASC LIMIT 1`).get(now);
    if (!candidate) return null;
    const info = db.prepare(`UPDATE miniapp_tasks
      SET status='processing',phase='claimed',claimed_by=?,claim_token_hash=?,lease_expires_at=?,updated_at=?,row_version=row_version+1
      WHERE id=? AND row_version=? AND COALESCE(protocol_version,1)<2
        AND (status='pending_host' OR (status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?))`)
      .run(hostDeviceId, claimTokenHash, leaseExpiresAt, now, candidate.id, candidate.row_version, now);
    if (info.changes !== 1) return null;
    return { task: taskRow(db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(candidate.id)), claimToken };
  });
  return execute.immediate();
}

function completeLegacyTask(db, id, result = {}, success = true, claim = {}) {
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(id);
  if (!row) throw taskError('TASK_NOT_FOUND', 'task not found', 404);
  if (Number(row.protocol_version || 1) >= 2) throw taskError('TASK_PROTOCOL_MISMATCH', 'legacy completion cannot mutate a V2 task', 409);
  const now = claim.now || new Date().toISOString();
  if (row.claimed_by) {
    if (row.status !== 'processing') throw taskError('TASK_STATE_CONFLICT', 'legacy task is not processing', 409);
    const sharedLegacyCompatibility = row.claimed_by === 'legacy-shared' && !claim.claimToken;
    if (!sharedLegacyCompatibility) {
      const tokenHash = crypto.createHash('sha256').update(String(claim.claimToken || '')).digest('hex');
      if (!claim.claimToken || tokenHash !== row.claim_token_hash || (claim.hostDeviceId && String(claim.hostDeviceId) !== String(row.claimed_by))) {
        throw taskError('TASK_CLAIM_INVALID', 'legacy claim token is invalid or stale', 409);
      }
      if (Number(claim.expectedRowVersion) !== Number(row.row_version)) throw taskError('TASK_VERSION_CONFLICT', 'legacy task row version is stale', 409);
    }
    if (!row.lease_expires_at || row.lease_expires_at <= now) throw taskError('TASK_LEASE_EXPIRED', 'legacy task lease has expired', 409);
  } else if (row.status !== 'pending_host') {
    throw taskError('TASK_STATE_CONFLICT', 'legacy task cannot be completed from its current state', 409);
  }
  const status = success ? 'completed' : 'failed';
  const info = db.prepare(`UPDATE miniapp_tasks SET status=?,phase=?,progress=?,result_payload=?,lease_expires_at=NULL,updated_at=?,row_version=row_version+1
    WHERE id=? AND row_version=? AND status IN ('pending_host','processing')`)
    .run(status, status, success ? 100 : Number(row.progress || 0), JSON.stringify(result || {}), now, id, row.row_version);
  if (info.changes !== 1) throw taskError('TASK_VERSION_CONFLICT', 'legacy task row version is stale', 409);
  return taskRow(db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(id));
}

module.exports = {
  cancelV2Task,
  canonicalResultJson,
  claimNextLegacyTask,
  claimNextV2Task,
  completeLegacyTask,
  completeV2Task,
  createV2Task,
  failV2Task,
  listLegacyPending,
  updateV2TaskProgress,
  // 共享逻辑
  TASK_STATUS,
  requestHash,
  resultHash,
  taskError,
  taskRow,
  parseJson,
};
