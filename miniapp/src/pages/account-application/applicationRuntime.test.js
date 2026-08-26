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
  profileName: ' \u5f20\u4e09 ', contactPhone: '138 0013-8000',
}), {
  requestedIdentity: 'student', profileMode: 'existing',
  bindingHint: '\u59d3\u540d\uff1a\u5f20\u4e09\uff1b\u624b\u673a\u53f7\uff1a13800138000',
});
assert.deepStrictEqual(buildRoleApplicationRequest({
  requestedIdentity: 'family_member', profileMode: 'existing', profileName: '\u674e\u56db', contactPhone: '13900139000',
}), {
  requestedIdentity: 'family_member', profileMode: 'existing', bindingHint: '\u59d3\u540d\uff1a\u674e\u56db\uff1b\u624b\u673a\u53f7\uff1a13900139000',
});
assert.deepStrictEqual(buildRoleApplicationRequest({
  requestedIdentity: 'teacher', profileMode: 'new', profileName: '\u738b\u4e94', contactPhone: '13700137000',
}), {
  requestedIdentity: 'teacher', profileMode: 'new', bindingHint: '\u59d3\u540d\uff1a\u738b\u4e94\uff1b\u624b\u673a\u53f7\uff1a13700137000',
});
assert.throws(
  () => buildRoleApplicationRequest({ requestedIdentity: 'family_member', profileMode: 'new', profileName: '\u674e\u56db', contactPhone: '13900139000' }),
  /family_member.*existing/,
);
assert.throws(
  () => buildRoleApplicationRequest({ requestedIdentity: 'operator', profileMode: 'existing', profileName: '\u5f20\u4e09', contactPhone: '13800138000' }),
  /teacher, student, or family_member/,
);
assert.throws(
  () => buildRoleApplicationRequest({ requestedIdentity: 'teacher', profileMode: 'create', profileName: '\u5f20\u4e09', contactPhone: '13800138000' }),
  /existing or new/,
);
assert.throws(
  () => buildRoleApplicationRequest({ requestedIdentity: 'student', profileMode: 'existing', profileName: 'x'.repeat(65), contactPhone: '13800138000' }),
  /64/,
);
assert.throws(
  () => buildRoleApplicationRequest({ requestedIdentity: 'student', profileMode: 'existing', profileName: '\u5f20\u4e09', contactPhone: '12345' }),
  /mobile phone/,
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
assert.ok(!pageSource.includes('commandId'), 'role application UI must not expose a retired command identifier that the cloud contract does not return');
for (const retiredTerm of [
  String.fromCharCode(25968, 25454, 20027, 26426),
  String.fromCharCode(26412, 22320, 20027, 26426),
]) {
  assert.ok(!runtimeSource.includes(retiredTerm), `miniapp role flow must not retain retired authority wording: ${retiredTerm}`);
}
assert.ok(runtimeSource.includes('family_member'), 'application copy must include the family-member binding path');
const submittedCopy = copyForApplicationState('submitted');
assert.ok(submittedCopy.title.includes('等待审核'), 'submitted applications must describe a neutral review state');
assert.ok(!submittedCopy.description.includes('教师端'), 'submitted applications must not imply that a teacher reviews role applications');

console.log('account application runtime checks passed');
