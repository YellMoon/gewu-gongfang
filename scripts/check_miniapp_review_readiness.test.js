const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  buildDefaultReviewInfo,
  validateReviewInfo,
  REVIEW_DOC_PATH,
} = require('./check_miniapp_review_readiness');

const info = buildDefaultReviewInfo();

assert.ok(info.versionDesc.length > 20, 'review version description should explain this release');
assert.ok(info.versionDesc.length <= 200, 'review version description must fit WeChat 200 char limit');
assert.ok(info.testRemark.length > 20, 'review test remark should guide reviewers');
assert.ok(info.testRemark.length <= 200, 'review test remark must fit WeChat 200 char limit');
assert.strictEqual(info.orderCenterPath, '', 'non-transaction miniapp should leave order center path empty');
assert.strictEqual(info.expeditedAudit, false, 'audit expedited option should default to false');
assert.strictEqual(info.privacyCollection, true, 'WeChat login requires privacy collection disclosure');

for (const forbidden of ['教学工具', '学籍管理', '分班', '档案', '主机处理', '提交任务']) {
  assert.ok(!info.versionDesc.includes(forbidden), `review desc should not mention unsupported/explanatory copy: ${forbidden}`);
  assert.ok(!info.testRemark.includes(forbidden), `review remark should not mention unsupported/explanatory copy: ${forbidden}`);
}

const validation = validateReviewInfo(info);
assert.deepStrictEqual(validation.errors, [], 'default review info should be valid');

assert.ok(fs.existsSync(REVIEW_DOC_PATH), 'miniapp review guide should exist');
const doc = fs.readFileSync(REVIEW_DOC_PATH, 'utf-8');
assert.ok(doc.includes(info.versionDesc), 'review guide should contain reusable version description');
assert.ok(doc.includes(info.testRemark), 'review guide should contain reusable test remark');
assert.ok(doc.includes('5.0.34') || doc.includes('<当前版本>'), 'review guide should record current version or a version placeholder');
assert.ok(doc.includes('被驳回'), 'review guide should include rejection handling');
assert.ok(doc.includes('审核通过'), 'review guide should include approval handling');
assert.ok(doc.includes('发布线上版'), 'review guide should include online release handoff');

const scriptSource = fs.readFileSync(path.join(process.cwd(), 'scripts/check_miniapp_review_readiness.js'), 'utf-8');
assert.ok(scriptSource.includes('validateReviewInfo'), 'review readiness script should validate review fields');

console.log('miniapp review readiness checks passed');
