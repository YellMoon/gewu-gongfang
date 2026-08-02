const assert = require('node:assert/strict');
const { createPrimaryHostLocalDraftExecutor } = require('./primaryHostLocalDraftExecutor');

async function run() {
  const calls = [];
  const executor = createPrimaryHostLocalDraftExecutor({
    refreshControlRecords: async () => calls.push('refresh'),
    hostAuthorityContext: async () => {
      calls.push('host-context');
      return {
        authorityId: 'authority-host-1',
        hostEpochId: 'epoch-host-1',
        actor: { userId: 'host-user', deviceId: 'host-device', role: 'super_admin' },
        lease: { id: 'host-lease-1', grantVersion: 3 },
      };
    },
    authorityExecutor: {
      execute(envelope) {
        calls.push(['execute', envelope]);
        return { receipt: { status: 'committed', projectionVersion: 7 } };
      },
    },
    projectionWorker: { wake: () => calls.push('wake') },
  });

  const committed = await executor({
    type: 'personal-asset-record.create.v1',
    payload: { record: { id: 'asset-1' } },
    commandId: 'host-local-command-1',
    idempotencyKey: 'host-local-idempotency-1',
  });
  assert.equal(committed.receipt.status, 'committed');
  assert.equal(committed.envelope.commandId, 'host-local-command-1');
  assert.equal(committed.envelope.idempotencyKey, 'host-local-idempotency-1');
  assert.deepEqual(calls.slice(0, 2), ['refresh', 'host-context']);
  assert.equal(calls[2][0], 'execute');
  assert.deepEqual(calls[2][1].actor, { userId: 'host-user', deviceId: 'host-device', role: 'super_admin' });
  assert.deepEqual(calls[2][1].lease, { id: 'host-lease-1', grantVersion: 3 });
  assert.equal(calls[2][1].authorityId, 'authority-host-1');
  assert.equal(calls[2][1].hostEpochId, 'epoch-host-1');
  assert.equal(calls[2][1].type, 'personal-asset-record.create.v1');
  assert.deepEqual(calls[2][1].payload, { record: { id: 'asset-1' } });
  assert.equal(calls[3], 'wake');

  const rejectedCalls = [];
  const rejectedExecutor = createPrimaryHostLocalDraftExecutor({
    refreshControlRecords: async () => rejectedCalls.push('refresh'),
    hostAuthorityContext: async () => ({
      authorityId: 'authority-host-1', hostEpochId: 'epoch-host-1',
      actor: { userId: 'host-user', deviceId: 'host-device', role: 'super_admin' },
      lease: { id: 'host-lease-1', grantVersion: 3 },
    }),
    authorityExecutor: { execute: () => ({ receipt: { status: 'rejected' } }) },
    projectionWorker: { wake: () => rejectedCalls.push('wake') },
  });
  const rejected = await rejectedExecutor({ type: 'personal-asset-record.create.v1', payload: {} });
  assert.equal(rejected.receipt.status, 'rejected');
  assert.deepEqual(rejectedCalls, ['refresh']);

  await assert.rejects(
    () => executor(null),
    error => error && error.code === 'PRIMARY_HOST_LOCAL_DRAFT_REQUIRED',
  );
}

run().then(() => console.log('primaryHostLocalDraftExecutor runtime tests passed'));
