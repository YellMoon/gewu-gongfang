const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  buildDefaultReviewInfo,
  validateReviewExperienceCode,
  validateReviewGuide,
  validateReviewInfo,
  REVIEW_DOC_PATH,
} = require('./check_miniapp_review_readiness');

const info = buildDefaultReviewInfo();
const STRONG_TEST_FIXTURE = 'vN7$kP2@xR9!mQ4#tL8&cW5*zH3^sJ6?dF';

assert.ok(info.versionDesc.length > 20, 'review version description should explain this release');
assert.ok(info.versionDesc.length <= 200, 'review version description must fit WeChat 200 char limit');
assert.ok(info.testRemark.length > 20, 'review test remark should guide reviewers');
assert.ok(info.testRemark.length <= 200, 'review test remark must fit WeChat 200 char limit');
assert.strictEqual(info.orderCenterPath, '', 'non-transaction miniapp should leave order center path empty');
assert.strictEqual(info.expeditedAudit, false, 'audit expedited option should default to false');
assert.strictEqual(info.privacyCollection, true, 'WeChat login requires privacy collection disclosure');
assert.ok(info.testRemark.includes('<review experience code>'), 'review note must use the literal private-code placeholder');
assert.ok(info.testRemark.includes('审核体验'), 'review note should identify the permanent review entry');
assert.ok(info.testRemark.includes('管理员') && info.testRemark.includes('学生'), 'review note should explain both roles');
assert.ok(info.testRemark.includes('只读') && info.testRemark.includes('脱敏'), 'review note should explain sanitized read-only data');
assert.ok(info.testRemark.includes('沙箱') && info.testRemark.includes('Word/PDF'), 'review note should explain isolated export sandbox');

for (const forbidden of ['教学工具', '学籍管理', '分班', '档案', '主机处理', '提交任务']) {
  assert.ok(!info.versionDesc.includes(forbidden), `review desc should not mention unsupported/explanatory copy: ${forbidden}`);
  assert.ok(!info.testRemark.includes(forbidden), `review remark should not mention unsupported/explanatory copy: ${forbidden}`);
}

const validation = validateReviewInfo(info);
assert.deepStrictEqual(validation.errors, [], 'default review info should be valid');

assert.ok(fs.existsSync(REVIEW_DOC_PATH), 'miniapp review guide should exist');
const doc = fs.readFileSync(REVIEW_DOC_PATH, 'utf-8');
const currentVersion = require(path.join(process.cwd(), 'package.json')).version;
assert.ok(doc.includes(info.versionDesc), 'review guide should contain reusable version description');
assert.ok(doc.includes(info.testRemark), 'review guide should contain reusable test remark');
assert.ok(doc.includes(currentVersion) || doc.includes('<当前版本>'), 'review guide should record current version or a version placeholder');
assert.ok(doc.includes('被驳回'), 'review guide should include rejection handling');
assert.ok(doc.includes('审核通过'), 'review guide should include approval handling');
assert.ok(doc.includes('发布线上版'), 'review guide should include online release handoff');
for (const required of [
  '永久保留',
  '管理员体验',
  '学生体验',
  '脱敏',
  '只读',
  '绑定的示例学生',
  '隔离内存沙箱',
  '不会写入真实',
  '<review experience code>',
  '密码管理器',
  'Set-Clipboard',
  '不会输出',
]) {
  assert.ok(doc.includes(required), `review guide should document: ${required}`);
}
assert.deepStrictEqual(validateReviewGuide(doc).errors, [], 'review guide should satisfy the permanent review contract');

for (const weak of [
  '',
  'short',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'GewuReview2026!demo',
  'AdminStudentReview!2026FixtureValue',
  'Qwerty1234567890!Qwerty1234567890!',
  'AbcdEfghIjklMnop1234!@#$AbcdEfgh',
  'Review-Experience-Code-For-Test-123!',
  '<review experience code>',
]) {
  const result = validateReviewExperienceCode({ MINIAPP_REVIEW_EXPERIENCE_CODE: weak });
  assert.strictEqual(result.ok, false, `weak review code should fail closed: ${weak ? '<redacted>' : '<missing>'}`);
  assert.ok(!JSON.stringify(result).includes(weak) || weak === '', 'review code validation must not echo submitted values');
}
const strongValidation = validateReviewExperienceCode({ MINIAPP_REVIEW_EXPERIENCE_CODE: STRONG_TEST_FIXTURE });
assert.deepStrictEqual(strongValidation, { ok: true, errors: [] }, 'strong configured review code should pass readiness');
assert.ok(!JSON.stringify(strongValidation).includes(STRONG_TEST_FIXTURE), 'successful validation must not expose the review code');

const policyPath = path.join(process.cwd(), 'scripts', 'review-experience-code-policy.json');
assert.ok(fs.existsSync(policyPath), 'JS and Python validators should share one review-code policy file');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
assert.ok(policy.minLength >= 32, 'shared policy should require a materially long code');
assert.ok(policy.minUniqueCharacters >= 20, 'shared policy should require high character diversity');

const scriptSource = fs.readFileSync(path.join(process.cwd(), 'scripts/check_miniapp_review_readiness.js'), 'utf-8');
assert.ok(scriptSource.includes('validateReviewInfo'), 'review readiness script should validate review fields');
assert.ok(!scriptSource.includes("console.log(process.env.MINIAPP_REVIEW_EXPERIENCE_CODE"), 'readiness must never print the configured code');

console.log('miniapp review readiness checks passed');
