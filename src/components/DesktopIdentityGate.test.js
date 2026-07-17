const assert = require('assert');
const fs = require('fs');

const indexSource = fs.readFileSync('src/index.tsx', 'utf8');
const gateSource = fs.readFileSync('src/components/DesktopIdentityGate.tsx', 'utf8');
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
assert.ok(gateSource.includes('等待另一台已授权设备审核'));
assert.ok(gateSource.includes('retryRegistration'));
assert.ok(gateSource.includes('离线身份租约已过期'));
assert.ok(appSource.includes('processMiniappCloudTasks'));
assert.ok(appSource.includes('publishCloudHeartbeat'));

console.log('desktop identity gate source checks passed');
