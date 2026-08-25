const assert = require('assert');

const {
  normalizeManualPhone,
  validateManualPhone,
  loginResultState,
  homeForIdentity,
} = require('./manualPhoneLoginRuntime');
const {
  VISITOR_CAPABILITIES,
} = require('../../utils/accountExperience');

assert.strictEqual(typeof homeForIdentity, 'function', 'login routing must expose a testable identity boundary');
assert.strictEqual(
  homeForIdentity({
    id: 'unrecognized-login',
    role: 'student',
    user_type: 'student',
    account_state: 'unrecognized',
    token_use: 'unrecognized-student',
    capabilities: [],
  }),
  '/pages/index/index',
  'retired unrecognized sessions must never enter a parallel experience page',
);
assert.strictEqual(
  homeForIdentity({
    id: 'visitor-login',
    role: 'visitor',
    user_type: 'visitor',
    identity_kind: 'visitor',
    account_state: 'visitor',
    token_use: 'miniapp-visitor',
    authority_id: 'authority-login-test',
    capabilities: [...VISITOR_CAPABILITIES],
  }),
  '/pages/index/index',
  'a canonical visitor must enter the normal role-aware home',
);
for (const role of ['student', 'teacher']) {
  assert.strictEqual(
    homeForIdentity({ id: `${role}-unbound`, role, user_type: role, account_state: 'formal', student_id: null, teacher_id: null }),
    '/pages/index/index',
    `an unbound formal ${role} must enter the normal role-aware home`,
  );
}

assert.strictEqual(normalizeManualPhone(' 138 0013 8000 '), '13800138000');
assert.strictEqual(normalizeManualPhone('+86 138-0013-8000'), '13800138000');
assert.strictEqual(validateManualPhone('13800138000'), '');
assert.strictEqual(validateManualPhone('12800138000'), '请输入正确的中国大陆手机号');
assert.strictEqual(validateManualPhone('1380013800'), '请输入正确的中国大陆手机号');
assert.deepStrictEqual(
  loginResultState({ success: false, code: 'MANUAL_PHONE_INVALID', error: 'invalid phone' }),
  { kind: 'error', code: 'MANUAL_PHONE_INVALID', error: 'invalid phone' },
);
assert.deepStrictEqual(
  loginResultState({ success: true, data: { token: 'token', user: { id: 'user-1' } } }),
  { kind: 'authenticated', token: 'token', user: { id: 'user-1' } },
);
assert.deepStrictEqual(
  loginResultState({ success: false, code: 'PHONE_WECHAT_BINDING_CONFLICT', error: 'conflict' }),
  { kind: 'error', code: 'PHONE_WECHAT_BINDING_CONFLICT', error: 'conflict' },
);

console.log('miniapp manual phone login runtime tests passed');
