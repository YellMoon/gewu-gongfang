const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  initQuestionBankStore,
  inspectQuestionBankStore,
  assertQuestionBankWritable,
  scanQuestionBankStores,
  findQuestionBankStore,
} = require('./questionBankStorageService');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-qb-store-'));
const deviceId = 'desktop_host_test';

const manifest = initQuestionBankStore(root, { deviceId });

assert.ok(manifest.storeId.startsWith('qb_'));
assert.strictEqual(manifest.schemaVersion, 1);
assert.strictEqual(manifest.lastMountedByDeviceId, deviceId);
assert.ok(fs.existsSync(path.join(root, 'manifest.json')));
assert.ok(fs.existsSync(path.join(root, 'assets', 'images')));
assert.ok(fs.existsSync(path.join(root, 'assets', 'word-imports')));
assert.ok(fs.existsSync(path.join(root, 'assets', 'exports')));
assert.ok(fs.existsSync(path.join(root, 'backups')));

const inspected = inspectQuestionBankStore(root);
assert.strictEqual(inspected.available, true);
assert.strictEqual(inspected.manifest.storeId, manifest.storeId);

assert.doesNotThrow(() => assertQuestionBankWritable(root, { nodeRole: 'primary-host', deviceId }));
assert.throws(
  () => assertQuestionBankWritable(root, { nodeRole: 'desktop-client', deviceId: 'client_a' }),
  /Only primary-host/
);
assert.throws(
  () => inspectQuestionBankStore(path.join(root, 'missing')),
  /not available/
);

const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-qb-store-second-'));
const missingRoot = path.join(os.tmpdir(), `gewu-qb-store-missing-${Date.now()}`);
const secondManifest = initQuestionBankStore(secondRoot, { deviceId: 'desktop_host_typec' });

const scan = scanQuestionBankStores([missingRoot, root, secondRoot]);
assert.strictEqual(scan.length, 3);
assert.strictEqual(scan[0].available, false);
assert.strictEqual(scan[0].status, 'offline');
assert.strictEqual(scan[1].available, true);
assert.strictEqual(scan[1].manifest.storeId, manifest.storeId);
assert.strictEqual(scan[2].available, true);
assert.strictEqual(scan[2].manifest.storeId, secondManifest.storeId);

const foundByStoreId = findQuestionBankStore([missingRoot, secondRoot], { storeId: secondManifest.storeId });
assert.strictEqual(foundByStoreId.status, 'online');
assert.strictEqual(foundByStoreId.root, secondRoot);

const missingByStoreId = findQuestionBankStore([root], { storeId: secondManifest.storeId });
assert.strictEqual(missingByStoreId.status, 'offline');
assert.strictEqual(missingByStoreId.available, false);

console.log('questionBankStorageService tests passed');
