const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/cloudRelayHostApi.ts', 'utf-8');

assert.ok(source.includes('readDesktopAuthorizationSession'), 'host relay client should use the current desktop authorization session');
assert.ok(source.includes('x-device-id'), 'host relay client should bind the local host request to the active desktop device');
assert.ok(source.includes('desktopIdentitySessionProvider?.ensureHostSync?.({'),
  'a primary host must exchange its cloud login for its own locally signed session before calling protected host relay APIs');
assert.ok(!source.includes('desktopSyncToken'), 'host relay client must not retain a shared relay secret');
console.log('cloud relay host API checks passed');
