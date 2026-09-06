const assert = require('assert');
const fs = require('fs');

const indexSource = fs.readFileSync('src/index.tsx', 'utf8');
const gateSource = fs.readFileSync('src/components/DesktopIdentityGate.tsx', 'utf8');
const identityClientSource = fs.readFileSync('src/services/desktopIdentityClient.mjs', 'utf8');
const identityErrorSource = fs.readFileSync('src/services/desktopIdentityError.mjs', 'utf8');
const decodedGateSource = gateSource.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => (
  String.fromCharCode(Number.parseInt(hex, 16))
));
const decodedIdentityErrorSource = identityErrorSource.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => (
  String.fromCharCode(Number.parseInt(hex, 16))
));
const gateStyle = fs.readFileSync('src/components/DesktopIdentityGate.css', 'utf8');
assert.match(gateStyle, /\.desktop-identity-password-fields\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*16px;/,
  'password form fields must retain visible vertical spacing in the production renderer');
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
assert.ok(decodedGateSource.includes('登录格物工坊'), 'the primary gate must present a normal product login title');
assert.ok(!decodedGateSource.includes('首次登录需要联网'), 'the login page must not explain internal first-use flow');
assert.ok(!decodedGateSource.includes('请选择微信登录'), 'the login page must not narrate controls that are already visible');
assert.ok(decodedGateSource.includes('输入手机号') && decodedGateSource.includes('输入账号名'),
  'password login must clearly identify its phone and account-name fields');
assert.ok(decodedGateSource.includes('微信扫码登录') && decodedGateSource.includes('密码登录'),
  'login modes must use familiar and unambiguous user-facing labels');
assert.ok(
  gateSource.indexOf('desktop-identity-password-form') < gateSource.indexOf("\\u5fae\\u4fe1\\u626b\\u7801\\u767b\\u5f55"),
  'the teacher desktop must make phone/account password login the primary entry and keep QR login secondary'
);
for (const internalLoginCopy of [
  '格物工坊身份验证', '核验账号并登记此电脑', '设备名称', '开始微信身份注册',
  '静默登记这台电脑', '云端账号已核验', '请完成微信身份验证', '此电脑将自动登记',
  '正在检查本机身份', '当前身份验证不能设置云端账号密码',
  '身份验证未完成', '设备核验', '开发者',
]) assert.ok(!decodedGateSource.includes(internalLoginCopy),
  `silent device registration must not leak implementation copy into login: ${internalLoginCopy}`);
assert.ok(!gateSource.includes('setDeviceName'), 'device naming must be derived silently by the Electron main process');
assert.ok(!gateSource.includes('deviceName'), 'the renderer must not request or submit a user-selected device name');
assert.ok(!gateSource.includes('onlineVerificationMode') && !gateSource.includes('setOnlineVerificationMode'),
  'login methods must be direct actions instead of requiring a mode-switch click first');
assert.ok(!/^\s*admin:/m.test(gateSource), 'desktop identity labels must not retain the retired ordinary-admin role');
assert.ok(!/^\s*parent:/m.test(gateSource), 'a household relationship must not be rendered as a desktop role');
assert.ok(!gateSource.includes('<Space.Compact'), 'login methods must not be rendered as a duplicate action switcher');
assert.ok(gateSource.includes('onClick={beginRegistration} block'),
  'QR login must start directly from its single visible action');
assert.ok(
  electronSource.includes("input.deviceName || config.deviceName || require('os').hostname()"),
  'Electron main must silently derive the device name when registration starts'
);
assert.ok(gateStyle.includes('.desktop-identity-header'));
assert.ok(gateStyle.includes('align-items: center'));
assert.ok(gateSource.includes('<Card className="desktop-identity-card" variant="borderless">') && !gateSource.includes('<Card className="desktop-identity-card" bordered={false}>'),
  'the login card must use the current Ant Design borderless variant API');
assert.ok(!gateSource.includes('<Spin tip='),
  'loading messages must use a nested Spin so Ant Design does not emit a runtime warning');
assert.ok(gateSource.includes('desktop-identity-password-form') && gateSource.includes('onSubmit={event => {'),
  'password login inputs must be inside a real submit form for keyboard and accessibility support');
assert.ok(gateSource.includes('autoComplete="username"') && gateSource.includes('autoComplete="current-password"'),
  'password login must expose standard browser autofill semantics');
