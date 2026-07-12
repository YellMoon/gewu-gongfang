const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/cloudRelayHostApi.ts', 'utf-8');

assert.ok(source.includes('desktopSyncToken'), 'host relay client should read the desktop sync token from runtime config');
assert.ok(source.includes("'x-gewu-desktop-sync-token'"), 'host relay client should send the desktop sync token header to the local host API');
console.log('cloud relay host API checks passed');
