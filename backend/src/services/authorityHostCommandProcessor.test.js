const assert = require('assert');
const Database = require('better-sqlite3');
const { PROTOCOL } = require('../../../shared/authorityProtocol');
const { createAuthorityCommandInboxService } = require('./authorityCommandInboxService');
const { createAuthorityCommandService, digest, stableJson } = require('./authorityCommandService');
const { createAuthorityHostCommandProcessor } = require('./authorityHostCommandProcessor');
const { createAuthorityProjectionVersionService } = require('./authorityProjectionVersionService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE host_commands (
    command_id TEXT PRIMARY KEY, target_host_id TEXT NOT NULL, actor_user_id TEXT NOT NULL,
    device_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, envelope_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL, status TEXT NOT NULL, claim_token TEXT, claim_until TEXT,
    row_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(actor_user_id, device_id, idempotency_key)
  );
  CREATE TABLE host_receipts (
    command_id TEXT PRIMARY KEY, result_hash TEXT NOT NULL, receipt_json TEXT NOT NULL,
    completed_at TEXT NOT NULL
  );
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
  CREATE TABLE authority_projection_versions (
    authority_id TEXT NOT NULL, host_epoch_id TEXT NOT NULL, version INTEGER NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY(authority_id, host_epoch_id)
  );
`);

let clock = '2026-07-28T00:00:00.000Z';
const inbox = createAuthorityCommandInboxService({ db, now: () => clock });
const versions = createAuthorityProjectionVersionService({ db, now: () => clock });
let domainWrites = 0;
const executor = createAuthorityCommandService({
  db,
  now: () => clock,
  authorizeEnvelope: () => ({ scope: { kind: 'teacher', teacherId: 'teacher-1' } }),
  nextProjectionVersion: envelope => versions.next(envelope),
  handlers: {
    'schedule.update.v1': envelope => ({ write: ++domainWrites, scheduleId: envelope.payload.id }),
  },
});
const payload = { id: 'processor-schedule-1' };
inbox.enqueue({
  protocol: PROTOCOL,
  commandId: 'processor-command-1',
  idempotencyKey: 'processor-key-1',
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  actor: { userId: 'user-1', deviceId: 'device-1', role: 'teacher' },
  lease: { id: 'lease-1', grantVersion: 1 },
  type: 'schedule.update.v1',
  payload,
  payloadHash: digest(stableJson(payload)),
  createdAt: clock,
});

let failPublish = true;
const commandSource = {
  claim: input => inbox.claim(input),
  renew: input => inbox.renew(input),
  publishReceipt: (receipt, claim) => {
    if (failPublish) {
      failPublish = false;
      throw new Error('simulated receipt transport loss');
    }
    return inbox.publishReceipt(receipt, claim);
  },
};
let tokenSequence = 0;
const processor = createAuthorityHostCommandProcessor({
  targetHostId: 'authority-1',
  commandSource,
  executor,
  claimLeaseMs: 30_000,
  createClaimToken: () => `processor-claim-${++tokenSequence}`,
});

(async function main() {
  await assert.rejects(() => processor.processOnce(), /simulated receipt transport loss/);
  assert.strictEqual(domainWrites, 1, 'the host transaction committed before receipt transport failed');
  assert.strictEqual(db.prepare("SELECT status FROM host_commands WHERE command_id='processor-command-1'").get().status, 'claimed');

  clock = '2026-07-28T00:00:31.000Z';
  const recovered = await processor.processOnce();
  assert.deepStrictEqual(recovered, { processed: 1, replayed: 1, recovered: 1 });
  assert.strictEqual(domainWrites, 1, 'expired-claim recovery must replay the stored receipt without a second domain write');
  assert.strictEqual(db.prepare("SELECT status FROM host_commands WHERE command_id='processor-command-1'").get().status, 'completed');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM host_receipts').get().count, 1);

  console.log('authorityHostCommandProcessor tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
