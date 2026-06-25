const assert = require('assert');
const fs = require('fs');

const sync = fs.readFileSync('miniapp/src/utils/sync.ts', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(sync.includes('addPendingChange'), 'miniapp sync facade should import addPendingChange');
assert.ok(sync.includes("action: 'update'"), 'updateLocalItem should enqueue update changes');
assert.ok(sync.includes("action: 'create'"), 'addLocalItem should enqueue create changes');
assert.ok(sync.includes("action: 'delete'"), 'removeLocalItem should enqueue delete changes');
assert.ok(sync.includes('timestamp: Date.now()'), 'queued local changes should include a timestamp');
assert.ok(packageJson.includes('miniapp/src/utils/miniappOfflineQueue.test.js'), 'miniapp offline queue test should run in npm test');

console.log('miniapp offline queue checks passed');
