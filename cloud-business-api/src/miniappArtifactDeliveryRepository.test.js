'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createMiniappArtifactDeliveryRepository } = require('./miniappArtifactDeliveryRepository');

const HASH = crypto.createHash('sha256').update('artifact-bytes').digest('hex');
const NOW = new Date('2026-08-23T00:00:00.000Z');
const EXPIRY = new Date('2026-08-23T00:15:00.000Z');

(async () => {
  const calls = [];
  const rows = [
    [{ deliveryId: 'delivery_12345678', status: 'queued', artifactId: 'paper_artifact_12345678', fileName: 'paper.pdf', mimeType: 'application/pdf', expectedSha256: HASH, expectedBytes: 14, expiresAt: EXPIRY }],
    [{ deliveryId: 'delivery_12345678', status: 'leased', artifactId: 'paper_artifact_12345678', objectId: 'obj_paper_12345678', objectVersion: 1, expectedSha256: HASH, expectedBytes: 14, fileName: 'paper.pdf', mimeType: 'application/pdf', expiresAt: EXPIRY, leaseExpiresAt: EXPIRY }],
    [{ deliveryId: 'delivery_12345678', status: 'ready', fileName: 'paper.pdf', mimeType: 'application/pdf', expiresAt: EXPIRY }],
    [{ deliveryId: 'delivery_12345678', status: 'ready', artifactId: 'paper_artifact_12345678', fileName: 'paper.pdf', mimeType: 'application/pdf', expiresAt: EXPIRY }],
    [{ deliveryId: 'delivery_12345678', status: 'ready', fileName: 'paper.pdf', mimeType: 'application/pdf', bytes: Buffer.from('artifact-bytes'), expiresAt: EXPIRY }],
  ];
  const repository = createMiniappArtifactDeliveryRepository({
    query: async (text, values) => { calls.push([text, values]); return { rows: rows.shift() || [] }; },
    randomId: () => '12345678', randomToken: () => 'lease-token-with-sufficient-length', now: () => NOW,
  });

  const requested = await repository.request({ tenantId: 'default', accountId: 'account-1', taskId: 'paper_task_12345678' });
  assert.deepStrictEqual(requested, { deliveryId: 'delivery_12345678', status: 'queued', artifactId: 'paper_artifact_12345678', fileName: 'paper.pdf', mimeType: 'application/pdf', expiresAt: EXPIRY.toISOString() });

  const lease = await repository.lease({ agentId: 'storage-agent-1' });
  assert.strictEqual(lease.deliveryId, 'delivery_12345678');
  assert.strictEqual(lease.objectId, 'obj_paper_12345678');
  assert.strictEqual(lease.leaseToken, 'lease-token-with-sufficient-length');

  const uploaded = await repository.upload({ agentId: 'storage-agent-1', deliveryId: lease.deliveryId, leaseToken: lease.leaseToken, bytes: Buffer.from('artifact-bytes') });
  assert.deepStrictEqual(uploaded, { deliveryId: 'delivery_12345678', status: 'ready', fileName: 'paper.pdf', mimeType: 'application/pdf', expiresAt: EXPIRY.toISOString() });

  const status = await repository.status({ tenantId: 'default', accountId: 'account-1', deliveryId: 'delivery_12345678' });
  assert.deepStrictEqual(status, { deliveryId: 'delivery_12345678', status: 'ready', artifactId: 'paper_artifact_12345678', fileName: 'paper.pdf', mimeType: 'application/pdf', expiresAt: EXPIRY.toISOString() });

  const downloaded = await repository.download({ tenantId: 'default', accountId: 'account-1', deliveryId: 'delivery_12345678' });
  assert.deepStrictEqual(downloaded, { deliveryId: 'delivery_12345678', fileName: 'paper.pdf', mimeType: 'application/pdf', bytes: Buffer.from('artifact-bytes') });
  assert.ok(calls[0][0].includes('business.paper_export_artifacts'));
  assert.ok(calls[1][0].includes('FOR UPDATE SKIP LOCKED'));
  assert.ok(calls[2][0].includes('expected_sha256'));
  assert.ok(calls[4][0].includes('artifact_bytes'));
  console.log('miniapp artifact delivery repository checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
