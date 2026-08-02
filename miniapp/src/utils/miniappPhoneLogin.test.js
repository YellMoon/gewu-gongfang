const assert = require('assert');
const fs = require('fs');

const loginPage = fs.readFileSync('miniapp/src/pages/login/index.tsx', 'utf-8');
const loginRuntime = fs.readFileSync('miniapp/src/pages/login/manualPhoneLoginRuntime.js', 'utf-8');
const apiClient = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const { pageInventory } = require('./miniappUiPageInventory');
const loginInventory = pageInventory.find(entry => entry.route === 'pages/login/index');

assert.strictEqual((loginPage.match(/openType="getPhoneNumber"/g) || []).length, 0, 'login page should not depend on unavailable WeChat phone authorization');
assert.ok(loginPage.includes('type="number"') && loginPage.includes('maxlength={11}'), 'login page should expose an 11-digit manual phone input');
assert.ok(loginPage.includes('phone,'), 'login request should send the normalized manually entered phone');
assert.ok(loginPage.includes('validateManualPhone'), 'manual phone must be validated before login');
assert.ok(loginPage.includes('resolveHomeForIdentity') && loginRuntime.includes('isUnrecognizedIdentity'), 'login routing should branch on the authoritative unrecognized identity contract');
assert.ok(loginPage.includes("'/pages/unrecognized-experience/index'"), 'unrecognized accounts should enter the restricted experience shell');
assert.ok(loginPage.includes("'/pages/index/index'"), 'formal accounts should enter the normal application shell');
assert.ok(loginPage.includes('MANUAL_PHONE_REQUIRED') && loginPage.includes('MANUAL_PHONE_INVALID'), 'login page should explain manual phone validation failures');
assert.ok(!loginPage.includes('WECHAT_BINDING_REVIEW_REQUIRED'), 'login page must not expose the retired binding-review outcome');
assert.ok(!loginPage.includes('pendingBinding') && !loginPage.includes('binding-review-notice'), 'login page must not retain unreachable pending-binding UI state');
assert.ok(!loginPage.includes('首次绑定当前微信时') && !loginPage.includes('超级管理员审核'), 'login page must not claim that valid manual-phone login requires administrator review');
assert.ok(loginPage.includes('PHONE_WECHAT_BINDING_CONFLICT') && loginPage.includes('OPENID_PHONE_BINDING_CONFLICT'), 'login page should explain both binding-conflict directions');
assert.ok(loginPage.includes('MINIAPP_LOGIN_DISABLED') && loginPage.includes('AUTH_RATE_LIMITED'), 'login page should preserve disabled and rate-limit responses');
assert.ok(!loginPage.includes('phoneCode'), 'login page should not request a WeChat dynamic phone code');
assert.ok(!loginPage.includes('authApi.reviewDemo'), 'legacy review-code login must be absent');
assert.ok(!loginPage.includes('reviewCode') && !loginPage.includes('reviewRole'), 'login page must not expose review-code or synthetic-role state');
assert.ok(!loginPage.includes('unrecognized_session'), 'unrecognized accounts must use the shared auth session storage');
assert.ok(!loginPage.includes('无需注册'), 'login page must not offer an unauthenticated experience bypass');
assert.ok(apiClient.includes('code?: number | string'), 'API responses should preserve string denial codes');
assert.ok(apiClient.includes('res.data?.code'), '403 responses should preserve the backend denial code');
assert.ok(loginInventory?.verificationStates.includes('manual-phone-login'), 'login UI inventory should cover manual phone login');
assert.ok(loginInventory?.verificationStates.includes('formal-login'), 'login UI inventory should cover direct canonical formal login');
assert.ok(loginInventory?.verificationStates.includes('visitor-login'), 'login UI inventory should cover direct visitor login');
assert.ok(loginInventory?.verificationStates.includes('identity-conflict'), 'login UI inventory should cover rejected phone/openid conflicts');
assert.ok(!loginInventory?.verificationStates.includes('wechat-binding-review'), 'login UI inventory must not retain binding review');
assert.ok(!loginInventory?.verificationStates.includes('pending-review'), 'login UI inventory must not retain pending review');
assert.ok(!loginInventory?.realFeatureBasis.includes('WECHAT_BINDING_REVIEW_REQUIRED'), 'login feature basis must match the direct-login backend contract');
assert.ok(!JSON.stringify(loginInventory).includes('invite-register'), 'login inventory must not restore legacy registration');

console.log('miniapp manual phone login source checks passed');
