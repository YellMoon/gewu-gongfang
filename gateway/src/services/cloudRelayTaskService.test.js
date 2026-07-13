const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const implementations = [
  ['gateway', require('./cloudRelayTaskService')],
  ['backend', require('../../../backend/src/services/cloudRelayTaskService')],
];

function createDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE miniapp_tasks (
    id TEXT PRIMARY KEY, task_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_host',
    payload TEXT NOT NULL, result_payload TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    protocol_version INTEGER NOT NULL DEFAULT 1, idempotency_key TEXT, request_hash TEXT,
    target_host_device_id TEXT, selection_context TEXT, phase TEXT, progress INTEGER NOT NULL DEFAULT 0,
    claimed_by TEXT, claim_token_hash TEXT, lease_expires_at TEXT, row_version INTEGER NOT NULL DEFAULT 0,
    error_code TEXT, cancel_requested_at TEXT, job_key TEXT, snapshot_hash TEXT, artifact_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, next_attempt_at TEXT,
    deadline_at TEXT, result_expires_at TEXT, completion_operation_id TEXT, completion_result_hash TEXT
  );
  CREATE UNIQUE INDEX idx_task_idempotency ON miniapp_tasks(created_by,idempotency_key) WHERE idempotency_key IS NOT NULL;`);
  return db;
}

for (const [name, service] of implementations) {
  const db = createDb();
  const input = {
    taskType: 'paper-export-pdf', payload: { questionIds: ['q2', 'q1'], title: 'paper' },
    createdBy: 'user-1', tenantId: 'tenant-a', actorRole: 'student', allowDraft: false,
    targetHostDeviceId: 'host-a', idempotencyKey: 'idem-1',
    maxAttempts: 4, deadlineAt: '2026-07-13T01:00:00.000Z', resultExpiresAt: '2026-07-20T00:00:00.000Z',
  };
  const created = service.createV2Task(db, input, { now: '2026-07-13T00:00:00.000Z', idFactory: () => 'task-v2' });
  assert.strictEqual(created.replayed, false, `${name}: first create is not a replay`);
  assert.strictEqual(created.task.protocol_version, 2);
  assert.strictEqual(created.task.target_host_device_id, 'host-a');
  assert.strictEqual(created.task.phase, 'queued');
  assert.strictEqual(created.task.max_attempts, 4);
  assert.strictEqual(created.task.deadline_at, '2026-07-13T01:00:00.000Z');
  assert.strictEqual(created.task.result_expires_at, '2026-07-20T00:00:00.000Z');
  assert.deepStrictEqual(created.task.selection_context, { tenantId: 'tenant-a', actorRole: 'student', allowDraft: false });

  const replay = service.createV2Task(db, input, { now: '2026-07-13T00:00:01.000Z', idFactory: () => 'must-not-insert' });
  assert.strictEqual(replay.replayed, true, `${name}: same key and request must replay`);
  assert.strictEqual(replay.task.id, 'task-v2');
  assert.throws(
    () => service.createV2Task(db, { ...input, payload: { ...input.payload, title: 'different' } }),
    error => error.code === 'IDEMPOTENCY_KEY_CONFLICT' && error.statusCode === 409,
    `${name}: same key with a different request must conflict`
  );

  assert.strictEqual(service.claimNextV2Task(db, { hostDeviceId: 'host-b' }), null, `${name}: a different host cannot claim the task`);
  const firstClaim = service.claimNextV2Task(db, {
    hostDeviceId: 'host-a', now: '2026-07-13T00:00:02.000Z', leaseMs: 1000, tokenFactory: () => 'claim-old',
  });
  assert.strictEqual(firstClaim.task.id, 'task-v2');
  assert.strictEqual(firstClaim.task.status, 'processing');
  assert.strictEqual(firstClaim.task.row_version, 1);
  assert.strictEqual(service.claimNextV2Task(db, { hostDeviceId: 'host-a', now: '2026-07-13T00:00:02.500Z' }), null, `${name}: an active lease prevents duplicate claim`);

  const secondClaim = service.claimNextV2Task(db, {
    hostDeviceId: 'host-a', now: '2026-07-13T00:00:04.000Z', leaseMs: 1000, tokenFactory: () => 'claim-new',
  });
  assert.strictEqual(secondClaim.task.row_version, 2, `${name}: expired lease can be reclaimed with CAS`);
  assert.throws(
    () => service.completeV2Task(db, 'task-v2', { claimToken: 'claim-old', expectedRowVersion: 2, operationId: 'stale-op', resultHash: crypto.createHash('sha256').update('{}').digest('hex'), result: {} }),
    error => error.code === 'TASK_CLAIM_INVALID',
    `${name}: a stale claim token must be rejected`
  );
  assert.throws(
    () => service.updateV2TaskProgress(db, 'task-v2', { claimToken: 'claim-new', expectedRowVersion: 2, progress: 10, phase: 'made-up-phase' }),
    error => error.code === 'TASK_PHASE_INVALID' && error.statusCode === 400,
    `${name}: progress phases must use the explicit lifecycle enum`
  );

  const progressed = service.updateV2TaskProgress(db, 'task-v2', {
    claimToken: 'claim-new', expectedRowVersion: 2, progress: 45, phase: 'rendering',
    now: '2026-07-13T00:00:04.100Z', leaseMs: 1000,
  });
  assert.deepStrictEqual([progressed.status, progressed.phase, progressed.progress, progressed.row_version], ['processing', 'rendering', 45, 3]);
  assert.throws(
    () => service.updateV2TaskProgress(db, 'task-v2', { claimToken: 'claim-new', expectedRowVersion: 2, progress: 50, phase: 'rendering' }),
    error => error.code === 'TASK_VERSION_CONFLICT',
    `${name}: stale row versions must fail CAS`
  );
  const completionResult = { fileName: 'paper.pdf', artifactId: 'artifact-1' };
  const completionHash = crypto.createHash('sha256').update(JSON.stringify({ artifactId: 'artifact-1', fileName: 'paper.pdf' })).digest('hex');
  assert.throws(() => service.completeV2Task(db, 'task-v2', {
    claimToken: 'claim-new', expectedRowVersion: 3, operationId: 'completion-op-1', resultHash: '0'.repeat(64), result: completionResult,
  }), error => error.code === 'TASK_RESULT_HASH_MISMATCH' && error.statusCode === 400, `${name}: completion result hash must match canonical result JSON`);
  const completed = service.completeV2Task(db, 'task-v2', {
    claimToken: 'claim-new', expectedRowVersion: 3, operationId: 'completion-op-1', resultHash: completionHash, result: completionResult, now: '2026-07-13T00:00:04.200Z',
  });
  assert.deepStrictEqual([completed.status, completed.phase, completed.progress, completed.row_version], ['completed', 'completed', 100, 4]);
  assert.deepStrictEqual([completed.completion_operation_id, completed.completion_result_hash], ['completion-op-1', completionHash]);
  assert.strictEqual(service.completeV2Task(db, 'task-v2', { operationId: 'completion-op-1', resultHash: completionHash, result: completionResult }).row_version, 4, `${name}: lost ACK replay with same operation/hash is idempotent`);
  assert.throws(() => service.completeV2Task(db, 'task-v2', { operationId: 'completion-op-1', resultHash: 'f'.repeat(64), result: completionResult }), error => error.code === 'TASK_COMPLETION_CONFLICT');
  assert.throws(() => service.completeV2Task(db, 'task-v2', { operationId: 'completion-op-2', resultHash: completionHash, result: completionResult }), error => error.code === 'TASK_COMPLETION_CONFLICT');
  assert.throws(
    () => service.failV2Task(db, 'task-v2', { claimToken: 'claim-new', expectedRowVersion: 4, errorCode: 'LATE_FAIL' }),
    error => error.code === 'TASK_STATE_CONFLICT',
    `${name}: terminal tasks cannot transition again`
  );

  const cancelCreated = service.createV2Task(db, { ...input, idempotencyKey: 'idem-cancel' }, { idFactory: () => 'task-cancel' });
  const cancelled = service.cancelV2Task(db, 'task-cancel', { actorUserId: 'user-1', isAdmin: false });
  assert.deepStrictEqual([cancelled.status, cancelled.phase], ['cancelled', 'cancelled']);

  db.prepare(`INSERT INTO miniapp_tasks(id,task_type,status,payload,created_by,created_at,updated_at,protocol_version)
    VALUES('legacy-1','paper-export-word','pending_host','{}','user-1','t','t',1)`).run();
  assert.deepStrictEqual(service.listLegacyPending(db).map(row => row.id), ['legacy-1'], `${name}: V1 polling must not return V2 tasks`);
  assert.strictEqual(service.completeLegacyTask(db, 'legacy-1', { ok: true }).status, 'completed');

  db.prepare(`INSERT INTO miniapp_tasks(id,task_type,status,payload,created_by,created_at,updated_at,protocol_version)
    VALUES('legacy-claim','paper-export-pdf','pending_host','{}','user-1','2026-07-13T00:00:00.000Z','t',1)`).run();
  const legacyFirstClaim = service.claimNextLegacyTask(db, {
    hostDeviceId: 'host-a', now: '2026-07-13T00:00:01.000Z', leaseMs: 1000, tokenFactory: () => 'legacy-old',
  });
  assert.strictEqual(legacyFirstClaim.task.id, 'legacy-claim');
  assert.strictEqual(legacyFirstClaim.task.row_version, 1);
  assert.strictEqual(service.claimNextLegacyTask(db, { hostDeviceId: 'host-b', now: '2026-07-13T00:00:01.500Z' }), null, `${name}: active V1 lease prevents another host claim`);
  const legacySecondClaim = service.claimNextLegacyTask(db, {
    hostDeviceId: 'host-b', now: '2026-07-13T00:00:03.000Z', leaseMs: 1000, tokenFactory: () => 'legacy-new',
  });
  assert.strictEqual(legacySecondClaim.task.row_version, 2, `${name}: expired V1 lease can be reclaimed atomically`);
  assert.throws(
    () => service.completeLegacyTask(db, 'legacy-claim', { ok: true }, true, { claimToken: 'legacy-old', expectedRowVersion: 2, hostDeviceId: 'host-a', now: '2026-07-13T00:00:03.100Z' }),
    error => error.code === 'TASK_CLAIM_INVALID',
    `${name}: stale V1 claim token cannot complete another host's work`
  );
  assert.strictEqual(service.completeLegacyTask(db, 'legacy-claim', { ok: true }, true, {
    claimToken: 'legacy-new', expectedRowVersion: 2, hostDeviceId: 'host-b', now: '2026-07-13T00:00:03.500Z',
  }).status, 'completed');

  db.prepare(`INSERT INTO miniapp_tasks(id,task_type,status,payload,created_by,created_at,updated_at,protocol_version)
    VALUES('legacy-expired','paper-export-pdf','pending_host','{}','user-1','2026-07-13T00:00:04.000Z','t',1)`).run();
  const expiringClaim = service.claimNextLegacyTask(db, {
    hostDeviceId: 'host-a', now: '2026-07-13T00:00:04.000Z', leaseMs: 1000, tokenFactory: () => 'legacy-expiring',
  });
  assert.throws(
    () => service.completeLegacyTask(db, 'legacy-expired', { ok: true }, true, { claimToken: expiringClaim.claimToken, expectedRowVersion: expiringClaim.task.row_version, hostDeviceId: 'host-a', now: '2026-07-13T00:00:06.000Z' }),
    error => error.code === 'TASK_LEASE_EXPIRED',
    `${name}: an expired V1 claim cannot complete without a valid lease`
  );
  assert.throws(
    () => service.completeLegacyTask(db, 'task-v2', { ok: true }),
    error => error.code === 'TASK_PROTOCOL_MISMATCH',
    `${name}: legacy completion cannot mutate a V2 task`
  );
  db.close();
}

console.log('cloud relay V2 task service contract checks passed');
