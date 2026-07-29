const assert = require('assert');

(async function main() {
  const { createDesktopCommandOutbox } = await import('./desktopCommandOutbox.mjs');
  let sealedState = '';
  const store = {
    read: async () => sealedState,
    write: async value => { sealedState = value; },
  };
  const codec = {
    seal: async value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64'),
    open: async value => JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
  };
  const outbox = createDesktopCommandOutbox({
    store,
    codec,
    createId: () => 'draft-1',
    now: () => '2026-07-28T00:00:00.000Z',
  });

  const queued = await outbox.append({
    type: 'schedule.update.v1',
    payload: { id: 'schedule-1', changes: { notes: 'private draft' } },
    preview: { title: 'Update schedule notes' },
  });
  assert.strictEqual(queued.status, 'awaiting_confirmation');
  assert.ok(sealedState);
  assert.ok(!sealedState.includes('private draft'), 'persistent outbox state must be sealed');
  assert.strictEqual((await outbox.get('draft-1')).payload.changes.notes, 'private draft');
  assert.strictEqual((await outbox.confirm('draft-1')).status, 'confirmed');

  const submitted = await outbox.markSubmitted('draft-1', {
    commandId: 'command-1',
    payloadHash: 'payload-hash-1',
    transportUsed: 'lan',
  });
  assert.strictEqual(submitted.status, 'submitted');
  const completed = await outbox.acknowledge('draft-1', {
    commandId: 'command-1',
    payloadHash: 'payload-hash-1',
    resultHash: 'result-hash-1',
  });
  assert.strictEqual(completed.status, 'completed');
  assert.strictEqual(completed.receipt.resultHash, 'result-hash-1');

  await assert.rejects(
    () => outbox.acknowledge('draft-1', {
      commandId: 'command-1',
      payloadHash: 'different-hash',
      resultHash: 'result-hash-2',
    }),
    error => error?.code === 'AUTHORITY_RECEIPT_CONFLICT'
  );
  assert.strictEqual((await outbox.get('draft-1')).status, 'conflict');

  let rejectedState = '';
  const rejectedOutbox = createDesktopCommandOutbox({
    store: {
      read: async () => rejectedState,
      write: async value => { rejectedState = value; },
    },
    codec,
    createId: () => 'draft-rejected',
    now: () => '2026-07-28T00:00:02.000Z',
  });
  await rejectedOutbox.append({
    type: 'student.update.v1',
    payload: { id: 'student-1', changes: { notes: 'rejected draft remains' } },
  });
  await rejectedOutbox.confirm('draft-rejected');
  await rejectedOutbox.markSubmitted('draft-rejected', {
    commandId: 'command-rejected',
    payloadHash: 'payload-hash-rejected',
    transportUsed: 'durable-relay',
  });
  const rejected = await rejectedOutbox.acknowledge('draft-rejected', {
    commandId: 'command-rejected',
    payloadHash: 'payload-hash-rejected',
    resultHash: 'result-hash-rejected',
    status: 'rejected',
    result: { error: { code: 'AUTHORITY_COMMAND_SCOPE_FORBIDDEN' } },
  });
  assert.strictEqual(rejected.status, 'conflict');
  assert.strictEqual(rejected.conflict.code, 'AUTHORITY_COMMAND_SCOPE_FORBIDDEN');
  assert.strictEqual(rejected.receipt.status, 'rejected');

  console.log('desktop command outbox tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
