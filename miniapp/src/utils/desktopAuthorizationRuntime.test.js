const assert = require('assert');
const fs = require('fs');
const { pageInventory } = require('./miniappUiPageInventory');
const runtime = require('./desktopAuthorizationRuntime');

assert.strictEqual(
  runtime.parseDesktopAuthorizationChallengeId({ challengeId: 'challenge-1234567890' }),
  'challenge-1234567890',
);
for (const invalid of ['', '../challenge', 'challenge id', 'x'.repeat(129)]) {
  assert.throws(
    () => runtime.parseDesktopAuthorizationChallengeId({ challengeId: invalid }),
    error => error.code === 'DESKTOP_CHALLENGE_ID_INVALID',
  );
}

assert.deepStrictEqual(runtime.buildDesktopConfirmationPayload({
  challengeId: 'challenge-1234567890',
  loginCode: 'new-login-code',
  phone: '13800138005',
  expectedRowVersion: 3,
}), {
  challengeId: 'challenge-1234567890',
  code: 'new-login-code',
  phone: '13800138005',
  expectedRowVersion: 3,
});
assert.throws(
  () => runtime.buildDesktopConfirmationPayload({
    challengeId: 'challenge-1234567890', loginCode: 'new-login-code', phone: 'invalid', expectedRowVersion: 3,
  }),
  error => error.code === 'MANUAL_PHONE_INVALID',
);

const projected = runtime.projectDesktopAuthorizationChallenge({
  id: 'challenge-1234567890',
  deviceId: 'must-not-reach-page',
  deviceName: 'Second PC',
  keyFingerprint: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  publicKey: 'must-not-reach-page',
  purpose: 'register',
  status: 'pending_phone',
  rowVersion: 1,
  createdAt: '2026-07-17T09:00:00.000Z',
  expiresAt: '2026-07-17T09:10:00.000Z',
});
assert.strictEqual(projected.keyFingerprintSummary, '01234567…cdef');
assert.ok(!JSON.stringify(projected).includes('must-not-reach-page'));
assert.strictEqual(runtime.desktopAuthorizationView(projected, new Date('2026-07-17T09:05:00.000Z')), 'phone-required');
assert.strictEqual(runtime.desktopAuthorizationView(projected, new Date('2026-07-17T09:10:00.000Z')), 'expired');

const pageSource = fs.readFileSync('miniapp/src/pages/desktop-authorization/index.tsx', 'utf8');
const runtimeSource = fs.readFileSync('miniapp/src/utils/desktopAuthorizationRuntime.js', 'utf8');
const hostPurpose = runtime.desktopAuthorizationPurposePresentation('primary-host-bootstrap');
assert.ok(hostPurpose.phoneCopy.includes('\u9ad8\u98ce\u9669\u64cd\u4f5c'));
assert.ok(!hostPurpose.phoneCopy.includes('\u8d85\u7ea7\u7ba1\u7406\u5458\u5ba1\u6838'));
assert.ok(!pageSource.includes('getPhoneNumber'), 'desktop confirmation must not invoke automatic phone retrieval');
assert.ok(!pageSource.includes('phoneCodeFromAuthorizationEvent'));
assert.ok(!runtimeSource.includes('phoneCode'), 'desktop authorization runtime must not retain the retired automatic phone code path');
assert.ok(pageSource.includes('type="number"') && pageSource.includes('maxlength={11}'));
assert.ok(pageSource.includes('validateManualPhone'));
assert.ok(pageSource.includes('phone: normalizedPhone'));
assert.ok(pageSource.includes('Taro.login()'));
assert.ok(pageSource.includes('buildDesktopConfirmationPayload'));
assert.ok(pageSource.includes('desktopAuthorizationApi.confirm'));
assert.ok(pageSource.includes('expectedRowVersion'));
assert.ok(pageSource.includes('purposePresentation.phoneCopy'), 'the page must show purpose-specific phone confirmation copy');
assert.ok(!pageSource.includes('\\u4ecd\\u9700\\u6570\\u636e\\u4e3b\\u673a\\u8d85\\u7ea7\\u7ba1\\u7406\\u5458\\u5ba1\\u6838'));
assert.ok(!pageSource.includes('openid'));

const appConfig = fs.readFileSync('miniapp/src/app.config.ts', 'utf8');
assert.ok(appConfig.includes("'pages/desktop-authorization/index'"));
const inventory = pageInventory.find(entry => entry.route === 'pages/desktop-authorization/index');
assert.ok(inventory?.roleViews.includes('guest'));
assert.ok(inventory?.verificationStates.includes('manual-phone-entry'));
assert.ok(!inventory?.realFeatureBasis.some(value => value.includes('getPhoneNumber')));

console.log('miniapp desktop authorization runtime checks passed');
