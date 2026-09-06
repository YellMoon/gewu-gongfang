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
  profileName: '\u5f20\u4e09', profilePhone: '13800138000',
});
assert.deepStrictEqual(buildRoleApplicationRequest({
  requestedIdentity: 'family_member', profileMode: 'existing', profileName: '\u674e\u56db', contactPhone: '13900139000',
}), {
  requestedIdentity: 'family_member', profileMode: 'existing', profileName: '\u674e\u56db', profilePhone: '13900139000',
});
assert.deepStrictEqual(buildRoleApplicationRequest({
  requestedIdentity: 'teacher', profileMode: 'new', profileName: '\u738b\u4e94', contactPhone: '13700137000',
}), {
  requestedIdentity: 'teacher', profileMode: 'new', profileName: '\u738b\u4e94', profilePhone: '13700137000',
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
const literalUnicodeInputPlaceholder = "placeholder='" + '\\' + 'u';
assert.ok(!pageSource.includes(literalUnicodeInputPlaceholder), 'role application inputs must render readable placeholder copy instead of literal Unicode escape sequences');
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
const initialCopy = copyForApplicationState('not_submitted');
assert.strictEqual(initialCopy.title, '申请角色', 'the visitor entry must name the user action, not an internal binding process');
assert.ok(!initialCopy.description.includes('档案') && !initialCopy.description.includes('身份绑定'), 'the role-application introduction must not expose internal record terminology');
const invalidCopy = copyForApplicationState('invalid');
assert.strictEqual(invalidCopy.description, '\u8bf7\u586b\u5199\u59d3\u540d\u548c\u6b63\u786e\u7684\u624b\u673a\u53f7\u3002', 'validation must name missing input instead of describing other roles');
assert.ok(!invalidCopy.description.includes('档案'), 'validation guidance must use information users can recognize instead of internal records');
assert.ok(!pageSource.includes("className='state-kicker'"), 'the role-application page must not repeat an internal account-identity heading above the user-facing action title');
assert.ok(pageSource.includes("label: '\\u6559\\u5e08'"), 'the formal role name must be teacher, not the conversational teacher label');
assert.ok(!pageSource.includes('\\u65b0\\u8eab\\u4efd') && !pageSource.includes('\\u5173\\u8054\\u5bf9\\u8c61'), 'role choices must not expose internal identity terminology');
assert.ok(pageSource.includes('CLOUD_ROLE_APPLICATION_VERIFIED_PHONE_REQUIRED'), 'a mismatched hand-entered phone must produce an explicit verified-account-phone message');
assert.ok(pageSource.includes('\\u5f53\\u524d\\u8d26\\u53f7\\u624b\\u673a\\u53f7'), 'the phone field must clearly refer to the current verified account');

console.log('account application runtime checks passed');
