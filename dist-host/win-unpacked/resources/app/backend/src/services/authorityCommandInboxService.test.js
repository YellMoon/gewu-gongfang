const assert = require('assert');
const Database = require('better-sqlite3');
const { PROTOCOL, stableJson } = require('../../../shared/authorityProtocol');
const { createAuthorityCommandInboxService } = require('./authorityCommandInboxService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE host_commands (
    command_id TEXT PRIMARY KEY,
    target_host_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    claim_token TEXT,
    claim_until TEXT,
    row_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(actor_user_id, device_id, idempotency_key)
  );
  CREATE TABLE host_receipts (
    command_id TEXT PRIMARY KEY,
    result_hash TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    completed_at TEXT NOT NULL
  );
`);

function envelope(overrides = {}) {
  return {
    protocol: PROTOCOL,
    commandId: 'inbox-command-1',
    idempotencyKey: 'inbox-key-1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'teacher' },
    lease: { id: 'lease-1', grantVersion: 2 },
    type: 'schedule.update.v1',
    payload: { id: 'schedule-1' },
    payloadHash: 'payload-hash-1',
    createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

let clock = '2026-07-28T00:00:01.000Z';
const service = createAuthorityCommandInboxService({
  db,
  now: () => clock,
});

const queued = service.enqueue(envelope());
assert.deepStrictEqual(queued, { id: 'inbox-command-1', status: 'pending', replayed: false });
assert.strictEqual(
  db.prepare('SELECT envelope_json FROM host_commands WHERE command_id=?').get('inbox-command-1').envelope_json,
  stableJson(envelope()),
  'the cloud inbox must persist the complete canonical envelope',
);
assert.deepStrictEqual(
  service.enqueue(envelope()),
  { id: 'inbox-command-1', status: 'pending', replayed: true },
  'repeating the same command must not enqueue a second row',
);
assert.throws(
  () => service.enqueue(envelope({
    commandId: 'inbox-command-conflict',
    payload: { id: 'schedule-2' },
    payloadHash: 'payload-hash-2',
  })),
  error => error?.code === 'COMMAND_IDEMPOTENCY_CONFLICT',
);

const receipt = {
  protocol: 'gewu.authority-receipt.v1',
  commandId: 'inbox-command-1',
  payloadHash: 'payload-hash-1',
  status: 'committed',
  resultHash: 'result-hash-1',
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  projectionVersion: 4,
  completedAt: '2026-07-28T00:00:02.000Z',
};
service.claim({
  targetHostId: 'authority-1',
  claimToken: 'receipt-claim-token',
  leaseMs: 30_000,
  limit: 1,
});
assert.throws(
  () => service.publishReceipt(receipt, { claimToken: 'wrong-token' }),
  error => error?.code === 'AUTHORITY_COMMAND_CLAIM_LOST',
);
assert.deepStrictEqual(
  service.publishReceipt(receipt, { claimToken: 'receipt-claim-token' }),
  receipt,
);
assert.deepStrictEqual(
  service.findReceipt({
    commandId: 'inbox-command-1',
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'teacher' },
  }),
  receipt,
);
assert.throws(
  () => service.findReceipt({
    commandId: 'inbox-command-1',
    actor: { userId: 'other-user', deviceId: 'other-device', role: 'teacher' },
  }),
  error => error?.code === 'AUTHORITY_RECEIPT_FORBIDDEN',
);

const command2 = envelope({
  commandId: 'inbox-command-2',
  idempotencyKey: 'inbox-key-2',
  payload: { id: 'schedule-2' },
  payloadHash: 'payload-hash-2',
});
service.enqueue(command2);
const firstClaim = service.claim({
  targetHostId: 'authority-1',
  claimToken: 'claim-token-1',
  leaseMs: 30_000,
  limit: 10,
});
assert.strictEqual(firstClaim.length, 1);
assert.deepStrictEqual(firstClaim[0].envelope, command2);
assert.strictEqual(firstClaim[0].recovered, false);
assert.deepStrictEqual(
  service.claim({
    targetHostId: 'authority-1',
    claimToken: 'claim-token-other',
    leaseMs: 30_000,
    limit: 10,
  }),
  [],
  'an unexpired claim must not be stolen',
);
assert.throws(
  () => service.renew({
    commandId: 'inbox-command-2',
    claimToken: 'wrong-token',
    leaseMs: 30_000,
  }),
  error => error?.code === 'AUTHORITY_COMMAND_CLAIM_LOST',
);

clock = '2026-07-28T00:00:32.000Z';
const recoveredClaim = service.claim({
  targetHostId: 'authority-1',
  claimToken: 'claim-token-2',
  leaseMs: 60_000,
  limit: 10,
});
assert.strictEqual(recoveredClaim.length, 1);
assert.strictEqual(recoveredClaim[0].commandId, 'inbox-command-2');
assert.strictEqual(recoveredClaim[0].recovered, true);
const renewed = service.renew({
  commandId: 'inbox-command-2',
  claimToken: 'claim-token-2',
  leaseMs: 60_000,
});
assert.strictEqual(renewed.claimUntil, '2026-07-28T00:01:32.000Z');

console.log('authorityCommandInboxService tests passed');
