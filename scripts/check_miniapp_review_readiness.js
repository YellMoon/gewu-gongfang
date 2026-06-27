const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const REVIEW_DOC_PATH = path.join(ROOT_DIR, 'docs', 'miniapp-review-guide.md');

function buildDefaultReviewInfo() {
  return {
    version: require(path.join(ROOT_DIR, 'package.json')).version,
    versionDesc: '修复云端接口与权限同步，完善小程序管理员/学生入口、课表查看、题库组卷导出、财务资产导入等现有功能联调。',
    testRemark: '小程序支持微信一键登录。管理员入口包含首页、课程表、学员、财务、我的等页面；学生入口仅展示本人相关课表，并支持题库选题组卷和导出。',
    orderCenterPath: '',
    expeditedAudit: false,
    privacyCollection: true,
  };
}

function validateReviewInfo(info) {
  const errors = [];
  const forbiddenCopy = ['教学工具', '学籍管理', '分班', '档案', '主机处理', '提交任务'];
  const fields = [
    ['versionDesc', info.versionDesc],
    ['testRemark', info.testRemark],
  ];

  for (const [field, value] of fields) {
    if (!value || value.trim().length < 10) errors.push(`${field} is too short`);
    if (value && value.length > 200) errors.push(`${field} exceeds WeChat 200 char limit`);
    for (const forbidden of forbiddenCopy) {
      if (value?.includes(forbidden)) errors.push(`${field} contains unsupported copy: ${forbidden}`);
    }
  }

  if (info.orderCenterPath) {
    errors.push('orderCenterPath should stay empty unless transaction/order center is implemented');
  }
  if (info.expeditedAudit !== false) errors.push('expeditedAudit should default to false');
  if (info.privacyCollection !== true) errors.push('privacyCollection should be true for WeChat login');

  return { ok: errors.length === 0, errors };
}

function main() {
  const info = buildDefaultReviewInfo();
  const validation = validateReviewInfo(info);
  if (!fs.existsSync(REVIEW_DOC_PATH)) {
    validation.errors.push(`review guide missing: ${path.relative(ROOT_DIR, REVIEW_DOC_PATH)}`);
    validation.ok = false;
  }

  if (!validation.ok) {
    console.error(JSON.stringify(validation, null, 2));
    process.exit(1);
  }

  console.log('miniapp review readiness checks passed');
  console.log(JSON.stringify(info, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  REVIEW_DOC_PATH,
  buildDefaultReviewInfo,
  validateReviewInfo,
};
