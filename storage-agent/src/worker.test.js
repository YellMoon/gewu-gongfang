'use strict';

const assert = require('assert');
const crypto = require('crypto');

const { createStorageWorker } = require('./worker');
const { sealForAgent } = require('../../shared/encryptedNasRelay');

async function main() {
  const events = [];
  const pair = crypto.generateKeyPairSync('x25519');
  const agentPublicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const agentPrivateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
  const plaintext = Buffer.from('media');
  const expectedSha256 = crypto.createHash('sha256').update(plaintext).digest('hex');
  const task = { taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1, expectedSha256, expectedBytes: plaintext.length, leaseToken: 'lease-token-test-value' };
  const relay = sealForAgent({ agentPublicKey, binding: 'task_12345678:obj_1:1', plaintext });
  const leases = [null, task];
  const worker = createStorageWorker({
    agentPrivateKey,
    objectStore: {
      async putVerified(descriptor, bytes) {
        events.push('putVerified');
        assert.deepStrictEqual(descriptor, { objectId: 'obj_1', version: 1, sha256: expectedSha256, bytes: plaintext.length });
        assert.deepStrictEqual(bytes, plaintext);
      },
    },
    client: {
      async lease() {
        events.push('lease');
        return leases.shift();
      },
      async download(input) {
        events.push('download');
        assert.strictEqual(input, task);
        return relay;
      },
      async complete(input) {
        events.push('complete');
        assert.deepStrictEqual(input, { taskId: task.taskId, leaseToken: task.leaseToken, observedSha256: expectedSha256, observedBytes: plaintext.length });
        return { taskId: task.taskId, state: 'verified' };
      },
    },
  });

  assert.deepStrictEqual(await worker.runOnce(), { state: 'idle' });
  assert.deepStrictEqual(await worker.runOnce(), { state: 'verified', taskId: 'task_12345678' });
  assert.deepStrictEqual(events, ['lease', 'lease', 'download', 'putVerified', 'complete']);

  const rejectedEvents = [];
  const tamperedWorker = createStorageWorker({
    agentPrivateKey,
    objectStore: { async putVerified() { rejectedEvents.push('putVerified'); } },
    client: {
      async lease() { rejectedEvents.push('lease'); return task; },
      async download() { rejectedEvents.push('download'); return { ...relay, ciphertext: Buffer.concat([relay.ciphertext, Buffer.from([0])]) }; },
      async complete() { rejectedEvents.push('complete'); },
    },
  });
  await assert.rejects(() => tamperedWorker.runOnce(), /RELAY_ENVELOPE_AUTH_FAILED/);
  assert.deepStrictEqual(rejectedEvents, ['lease', 'download'], 'a rejected relay must not write NAS bytes or submit a receipt');
  assert.throws(() => createStorageWorker({ client: {} }), /STORAGE_WORKER_CONFIG_INVALID/);
}

main().then(() => console.log('storage agent worker checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
