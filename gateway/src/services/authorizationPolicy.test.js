const assert = require('assert');
const { effectiveCapabilities, canReviewUsers } = require('./authorizationPolicy');

const canonical = { id: 'miniapp-admin-13732250653', phone: '13732250653', user_type: 'super_admin', status: 1, login_enabled: 1, review_status: 'approved', is_super_admin_identity: 1 };
assert.strictEqual(canReviewUsers(canonical), true);
assert.strictEqual(canReviewUsers({ ...canonical, id: 'forged', is_super_admin_identity: 0 }), false);
assert.strictEqual(canReviewUsers({ ...canonical, user_type: 'admin' }), false);

assert.deepStrictEqual(effectiveCapabilities({ role: 'pending' }), []);
assert.deepStrictEqual(effectiveCapabilities({ role: 'student' }), ['question-bank:view']);
assert.deepStrictEqual(effectiveCapabilities({ role: 'teacher' }), [
  'business:teacher-scope', 'question-bank:view', 'question-bank:edit',
]);
assert.deepStrictEqual(effectiveCapabilities({ role: 'admin' }), [
  'business:all', 'question-bank:view', 'question-bank:edit',
]);
assert.ok(!effectiveCapabilities({ role: 'admin', isPrimaryHost: true, clientType: 'desktop' }).includes('users:review'));
assert.ok(!effectiveCapabilities({ role: 'super_admin', isPrimaryHost: true, clientType: 'desktop' }).includes('question-bank:delete-committed'), 'gateway never grants host-only deletion');

console.log('gateway authorization policy tests passed');
