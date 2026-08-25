'use strict';

const assert = require('assert');
const { VISITOR_CAPABILITIES, cloudSessionUser } = require('./cloudSessionIdentityRuntime');

const visitor = cloudSessionUser({ accountId: 'account-visitor', status: 'visitor', roles: [] });
assert.deepStrictEqual(visitor, {
  id: 'account-visitor', cloud_account_id: 'account-visitor', role: 'visitor', user_type: 'visitor',
  identity_kind: 'visitor', account_state: 'visitor', token_use: 'miniapp-visitor',
  authority_id: 'cloud:account-visitor', capabilities: VISITOR_CAPABILITIES.slice(),
});
assert.deepStrictEqual(
  cloudSessionUser({ accountId: 'teacher-1', status: 'active', roles: ['teacher'] }),
  { id: 'teacher-1', cloud_account_id: 'teacher-1', role: 'teacher', user_type: 'teacher', account_state: 'formal', token_use: 'miniapp-cloud' },
);
assert.strictEqual(cloudSessionUser({ accountId: 'legacy-operator', status: 'active', roles: ['operator'] }), null, 'the unsupported role must not create a miniapp session');
assert.strictEqual(cloudSessionUser({ accountId: 'legacy-pending', status: 'pending_authorization', roles: [] }), null, 'a legacy pending account must not create a second non-formal identity');
assert.strictEqual(cloudSessionUser({ accountId: 'bad-visitor', status: 'active', roles: [] }), null, 'a no-grant account must be presented as visitor, never as active pending');

console.log('cloud miniapp session identity checks passed');
