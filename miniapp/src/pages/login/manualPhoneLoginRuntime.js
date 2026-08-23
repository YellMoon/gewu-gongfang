const { isUnrecognizedIdentity } = require('../../utils/accountExperience');
const { normalizeManualPhone, validateManualPhone } = require('../../utils/manualPhone');

const DEFAULT_FORMAL_HOME = '/pages/index/index';
const DEFAULT_UNRECOGNIZED_HOME = '/pages/unrecognized-experience/index';

function homeForIdentity(identity, routes = {}) {
  return isUnrecognizedIdentity(identity)
    ? routes.unrecognizedHome || DEFAULT_UNRECOGNIZED_HOME
    : routes.formalHome || DEFAULT_FORMAL_HOME;
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
