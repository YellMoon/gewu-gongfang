const assert = require('assert');
const fs = require('fs');

const loginPage = fs.readFileSync('miniapp/src/pages/login/index.tsx', 'utf-8');
const apiClient = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const uiInventory = fs.readFileSync('miniapp/src/utils/miniappUiPageInventory.js', 'utf-8');

assert.strictEqual((loginPage.match(/openType="getPhoneNumber"/g) || []).length, 1, 'login page should expose one verified-phone login action');
assert.ok(loginPage.includes('onGetPhoneNumber={handlePhoneLogin}'), 'verified phone event should have a dedicated handler');
assert.ok(loginPage.includes('phoneCode'), 'login request should send the dynamic verified phone code');
assert.ok(loginPage.includes('isUnrecognizedIdentity'), 'login page should branch on the authoritative unrecognized identity contract');
assert.ok(loginPage.includes("'/pages/unrecognized-experience/index'"), 'unrecognized accounts should enter the restricted experience shell');
assert.ok(loginPage.includes("'/pages/index/index'"), 'formal accounts should enter the normal application shell');
assert.ok(loginPage.includes('PHONE_VERIFICATION_REQUIRED') && loginPage.includes('WECHAT_PHONE_EXCHANGE_FAILED'), 'login page should explain verified-phone failures');
assert.ok(loginPage.includes('PHONE_WECHAT_BINDING_CONFLICT') && loginPage.includes('OPENID_PHONE_BINDING_CONFLICT'), 'login page should explain both binding-conflict directions');
assert.ok(loginPage.includes('MINIAPP_LOGIN_DISABLED') && loginPage.includes('AUTH_RATE_LIMITED'), 'login page should preserve disabled and rate-limit responses');
assert.ok(!loginPage.includes('phoneNumber:'), 'login page must not submit a caller-controlled plaintext phone number');
assert.ok(!loginPage.includes('authApi.reviewDemo'), 'legacy review-code login must be absent');
assert.ok(!loginPage.includes('reviewCode') && !loginPage.includes('reviewRole'), 'login page must not expose review-code or synthetic-role state');
assert.ok(!loginPage.includes('unrecognized_session'), 'unrecognized accounts must use the shared auth session storage');
assert.ok(!loginPage.includes('无需注册'), 'login page must not offer an unauthenticated experience bypass');
assert.ok(apiClient.includes('code?: number | string'), 'API responses should preserve string denial codes');
assert.ok(apiClient.includes('res.data?.code'), '403 responses should preserve the backend denial code');
assert.ok(uiInventory.includes('verified-phone-binding'), 'login UI inventory should cover the verified phone binding state');
assert.ok(!uiInventory.includes('invite-register'), 'login inventory must not restore legacy registration');

console.log('miniapp verified phone login source checks passed');
