'use strict';

function normalizeManualPhone(value = '') {
  return String(value)
    .trim()
    .replace(/^\+?86/, '')
    .replace(/\D/g, '')
    .slice(0, 11);
}

function validateManualPhone(value = '') {
  return /^1[3-9]\d{9}$/.test(normalizeManualPhone(value))
    ? ''
    : '\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u4e2d\u56fd\u5927\u9646\u624b\u673a\u53f7';
}

module.exports = { normalizeManualPhone, validateManualPhone };
