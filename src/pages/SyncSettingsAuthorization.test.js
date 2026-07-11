const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('src/pages/SyncSettings.tsx','utf8');
assert.ok(source.includes('readDesktopAuthorizationSession'));
assert.ok((source.match(/sessionResolver: \(\) => readDesktopAuthorizationSession\(\)/g) || []).length >= 3,
  'discovered LAN, manual LAN, and cloud transports must resolve the current desktop session');
assert.ok(source.includes('handleStartPairing') && source.includes('handleRefreshPairing') && source.includes('pollOrExchange'),
  'SyncSettings must expose the minimal pairing writer and manual refresh flow');
console.log('SyncSettings authorization wiring tests passed');
