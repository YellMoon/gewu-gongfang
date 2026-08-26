'use strict';

const assert = require('assert');
const { createPaperExportMediaResolver } = require('./paperExportMediaResolver');

(async () => {
  const bytes = Buffer.from('verified-image');
  const calls = [];
  const resolver = createPaperExportMediaResolver({
    questionAssetDeliveries: {
      request: async input => { calls.push(['request', input]); return { deliveryId: 'question_asset_delivery_12345678', status: 'ready' }; },
      download: async input => { calls.push(['download', input]); return { deliveryId: input.deliveryId, fileName: 'diagram.png', mimeType: 'image/png', bytes }; },
    },
  });
  const input = { tenantId: 'default', accountId: 'account-1', questionId: 'question-1', assetKey: 'a'.repeat(64), fileName: 'diagram.png', mimeType: 'image/png' };
  assert.deepStrictEqual(await resolver(input), bytes);
  assert.deepStrictEqual(calls, [
    ['request', { tenantId: 'default', accountId: 'account-1', questionId: 'question-1', assetKey: 'a'.repeat(64) }],
    ['download', { tenantId: 'default', accountId: 'account-1', deliveryId: 'question_asset_delivery_12345678' }],
  ]);
  const pending = createPaperExportMediaResolver({
    questionAssetDeliveries: { request: async () => ({ deliveryId: 'question_asset_delivery_12345678', status: 'queued' }), download: async () => { throw new Error('unexpected'); } },
  });
  await assert.rejects(() => pending(input), /CLOUD_PAPER_EXPORT_MEDIA_PENDING/);
  console.log('paper export media resolver checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
