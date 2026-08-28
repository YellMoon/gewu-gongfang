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
assert.throws(() => experience.accountExperiencePath({ account_state: 'unsupported' }, 'applicationMine'));

for (const role of ['super_admin', 'teacher', 'student']) {
  assert.strictEqual(
    experience.isFormalIdentity({ id: `${role}-account`, role, user_type: role, account_state: 'formal', token_use: 'miniapp-cloud' }),
    true,
    `${role} must remain a recognized formal identity`,
  );
}
assert.strictEqual(experience.isFormalIdentity(null), false, 'no persisted identity must not render as a formal account');
assert.strictEqual(experience.isFormalIdentity({ id: 'stale', role: 'operator', account_state: 'formal', token_use: 'miniapp-cloud' }), false, 'retired identities must fail closed into the limited account surface');
assert.strictEqual(experience.isFormalIdentity({ id: 'stale', role: 'teacher', account_state: 'formal', token_use: 'legacy-token' }), false, 'a stale token marker must not expose formal account controls');
console.log('visitor role-application boundary checks passed');
