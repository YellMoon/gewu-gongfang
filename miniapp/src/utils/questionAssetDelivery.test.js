const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadQuestionAsset } = require('./questionAssetDelivery');

async function scenario(options = {}) {
  let elapsed = 0;
  let active = true;
  const calls = [];
  const delivery = status => ({ success: true, data: { delivery: { deliveryId: 'question_asset_delivery_12345678', status } } });
  const api = {
    requestQuestionAssetDelivery: async (...args) => { calls.push(['request', ...args]); return delivery(options.initial || 'queued'); },
    readQuestionAssetDelivery: async (...args) => {
      calls.push(['read', ...args]);
      if (options.readError) throw new Error('network');
      if (options.wrongId) return { success: true, data: { delivery: { deliveryId: 'other', status: 'ready' } } };
      return delivery(elapsed >= (options.readyAfter ?? 40000) ? 'ready' : 'leased');
    },
    downloadQuestionAssetDelivery: async (...args) => {
      calls.push(['download', ...args]);
      if (options.cancelDownload) active = false;
      return { success: true, data: { tempFilePath: 'wxfile://diagram.png' } };
    },
  };
  const result = await loadQuestionAsset({
    api, token: 'test-session', questionId: 'question-1', assetKey: 'a'.repeat(64),
    isActive: () => active, now: () => elapsed,
    sleep: async ms => { elapsed += ms; if (options.cancel) active = false; },
  });
  return { result, calls, elapsed };
}

(async () => {
  const slow = await scenario();
  assert.equal(slow.result, 'wxfile://diagram.png', 'NAS media ready after 40 seconds must still be downloaded');
  assert.equal(slow.calls.filter(call => call[0] === 'request').length, 1, 'poll the original delivery; never create replacements');
  assert.equal(slow.calls.filter(call => call[0] === 'download').length, 1);
  assert(slow.elapsed >= 40000 && slow.elapsed < 120000);
  for (const call of slow.calls.filter(call => call[0] === 'read')) assert.equal(call[2], 'question_asset_delivery_12345678');
  const ready = await scenario({ initial: 'ready' });
  assert.equal(ready.elapsed, 0);
  assert.equal(ready.result, 'wxfile://diagram.png');
  for (const options of [{ initial: 'failed' }, { wrongId: true }, { readError: true }, { cancel: true }, { initial: 'ready', cancelDownload: true }]) {
    const result = await scenario(options);
    assert.equal(result.result, null);
    if (!options.cancelDownload) assert(!result.calls.some(call => call[0] === 'download'));
  }
  const timeout = await scenario({ readyAfter: Infinity });
  assert.equal(timeout.result, null);
  assert(timeout.elapsed <= 120000 && timeout.calls.length < 85, 'wait must be bounded');
  for (const page of ['question-bank', 'question-paper']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'pages', page, 'index.tsx'), 'utf8');
    assert(source.includes('await loadQuestionAsset({'), `${page} must use the same tested delivery lifecycle`);
    assert(!source.includes('await miniappCloudBusinessApi.readQuestionAssetDelivery('), 'remove the old short-poll implementation');
    assert(source.includes('setAssetPaths(current => ({ ...current, [assetKey]: tempFilePath }))'), 'show each ready image immediately, not after the slowest image');
  }
  console.log('questionAssetDelivery tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
