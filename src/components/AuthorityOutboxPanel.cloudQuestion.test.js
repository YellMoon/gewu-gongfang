'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require('./authorityDraftPresentation.test');
require('./AuthorityOutboxPanel.confirmation.test');
const panel = fs.readFileSync('src/components/AuthorityOutboxPanel.tsx', 'utf8');
assert(!panel.includes('{item.type}'), 'review must show user data, not protocol identifiers');
assert.match(panel, /presentation\.details\.map/);
assert.match(panel, /role="listitem"/, 'pending changes remain readable stacked rows');
const loaded = { exports: {} }, stored = new Map();
global.localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
const reads = [], uploads = [];
const compiled = ts.transpileModule(fs.readFileSync('src/services/desktopQuestionAssetRelay.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('require', 'module', 'exports', compiled)(name => {
  if (name === './questionAssetStore') return { assetKeyFromRef: ref => ref.replace('question-asset://', ''), getQuestionAssetDataUrl: async () => { throw Error('must not upload while polling'); } };
  if (name === './desktopQuestionImportClient.mjs') return { createDesktopQuestionImportClient: () => ({ readAssetRelay: async id => { reads.push(id); return { state: 'verified' }; }, createAssetRelay: async input => uploads.push(input) }) };
  throw Error(name);
}, loaded, loaded.exports);
(async () => {
  const asset = loaded.exports;
  const item = { id: 'draft', type: 'question.create.v1', status: 'completed', receipt: { status: 'committed', result: { id: 'question' } }, payload: { record: { id: 'question', stem: '<img src="question-asset://image" />' } } };
  assert.equal(asset.hasPendingQuestionAssetVerification(item), true);
  stored.set('gewu.question-asset-relay.v1:question:image', JSON.stringify({ taskId: 'relay', status: 'queued' }));
  await asset.refreshQuestionAssetVerification([item]);
  assert.deepEqual(reads, ['relay']); assert.equal(uploads.length, 0);
  assert.equal(asset.hasPendingQuestionAssetVerification(item), false, 'only a verified remote asset receipt clears pending media');
  assert.equal(await asset.relayQuestionAssetsAfterReceipt(item, { status: 'rejected' }), 0, 'rejected text commands cannot relay media');
  console.log('question asset pending-state and receipt-gated relay checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
