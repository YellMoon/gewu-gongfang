'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildWindowsHostFirewallPlan,
  buildElevatedFirewallRequest,
  parseFirewallAudit,
} = require('./windowsHostFirewall');

const stableHost = {
  platform: 'win32',
  isPackaged: true,
  nodeRole: 'primary-host',
  executablePath: 'C:\\Program Files\\GewuGongfang\\GewuGongfang.exe',
  port: 60462,
  helperPath: 'C:\\Program Files\\GewuGongfang\\resources\\app\\public\\windowsHostFirewallElevated.ps1',
};

const plan = buildWindowsHostFirewallPlan(stableHost);
assert.strictEqual(plan.allowed, true);
assert.strictEqual(plan.requiresExplicitAction, true);
assert.strictEqual(plan.rule.direction, 'in');
assert.strictEqual(plan.rule.profile, 'private');
assert.strictEqual(plan.rule.remoteAddress, 'LocalSubnet');
assert.strictEqual(plan.rule.program, stableHost.executablePath);
assert.strictEqual(plan.rule.localPort, 60462);
assert.ok(plan.rule.name.startsWith('GewuGongfang Primary Host LAN '));

for (const input of [
  { ...stableHost, nodeRole: 'desktop-client' },
  { ...stableHost, isPackaged: false },
  { ...stableHost, executablePath: 'C:\\Users\\test\\AppData\\Local\\Temp\\win-unpacked\\GewuGongfang.exe' },
  { ...stableHost, executablePath: 'C:\\build\\win-unpacked\\GewuGongfang.exe' },
  { ...stableHost, platform: 'linux' },
]) {
  const rejected = buildWindowsHostFirewallPlan(input);
  assert.strictEqual(rejected.allowed, false, JSON.stringify(input));
  assert.strictEqual(rejected.elevationAllowed, false, JSON.stringify(input));
}

const elevated = buildElevatedFirewallRequest({ ...stableHost, action: 'ensure' });
assert.strictEqual(elevated.allowed, true);
assert.strictEqual(elevated.action, 'ensure');
assert.strictEqual(elevated.command, 'powershell.exe');
assert.ok(elevated.args.includes('-EncodedCommand'));
assert.ok(!elevated.args.join(' ').includes(stableHost.executablePath), 'paths must remain inside the encoded command boundary');

assert.deepStrictEqual(parseFirewallAudit('{"managed":true,"state":"enabled"}'), {
  managed: true,
  state: 'enabled',
});
assert.throws(() => parseFirewallAudit('not-json'), /WINDOWS_FIREWALL_AUDIT_INVALID/);

const helperSource = fs.readFileSync(path.join(__dirname, 'windowsHostFirewallElevated.ps1'), 'utf8');
assert.ok(helperSource.includes("ValidateSet('audit', 'ensure', 'remove')"));
assert.ok(helperSource.includes('RemoteAddress LocalSubnet'));
assert.ok(helperSource.includes('Profile Private'));
assert.ok(helperSource.includes('Description -ne $RuleDescription'));
assert.ok(helperSource.includes("return @{ managed = $false; state = 'conflict'"));

console.log('windows host firewall checks passed');