assert.ok(gateSource.includes('canStartBusinessRuntime'));
assert.ok(gateSource.includes('desktopIdentityExpiryDelay'));
assert.ok(gateSource.includes('const secureRelock = useCallback'));
assert.ok(gateSource.includes('clearCurrentDesktopIdentityPartition(window)'));
assert.ok(gateSource.includes("gateState.kind === 'offline-unlocked'"));
assert.ok(gateSource.includes("{ kind: 'offline-blocked' }"));
assert.ok(gateSource.includes('pending.qrImageDataUrl') && gateSource.includes('<img'),
  'new-device registration must render an official mini-program code image fallback');
assert.ok(!gateSource.includes('pending.qrValue') && !gateSource.includes('<QRCode'),
  'the retired URL Scheme QR path must not remain as a hidden fallback');
assert.ok(gateSource.includes('enrollPasswordForVerifiedRegistration'), 'verified QR registration must support optional cloud password enrollment without exposing a phone code');
assert.ok(identityClientSource.includes('body: { verificationToken: pending.verificationToken, loginName, password }'), 'cloud password enrollment must use only the existing short-lived verification ticket');
assert.ok(gateSource.includes('setCloudPassword(\'\')'), 'cloud password input must be cleared after every enrollment attempt');
assert.ok(!gateSource.includes('phoneCode: cloudPassword'), 'desktop registration must never substitute or retain a phone verification code');
assert.ok(!gateSource.includes('beginPasswordReset'));
assert.ok(gateSource.includes('beginUnifiedOnlineRegistration'));
assert.ok(gateSource.includes('pollUnifiedOnlineRegistration'));
assert.ok(gateSource.includes('completeUnifiedOnlineRegistration'));
assert.ok(gateSource.includes("const waitingForVerification = pending?.status === 'awaiting_online_verification'")
  && gateSource.includes('window.setInterval(() => { void pollRegistration(); }, 3000)'),
  'a newly started WeChat login must poll automatically instead of waiting for a manual refresh click');
assert.ok(gateSource.includes("pending?.desktopAccess?.access === 'allowed'"),
  'the verified login state must show the enter action only after cloud confirms a teacher-desktop role');
assert.ok(gateSource.includes("pending?.desktopAccess?.access === 'teacher_registration_required'"),
  'a verified visitor or student must see only the teacher registration path');
assert.ok(gateSource.includes("setPending({ ...pending, desktopAccess: registered.desktopAccess })"),
  'successful teacher registration must promote the same verified login flow before silent device registration');
assert.ok(!gateSource.includes('beginUnifiedOnlineRecovery'));
assert.ok(gateSource.includes('beginPasswordVerification'));
assert.ok(gateSource.includes("accountLoginType === 'phone'"));
assert.ok(gateSource.includes("const showLoginMethods = ['registration-required', 'registration-active', 'registration-interrupted', 'upgrade-required',")
  && gateSource.includes("'online-authentication-required',")
  && gateSource.includes('showLoginMethods && renderRegistration()'),
  'an expired online session must return directly to the normal password/WeChat login choices');
assert.ok(gateSource.includes("const locked = ['locked', 'offline-blocked'].includes(gateState.kind)"),
  'online reauthentication must not strand the user behind a retry-session-only screen');
const retiredApprovalText = String.fromCharCode(30001, 19968, 21478, 19968, 21488, 24050, 25480, 26435, 35774, 22791, 25209, 20934);
assert.ok(!decodedGateSource.includes(retiredApprovalText), 'desktop recovery must not require another device approval');
assert.ok(!gateSource.includes('identity_verified_pending_approval'));
assert.ok(!decodedGateSource.includes('等待另一台已授权设备审核'));
assert.ok(gateSource.includes('returnToPasswordLogin'));
assert.ok(decodedGateSource.includes('\u8fd4\u56de\u5bc6\u7801\u767b\u5f55'),
  'the WeChat QR state must offer a clear return to password login');
assert.ok(gateSource.includes('onClick={returnToPasswordLogin}'),
  'returning from WeChat login must clear the pending local registration through the recovery handler');
assert.ok(gateSource.includes('const pollingFlowRef = useRef<number | null>(null)'),
  'registration polling must be owned by a specific login-flow generation');
