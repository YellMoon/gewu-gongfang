const assert = require('assert');
const fs = require('fs');

const loginPage = fs.readFileSync('miniapp/src/pages/login/index.tsx', 'utf-8');
const apiClient = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const uiInventory = fs.readFileSync('miniapp/src/utils/miniappUiPageInventory.js', 'utf-8');

assert.ok(loginPage.includes('MINIAPP_USER_NOT_PREAUTHORIZED'), 'login page should detect an unbound preauthorized account');
assert.ok(loginPage.includes('openType="getPhoneNumber"'), 'login page should use the WeChat verified phone button');
assert.ok(loginPage.includes('onGetPhoneNumber={handlePhoneLogin}'), 'verified phone event should have a dedicated handler');
assert.ok(loginPage.includes('phoneCode'), 'login request should send the dynamic verified phone code');
assert.ok(!loginPage.includes('phoneNumber:'), 'login page must not submit a caller-controlled plaintext phone number');
assert.ok(apiClient.includes('code?: number | string'), 'API responses should preserve string denial codes');
assert.ok(apiClient.includes('res.data?.code'), '403 responses should preserve the backend denial code');
assert.ok(uiInventory.includes('verified-phone-binding'), 'login UI inventory should cover the verified phone binding state');

console.log('miniapp verified phone login source checks passed');
