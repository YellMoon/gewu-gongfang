const assert = require('assert');
const fs = require('fs');

const indexSource = fs.readFileSync('src/index.tsx', 'utf8');
const gateSource = fs.readFileSync('src/components/DesktopIdentityGate.tsx', 'utf8');
const identityClientSource = fs.readFileSync('src/services/desktopIdentityClient.mjs', 'utf8');
const identityErrorSource = fs.readFileSync('src/services/desktopIdentityError.mjs', 'utf8');
const decodedGateSource = gateSource.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => (
  String.fromCharCode(Number.parseInt(hex, 16))
));
const gateStyle = fs.readFileSync('src/components/DesktopIdentityGate.css', 'utf8');
const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const electronSource = fs.readFileSync('public/electron.js', 'utf8');

assert.ok(!indexSource.includes("import App from './App'"), 'locked startup must not statically import the business App');
assert.ok(indexSource.includes("import DesktopIdentityGate from './components/DesktopIdentityGate'"));
assert.ok(indexSource.includes('<DesktopIdentityGate'));
assert.ok(
  gateSource.includes("React.lazy(() => import('../App'))"),
  'business App bundle must load only after the identity gate authorizes runtime startup'
);
assert.ok(!gateSource.includes('browserDatabase'), 'identity gate must not import the business database');
assert.ok(!gateSource.includes('processMiniappCloudTasks'), 'identity gate must not start host task polling');
assert.ok(!gateSource.includes('publishCloudHeartbeat'), 'identity gate must not start host heartbeat');
assert.ok(
  gateSource.includes('resolveDesktopIdentityBaseUrl(config)'),
  'single-user host identity challenges must use the trusted local identity base URL policy'
);
assert.ok(!decodedGateSource.includes(
  '同一个人可以同时拥有超级管理员和老师身份；每台电脑分别注册、分别撤销。'
));
assert.ok(gateSource.includes('className="desktop-identity-header"'));
assert.ok(gateSource.includes('className="desktop-identity-title"'));
assert.ok(gateStyle.includes('.desktop-identity-header'));
assert.ok(gateStyle.includes('align-items: center'));
assert.ok(gateSource.includes('canStartBusinessRuntime'));
assert.ok(gateSource.includes('desktopIdentityExpiryDelay'));
assert.ok(gateSource.includes('const secureRelock = useCallback'));
assert.ok(gateSource.includes('clearCurrentDesktopIdentityPartition(window)'));
assert.ok(gateSource.includes("gateState.kind === 'offline-unlocked'"));
assert.ok(gateSource.includes("{ kind: 'offline-blocked' }"));
assert.ok(gateSource.includes('pending.qrImageDataUrl') && gateSource.includes('<img'),
  'new-device registration must render an official mini-program code image fallback');
