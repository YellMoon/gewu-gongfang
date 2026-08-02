const { isUnrecognizedIdentity } = require('../../utils/accountExperience');

const DEFAULT_FORMAL_HOME = '/pages/index/index';
const DEFAULT_UNRECOGNIZED_HOME = '/pages/unrecognized-experience/index';

function homeForIdentity(identity, routes = {}) {
  return isUnrecognizedIdentity(identity)
    ? routes.unrecognizedHome || DEFAULT_UNRECOGNIZED_HOME
    : routes.formalHome || DEFAULT_FORMAL_HOME;
}

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

function loginResultState(response = {}) {
  if (response.success && response.data?.token && response.data?.user) {
    return {
      kind: 'authenticated',
      token: response.data.token,
      user: response.data.user,
    };
  }
  return {
    kind: 'error',
    code: String(response.code || ''),
    error: String(response.error || ''),
  };
}

module.exports = {
  homeForIdentity,
  normalizeManualPhone,
  validateManualPhone,
  loginResultState,
};
