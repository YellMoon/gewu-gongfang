const { normalizeManualPhone, validateManualPhone } = require('../../utils/manualPhone');

const DEFAULT_FORMAL_HOME = '/pages/index/index';

function homeForIdentity(_identity, routes = {}) {
  return routes.formalHome || DEFAULT_FORMAL_HOME;
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