assert.ok(gateSource.includes('enrollPasswordForVerifiedRegistration'), 'verified QR registration must support optional cloud password enrollment without exposing a phone code');
assert.ok(identityClientSource.includes('body: { verificationToken: pending.verificationToken, loginName, password }'), 'cloud password enrollment must use only the existing short-lived verification ticket');
assert.ok(gateSource.includes('setCloudPassword(\'\')'), 'cloud password input must be cleared after every enrollment attempt');
assert.ok(!gateSource.includes('phoneCode: cloudPassword'), 'desktop registration must never substitute or retain a phone verification code');
assert.ok(!gateSource.includes('beginPasswordReset'));
assert.ok(gateSource.includes('beginUnifiedOnlineRegistration'));
assert.ok(gateSource.includes('pollUnifiedOnlineRegistration'));
assert.ok(gateSource.includes('completeUnifiedOnlineRegistration'));
assert.ok(!gateSource.includes('beginUnifiedOnlineRecovery'));
assert.ok(gateSource.includes('beginPasswordVerification'));
assert.ok(gateSource.includes("accountLoginType === 'phone'"));
const retiredApprovalText = String.fromCharCode(30001, 19968, 21478, 19968, 21488, 24050, 25480, 26435, 35774, 22791, 25209, 20934);
assert.ok(!decodedGateSource.includes(retiredApprovalText), 'desktop recovery must not require another device approval');
assert.ok(!gateSource.includes('identity_verified_pending_approval'));
assert.ok(!decodedGateSource.includes('等待另一台已授权设备审核'));
assert.ok(gateSource.includes('retryRegistration'));
assert.ok(gateSource.includes('离线身份租约已过期'));
assert.ok(gateSource.includes('desktop-identity-runtime--offline'));
assert.ok(gateStyle.includes('.desktop-identity-runtime--offline > .app-shell'));
assert.ok(gateStyle.includes('.desktop-identity-runtime--offline .desktop-identity-runtime-bar'));
assert.ok(
  !appSource.includes('processMiniappCloudTasks'),
  'business renderer must not own primary-host cloud task execution'
);
assert.ok(
  !appSource.includes('publishCloudHeartbeat'),
  'business renderer must not own primary-host heartbeat publication'
);
assert.ok(
  !gateSource.includes('hostBaseUrl: runtimeConfig?.hostBaseUrl'),
  'managed desktop unlock must not use a retired local authority endpoint'
);
assert.ok(
  gateSource.includes('online: browserOnline()'),
  'pairing completion must obtain an online session when connectivity is available'
);
assert.ok(gateSource.includes('ensureOnlineSession'));
assert.ok(gateSource.includes('listCloudSchedules'), 'the authorized desktop runtime must expose the cloud scheduling read path');
assert.ok(gateSource.includes('updateCloudSchedule'), 'the authorized desktop runtime must expose the cloud scheduling update path');
assert.ok(gateSource.includes('updateCloudScheduleStudentOverride'), 'the authorized desktop runtime must expose the cloud attendance and fee update path');
assert.ok(!gateSource.includes('ensureHostSync'));
assert.ok(!gateSource.includes('ensureHostSyncSession'));
assert.ok(!gateSource.includes('normalizeDesktopAuthorizationSession'));
assert.ok(
  !gateSource.includes('config.deviceId ||'),
  'identity verification must not expose the immutable device id as an editable device name'
);
for (const legacyMarker of [
  'singleUserRuntime', 'beginSingleUserEnrollment', 'single-user-',
  'singleUserPairingClient', 'discoverPairingCapability', 'submitPairingRequest',
  'pollPairingResult', 'normalizePairingCode', 'pairingCode', 'pairingPending',
  '输入一次性配对码', '启用临时单人模式',
]) assert.ok(!gateSource.includes(legacyMarker) && !decodedGateSource.includes(legacyMarker),
  `managed identity gate must not retain legacy single-user flow: ${legacyMarker}`);
for (const code of [
  'PAIRING_CODE_EXPIRED', 'PAIRING_CODE_USED', 'PAIRING_CODE_LOCKED', 'PAIRING_HOST_OFFLINE',
  'PAIRING_CAPABILITY_STALE', 'DESKTOP_DEVICE_FINGERPRINT_MISMATCH',
  'SINGLE_USER_MODE_DISABLED', 'LOCAL_BACKUP_FAILED',
]) assert.ok(!identityErrorSource.includes(code), `managed identity error catalog must not retain legacy code: ${code}`);
assert.ok(gateSource.includes('desktopIdentityErrorMessage(error)'));
assert.ok(!identityErrorSource.includes('Error invoking remote method'));
assert.ok(
  gateSource.includes("console.error('[desktop-identity:registration]', String((caught as any)?.code || 'DESKTOP_IDENTITY_REGISTRATION_FAILED'))"),
  'registration failures must retain only a stable local error code for Electron support diagnostics'
);
assert.ok(!decodedGateSource.includes('请输入本机密码'),
  'the unified desktop must never present a retired local-password login screen');
assert.ok(!decodedGateSource.includes('忘记本机密码？重新核验身份并重设'),
  'the unified desktop must not retain the retired device-password recovery path');
assert.ok(!gateSource.includes('beginUnifiedOnlineRecovery'),
  'cloud reauthentication replaces legacy local-password recovery');

console.log('desktop identity gate source checks passed');