assert.ok(gateSource.includes('if (registrationFlowRef.current === flowId) setError(messageForError(caught))'),
  'an obsolete WeChat poll must not write its error into a later password-login flow');
assert.ok(gateSource.includes('if (registrationFlowRef.current === flowId) setPolling(false)'),
  'an obsolete WeChat poll must not clear the loading state of a later login flow');
assert.ok(gateSource.includes('setPolling(false);\n    setBusy(true);'),
  'returning to password login must clear only the visible polling state immediately');
assert.ok(gateSource.includes(String.raw`\u79bb\u7ebf\u767b\u5f55\u5df2\u8fc7\u671f`));
assert.ok(gateSource.includes('desktop-identity-runtime--offline'));
assert.ok(!decodedGateSource.includes(String.fromCharCode(23457, 26680, 35774, 22791)) && !decodedGateSource.includes(String.fromCharCode(20027, 26426, 20889, 25805, 20316)),
  'desktop offline copy must not expose retired device-approval or host-internal terminology');
assert.ok(gateSource.includes(String.raw`\u79bb\u7ebf\u65f6\u53ef\u7ee7\u7eed\u7f16\u8f91\u672c\u5730\u8349\u7a3f`) && gateSource.includes(String.raw`\u8fde\u63a5\u7f51\u7edc\u540e\u7531\u4f60\u786e\u8ba4\u63d0\u4ea4`),
  'desktop offline copy must state the actual draft and user-confirmed submission boundary');
assert.ok(decodedGateSource.includes(String.fromCharCode(27491, 22312, 24674, 22797, 30331, 24405, 29366, 24577)),
  'desktop session recovery must use familiar login language rather than internal cloud-session wording');
assert.ok(gateStyle.includes('.desktop-identity-runtime--offline > .app-shell'));
assert.ok(gateStyle.includes('.desktop-identity-runtime--offline .desktop-identity-runtime-bar'));
assert.ok(gateStyle.includes('.desktop-identity-runtime .app-shell__topbar')
  && gateStyle.includes('padding-right: 350px'),
  'the application top bar must reserve space so fixed identity controls cannot cover page actions');
assert.ok(gateStyle.includes(':has(.desktop-identity-runtime-bar .ant-btn:nth-of-type(2))')
  && gateStyle.includes('padding-right: 540px'),
  'the top bar must reserve the wider identity-control footprint when role switching is available');
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
assert.ok(gateSource.includes("{ kind: 'initialization-failed' }"),
  'a bootstrap failure must leave the loading state instead of showing a blank login screen');
assert.ok(gateSource.includes('retryInitialization'),
  'a bootstrap failure must provide a retry action');
