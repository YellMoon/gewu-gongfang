const assert = require('assert');
const releaseMatrix = require('./release-matrix');
const {
  buildSubmitAuditPayload,
  firstCategory,
  firstPage,
  recordProductionRelease,
} = require('./miniapp-review');

const pagePayload = { page_list: ['pages/login/index', 'pages/index/index'] };
const categoryPayload = {
  category_list: [{
    first_class: '教育',
    second_class: '教育信息服务',
    first_id: 100,
    second_id: 101,
  }],
};

assert.strictEqual(firstPage(pagePayload), 'pages/index/index');
assert.deepStrictEqual(firstCategory(categoryPayload), {
  first_class: '教育',
  second_class: '教育信息服务',
  first_id: 100,
  second_id: 101,
});

assert.deepStrictEqual(buildSubmitAuditPayload({ pagePayload, categoryPayload }), {
  item_list: [{
    address: 'pages/index/index',
    tag: '教育,课程,题库',
    title: '格物工坊',
    first_class: '教育',
    second_class: '教育信息服务',
    first_id: 100,
    second_id: 101,
  }],
});

const releaseManifest = releaseMatrix.createReleaseManifest({
  version: '8.1.3',
  commit: 'a'.repeat(40),
});
releaseMatrix.recordReceipt(releaseManifest, {
  target: 'miniapp',
  version: '8.1.3',
  evidence: 'WeChat development upload succeeded',
  releaseLevel: 'development',
});

assert.throws(
  () => recordProductionRelease({ manifest: releaseManifest, releaseResult: { errcode: 86000 } }),
  /WECHAT_MINIAPP_PRODUCTION_RELEASE_FAILED: 86000/,
);
assert.strictEqual(releaseManifest.targets.miniapp.receipt.releaseLevel, 'development');

recordProductionRelease({
  manifest: releaseManifest,
  releaseResult: { errcode: 0 },
  verifiedAt: '2026-08-23T00:00:00.000Z',
});
assert.strictEqual(releaseManifest.targets.miniapp.receipt.releaseLevel, 'production');
assert.strictEqual(releaseMatrix.isReleaseComplete(releaseManifest), false, 'other release targets are pending');

console.log('miniapp review helper checks passed');
