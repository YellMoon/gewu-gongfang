'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const REVIEW_DOC_PATH = path.join(ROOT_DIR, 'docs', 'miniapp-review-guide.md');

function buildDefaultReviewInfo() {
  return {
    version: require(path.join(ROOT_DIR, 'miniapp', 'package.json')).version,
    versionDesc: '支持已绑定微信直接登录；首次登录需授权微信手机号，新账号自动创建为访客，可预览云端题目并提交教师、学生或家庭成员身份申请。',
    testRemark: '审核员可用已绑定微信直接登录，或在首次登录时授权微信手机号。新账号以访客身份进入，只能预览云端题目并提交身份申请，不会读取或修改正式教务数据。',
    orderCenterPath: '',
    expeditedAudit: false,
    privacyCollection: true,
  };
}

function validateReviewGuide(doc) {
  const required = [
    '微信手机号',
    '已绑定微信直接登录',
    '首次登录',
    '访客',
    '自动创建',
    '不需要体验码',
    '云端题目预览',
    '家庭成员',
    '身份申请',
    '不会读取或修改正式业务数据',
    '180 天',
    '脱敏',
    'https://physicsedu.xyz/cloud-business',
    '被驳回',
    '审核通过',
    '发布线上版',
  ];
  const errors = required
    .filter(copy => !doc.includes(copy))
    .map(copy => `review guide missing required contract: ${copy}`);
  for (const removed of ['<review experience code>', 'MINIAPP_REVIEW_EXPERIENCE_CODE', '独立的“审核体验”入口']) {
    if (doc.includes(removed)) errors.push(`review guide retains removed review-demo contract: ${removed}`);
  }
  for (const retired of ['手填手机号', '前十道脱敏题目', '体验 Word/PDF 导出', '本地数据主机']) {
    if (doc.includes(retired)) errors.push(`review guide retains retired contract: ${retired}`);
  }
  return { ok: errors.length === 0, errors };
}

function validateReviewInfo(info) {
  const errors = [];
  const forbiddenCopy = ['体验码', '审核体验入口', '管理员体验', 'Gateway', '手填手机号', '前十道脱敏题目', 'Word/PDF 导出'];
  const fields = [
    ['versionDesc', info.versionDesc],
    ['testRemark', info.testRemark],
  ];

  for (const [field, value] of fields) {
    if (!value || value.trim().length < 10) errors.push(`${field} is too short`);
    if (value && value.length > 200) errors.push(`${field} exceeds WeChat 200 char limit`);
    for (const forbidden of forbiddenCopy) {
      if (value?.includes(forbidden)) errors.push(`${field} contains removed copy: ${forbidden}`);
    }
  }

  if (!info.testRemark?.includes('微信手机号')) errors.push('testRemark must explain WeChat phone authorization');
  if (!info.testRemark?.includes('不会读取或修改正式教务数据')) errors.push('testRemark must explain formal-data isolation');
  if (info.orderCenterPath) errors.push('orderCenterPath should stay empty unless transaction/order center is implemented');
  if (info.expeditedAudit !== false) errors.push('expeditedAudit should default to false');
  if (info.privacyCollection !== true) errors.push('privacyCollection should be true for verified-phone login');

  return { ok: errors.length === 0, errors };
}

function main() {
  const info = buildDefaultReviewInfo();
  const validation = validateReviewInfo(info);
  if (!fs.existsSync(REVIEW_DOC_PATH)) {
    validation.errors.push(`review guide missing: ${path.relative(ROOT_DIR, REVIEW_DOC_PATH)}`);
  } else {
    validation.errors.push(...validateReviewGuide(fs.readFileSync(REVIEW_DOC_PATH, 'utf8')).errors);
  }
  validation.ok = validation.errors.length === 0;

  if (!validation.ok) {
    console.error(JSON.stringify(validation, null, 2));
    process.exit(1);
  }

  console.log('miniapp review readiness checks passed');
  console.log(`review material version: ${info.version}`);
}

if (require.main === module) main();

module.exports = {
  REVIEW_DOC_PATH,
  buildDefaultReviewInfo,
  validateReviewGuide,
  validateReviewInfo,
};
