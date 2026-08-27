'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createQuestionAssetDeliveryRepository } = require('./questionAssetDeliveryRepository');

const BYTES = Buffer.from('question-image-bytes');
const HASH = crypto.createHash('sha256').update(BYTES).digest('hex');
const NOW = new Date('2026-08-27T00:00:00.000Z');
const EXPIRY = new Date('2026-08-27T00:15:00.000Z');

(async () => {
  const calls = [];
  const rows = [
    [{ deliveryId: 'question_asset_delivery_12345678', status: 'queued', assetId: 'question_asset_import_question_1_0', fileName: 'diagram.png', mimeType: 'image/png', expiresAt: EXPIRY }],
    [{ deliveryId: 'question_asset_delivery_12345678', status: 'leased', assetId: 'question_asset_import_question_1_0', objectId: 'obj_import_media_12345678', objectVersion: 1, expectedSha256: HASH, expectedBytes: BYTES.length, fileName: 'diagram.png', mimeType: 'image/png', expiresAt: EXPIRY, leaseExpiresAt: EXPIRY }],
    [{ deliveryId: 'question_asset_delivery_12345678', status: 'ready', assetId: 'question_asset_import_question_1_0', fileName: 'diagram.png', mimeType: 'image/png', expiresAt: EXPIRY }],
    [{ deliveryId: 'question_asset_delivery_12345678', status: 'ready', assetId: 'question_asset_import_question_1_0', fileName: 'diagram.png', mimeType: 'image/png', bytes: BYTES, expiresAt: EXPIRY }],
  ];
  const repository = createQuestionAssetDeliveryRepository({
    query: async (text, values) => { calls.push([text, values]); return { rows: rows.shift() || [] }; },
    randomId: () => '12345678', randomToken: () => 'lease-token-with-sufficient-length', now: () => NOW,
  });
  const requested = await repository.request({ tenantId: 'default', accountId: 'account-1', questionId: 'question-1', assetKey: HASH });
  assert.deepStrictEqual(requested, { deliveryId: 'question_asset_delivery_12345678', status: 'queued', assetId: 'question_asset_import_question_1_0', fileName: 'diagram.png', mimeType: 'image/png', expiresAt: EXPIRY.toISOString() });
  const leased = await repository.lease({ agentId: 'storage-agent-1' });
  assert.strictEqual(leased.objectId, 'obj_import_media_12345678');
  await repository.upload({ agentId: 'storage-agent-1', deliveryId: leased.deliveryId, leaseToken: leased.leaseToken, bytes: BYTES });
  const downloaded = await repository.download({ tenantId: 'default', accountId: 'account-1', deliveryId: leased.deliveryId });
  assert.deepStrictEqual(downloaded, { deliveryId: leased.deliveryId, fileName: 'diagram.png', mimeType: 'image/png', bytes: BYTES });
  assert.ok(calls[0][0].includes('business.question_assets') && calls[0][0].includes("question.status='published'") && calls[0][0].includes('asset.question_id=$4'), 'delivery must be bound to the requested published cloud question asset');
  assert.deepStrictEqual(calls[0][1].slice(0, 4), ['default', 'account-1', HASH, 'question-1']);
  assert.ok(calls[1][0].includes('FOR UPDATE SKIP LOCKED'), 'agent lease must be concurrency-safe');
  assert.ok(calls[2][0].includes('expected_sha256'), 'uploaded bytes must be checked against immutable metadata');
  rows.unshift([{ deliveryId: 'question_asset_delivery_12345678', status: 'queued', assetId: 'question_asset_import_question_1_0', fileName: 'diagram.png', mimeType: 'image/png', expiresAt: EXPIRY }]);
  const exportRequested = await repository.requestForPaperExport({ tenantId: 'default', accountId: 'account-1', taskId: 'paper_task_1', questionId: 'question-1', assetKey: HASH });
  assert.strictEqual(exportRequested.status, 'queued');
  assert.ok(calls[4][0].includes('business.paper_export_tasks') && calls[4][0].includes('question_snapshot_json'), 'draft media delivery must be authorized by the persisted export snapshot');
  assert.ok(!calls[4][0].includes("question.status='published'"), 'a verified draft image selected into an export task must not be rejected by the public-read status boundary');
  console.log('question asset delivery repository checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