assert.ok((gateSource.match(/resumeOfflineAfterNetworkFailure\(/g) || []).length >= 2,
  'cold-start and manual recovery must both call the shared offline resume path after a cloud outage');
assert.ok(gateSource.includes('acceptRuntime(offlineResumed)'),
  'offline recovery must accept the result returned by the offline resume, which clears the online session store');
assert.ok(decodedGateSource.includes('登录遇到问题') && decodedGateSource.includes('请重试'),
  'bootstrap failures must use concise, familiar login recovery copy');
for (const rejectedFailureCopy of ['暂时无法打开登录', '身份验证未完成', '重新检查', '重新打开']) {
  assert.ok(!decodedGateSource.includes(rejectedFailureCopy),
    `login recovery must not expose awkward implementation copy: ${rejectedFailureCopy}`);
}
assert.ok(!identityErrorSource.includes('Error invoking remote method'));
for (const rejectedErrorCopy of [
  '\u767b\u5f55\u6682\u65f6\u65e0\u6cd5\u6253\u5f00',
  '\u6682\u65f6\u65e0\u6cd5\u6253\u5f00\u767b\u5f55',
  '\u5173\u95ed\u540e\u91cd\u65b0\u6253\u5f00',
  '\u8eab\u4efd\u9a8c\u8bc1\u672a\u5b8c\u6210',
  '\u8bbe\u5907\u6838\u9a8c',
  '\u5f00\u53d1\u8005',
]) assert.ok(!decodedGateSource.includes(rejectedErrorCopy) && !decodedIdentityErrorSource.includes(rejectedErrorCopy),
  `desktop login must not expose internal recovery copy: ${rejectedErrorCopy}`);
assert.ok(!/关闭.{0,8}(?:再|重新)打开/.test(`${decodedGateSource}\n${decodedIdentityErrorSource}`),
  'desktop login recovery must never instruct the user to close and reopen the app');
assert.ok(gateSource.includes('const clearPendingVerificationState = useCallback'),
  'runtime acceptance and relocking must share one verification-secret cleanup boundary');
assert.ok((gateSource.match(/clearPendingVerificationState\(\);/g) || []).length >= 2,
  'both successful runtime acceptance and secure relock must clear pending verification state');
for (const cleanupAction of [
  'registrationFlowRef.current += 1', 'pollingFlowRef.current = null', 'setPolling(false)',
  'setPending(null)', "setAccountPassword('')", "setCloudPassword('')", "setCloudPasswordAgain('')",
]) assert.ok(gateSource.includes(cleanupAction), `verification cleanup must include: ${cleanupAction}`);
assert.ok(gateSource.includes('pending?.status === \'verified\'')
  && (gateSource.match(/onClick=\{returnToPasswordLogin\}/g) || []).length >= 2,
  'the verified state must still offer a safe return to password login/reset');
assert.ok(gateSource.includes('commitRoleSwitchRuntime({'),
  'role switching must use the ordering helper before installing the next identity partition');
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

(async () => {
  const {
    claimAutomaticDesktopRegistration,
    commitRoleSwitchRuntime,
    resumeOfflineAfterNetworkFailure,
  } = await import('../services/desktopIdentityGateRuntime.mjs');

  const attemptRef = { current: null };
  const verified = { status: 'verified', verificationToken: 'verified-token', desktopAccess: { access: 'allowed' } };
  assert.strictEqual(claimAutomaticDesktopRegistration({ pending: { ...verified, status: 'awaiting_online_verification' }, attemptRef }), false);
  assert.strictEqual(claimAutomaticDesktopRegistration({ pending: { ...verified, desktopAccess: { access: 'teacher_registration_required' } }, attemptRef }), false);
  assert.strictEqual(claimAutomaticDesktopRegistration({ pending: verified, attemptRef }), true);
  assert.strictEqual(claimAutomaticDesktopRegistration({ pending: { ...verified }, attemptRef }), false,
    'rerenders and repeated verification polling must not register the device twice');
  assert.strictEqual(claimAutomaticDesktopRegistration({ pending: { ...verified, verificationToken: 'next-token' }, attemptRef }), true);
  assert.ok(gateSource.includes('claimAutomaticDesktopRegistration({ pending, attemptRef: automaticRegistrationRef })'));
  assert.ok(!decodedGateSource.includes("{'进入格物工坊'}"), 'a verified login must not require another enter button');

  const offlineCalls = [];
  const offlineResult = { gateState: { kind: 'offline-unlocked' } };
  const resumed = await resumeOfflineAfterNetworkFailure({
    client: { resume: async input => { offlineCalls.push(input); return offlineResult; } },
    baseUrl: 'http://127.0.0.1:3001',
  });
  assert.deepStrictEqual(offlineCalls, [{ baseUrl: 'http://127.0.0.1:3001', online: false }]);
  assert.strictEqual(resumed, offlineResult);

  const switched = { token: 'next-session' };
  const events = [];
  let currentSession = null;
  const onlineSessionRef = {};
  Object.defineProperty(onlineSessionRef, 'current', {
    get: () => currentSession,
    set: value => { currentSession = value; events.push('ref'); },
  });
  await commitRoleSwitchRuntime({
    switched,
    onlineSessionRef,
    resolveNext: async () => {
      assert.strictEqual(currentSession, switched);
      events.push('resolve');
      return { kind: 'online-unlocked', partitionKey: 'user:teacher' };
    },
    setOnlineSession: value => { assert.strictEqual(currentSession, switched); events.push('state'); },
    installIdentityContext: () => { assert.strictEqual(currentSession, switched); events.push('partition'); },
    setGateState: () => { assert.strictEqual(currentSession, switched); events.push('gate'); },
    setRuntimeSuspended: () => { assert.strictEqual(currentSession, switched); events.push('runtime'); },
  });
  assert.strictEqual(events[0], 'ref', 'the session ref must update before any state/provider/partition consumer');
  assert.ok(events.indexOf('ref') < events.indexOf('resolve'));
  assert.ok(events.indexOf('ref') < events.indexOf('partition'));

  console.log('desktop identity gate source and behavior checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
