const assert = require('assert');
const fs = require('fs');

const indexSource = fs.readFileSync('src/index.tsx', 'utf8');
const gateSource = fs.readFileSync('src/components/DesktopIdentityGate.tsx', 'utf8');
const decodedGateSource = gateSource.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => (
  String.fromCharCode(Number.parseInt(hex, 16))
));
const gateStyle = fs.readFileSync('src/components/DesktopIdentityGate.css', 'utf8');
const appSource = fs.readFileSync('src/App.tsx', 'utf8');

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
assert.ok(gateSource.includes('canStartBusinessRuntime'));
assert.ok(gateSource.includes('desktopIdentityExpiryDelay'));
assert.ok(gateSource.includes('const secureRelock = useCallback'));
assert.ok(gateSource.includes('clearCurrentDesktopIdentityPartition(window)'));
assert.ok(gateSource.includes("gateState.kind === 'offline-unlocked'"));
assert.ok(gateSource.includes("{ kind: 'offline-blocked' }"));
assert.ok(gateSource.includes('<QRCode'), 'new-device registration must render the backend challenge QR value');
assert.ok(gateSource.includes('请输入本机密码'));
assert.ok(decodedGateSource.includes('忘记本机密码？重新核验身份并重设'));
assert.ok(gateSource.includes('beginPasswordReset'));
assert.ok(gateSource.includes("pending?.challenge?.purpose === 'password_reset'"));
assert.ok(decodedGateSource.includes('不会删除本机数据或待同步变更'));
assert.ok(decodedGateSource.includes('眼睛按钮只显示本次输入'));
assert.ok(gateSource.includes('等待另一台已授权设备审核'));
assert.ok(gateSource.includes('retryRegistration'));
assert.ok(gateSource.includes('离线身份租约已过期'));
assert.ok(gateSource.includes('desktop-identity-runtime--offline'));
assert.ok(gateStyle.includes('.desktop-identity-runtime--offline > .app-shell'));
assert.ok(gateStyle.includes('.desktop-identity-runtime--offline .desktop-identity-runtime-bar'));
assert.ok(appSource.includes('processMiniappCloudTasks'));
assert.ok(appSource.includes('publishCloudHeartbeat'));

console.log('desktop identity gate source checks passed');
