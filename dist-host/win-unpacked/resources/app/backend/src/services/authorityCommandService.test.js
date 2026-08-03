const assert = require('assert');
const Database = require('better-sqlite3');
const { createAuthorityCommandService, digest, stableJson } = require('./authorityCommandService');
const { PROTOCOL } = require('../../../shared/authorityProtocol');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE authority_command_ledger (
    command_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, host_epoch_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL, device_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    command_type TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL,
    result_hash TEXT, created_at TEXT NOT NULL, committed_at TEXT,
    UNIQUE(actor_user_id, device_id, idempotency_key)
  );
  CREATE TABLE authority_command_receipts (
    command_id TEXT PRIMARY KEY, result_hash TEXT NOT NULL, result_payload TEXT NOT NULL,
    projection_version INTEGER NOT NULL, completed_at TEXT NOT NULL
  );
`);

let writes = 0;
let authorizations = 0;
const service = createAuthorityCommandService({
  db,
  now: () => '2026-07-27T00:00:00.000Z',
  handlers: {
    'schedule.update.v1': (input, authorization) => ({
      write: ++writes,
      scheduleId: input.payload.id,
      scopeKind: authorization.scope.kind,
    }),
  },
  authorizeEnvelope: () => {
    authorizations += 1;
    return { scope: { kind: 'teacher', teacherId: 'teacher-1' } };
  },
  nextProjectionVersion: () => 7,
});
const actor = { userId: 'u1', deviceId: 'd1', role: 'teacher' };
function command(overrides = {}) {
  const payload = overrides.payload || { id: 's-default' };
  return {
    protocol: PROTOCOL,
    authorityId: 'authority-1',
    hostEpochId: 'epoch-2',
    actor,
    lease: { id: 'lease-1', grantVersion: 1 },
    payload,
    payloadHash: digest(stableJson(payload)),
    createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

assert.throws(
  () => service.execute({ commandId: 'legacy', idempotencyKey: 'legacy', actor, type: 'schedule.update.v1', payload: { id: 's0' } }),
  error => error && error.code === 'AUTHORITY_PROTOCOL_INVALID'
);

const first = service.execute(command({ commandId: 'c1', idempotencyKey: 'k1', type: 'schedule.update.v1', payload: { id: 's1' } }));
assert.deepStrictEqual(first.receipt, {
  protocol: 'gewu.authority-receipt.v1',
  commandId: 'c1',
  payloadHash: digest(stableJson({ id: 's1' })),
  status: 'committed',
  resultHash: first.receipt.resultHash,
  authorityId: 'authority-1',
  hostEpochId: 'epoch-2',
  projectionVersion: 7,
  completedAt: '2026-07-27T00:00:00.000Z',
  result: { scheduleId: 's1', scopeKind: 'teacher', write: 1 },
});
const replay = service.execute(command({ commandId: 'c2', idempotencyKey: 'k1', type: 'schedule.update.v1', payload: { id: 's1' } }));
assert.strictEqual(first.receipt.resultHash, replay.receipt.resultHash);
assert.strictEqual(writes, 1);
assert.strictEqual(authorizations, 1, 'a receipt replay must not re-run host authorization or domain mutation');
assert.strictEqual(replay.replayed, true);

assert.throws(
  () => service.execute(command({ commandId: 'c3', idempotencyKey: 'k1', type: 'schedule.update.v1', payload: { id: 's2' } })),
  error => error && error.code === 'COMMAND_IDEMPOTENCY_CONFLICT'
);

const hashRejected = service.execute(command({
  commandId: 'c-hash',
  idempotencyKey: 'k-hash',
  type: 'schedule.update.v1',
  payload: { id: 's-hash' },
  payloadHash: 'tampered-payload-hash',
}));
assert.strictEqual(hashRejected.receipt.status, 'rejected');
assert.strictEqual(
  hashRejected.receipt.result.error.code,
  'AUTHORITY_PAYLOAD_HASH_MISMATCH',
);
assert.strictEqual(
  service.execute(command({
    commandId: 'c-hash-replay',
    idempotencyKey: 'k-hash',
    type: 'schedule.update.v1',
    payload: { id: 's-hash' },
    payloadHash: 'tampered-payload-hash',
  })).replayed,
  true,
);

const unsupported = service.execute(command({
  commandId: 'c-unsupported',
  idempotencyKey: 'k-unsupported',
  type: 'legacy.raw-sync.v1',
  payload: { id: 'raw-row' },
}));
assert.strictEqual(unsupported.receipt.status, 'rejected');
assert.strictEqual(unsupported.receipt.result.error.code, 'COMMAND_TYPE_UNSUPPORTED');

const deniedService = createAuthorityCommandService({
  db,
  now: () => '2026-07-27T00:00:02.000Z',
  handlers: { 'schedule.update.v1': () => ({ mustNotWrite: true }) },
  authorizeEnvelope: () => {
    throw Object.assign(new Error('scope denied'), {
      code: 'AUTHORITY_COMMAND_SCOPE_FORBIDDEN',
      statusCode: 403,
    });
  },
  nextProjectionVersion: () => 9,
  currentProjectionVersion: () => 7,
});
const denied = deniedService.execute(command({
  commandId: 'c-denied',
  idempotencyKey: 'k-denied',
  type: 'schedule.update.v1',
  payload: { id: 's-denied' },
}));
assert.strictEqual(denied.receipt.status, 'rejected');
assert.strictEqual(denied.receipt.projectionVersion, 7);
assert.strictEqual(denied.receipt.result.error.code, 'AUTHORITY_COMMAND_SCOPE_FORBIDDEN');

let postCommitWrites = 0;
const postCommit = createAuthorityCommandService({
  db,
  now: () => '2026-07-27T00:00:01.000Z',
  handlers: { 'schedule.update.v1': () => ({ write: ++postCommitWrites }) },
  authorizeEnvelope: () => ({ scope: { kind: 'teacher', teacherId: 'teacher-1' } }),
  nextProjectionVersion: () => 8,
  afterCommit: () => { throw new Error('simulated transport loss'); },
});
assert.throws(
  () => postCommit.execute(command({ commandId: 'c4', idempotencyKey: 'k2', type: 'schedule.update.v1', payload: { id: 's4' } })),
  /simulated transport loss/
);
const recovered = service.execute(command({ commandId: 'c5', idempotencyKey: 'k2', type: 'schedule.update.v1', payload: { id: 's4' } }));
assert.strictEqual(recovered.replayed, true);
assert.strictEqual(postCommitWrites, 1);

let rollbackCalls = 0;
const rollbackAware = createAuthorityCommandService({
  db,
  now: () => '2026-07-27T00:00:02.000Z',
  handlers: {
    'schedule.update.v1': () => {
      const error = new Error('simulated domain failure');
      error.code = 'SIMULATED_DOMAIN_FAILURE';
      throw error;
    },
  },
  authorizeEnvelope: () => ({ scope: { kind: 'teacher', teacherId: 'teacher-1' } }),
  nextProjectionVersion: () => 8,
  currentProjectionVersion: () => 8,
  afterRollback: ({ envelope, error }) => {
    rollbackCalls += 1;
    assert.strictEqual(envelope.commandId, 'c-rollback');
    assert.strictEqual(error.code, 'SIMULATED_DOMAIN_FAILURE');
  },
});
const rollbackEnvelope = command({
  commandId: 'c-rollback',
  idempotencyKey: 'k-rollback',
  type: 'schedule.update.v1',
  payload: { id: 's-rollback' },
});
assert.strictEqual(rollbackAware.execute(rollbackEnvelope).receipt.status, 'rejected');
assert.strictEqual(rollbackCalls, 1);
assert.strictEqual(rollbackAware.execute(rollbackEnvelope).replayed, true);
assert.strictEqual(rollbackCalls, 1, 'a rejected receipt replay must not run rollback recovery again');

console.log('authorityCommandService tests passed');
