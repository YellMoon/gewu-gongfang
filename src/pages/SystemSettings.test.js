'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(__dirname + '/SystemSettings.tsx', 'utf8');
assert.ok(source.includes('primaryHostRuntime?.firewallStatus'));
assert.ok(source.includes('primaryHostRuntime?.enableLanFirewall'));
assert.ok(source.includes('loadWindowsHostFirewallStatus'));
assert.ok(source.includes('requestWindowsHostLanFirewall'));
assert.ok(source.includes('LocalSubnet'));
assert.ok(source.includes('elevation-requested'));

console.log('system settings firewall UI checks passed');
