const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  initQuestionBankStore,
  inspectQuestionBankStore,
  assertQuestionBankWritable,
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
