'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createStorageWorker } = require('./worker');

(async () => {
  const bytes = Buffer.from('artifact-bytes');
  const expectedSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const events = [];
  const worker = createStorageWorker({
    agentPrivateKey: 'unused-by-delivery-branch',
    questionImportParser: { parse: async () => { throw new Error('not used'); } },
    objectStore: {
      putVerified: async () => { throw new Error('not used'); },
      readVerified: async descriptor => { events.push(['read', descriptor]); return Buffer.from(bytes); },
    },
    client: {
      lease: async () => null,
      download: async () => { throw new Error('not used'); },
      complete: async () => { throw new Error('not used'); },
      reportSourceCandidates: async () => { throw new Error('not used'); },
      leaseArtifactDelivery: async () => ({ deliveryId: 'delivery_12345678', objectId: 'obj_paper_12345678', objectVersion: 1, expectedSha256, expectedBytes: bytes.length, mimeType: 'application/pdf', leaseToken: 'lease-token-with-sufficient-length', leaseExpiresAt: '2026-08-23T00:15:00.000Z' }),
      uploadArtifactDelivery: async input => { events.push(['upload', input]); return { deliveryId: input.deliveryId, status: 'ready' }; },
    },
  });
  assert.deepStrictEqual(await worker.runOnce(), { state: 'delivery_uploaded', deliveryId: 'delivery_12345678' });
  assert.deepStrictEqual(events, [
    ['read', { objectId: 'obj_paper_12345678', version: 1, sha256: expectedSha256, bytes: bytes.length }],
    ['upload', { deliveryId: 'delivery_12345678', leaseToken: 'lease-token-with-sufficient-length', bytes }],
  ]);
  console.log('storage artifact delivery worker checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
