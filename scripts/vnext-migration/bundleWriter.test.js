'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createInventoryManifest } = require('../../shared/migrationBundleProtocol');
const { verifyInventoryBundle, writeInventoryBundle } = require('./bundleWriter');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-bundle-writer-'));

function manifest(bundleId = 'bundle-test-1') {
  return createInventoryManifest({
    bundleId,
    createdAt: '2026-08-13T00:00:00.000Z',
    sourceVersion: 'legacy-desktop',
    sources: [
      { sourceId: 'authority-db', kind: 'sqlite', pathHash: 'a'.repeat(64), label: 'authority-db' },
    ],
  });
}

try {
  const bundlePath = path.join(workspace, 'inventory-bundle');
  const result = writeInventoryBundle({
    bundlePath,
    manifest: manifest(),
    inventory: { sources: { 'authority-db': { quickCheck: 'ok', inventoryHash: 'b'.repeat(64) } } },
    ledger: [{
      sourceId: 'authority-db', sourceType: 'sqlite', sourceRecordId: null,
      sourceHash: 'b'.repeat(64), status: 'discovered', targetType: null,
      targetRecordId: null, targetHash: null, conflictCode: null,
    }],
    unresolved: [],
  });

  assert.ok(fs.statSync(bundlePath).isDirectory());
  assert.ok(!fs.existsSync(`${bundlePath}.partial`));
  assert.deepStrictEqual(
    fs.readdirSync(path.join(bundlePath, 'reports')).sort(),
    ['inventory.json', 'migration-ledger.json', 'unresolved.json'],
  );
  assert.deepStrictEqual(fs.readdirSync(path.join(bundlePath, 'checksums')), ['sha256sums.json']);
  assert.match(result.bundleHash, /^[a-f0-9]{64}$/);

  const verified = verifyInventoryBundle({ bundlePath });
  assert.strictEqual(verified.bundleHash, result.bundleHash);
  assert.strictEqual(verified.fileCount, 4);

  assert.throws(
    () => writeInventoryBundle({ bundlePath, manifest: manifest('bundle-test-2'), inventory: {}, ledger: [], unresolved: [] }),
    error => error && error.code === 'MIGRATION_BUNDLE_ALREADY_EXISTS',
  );

  const badBundlePath = path.join(workspace, 'bad-bundle');
  assert.throws(
    () => writeInventoryBundle({
      bundlePath: badBundlePath,
      manifest: { ...manifest('bundle-bad'), status: 'partial' },
      inventory: {}, ledger: [], unresolved: [],
    }),
    error => error && error.code === 'MIGRATION_BUNDLE_STATUS_INVALID',
  );
  assert.ok(!fs.existsSync(badBundlePath));

  fs.writeFileSync(path.join(bundlePath, 'reports', 'inventory.json'), '{"tampered":true}\n', 'utf8');
  assert.throws(
    () => verifyInventoryBundle({ bundlePath }),
    error => error && error.code === 'MIGRATION_BUNDLE_CHECKSUM_MISMATCH',
  );

  const partialPath = path.join(workspace, 'interrupted.partial');
  fs.mkdirSync(partialPath);
  assert.throws(
    () => writeInventoryBundle({
      bundlePath: path.join(workspace, 'interrupted'),
      manifest: manifest('bundle-interrupted'), inventory: {}, ledger: [], unresolved: [],
    }),
    error => error && error.code === 'MIGRATION_BUNDLE_PARTIAL_EXISTS',
  );
  assert.ok(!fs.existsSync(path.join(workspace, 'interrupted')));
  assert.ok(fs.existsSync(partialPath));

  console.log('atomic migration inventory bundle checks passed');
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
