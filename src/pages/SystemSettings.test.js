'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(__dirname + '/SystemSettings.tsx', 'utf8');
assert.ok(source.includes('<SyncSettings variant="advanced" />'));
assert.ok(!source.includes('primaryHostRuntime'));
assert.ok(!source.includes('primary-host'));
assert.ok(!source.includes('hostBaseUrl'));
assert.ok(!source.includes('HostAuthorityExecutionMonitor'));
assert.ok(!source.includes('loadWindowsHostFirewallStatus'));
assert.ok(!source.includes('dbService.importAllData'));

console.log('unified system settings UI checks passed');
