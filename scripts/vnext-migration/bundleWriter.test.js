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
      { sourceId: 'authority-db', kind: 'sqlite', pathHash: 'a'.repeat(64), label: 'authority-db', availability: 'available', inventoryId: 'authority-db' },
    ],
  });
}

try {
  const bundlePath = path.join(workspace, 'inventory-bundle');
  const result = writeInventoryBundle({
    bundlePath,
    manifest: manifest(),
    inventory: { schemaVersion: 1, sources: { 'authority-db': { quickCheck: 'ok', inventoryHash: 'b'.repeat(64) } } },
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

  const unavailableBundlePath = path.join(workspace, 'unavailable-bundle');
  const unavailableManifest = createInventoryManifest({
    bundleId: 'bundle-unavailable',
    createdAt: '2026-08-13T00:00:00.000Z',
    sourceVersion: 'legacy-desktop',
    sources: [
      { sourceId: 'authority-db', kind: 'sqlite', pathHash: 'a'.repeat(64), label: 'authority-db', availability: 'available', inventoryId: 'authority-db' },
      { sourceId: 'question-files', kind: 'filesystem', pathHash: 'c'.repeat(64), label: 'question-files', availability: 'unavailable', inventoryId: null },
    ],
  });
  writeInventoryBundle({
    bundlePath: unavailableBundlePath,
    manifest: unavailableManifest,
    inventory: { schemaVersion: 1, sources: { 'authority-db': { quickCheck: 'ok', inventoryHash: 'b'.repeat(64) } } },
    ledger: [
      { sourceId: 'authority-db', sourceType: 'sqlite', sourceRecordId: null, sourceHash: 'b'.repeat(64), status: 'discovered', targetType: null, targetRecordId: null, targetHash: null, conflictCode: null },
      { sourceId: 'question-files', sourceType: 'filesystem', sourceRecordId: null, sourceHash: null, status: 'unavailable', targetType: null, targetRecordId: null, targetHash: null, conflictCode: 'MIGRATION_CONFIGURED_SOURCE_UNAVAILABLE' },
    ],
    unresolved: [{ sourceId: 'question-files', kind: 'filesystem', pathHash: 'c'.repeat(64), code: 'MIGRATION_CONFIGURED_SOURCE_UNAVAILABLE' }],
  });
  assert.strictEqual(verifyInventoryBundle({ bundlePath: unavailableBundlePath }).bundleId, 'bundle-unavailable');
  const missingUnresolvedPath = path.join(workspace, 'missing-unresolved');
  assert.throws(
    () => writeInventoryBundle({
      bundlePath: missingUnresolvedPath,
      manifest: unavailableManifest,
      inventory: { schemaVersion: 1, sources: { 'authority-db': { quickCheck: 'ok', inventoryHash: 'b'.repeat(64) } } },
      ledger: [
        { sourceId: 'authority-db', sourceType: 'sqlite', sourceRecordId: null, sourceHash: 'b'.repeat(64), status: 'discovered', targetType: null, targetRecordId: null, targetHash: null, conflictCode: null },
        { sourceId: 'question-files', sourceType: 'filesystem', sourceRecordId: null, sourceHash: null, status: 'unavailable', targetType: null, targetRecordId: null, targetHash: null, conflictCode: 'MIGRATION_CONFIGURED_SOURCE_UNAVAILABLE' },
      ],
      unresolved: [],
    }),
    error => error && error.code === 'MIGRATION_BUNDLE_SOURCE_COVERAGE_INVALID',
  );

  const extraBundlePath = path.join(workspace, 'extra-bundle');
  writeInventoryBundle({
    bundlePath: extraBundlePath,
    manifest: manifest('bundle-extra'),
    inventory: { schemaVersion: 1, sources: { 'authority-db': { quickCheck: 'ok', inventoryHash: 'b'.repeat(64) } } },
    ledger: [{
      sourceId: 'authority-db', sourceType: 'sqlite', sourceRecordId: null,
      sourceHash: 'b'.repeat(64), status: 'discovered', targetType: null,
      targetRecordId: null, targetHash: null, conflictCode: null,
    }],
    unresolved: [],
  });
  fs.writeFileSync(path.join(extraBundlePath, 'reports', 'unexpected.json'), '{}\n', 'utf8');
  assert.throws(
    () => verifyInventoryBundle({ bundlePath: extraBundlePath }),
    error => error && error.code === 'MIGRATION_BUNDLE_UNEXPECTED_FILE',
  );
  fs.rmSync(path.join(extraBundlePath, 'reports', 'unexpected.json'));
  fs.mkdirSync(path.join(extraBundlePath, 'empty-extra'));
  assert.throws(
    () => verifyInventoryBundle({ bundlePath: extraBundlePath }),
    error => error && error.code === 'MIGRATION_BUNDLE_UNEXPECTED_FILE',
  );

  const inconsistentPath = path.join(workspace, 'inconsistent-bundle');
  assert.throws(
    () => writeInventoryBundle({
      bundlePath: inconsistentPath,
      manifest: manifest('bundle-inconsistent'),
      inventory: { schemaVersion: 1, sources: {} },
      ledger: [{
        sourceId: 'authority-db', sourceType: 'sqlite', sourceRecordId: null,
        sourceHash: 'b'.repeat(64), status: 'discovered', targetType: null,
        targetRecordId: null, targetHash: null, conflictCode: null,
      }],
      unresolved: [],
    }),
    error => error && error.code === 'MIGRATION_BUNDLE_SOURCE_COVERAGE_INVALID',
  );
  assert.ok(!fs.existsSync(inconsistentPath));

  assert.throws(
    () => writeInventoryBundle({ bundlePath, manifest: manifest('bundle-test-2'), inventory: {}, ledger: [], unresolved: [] }),
    error => error && error.code === 'MIGRATION_BUNDLE_ALREADY_EXISTS',
  );

  const badBundlePath = path.join(workspace, 'bad-bundle');
  assert.throws(
    () => writeInventoryBundle({
      bundlePath: badBundlePath,
      manifest: { ...manifest('bundle-bad'), status: 'partial' },
      inventory: { schemaVersion: 1, sources: { 'authority-db': { inventoryHash: 'b'.repeat(64) } } }, ledger: [], unresolved: [],
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
