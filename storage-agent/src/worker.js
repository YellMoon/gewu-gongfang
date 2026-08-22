'use strict';

const { openForAgent } = require('../../shared/encryptedNasRelay');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function createStorageWorker({ client, objectStore, agentPrivateKey } = {}) {
  if (!client || typeof client.lease !== 'function' || typeof client.download !== 'function' || typeof client.complete !== 'function'
    || !objectStore || typeof objectStore.putVerified !== 'function' || typeof agentPrivateKey !== 'string' || !agentPrivateKey) throw failure('STORAGE_WORKER_CONFIG_INVALID');
  return Object.freeze({
    async runOnce() {
      const task = await client.lease();
      if (task === null) return Object.freeze({ state: 'idle' });
      const relay = await client.download(task);
      const bytes = openForAgent({
        agentPrivateKey,
        binding: `${task.taskId}:${task.objectId}:${task.objectVersion}`,
        envelope: relay.envelope,
        ciphertext: relay.ciphertext,
      });
      await objectStore.putVerified({
        objectId: task.objectId,
        version: task.objectVersion,
        sha256: task.expectedSha256,
        bytes: task.expectedBytes,
      }, bytes);
      await client.complete({
        taskId: task.taskId,
        leaseToken: task.leaseToken,
        observedSha256: task.expectedSha256,
        observedBytes: task.expectedBytes,
      });
      return Object.freeze({ state: 'verified', taskId: task.taskId });
    },
  });
}

module.exports = Object.freeze({ createStorageWorker });
