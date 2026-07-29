const assert = require('assert');
const fs = require('fs');

const sync = fs.readFileSync('miniapp/src/utils/sync.ts', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(!sync.includes('addPendingChange'), 'miniapp sync facade must not enqueue core-table mutations');
assert.ok(sync.includes('requestAuthorityProjection'), 'miniapp sync facade should refresh its scoped authority projection');
assert.ok(sync.includes('MINIAPP_CORE_EDIT_REQUIRES_AUTHORITY_HOST'), 'legacy core edits must fail closed');
for (const mutation of ['updateLocalItem', 'addLocalItem', 'removeLocalItem']) {
  assert.ok(
    sync.includes(`export function ${mutation}`) && sync.includes('rejectLegacyCoreMutation();'),
    `${mutation} must reject legacy local core mutation`,
  );
}
assert.ok(packageJson.includes('miniapp/src/utils/miniappOfflineQueue.test.js'), 'miniapp offline queue test should run in npm test');

console.log('miniapp authority projection and core-mutation retirement checks passed');
