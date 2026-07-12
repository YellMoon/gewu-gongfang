const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('src/pages/SyncSettings.tsx','utf8');
assert.ok(source.includes('readDesktopAuthorizationSession') && source.includes('hydrateDesktopAuthorizationSession'));
assert.ok(!source.includes('pairingPhone') && !source.includes("phone: pairing"), 'desktop pairing must never accept a phone number');
assert.ok((source.match(/sessionResolver: \(\) => readDesktopAuthorizationSession\(\)/g) || []).length >= 3,
  'discovered LAN, manual LAN, and cloud transports must resolve the current desktop session');
assert.ok(source.includes('handleStartPairing') && source.includes('handleRefreshPairing') && source.includes('pollOrExchange'),
  'SyncSettings must expose the minimal pairing writer and manual refresh flow');
const reviewPanel=fs.readFileSync('src/components/PairingReviewPanel.tsx','utf8');
const permissionManager=fs.readFileSync('src/pages/PermissionManager.tsx','utf8');
const miniappUsers=fs.readFileSync('miniapp/src/pages/admin/users/index.tsx','utf8');
assert.ok(reviewPanel.includes('/pending?code=')&&reviewPanel.includes('/code/${pairingCode}/${action}')&&reviewPanel.includes('{ userId }'));
assert.ok(permissionManager.includes('<PairingReviewPanel users={rows}'));
assert.ok(miniappUsers.includes('getPendingPairings')&&miniappUsers.includes('reviewPairingCode'));
console.log('SyncSettings authorization wiring tests passed');
