const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/runtimeConfigClient.ts', 'utf-8');
const settingsSource = fs.readFileSync('src/pages/SystemSettings.tsx', 'utf-8')
  .replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));

assert.ok(source.includes("runtime-config:get"), 'client should call runtime-config:get');
assert.ok(
  !source.includes('desktopSyncToken'),
  'renderer runtime config must not expose the retired shared desktop sync secret'
);
assert.ok(source.includes('desktopIdentityMode'), 'client runtime config should expose managed desktop identity mode');
assert.ok(source.includes('getRuntimeConfig'), 'client should export getRuntimeConfig');
assert.ok(!source.includes('primary-host'), 'renderer runtime config must not retain a host build role');
assert.ok(!source.includes('hostBaseUrl'), 'renderer runtime config must not expose a local authority endpoint');
assert.ok(!source.includes('saveRuntimeConfig'), 'renderer runtime config must not offer local authority configuration writes');
assert.ok(!settingsSource.includes('name="desktopSyncToken"'), 'ordinary settings must not expose the legacy shared sync secret');
assert.ok(!settingsSource.includes('primary-host'), 'settings must not expose a host role');
