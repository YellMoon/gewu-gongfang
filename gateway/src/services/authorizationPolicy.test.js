const assert = require('assert');
const { effectiveCapabilities, canReviewUsers, roleForUser } = require('./authorizationPolicy');

const canonical = { id: 'miniapp-admin-13732250653', phone: '13732250653', user_type: 'super_admin', status: 1, login_enabled: 1, review_status: 'approved', is_super_admin_identity: 1 };
assert.strictEqual(canReviewUsers(canonical), true);
assert.strictEqual(canReviewUsers({ ...canonical, id: 'forged', is_super_admin_identity: 0 }), false);
assert.strictEqual(canReviewUsers({ ...canonical, user_type: 'admin' }), false);

assert.deepStrictEqual(effectiveCapabilities({ role: 'pending' }), []);
for (const role of ['teacher', 'student']) {
  assert.strictEqual(roleForUser({ user_type: role, review_status: 'pending', status: 1, login_enabled: 1 }), 'pending');
  assert.deepStrictEqual(effectiveCapabilities({ role, reviewStatus: 'pending', status: 1, loginEnabled: 1 }), [], `${role} pending review has no capabilities`);
  assert.deepStrictEqual(effectiveCapabilities({ role, reviewStatus: 'approved', status: 0, loginEnabled: 1 }), [], `${role} inactive has no capabilities`);
  assert.deepStrictEqual(effectiveCapabilities({ role, reviewStatus: 'approved', status: 1, loginEnabled: 0 }), [], `${role} login-disabled has no capabilities`);
}
const active = { reviewStatus: 'approved', status: 1, loginEnabled: 1 };
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'student', studentId: 'student-1' }), ['question-bank:view']);
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'teacher', teacherId: 'teacher-1' }), [
  'business:teacher-scope', 'question-bank:view', 'question-bank:edit',
]);
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'student', studentId: null }), [], 'an approved miniapp account may be unbound and must receive no raw business capabilities');
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'teacher', teacherId: null }), [], 'an approved teacher role without a local subject must fail closed');
assert.strictEqual(roleForUser({ ...active, user_type: 'admin' }), 'pending');
assert.deepStrictEqual(effectiveCapabilities({ ...active, role: 'admin' }), [], 'retired ordinary-admin identities must never receive gateway capabilities');
assert.ok(!effectiveCapabilities({ ...active, role: 'super_admin', isPrimaryHost: true, clientType: 'desktop' }).includes('question-bank:delete-committed'), 'gateway never grants host-only deletion');

console.log('gateway authorization policy tests passed');
