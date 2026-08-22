'use strict';

const crypto = require('crypto');
const { openForAgent } = require('../../shared/encryptedNasRelay');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function descriptorFor(task) {
  return { objectId: task.objectId, version: task.objectVersion, sha256: task.expectedSha256, bytes: task.expectedBytes };
}

function assertExpected(task, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== task.expectedBytes
    || crypto.createHash('sha256').update(bytes).digest('hex') !== task.expectedSha256) throw failure('STORAGE_WORKER_BYTES_MISMATCH');
}

function createStorageWorker({ client, objectStore, agentPrivateKey, questionImportParser } = {}) {
  if (!client || typeof client.lease !== 'function' || typeof client.download !== 'function' || typeof client.complete !== 'function'
    || typeof client.reportSourceCandidates !== 'function' || !objectStore || typeof objectStore.putVerified !== 'function' || typeof objectStore.readVerified !== 'function'
    || !questionImportParser || typeof questionImportParser.parse !== 'function' || typeof agentPrivateKey !== 'string' || !agentPrivateKey) throw failure('STORAGE_WORKER_CONFIG_INVALID');
  return Object.freeze({
    async runOnce() {
      const task = await client.lease();
      if (task === null) return Object.freeze({ state: 'idle' });
      if (task.kind === 'question_import_media') {
        const sourceBytes = await objectStore.readVerified({
          objectId: task.source.objectId, version: task.source.objectVersion, sha256: task.source.sha256, bytes: task.source.bytes,
        });
        const parsed = await questionImportParser.parse({
          sourceType: task.source.sourceType, sourceFileName: task.source.sourceFileName, bytes: sourceBytes,
        });
        const bytes = parsed?.mediaBytes?.[task.itemIndex]?.[task.assetIndex];
        assertExpected(task, bytes);
        await objectStore.putVerified(descriptorFor(task), bytes);
        await client.complete({
          taskId: task.taskId, leaseToken: task.leaseToken, observedSha256: task.expectedSha256, observedBytes: task.expectedBytes,
        });
        return Object.freeze({ state: 'verified', taskId: task.taskId });
      }
      const relay = await client.download(task);
      const bytes = openForAgent({
        agentPrivateKey,
        binding: `${task.taskId}:${task.objectId}:${task.objectVersion}`,
        envelope: relay.envelope,
        ciphertext: relay.ciphertext,
      });
      assertExpected(task, bytes);
      await objectStore.putVerified(descriptorFor(task), bytes);
      if (task.kind === 'question_import_source') {
        const parsed = await questionImportParser.parse({ sourceType: task.sourceType, sourceFileName: task.sourceFileName, bytes });
        await client.reportSourceCandidates({
          taskId: task.importTaskId, leaseToken: task.leaseToken, observedSha256: task.expectedSha256, observedBytes: task.expectedBytes,
          candidates: parsed.candidates,
        });
        return Object.freeze({ state: 'candidates_ready', taskId: task.taskId, importTaskId: task.importTaskId });
      }
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
