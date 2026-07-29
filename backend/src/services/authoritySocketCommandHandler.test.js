const assert = require('assert');
const {
  createAuthoritySocketCommandHandler,
} = require('./authoritySocketCommandHandler');

(async function main() {
  const envelope = Object.freeze({
    protocol: 'gewu.authority-command.v1',
    commandId: 'command-lan-1',
    idempotencyKey: 'key-lan-1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    actor: Object.freeze({ userId: 'user-1', deviceId: 'device-1', role: 'teacher' }),
    lease: Object.freeze({ id: 'lease-1', grantVersion: 1 }),
    type: 'schedule.update.v1',
    payload: Object.freeze({ id: 'schedule-1', changes: Object.freeze({ notes: 'LAN' }) }),
    payloadHash: 'payload-hash-1',
    createdAt: '2026-07-28T00:00:00.000Z',
  });
  const receipt = Object.freeze({
    protocol: 'gewu.authority-receipt.v1',
    commandId: envelope.commandId,
    payloadHash: envelope.payloadHash,
    status: 'committed',
    resultHash: 'result-hash-1',
    authorityId: envelope.authorityId,
    hostEpochId: envelope.hostEpochId,
    projectionVersion: 1,
    completedAt: '2026-07-28T00:00:01.000Z',
  });
  let storedReceipt = null;
  let wakeCount = 0;
  let refreshCount = 0;
  const handler = createAuthoritySocketCommandHandler({
    deviceAuth: {
      authenticate(req) {
        assert.strictEqual(req.method, 'POST');
        assert.strictEqual(req.originalUrl, '/api/authority/commands');
        assert.strictEqual(req.headers['x-gewu-device-signature'], 'signature-1');
        assert.deepStrictEqual(req.body, envelope);
        return envelope.actor;
      },
    },
    authorizeCommand: input => {
      assert.deepStrictEqual(input, envelope);
      return { scope: { kind: 'teacher' } };
    },
    inbox: {
      enqueue: input => {
        assert.deepStrictEqual(input, envelope);
        return { id: envelope.commandId, status: 'pending' };
      },
      findReceipt: ({ commandId, actor }) => {
        assert.strictEqual(commandId, envelope.commandId);
        assert.deepStrictEqual(actor, envelope.actor);
        return storedReceipt;
      },
    },
    worker: {
      async wake() {
        wakeCount += 1;
        storedReceipt = receipt;
      },
    },
    async refreshControlRecords(input) {
      assert.deepStrictEqual(input, envelope);
      refreshCount += 1;
    },
    sleep: async () => {},
    maxPolls: 2,
  });
  const response = await handler.handle({
    protocol: 'gewu.authority-socket.v1',
    type: 'command.submit',
    requestId: 'request-lan-1',
    envelope,
    auth: {
      'x-gewu-authority-user-id': envelope.actor.userId,
      'x-gewu-authority-device-id': envelope.actor.deviceId,
      'x-gewu-authority-role': envelope.actor.role,
      'x-gewu-device-signature': 'signature-1',
    },
  });
  assert.deepStrictEqual(response, {
    protocol: 'gewu.authority-socket.v1',
    type: 'command.receipt',
    requestId: 'request-lan-1',
    receipt,
  });
  assert.strictEqual(wakeCount, 1);
  assert.strictEqual(refreshCount, 1, 'each socket command must refresh the host device-control cache before authorization');

  const malformed = await handler.handle({ type: 'raw-row-sync', changes: [{ table: 'schedules' }] });
  assert.strictEqual(malformed.type, 'command.error');
  assert.strictEqual(malformed.error.code, 'AUTHORITY_SOCKET_FRAME_INVALID');
  assert.strictEqual(malformed.error.retryable, false);

  console.log('authority socket command handler tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
