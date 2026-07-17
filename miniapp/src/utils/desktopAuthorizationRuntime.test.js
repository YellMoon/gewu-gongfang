const assert = require('assert');
const fs = require('fs');
const { pageInventory } = require('./miniappUiPageInventory');

const runtime = require('./desktopAuthorizationRuntime');

assert.strictEqual(
  runtime.parseDesktopAuthorizationChallengeId({ challengeId: 'challenge-1234567890' }),
  'challenge-1234567890'
);
assert.strictEqual(
  runtime.parseDesktopAuthorizationChallengeId({ scene: 'challengeId%3Dchallenge-1234567890' }),
  'challenge-1234567890'
);
for (const invalid of ['', '../challenge', 'challenge id', 'x'.repeat(129)]) {
  assert.throws(
    () => runtime.parseDesktopAuthorizationChallengeId({ challengeId: invalid }),
    error => error.code === 'DESKTOP_CHALLENGE_ID_INVALID'
  );
}

assert.deepStrictEqual(runtime.buildDesktopConfirmationPayload({
  challengeId: 'challenge-1234567890',
  loginCode: 'new-login-code',
  phoneCode: 'new-phone-code',
}), {
  challengeId: 'challenge-1234567890',
  code: 'new-login-code',
  phoneCode: 'new-phone-code',
});
assert.throws(
  () => runtime.buildDesktopConfirmationPayload({
    challengeId: 'challenge-1234567890', loginCode: 'new-login-code',
  }),
  error => error.code === 'WECHAT_PHONE_CODE_REQUIRED'
);
assert.throws(
  () => runtime.phoneCodeFromAuthorizationEvent({ detail: { errMsg: 'getPhoneNumber:fail user deny' } }),
  error => error.code === 'WECHAT_PHONE_AUTH_CANCELLED'
);

const projected = runtime.projectDesktopAuthorizationChallenge({
  id: 'challenge-1234567890',
  deviceId: 'must-not-reach-page',
  deviceName: 'Second PC',
  keyFingerprint: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  publicKey: 'must-not-reach-page',
  challengeSecret: 'must-not-reach-page',
  shortCode: '123456',
  purpose: 'register',
  status: 'pending_phone',
  rowVersion: 1,
  createdAt: '2026-07-17T09:00:00.000Z',
  expiresAt: '2026-07-17T09:10:00.000Z',
});
assert.deepStrictEqual(Object.keys(projected).sort(), [
  'createdAt', 'deviceName', 'expiresAt', 'id', 'keyFingerprintSummary', 'purpose', 'status',
].sort());
assert.strictEqual(projected.keyFingerprintSummary, '01234567…cdef');
assert.ok(!JSON.stringify(projected).includes('must-not-reach-page'));
assert.strictEqual(runtime.desktopAuthorizationView(projected, new Date('2026-07-17T09:05:00.000Z')), 'phone-required');
assert.strictEqual(runtime.desktopAuthorizationView(projected, new Date('2026-07-17T09:10:00.000Z')), 'expired');
const distinctErrors = [
  'DESKTOP_CHALLENGE_EXPIRED',
  'DESKTOP_CHALLENGE_CLAIMANT_CONFLICT',
  'DESKTOP_DEVICE_OWNER_CONFLICT',
  'WECHAT_PHONE_AUTH_CANCELLED',
].map(code => runtime.desktopAuthorizationErrorMessage(code));
assert.strictEqual(new Set(distinctErrors).size, distinctErrors.length);

const pageSource = fs.readFileSync('miniapp/src/pages/desktop-authorization/index.tsx', 'utf8');
const visiblePageSource = pageSource.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => (
  String.fromCharCode(Number.parseInt(hex, 16))
));
assert.ok(pageSource.includes('openType="getPhoneNumber"'));
assert.ok(pageSource.includes('onGetPhoneNumber'));
assert.ok(pageSource.includes('phoneCodeFromAuthorizationEvent'));
assert.ok(pageSource.includes('Taro.login()'));
assert.ok(pageSource.includes('buildDesktopConfirmationPayload'));
assert.ok(pageSource.includes('desktopAuthorizationApi.confirm'));
assert.ok(!pageSource.includes('openid'));
assert.ok(!pageSource.includes("getStorageSync('phone"));
assert.ok(visiblePageSource.includes('二维码只建立一次性通道'));
assert.ok(visiblePageSource.includes('微信手机号用于确认申请人'));
assert.ok(visiblePageSource.includes('等待可信设备审批'));

const appSource = fs.readFileSync('miniapp/src/app.tsx', 'utf8');
assert.ok(appSource.includes("'pages/desktop-authorization/index'"));
assert.ok(appSource.includes('isUnauthenticatedEntryPage'));

const apiSource = fs.readFileSync('miniapp/src/utils/api.ts', 'utf8');
assert.ok(apiSource.includes('desktopAuthorizationApi'));
assert.ok(apiSource.includes('/public'));
assert.ok(apiSource.includes('/confirm'));
assert.ok(apiSource.includes('isAuthenticationEntryPath'));
assert.ok(apiSource.includes("this.getHeaders(anonymousEntry ? '' : requestSession.token)"));

const appConfig = fs.readFileSync('miniapp/src/app.config.ts', 'utf8');
assert.ok(appConfig.includes("'pages/desktop-authorization/index'"));
const inventory = pageInventory.find(entry => entry.route === 'pages/desktop-authorization/index');
assert.ok(inventory?.roleViews.includes('guest'));
assert.ok(inventory?.verificationStates.includes('phone-cancelled'));
assert.ok(inventory?.verificationStates.includes('approval-pending'));

console.log('miniapp desktop authorization runtime checks passed');
