const assert = require('assert');
const fs = require('fs');

const loginPage = fs.readFileSync('miniapp/src/pages/login/index.tsx', 'utf-8');
const apiClient = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const uiInventory = fs.readFileSync('miniapp/src/utils/miniappUiPageInventory.js', 'utf-8');

assert.strictEqual((loginPage.match(/openType="getPhoneNumber"/g) || []).length, 0, 'login page should not depend on unavailable WeChat phone authorization');
assert.ok(loginPage.includes('type="number"') && loginPage.includes('maxlength={11}'), 'login page should expose an 11-digit manual phone input');
assert.ok(loginPage.includes('phone,'), 'login request should send the normalized manually entered phone');
assert.ok(loginPage.includes('validateManualPhone'), 'manual phone must be validated before login');
assert.ok(loginPage.includes('isUnrecognizedIdentity'), 'login page should branch on the authoritative unrecognized identity contract');
assert.ok(loginPage.includes("'/pages/unrecognized-experience/index'"), 'unrecognized accounts should enter the restricted experience shell');
assert.ok(loginPage.includes("'/pages/index/index'"), 'formal accounts should enter the normal application shell');
assert.ok(loginPage.includes('MANUAL_PHONE_REQUIRED') && loginPage.includes('MANUAL_PHONE_INVALID'), 'login page should explain manual phone validation failures');
assert.ok(loginPage.includes('WECHAT_BINDING_REVIEW_REQUIRED'), 'login page should explain pending WeChat binding review');
assert.ok(loginPage.includes('PHONE_WECHAT_BINDING_CONFLICT') && loginPage.includes('OPENID_PHONE_BINDING_CONFLICT'), 'login page should explain both binding-conflict directions');
assert.ok(loginPage.includes('MINIAPP_LOGIN_DISABLED') && loginPage.includes('AUTH_RATE_LIMITED'), 'login page should preserve disabled and rate-limit responses');
assert.ok(!loginPage.includes('phoneCode'), 'login page should not request a WeChat dynamic phone code');
assert.ok(!loginPage.includes('authApi.reviewDemo'), 'legacy review-code login must be absent');
assert.ok(!loginPage.includes('reviewCode') && !loginPage.includes('reviewRole'), 'login page must not expose review-code or synthetic-role state');
assert.ok(!loginPage.includes('unrecognized_session'), 'unrecognized accounts must use the shared auth session storage');
assert.ok(!loginPage.includes('无需注册'), 'login page must not offer an unauthenticated experience bypass');
assert.ok(apiClient.includes('code?: number | string'), 'API responses should preserve string denial codes');
assert.ok(apiClient.includes('res.data?.code'), '403 responses should preserve the backend denial code');
assert.ok(uiInventory.includes('manual-phone-login'), 'login UI inventory should cover manual phone login');
assert.ok(uiInventory.includes('wechat-binding-review'), 'login UI inventory should cover binding review');
assert.ok(!uiInventory.includes('invite-register'), 'login inventory must not restore legacy registration');

console.log('miniapp manual phone login source checks passed');
