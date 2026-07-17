const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('src/pages/SyncSettings.tsx','utf8');
assert.ok(source.includes('readDesktopAuthorizationSession') && source.includes('hydrateDesktopAuthorizationSession'));
assert.ok(source.includes('resolveOnlineSyncActor') && source.includes('requireOnlineSession'),
  'one-click sync must resolve a current online V2 desktop session before transport selection');
assert.ok(!source.includes('pairingPhone') && !source.includes("phone: pairing"), 'desktop pairing must never accept a phone number');
assert.ok(!source.includes('message="\\u') && !source.includes('description="\\u'), 'escaped CJK copy must be evaluated instead of rendered literally');
assert.ok((source.match(/sessionResolver: requireOnlineSession/g) || []).length >= 3,
  'discovered LAN, manual LAN, and cloud transports must share the same online V2 session resolver');
assert.ok(source.includes('requireOnlineSession,\n        buildLocalDataMaps'),
  'the sync orchestrator must fail before discovery when only an offline lease is available');
assert.ok(!source.includes('startPairing') && !source.includes('pollOrExchange'),
  'SyncSettings must not expose the removed V1 pairing flow after the startup identity gate');
assert.ok(source.includes('桌面启动身份门统一完成'),
  'SyncSettings must direct identity management to the startup identity gate');
const permissionManager=fs.readFileSync('src/pages/PermissionManager.tsx','utf8');
const appNavigation=fs.readFileSync('src/navigation/appNavigation.tsx','utf8');
const identityDeviceCenter=fs.readFileSync('src/pages/IdentityDeviceCenter.tsx','utf8');
const identityDeviceCenterPolicy=fs.readFileSync('src/services/identityDeviceCenterPolicy.mjs','utf8');
const miniappUsers=fs.readFileSync('miniapp/src/pages/admin/users/index.tsx','utf8');
const miniappApi=fs.readFileSync('miniapp/src/utils/api.ts','utf8');
assert.strictEqual(fs.existsSync('src/components/PairingReviewPanel.tsx'), false, 'legacy V1 pairing review panel must be removed');
assert.ok(!permissionManager.includes('PairingReviewPanel'));
assert.ok(appNavigation.includes("'identity-devices'") && appNavigation.includes('identityDeviceNavItem'));
assert.ok(identityDeviceCenterPolicy.includes('/api/desktop-identity/authorizations/pending'));
assert.ok(!identityDeviceCenter.includes('selectedUsers') && !identityDeviceCenter.includes('{ userId }'));
assert.ok(!miniappUsers.includes('getPendingPairings') && !miniappUsers.includes('reviewPairingCode')
  && !miniappUsers.includes('pairingUsers') && !miniappUsers.includes('选择绑定账号'),
  'miniapp user review must not retain the V1 arbitrary account selector');
assert.ok(!miniappApi.includes('/api/desktop-pairing'), 'miniapp API must not call the removed V1 pairing control plane');
console.log('SyncSettings authorization wiring tests passed');
