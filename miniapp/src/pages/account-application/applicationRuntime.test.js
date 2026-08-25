'use strict';

const assert = require('assert');
const {
  APPLICATION_STATES,
  buildRoleApplicationRequest,
  copyForApplicationState,
  createApplicationOperationLock,
} = require('./applicationRuntime');

for (const state of [
  'loading', 'not_submitted', 'invalid', 'submitting', 'submitted',
  'rejected', 'approved',
  'offline', 'network_error',
]) {
  assert.ok(APPLICATION_STATES.includes(state));
  const copy = copyForApplicationState(state);
  assert.ok(copy.title && copy.description, `${state} needs truthful user-facing copy`);
}

assert.deepStrictEqual(buildRoleApplicationRequest({
  requestedIdentity: 'student', profileMode: 'existing',
  bindingHint: ' student-profile-1 ',
}), {
  requestedIdentity: 'student', profileMode: 'existing',
  bindingHint: 'student-profile-1',
});
assert.deepStrictEqual(buildRoleApplicationRequest({
  requestedIdentity: 'family_member', profileMode: 'existing', bindingHint: 'student-profile-1',
}), {
  requestedIdentity: 'family_member', profileMode: 'existing', bindingHint: 'student-profile-1',
});
assert.throws(
  () => buildRoleApplicationRequest({ requestedIdentity: 'admin', profileMode: 'existing', bindingHint: 'profile-1' }),
  /teacher, student, or family_member/,
);
assert.throws(
  () => buildRoleApplicationRequest({ requestedIdentity: 'teacher', profileMode: 'create', bindingHint: '' }),
  /existing/,
);
assert.throws(
  () => buildRoleApplicationRequest({ requestedIdentity: 'student', profileMode: 'existing', bindingHint: 'x'.repeat(129) }),
  /128/,
);

const lock = createApplicationOperationLock();
assert.strictEqual(lock.tryAcquire('submit'), true);
assert.strictEqual(lock.tryAcquire('refresh'), false);
assert.strictEqual(lock.current(), 'submit');
lock.release('refresh');
assert.strictEqual(lock.current(), 'submit');
lock.release('submit');
assert.strictEqual(lock.tryAcquire('refresh'), true);

const runtimeSource = require('fs').readFileSync(__dirname + '/applicationRuntime.js', 'utf8');
const pageSource = require('fs').readFileSync(__dirname + '/index.tsx', 'utf8');
assert.ok(pageSource.includes('`miniapp-role-${identityId}-${requestedIdentity}-${profileMode}-'), 'role application retries must use an identity-and-request scoped idempotency key');
assert.ok(!pageSource.includes('${identityId}-${role}-'), 'role application idempotency keys must not reference an undefined role variable');
for (const retiredTerm of [
  String.fromCharCode(25968, 25454, 20027, 26426),
  String.fromCharCode(26412, 22320, 20027, 26426),
]) {
  assert.ok(!runtimeSource.includes(retiredTerm), `miniapp role flow must not retain retired authority wording: ${retiredTerm}`);
}

console.log('account application runtime checks passed');
