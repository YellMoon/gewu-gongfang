'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildDefaultReviewInfo,
  validateReviewGuide,
  validateReviewInfo,
  REVIEW_DOC_PATH,
} = require('./check_miniapp_review_readiness');

const info = buildDefaultReviewInfo();
assert.ok(info.versionDesc.length > 20 && info.versionDesc.length <= 200);
assert.ok(info.testRemark.length > 20 && info.testRemark.length <= 200);
assert.strictEqual(info.orderCenterPath, '');
assert.strictEqual(info.expeditedAudit, false);
assert.strictEqual(info.privacyCollection, true);
assert.ok(info.testRemark.includes('验证手机号并登录'));
assert.ok(info.testRemark.includes('四道示例题'));
assert.ok(info.testRemark.includes('Word/PDF'));
assert.ok(info.testRemark.includes('身份申请'));
assert.ok(info.testRemark.includes('不会读取或修改正式教务数据'));
for (const removed of ['体验码', '审核体验入口', '管理员体验', 'Gateway']) {
  assert.ok(!info.versionDesc.includes(removed));
  assert.ok(!info.testRemark.includes(removed));
}
assert.deepStrictEqual(validateReviewInfo(info).errors, []);
assert.ok(fs.existsSync(REVIEW_DOC_PATH));

const doc = fs.readFileSync(REVIEW_DOC_PATH, 'utf8');
const currentVersion = require(path.join(process.cwd(), 'package.json')).version;
assert.ok(doc.includes(info.versionDesc));
assert.ok(doc.includes(info.testRemark));
assert.ok(doc.includes(currentVersion) || doc.includes('<当前版本>'));
assert.deepStrictEqual(validateReviewGuide(doc).errors, []);

const invalidInfo = { ...info, testRemark: `${info.testRemark} 体验码` };
assert.ok(validateReviewInfo(invalidInfo).errors.some(error => error.includes('removed copy')));
assert.ok(validateReviewGuide(`${doc}\n<review experience code>`).errors.some(error => error.includes('removed review-demo')));

const scriptSource = fs.readFileSync(path.join(process.cwd(), 'scripts/check_miniapp_review_readiness.js'), 'utf8');
assert.ok(!scriptSource.includes('validateReviewExperienceCode'));
assert.ok(!scriptSource.includes('process.env'));
assert.ok(!scriptSource.includes('review-experience-code-policy.json'));

console.log('miniapp review readiness checks passed');
