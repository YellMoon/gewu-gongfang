'use strict';

const assert = require('assert');
const crypto = require('crypto');

const { createStorageTaskRepository } = require('./storageTaskRepository');

const HASH = 'a'.repeat(64);
const LEASE_TOKEN = 'lease-token-test-value';
const leaseHash = crypto.createHash('sha256').update(LEASE_TOKEN, 'utf8').digest('hex');

async function main() {
  const calls = [];
  const repository = createStorageTaskRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      if (text.includes('storage_task_receipts')) {
        if (values.includes('b'.repeat(64))) return { rows: [] };
        return { rows: [{ taskId: 'task_12345678', state: 'verified', verifiedAt: new Date('2026-08-22T00:00:00.000Z') }] };
      }
      return {
        rows: [{
          taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1, expectedSha256: HASH,
          expectedBytes: 3, mediaType: 'image/png', leaseExpiresAt: new Date('2026-08-22T00:05:00.000Z'),
        }],
      };
    },
    randomToken: () => LEASE_TOKEN,
    now: () => new Date('2026-08-22T00:00:00.000Z'),
  });

  const leased = await repository.leaseNext({ agentId: 'storage-agent-1' });
  assert.deepStrictEqual(leased, {
    taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1, expectedSha256: HASH,
    expectedBytes: 3, mediaType: 'image/png', leaseToken: LEASE_TOKEN,
    leaseExpiresAt: '2026-08-22T00:05:00.000Z',
  });
  assert.ok(calls[0].text.includes('FOR UPDATE SKIP LOCKED'), 'leasing must be concurrency-safe');
  assert.ok(calls[0].values.includes(leaseHash), 'only a SHA-256 lease hash may be stored');
  assert.ok(!calls[0].values.includes(LEASE_TOKEN), 'the raw lease token must never be sent to PostgreSQL');

  const completed = await repository.complete({
    agentId: 'storage-agent-1', taskId: 'task_12345678', leaseToken: LEASE_TOKEN,
    observedSha256: HASH, observedBytes: 3,
  });
  assert.deepStrictEqual(completed, { taskId: 'task_12345678', state: 'verified', verifiedAt: '2026-08-22T00:00:00.000Z' });
  assert.ok(calls[1].text.includes('storage_task_receipts'), 'completion must create an immutable cloud receipt');
  assert.ok(calls[1].values.includes(leaseHash), 'completion must compare only the lease hash');
  assert.ok(!calls[1].values.includes(LEASE_TOKEN), 'completion must not persist the raw lease token');

  await assert.rejects(
    () => repository.complete({ agentId: 'storage-agent-1', taskId: 'task_12345678', leaseToken: LEASE_TOKEN, observedSha256: 'b'.repeat(64), observedBytes: 3 }),
    /STORAGE_TASK_RECEIPT_MISMATCH/,
    'the repository must reject an agent receipt that disagrees with the immutable object hash'
  );
}

main().then(() => console.log('storage task repository checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
