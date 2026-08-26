const assert = require('assert');
const fs = require('fs');

const loginPage = fs.readFileSync('miniapp/src/pages/login/index.tsx', 'utf-8');
const apiClient = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const { pageInventory } = require('./miniappUiPageInventory');
const loginInventory = pageInventory.find(entry => entry.route === 'pages/login/index');

assert.strictEqual((loginPage.match(/openType="getPhoneNumber"/g) || []).length, 1, 'login page must use the official one-time phone proof');
assert.ok(loginPage.includes('miniappCloudAuthApi.login(loginCode, phoneCode)'), 'login must use the dedicated cloud account client with both official identity proofs');
assert.strictEqual((loginPage.match(/className="wx-login-btn"/g) || []).length, 1, 'login page must expose one clear WeChat login action');
assert.ok(!loginPage.includes('handleCloudLogin(null)'), 'every WeChat login must obtain a current official phone proof');
assert.ok(loginPage.includes('Taro.login()'), 'login must obtain the official WeChat identity code before calling cloud login');
assert.ok(loginPage.includes('event?.detail?.code'), 'login must pass only the official one-time phone proof');
assert.ok(!loginPage.includes('/api/auth/wechat-login'), 'login must not call the old account endpoint');
assert.ok(!loginPage.includes('type="number"') && !loginPage.includes('normalizeManualPhone'), 'login must not collect a manually typed phone number');
assert.ok(loginPage.includes("'/pages/index/index'"), 'cloud identities must enter the role-aware home surface');
assert.ok(!loginPage.includes("'/pages/schedule/index'"), 'new visitors must not bypass the role-aware home shell');
assert.ok(!loginPage.includes('CLOUD_MINIAPP_ACCOUNT_PENDING'), 'new accounts are visitors rather than a parallel pending-authorization identity');
assert.ok(!loginPage.includes('WECHAT_BINDING_REVIEW_REQUIRED') && !loginPage.includes('pendingBinding'), 'old manual-review identity state must not be a new login path');
assert.ok(!loginPage.includes('authApi.reviewDemo'), 'legacy review-code login must be absent');
assert.ok(!loginPage.includes('reviewCode') && !loginPage.includes('reviewRole'), 'login page must not expose review-code or synthetic-role state');
assert.ok(apiClient.includes('code?: number | string'), 'API responses should preserve string denial codes');
assert.ok(apiClient.includes('(response.data as any)?.code'), 'cloud-login denials should preserve the backend denial code');
assert.ok(apiClient.includes("'/api/miniapp/cloud-login'"), 'cloud login must run without an old session bearer token');
assert.ok(apiClient.includes('phoneCode: string'), 'the cloud API facade must require an official phone proof for every login');
assert.ok(loginInventory?.verificationStates.includes('wechat-phone-proof'), 'login UI inventory should cover the new cloud phone proof');
assert.ok(loginInventory?.verificationStates.includes('visitor-session'), 'login UI inventory should cover a new visitor that can submit a role application');
assert.ok(loginInventory?.realFeatureBasis.includes('POST /api/miniapp/cloud-login'), 'login inventory must identify the cloud account boundary');
assert.ok(!JSON.stringify(loginInventory).includes('manual-phone-login'), 'login inventory must not claim a manual phone login path');

console.log('miniapp manual phone login source checks passed');
