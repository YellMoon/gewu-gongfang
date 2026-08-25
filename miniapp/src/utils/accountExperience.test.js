'use strict';

const assert = require('assert');
const experience = require('./accountExperience');

const identity = {
  role: 'visitor',
  user_type: 'visitor',
  identity_kind: 'visitor',
  account_state: 'visitor',
  token_use: 'miniapp-visitor',
  authority_id: 'cloud:account-1',
  capabilities: [...experience.VISITOR_CAPABILITIES],
};
assert.strictEqual(experience.isVisitorIdentity(identity), true);
assert.deepStrictEqual(experience.accountCapabilities(identity), experience.VISITOR_CAPABILITIES);
assert.strictEqual(experience.accountExperiencePath(identity, 'applicationMine'), '/api/miniapp/role-applications/me');
assert.strictEqual(experience.accountExperiencePath(identity, 'applicationSubmit'), '/api/miniapp/role-applications');
assert.throws(() => experience.accountExperiencePath(identity, 'artifact', 'artifact-1'));
assert.throws(() => experience.accountExperiencePath({ account_state: 'unrecognized' }, 'applicationMine'));
console.log('visitor role-application boundary checks passed');
