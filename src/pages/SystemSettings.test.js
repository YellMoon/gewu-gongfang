'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(__dirname + '/SystemSettings.tsx', 'utf8');
assert.ok(source.includes('primaryHostRuntime?.firewallStatus'));
assert.ok(source.includes('primaryHostRuntime?.enableLanFirewall'));
assert.ok(source.includes('loadWindowsHostFirewallStatus'));
assert.ok(source.includes('requestWindowsHostLanFirewall'));
assert.ok(source.includes('\\u672c\\u5730\\u5b50\\u7f51'));
assert.ok(source.includes('elevation-requested'));
assert.ok(source.includes('\\u5c40\\u57df\\u7f51\\u76f4\\u8fde\\uff08\\u53ef\\u9009\\uff09'));
assert.ok(source.includes('\\u4e91\\u4e2d\\u7ee7\\u59cb\\u7ec8\\u53ef\\u7528\\uff0c\\u65e0\\u9700\\u8bbe\\u7f6e Windows \\u9632\\u706b\\u5899'));
assert.ok(source.includes('\\u542f\\u7528\\u5c40\\u57df\\u7f51\\u76f4\\u8fde'));
assert.ok(source.includes('\\u4e0d\\u9700\\u8981\\u624b\\u5de5\\u521b\\u5efa\\u9632\\u706b\\u5899\\u89c4\\u5219'));
assert.ok(source.includes('\\u662f\\u5426\\u542f\\u7528\\u5c40\\u57df\\u7f51\\u76f4\\u8fde\\uff1f'));
assert.ok(!source.includes('message="LAN access"'));
assert.ok(!source.includes('Enable LAN access'));

console.log('system settings firewall UI checks passed');
