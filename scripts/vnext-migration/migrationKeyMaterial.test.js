'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createExternalMigrationKeys, loadExternalMigrationKeys } = require('./migrationKeyMaterial');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-key-material-test-'));
const repositoryRoot = path.join(root, 'repository');
fs.mkdirSync(repositoryRoot);
try {
  const keyDirectory = path.join(root, 'external-keys');
  const created = createExternalMigrationKeys({ keyDirectory, repositoryRoot });
  assert.match(created.publicKeyFingerprint, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(fs.readdirSync(keyDirectory).sort(), [
    'encryption-key.b64', 'metadata.json', 'signing-private.pem', 'signing-public.pem',
  ]);
  const loaded = loadExternalMigrationKeys({ keyDirectory, repositoryRoot });
  assert.strictEqual(loaded.publicKeyFingerprint, created.publicKeyFingerprint);
  assert.strictEqual(loaded.encryptionKey.length, 32);
  assert.throws(
    () => createExternalMigrationKeys({ keyDirectory, repositoryRoot }),
    error => error && error.code === 'VNEXT_MIGRATION_KEY_DIRECTORY_EXISTS',
  );
  assert.throws(
    () => createExternalMigrationKeys({ keyDirectory: path.join(repositoryRoot, 'keys'), repositoryRoot }),
    error => error && error.code === 'VNEXT_MIGRATION_KEY_DIRECTORY_IN_REPOSITORY',
  );
  fs.writeFileSync(path.join(keyDirectory, 'unexpected'), 'no');
  assert.throws(
    () => loadExternalMigrationKeys({ keyDirectory, repositoryRoot }),
    error => error && error.code === 'VNEXT_MIGRATION_KEY_FILE_SET_INVALID',
  );
  console.log('external migration key material checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
