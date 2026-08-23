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
  requestedRole: 'student',
  bindingHint: ' student-profile-1 ',
}), {
  requestedRole: 'student',
  bindingHint: 'student-profile-1',
});
assert.deepStrictEqual(buildRoleApplicationRequest({
  requestedRole: 'teacher',
  bindingHint: '',
}), {
  requestedRole: 'teacher',
});
assert.throws(
  () => buildRoleApplicationRequest({ requestedRole: 'admin' }),
  /student or teacher/,
);
assert.throws(
  () => buildRoleApplicationRequest({ requestedRole: 'student', bindingHint: 'x'.repeat(129) }),
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
for (const retiredTerm of [
  String.fromCharCode(25968, 25454, 20027, 26426),
  String.fromCharCode(26412, 22320, 20027, 26426),
]) {
  assert.ok(!runtimeSource.includes(retiredTerm), `miniapp role flow must not retain retired authority wording: ${retiredTerm}`);
}

console.log('account application runtime checks passed');
