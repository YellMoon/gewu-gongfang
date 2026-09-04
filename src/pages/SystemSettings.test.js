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
assert.ok(!/>\\u[0-9a-f]{4}/iu.test(source),
  'visible JSX text nodes must not render escaped Unicode code points to users');
assert.ok(source.includes("import desktopPackage from '../../package.json'"),
  'the displayed desktop version must come from the installer package manifest');
assert.ok(source.includes('desktopPackage.version'),
  'the settings page must display the exact installer package version');
assert.ok(!source.includes('../generated/version'),
  'the settings page must not display a stale generated build artifact version');

console.log('unified system settings UI checks passed');
