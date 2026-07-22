const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/runtimeConfigClient.ts', 'utf-8');
const settingsSource = fs.readFileSync('src/pages/SystemSettings.tsx', 'utf-8')
  .replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));

assert.ok(source.includes("runtime-config:get"), 'client should call runtime-config:get');
assert.ok(source.includes("runtime-config:set"), 'client should call runtime-config:set');
assert.ok(source.includes('questionBankCandidatePaths'), 'client runtime config should include hotplug candidate paths');
assert.ok(source.includes('questionBankStoreId'), 'client runtime config should include question bank store id');
assert.ok(source.includes('desktopSyncToken'), 'client runtime config should include desktop sync token');
assert.ok(source.includes('primaryHostEpochId') && source.includes('primaryHostGeneration'), 'client must expose managed host epoch metadata');
assert.ok(source.includes('localCachePath'), 'client runtime config should include local cache path');
assert.ok(source.includes('nasBackupPath'), 'client runtime config should include NAS backup path');
assert.ok(source.includes('desktopIdentityMode'), 'client runtime config should expose managed desktop identity mode');
assert.ok(source.includes("dialog:select-folder"), 'client should call dialog:select-folder');
assert.ok(source.includes('getRuntimeConfig'), 'client should export getRuntimeConfig');
assert.ok(source.includes('saveRuntimeConfig'), 'client should export saveRuntimeConfig');
assert.ok(settingsSource.includes('<Select\n              disabled'), 'ordinary settings must render the host-role selector as immutable');
assert.ok(settingsSource.includes('nodeRole: _managedNodeRole') && settingsSource.includes('saveRuntimeConfig(editableValues)'),
  'ordinary settings must strip managed host identity fields before saving editable paths');
assert.ok(!settingsSource.includes('name="desktopSyncToken"'), 'ordinary settings must not expose the legacy shared sync secret');
assert.ok(settingsSource.includes('主机身份由“身份与设备”中心管理'), 'settings must explain where host identity is managed');
