const assert = require('assert');
const fs = require('fs');

const syncSettings = fs.readFileSync('src/pages/SyncSettings.tsx', 'utf8');
const cloudSync = fs.readFileSync('src/pages/CloudSync.tsx', 'utf8');
const outboxPanel = fs.readFileSync('src/components/AuthorityOutboxPanel.tsx', 'utf8');
const todayWorkbench = fs.readFileSync('src/pages/TodayWorkbench.tsx', 'utf8');
const syncQuickPanel = fs.readFileSync('src/components/sync/SyncQuickPanel.tsx', 'utf8');
const preload = fs.readFileSync('public/preload.js', 'utf8');
const customTypes = fs.readFileSync('src/custom.d.ts', 'utf8');

for (const pageSource of [syncSettings, cloudSync]) {
  assert.ok(pageSource.includes('AuthorityOutboxPanel'),
    'each former sync page must render the authority outbox facade');
  for (const legacy of [
    'oneClickSync',
    'desktopAuthorizationSession',
    'desktopSessionRelayClient',
    'pairingApiBase',
    'SyncEngine',
    'browserDatabase',
    '/api/sync',
  ]) {
    assert.ok(!pageSource.includes(legacy), `${legacy} must not remain in a renderer sync page`);
  }
}

assert.ok(outboxPanel.includes('requireBridge().list()'));
assert.ok(outboxPanel.includes('requireBridge().confirmAndSubmit(item.id, cloudDraftSubmissionInput(item))'));
assert.ok(outboxPanel.includes('requireBridge().submit(item.id, cloudDraftSubmissionInput(item))'));
assert.ok(outboxPanel.includes('Modal.confirm'));
assert.ok(outboxPanel.includes('item.preview'));
assert.ok(!outboxPanel.includes('fetch('), 'renderer authority UI must never bypass the preload facade');
assert.ok(preload.includes("contextBridge.exposeInMainWorld('desktopAuthority'"));
assert.ok(customTypes.includes('desktopAuthority?:'));
for (const statusSurface of [todayWorkbench, syncQuickPanel]) {
  assert.ok(!statusSurface.includes('SyncEngine'),
    'desktop status surfaces must not read the retired raw-row sync engine');
  assert.ok(statusSurface.includes('desktopAuthority'),
    'desktop status surfaces must derive pending state from the authority outbox bridge');
}

const appNavigation = fs.readFileSync('src/navigation/appNavigation.tsx', 'utf8');
const identityDeviceCenter = fs.readFileSync('src/pages/IdentityDeviceCenter.tsx', 'utf8');
const identityDeviceCenterPolicy = fs.readFileSync('src/services/identityDeviceCenterPolicy.mjs', 'utf8');
const miniappApi = fs.readFileSync('miniapp/src/utils/api.ts', 'utf8');
assert.strictEqual(fs.existsSync('src/components/PairingReviewPanel.tsx'), false,
  'legacy V1 pairing review panel must be removed');
assert.strictEqual(fs.existsSync('src/pages/PermissionManager.tsx'), false,
  'the teacher desktop must not retain the retired account-role assignment workbench');
assert.ok(!appNavigation.includes("'permission'"),
  'the retired desktop permission-management route must be removed from navigation');
assert.ok(appNavigation.includes("'identity-devices'") && appNavigation.includes('identityDeviceNavItem'));
assert.ok(identityDeviceCenterPolicy.includes('/api/desktop-identity/devices'));
assert.ok(!identityDeviceCenterPolicy.includes('/api/desktop-identity/authorizations/pending'));
assert.ok(!identityDeviceCenter.includes('selectedUsers') && !identityDeviceCenter.includes('{ userId }'));
assert.strictEqual(fs.existsSync('miniapp/src/pages/admin/users/index.tsx'), false,
  'miniapp must not retain the retired arbitrary account-review page');
assert.ok(!miniappApi.includes('/api/desktop-pairing'),
  'miniapp API must not call the removed V1 pairing control plane');

console.log('SyncSettings authority facade wiring tests passed');
