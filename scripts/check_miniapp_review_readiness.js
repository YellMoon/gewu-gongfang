const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const REVIEW_DOC_PATH = path.join(ROOT_DIR, 'docs', 'miniapp-review-guide.md');
const REVIEW_CODE_ENV = 'MINIAPP_REVIEW_EXPERIENCE_CODE';
const REVIEW_CODE_PLACEHOLDER = '<review experience code>';
const REVIEW_CODE_POLICY = require('./review-experience-code-policy.json');

function buildDefaultReviewInfo() {
  return {
    version: require(path.join(ROOT_DIR, 'package.json')).version,
    versionDesc: '新增永久审核体验入口；管理员和学生角色仅浏览脱敏示例数据，并可在隔离内存沙箱体验示例题组卷及 Word/PDF 导出。',
    testRemark: `点击登录页“审核体验”，输入体验码 ${REVIEW_CODE_PLACEHOLDER}，选择管理员或学生。管理员浏览脱敏只读示例；学生仅查看绑定的示例学生。组卷与 Word/PDF 导出仅在隔离内存沙箱完成，不会写入真实业务数据。`,
    orderCenterPath: '',
    expeditedAudit: false,
    privacyCollection: true,
  };
}

function validateReviewExperienceCode(env = process.env) {
  const raw = String(env[REVIEW_CODE_ENV] || '');
  const value = raw.trim();
  const lower = value.toLowerCase();
  const repeatedCharacter = new RegExp(`(.)\\1{${REVIEW_CODE_POLICY.maxRepeatedCharacterRun},}`);
  const hasRepeatedSubstring = (() => {
    const minimum = REVIEW_CODE_POLICY.minRepeatedSubstringLength;
    for (let size = minimum; size <= Math.floor(value.length / 2); size += 1) {
      for (let start = 0; start + size <= value.length; start += 1) {
        const candidate = value.slice(start, start + size);
        if (value.indexOf(candidate, start + size) >= 0) return true;
      }
    }
    return false;
  })();
  const hasSequence = REVIEW_CODE_POLICY.sequenceSeeds.some(seed => {
    const candidates = [seed, [...seed].reverse().join('')];
    return candidates.some(sequence => {
      for (let index = 0; index + REVIEW_CODE_POLICY.sequenceLength <= sequence.length; index += 1) {
        if (lower.includes(sequence.slice(index, index + REVIEW_CODE_POLICY.sequenceLength))) return true;
      }
      return false;
    });
  });
  const strong = raw === value
    && value.length >= REVIEW_CODE_POLICY.minLength
    && value.length <= REVIEW_CODE_POLICY.maxLength
    && /^[\x21-\x7e]+$/.test(value)
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value)
    && /[^A-Za-z0-9]/.test(value)
    && new Set(value).size >= REVIEW_CODE_POLICY.minUniqueCharacters
    && !REVIEW_CODE_POLICY.forbiddenTerms.some(term => lower.includes(term))
    && !/(?:19|20)\d{2}/.test(value)
    && !/\d{1,4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?/.test(value)
    && !repeatedCharacter.test(value)
    && !hasRepeatedSubstring
    && !hasSequence
    && value !== REVIEW_CODE_PLACEHOLDER;
  return strong
    ? { ok: true, errors: [] }
    : { ok: false, errors: [`${REVIEW_CODE_ENV} is missing or weak`] };
}

function validateReviewGuide(doc) {
  const required = [
    '永久保留',
    '管理员体验',
    '学生体验',
    '脱敏',
    '只读',
    '绑定的示例学生',
    '隔离内存沙箱',
    '不会写入真实',
    REVIEW_CODE_PLACEHOLDER,
    '密码管理器',
    'Set-Clipboard',
    '不会输出',
  ];
  const errors = required.filter(copy => !doc.includes(copy)).map(copy => `review guide missing required contract: ${copy}`);
  return { ok: errors.length === 0, errors };
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
  } else {
    const guideValidation = validateReviewGuide(fs.readFileSync(REVIEW_DOC_PATH, 'utf8'));
    validation.errors.push(...guideValidation.errors);
  }
  const codeValidation = validateReviewExperienceCode(process.env);
  validation.errors.push(...codeValidation.errors);
  validation.ok = validation.errors.length === 0;

  if (!validation.ok) {
    console.error(JSON.stringify(validation, null, 2));
    process.exit(1);
  }

  console.log('miniapp review readiness checks passed');
  console.log(`review material version: ${info.version}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  REVIEW_DOC_PATH,
  REVIEW_CODE_ENV,
  REVIEW_CODE_PLACEHOLDER,
  buildDefaultReviewInfo,
  validateReviewExperienceCode,
  validateReviewGuide,
  validateReviewInfo,
};
