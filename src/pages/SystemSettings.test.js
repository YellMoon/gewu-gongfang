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
assert.ok(source.includes('\\u540c\\u6b65\\u8bf4\\u660e'),
  'the settings page must explain offline drafts in user language');
assert.ok(!source.includes('\\u4e91\\u7aef\\u88c1\\u51b3'),
  'the settings page must not expose cloud-authority implementation wording');

console.log('unified system settings UI checks passed');
