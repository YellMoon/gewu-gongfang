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

function sourceDescriptor(task) {
  if (task.kind === 'question_import_source') {
    return {
      objectId: task.objectId, objectVersion: task.objectVersion, sha256: task.expectedSha256, bytes: task.expectedBytes,
      sourceType: task.sourceType, sourceFileName: task.sourceFileName,
    };
  }
  return task.source;
}

function sourceCacheKey(source) {
  return [source.objectId, source.objectVersion, source.sha256, source.bytes, source.sourceType, source.sourceFileName].join(':');
}

function parsedMediaBytes(parsed) {
  if (!parsed || !Array.isArray(parsed.mediaBytes)) return null;
  let total = 0;
  for (const assets of parsed.mediaBytes) {
    if (!Array.isArray(assets)) return null;
    for (const bytes of assets) {
      if (!Buffer.isBuffer(bytes)) return null;
      total += bytes.length;
      if (!Number.isSafeInteger(total)) return null;
    }
  }
  return total;
}

function createStorageWorker({ client, objectStore, agentPrivateKey, questionImportParser } = {}) {
  if (!client || typeof client.lease !== 'function' || typeof client.download !== 'function' || typeof client.complete !== 'function'
    || typeof client.reportSourceCandidates !== 'function' || !objectStore || typeof objectStore.putVerified !== 'function' || typeof objectStore.readVerified !== 'function'
    || !questionImportParser || typeof questionImportParser.parse !== 'function' || typeof agentPrivateKey !== 'string' || !agentPrivateKey) throw failure('STORAGE_WORKER_CONFIG_INVALID');
  const parsedSourceCache = new Map();
  const maxCachedSourceMediaBytes = 128 * 1024 * 1024;

  async function parseImportSource(source, bytes = null) {
    const key = sourceCacheKey(source);
    const cached = parsedSourceCache.get(key);
    if (cached) return cached;
    const sourceBytes = bytes || await objectStore.readVerified({
      objectId: source.objectId, version: source.objectVersion, sha256: source.sha256, bytes: source.bytes,
    });
    const parsed = await questionImportParser.parse({
      sourceType: source.sourceType, sourceFileName: source.sourceFileName, bytes: sourceBytes,
    });
    const mediaBytes = parsedMediaBytes(parsed);
    if (mediaBytes !== null && mediaBytes <= maxCachedSourceMediaBytes) {
      parsedSourceCache.clear();
      parsedSourceCache.set(key, parsed);
    }
    return parsed;
  }

  return Object.freeze({
    async runOnce() {
      const task = await client.lease();
      if (task === null) {
        if (typeof client.leaseArtifactDelivery === 'function' && typeof client.uploadArtifactDelivery === 'function') {
          const delivery = await client.leaseArtifactDelivery();
          if (delivery !== null) {
            const bytes = await objectStore.readVerified({
              objectId: delivery.objectId, version: delivery.objectVersion, sha256: delivery.expectedSha256, bytes: delivery.expectedBytes,
            });
            assertExpected(delivery, bytes);
            await client.uploadArtifactDelivery({ deliveryId: delivery.deliveryId, leaseToken: delivery.leaseToken, bytes });
            return Object.freeze({ state: 'delivery_uploaded', deliveryId: delivery.deliveryId });
          }
        }
        if (typeof client.leaseQuestionAssetDelivery !== 'function' || typeof client.uploadQuestionAssetDelivery !== 'function') return Object.freeze({ state: 'idle' });
        const delivery = await client.leaseQuestionAssetDelivery();
        if (delivery === null) return Object.freeze({ state: 'idle' });
        const bytes = await objectStore.readVerified({
          objectId: delivery.objectId, version: delivery.objectVersion, sha256: delivery.expectedSha256, bytes: delivery.expectedBytes,
        });
        assertExpected(delivery, bytes);
        await client.uploadQuestionAssetDelivery({ deliveryId: delivery.deliveryId, leaseToken: delivery.leaseToken, bytes });
        return Object.freeze({ state: 'question_asset_delivery_uploaded', deliveryId: delivery.deliveryId });
      }
      if (task.kind === 'question_import_media') {
        const parsed = await parseImportSource(sourceDescriptor(task));
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
        const parsed = await parseImportSource(sourceDescriptor(task), bytes);
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
