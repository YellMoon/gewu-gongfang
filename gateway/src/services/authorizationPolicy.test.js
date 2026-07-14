const assert = require('assert');
const { effectiveCapabilities, canReviewUsers, roleForUser } = require('./authorizationPolicy');

const canonical = { id: 'miniapp-admin-13732250653', phone: '13732250653', user_type: 'super_admin', status: 1, login_enabled: 1, review_status: 'approved', is_super_admin_identity: 1 };
assert.strictEqual(canReviewUsers(canonical), true);
assert.strictEqual(canReviewUsers({ ...canonical, id: 'forged', is_super_admin_identity: 0 }), false);
assert.strictEqual(canReviewUsers({ ...canonical, user_type: 'admin' }), false);

assert.deepStrictEqual(effectiveCapabilities({ role: 'pending' }), []);
for (const role of ['admin', 'teacher', 'student']) {
  assert.strictEqual(roleForUser({ user_type: role, review_status: 'pending', status: 1, login_enabled: 1 }), 'pending');
  assert.deepStrictEqual(effectiveCapabilities({ role, reviewStatus: 'pending', status: 1, loginEnabled: 1 }), [], `${role} pending review has no capabilities`);
  assert.deepStrictEqual(effectiveCapabilities({ role, reviewStatus: 'approved', status: 0, loginEnabled: 1 }), [], `${role} inactive has no capabilities`);
  assert.deepStrictEqual(effectiveCapabilities({ role, reviewStatus: 'approved', status: 1, loginEnabled: 0 }), [], `${role} login-disabled has no capabilities`);
}
const active = { reviewStatus: 'approved', status: 1, loginEnabled: 1 };
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'student' }), ['question-bank:view']);
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'teacher' }), [
  'business:teacher-scope', 'question-bank:view', 'question-bank:edit',
]);
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'admin' }), [
  'business:all', 'question-bank:view', 'question-bank:edit',
]);
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'admin', isReviewDemo: true, readOnly: true }), [
  'review-demo:read', 'review-demo:admin', 'question-bank:view', 'review-demo:paper-export',
]);
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'student', isReviewDemo: true, readOnly: true }), [
  'review-demo:read', 'review-demo:student', 'question-bank:view', 'review-demo:paper-export',
]);
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'admin', isReviewDemo: true, readOnly: false }), []);
assert.ok(!effectiveCapabilities({ ...active, role: 'admin', isPrimaryHost: true, clientType: 'desktop' }).includes('users:review'));
assert.ok(!effectiveCapabilities({ ...active, role: 'super_admin', isPrimaryHost: true, clientType: 'desktop' }).includes('question-bank:delete-committed'), 'gateway never grants host-only deletion');

console.log('gateway authorization policy tests passed');
