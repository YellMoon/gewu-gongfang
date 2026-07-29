'use strict';

const assert = require('assert');
const {
  buildLanE2ePreflight,
  runLanE2ePreflight,
} = require('./windowsFirewallE2ePreflight');

const stableHost = {
  platform: 'win32',
  hostExe: 'C:\\Program Files\\GewuGongfang E2E Host\\GewuGongfang.exe',
  hostPort: 60462,
  helperPath: 'C:\\Program Files\\GewuGongfang E2E Host\\resources\\app\\public\\windowsHostFirewallElevated.ps1',
  clientBackendUrl: 'http://127.0.0.1:60463',
};

const plan = buildLanE2ePreflight(stableHost);
assert.strictEqual(plan.required, true);
assert.strictEqual(plan.clientBackendLoopback, true);
assert.strictEqual(plan.request.action, undefined);
assert.strictEqual(plan.request.args.includes('ensure'), false);
assert.ok(plan.request.args.includes('audit'));

assert.throws(
  () => buildLanE2ePreflight({ ...stableHost, hostExe: 'C:\\work\\tmp-host\\win-unpacked\\GewuGongfang.exe' }),
  /LAN_E2E_STABLE_HOST_EXE_REQUIRED/
);
assert.throws(
  () => buildLanE2ePreflight({ ...stableHost, clientBackendUrl: 'http://192.168.1.8:60463' }),
  /LAN_E2E_CLIENT_LOOPBACK_REQUIRED/
);

const audit = runLanE2ePreflight({
  ...stableHost,
  execFileSync(command, args, options) {
    assert.strictEqual(command, 'powershell.exe');
    assert.ok(args.includes('-File'));
    assert.ok(args.includes('audit'));
    assert.strictEqual(options.windowsHide, true);
    return '{"managed":true,"state":"enabled","localPort":60462}';
  },
});
assert.strictEqual(audit.state, 'enabled');

assert.throws(
  () => runLanE2ePreflight({
    ...stableHost,
    execFileSync() { return '{"managed":false,"state":"missing"}'; },
  }),
  /LAN_E2E_FIREWALL_RULE_REQUIRED/
);

console.log('windows firewall E2E preflight checks passed');
