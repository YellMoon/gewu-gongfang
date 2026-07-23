const assert = require('assert');

const {
  normalizeManualPhone,
  validateManualPhone,
  loginResultState,
} = require('./manualPhoneLoginRuntime');

assert.strictEqual(normalizeManualPhone(' 138 0013 8000 '), '13800138000');
assert.strictEqual(normalizeManualPhone('+86 138-0013-8000'), '13800138000');
assert.strictEqual(validateManualPhone('13800138000'), '');
assert.strictEqual(validateManualPhone('12800138000'), '请输入正确的中国大陆手机号');
assert.strictEqual(validateManualPhone('1380013800'), '请输入正确的中国大陆手机号');
assert.deepStrictEqual(
  loginResultState({ success: false, code: 'WECHAT_BINDING_REVIEW_REQUIRED', data: { requestId: 'binding-1' } }),
  { kind: 'pending-binding', requestId: 'binding-1' },
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
