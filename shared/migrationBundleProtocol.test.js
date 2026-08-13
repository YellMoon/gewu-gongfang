'use strict';

const assert = require('assert');

const {
  BUNDLE_SCHEMA_VERSION,
  LEDGER_STATUSES,
  SOURCE_KINDS,
  canonicalJson,
  createInventoryManifest,
  validateLedgerEntry,
  validateManifest,
} = require('./migrationBundleProtocol');

const manifest = createInventoryManifest({
  bundleId: 'bundle-001',
  createdAt: '2026-08-13T00:00:00.000Z',
  sourceVersion: '8.0.2',
  sources: [
    { sourceId: 'question-files', kind: 'filesystem', pathHash: 'b'.repeat(64), label: 'question-files', availability: 'unavailable', inventoryId: null },
    { sourceId: 'authority-db', kind: 'sqlite', pathHash: 'a'.repeat(64), label: 'authority-db', availability: 'available', inventoryId: 'authority-db' },
  ],
});

assert.strictEqual(BUNDLE_SCHEMA_VERSION, 2);
assert.strictEqual(manifest.schemaVersion, 2);
assert.strictEqual(manifest.mode, 'inventory-only');
assert.strictEqual(manifest.status, 'complete');
assert.deepStrictEqual(manifest.sources.map(source => source.sourceId), ['authority-db', 'question-files']);
assert.strictEqual(manifest.sources[0].inventoryId, 'authority-db');
assert.strictEqual(manifest.sources[1].availability, 'unavailable');
assert.deepStrictEqual(validateManifest(manifest), manifest);
assert.ok(Object.isFrozen(manifest));
assert.ok(Object.isFrozen(manifest.sources));
assert.ok(Object.isFrozen(manifest.sources[0]));
assert.ok(!JSON.stringify(manifest).includes('C:\\Users'));

assert.deepStrictEqual(SOURCE_KINDS, ['sqlite', 'filesystem', 'desktop-export', 'cloud-control']);
assert.deepStrictEqual(LEDGER_STATUSES, [
  'discovered',
  'migrated',
  'archived',
  'quarantined',
  'unavailable',
  'intentionally_excluded',
]);

assert.strictEqual(
  canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [{ z: 4, a: 5 }] }),
  '{"a":{"b":3,"y":2},"list":[{"a":5,"z":4}],"z":1}',
);

assert.deepStrictEqual(validateLedgerEntry({
  sourceId: 'authority-db',
  sourceType: 'sqlite',
  sourceRecordId: 'users:1',
  sourceHash: 'c'.repeat(64),
  status: 'discovered',
  targetType: null,
  targetRecordId: null,
  targetHash: null,
  conflictCode: null,
}), {
  sourceId: 'authority-db',
  sourceType: 'sqlite',
  sourceRecordId: 'users:1',
  sourceHash: 'c'.repeat(64),
  status: 'discovered',
  targetType: null,
  targetRecordId: null,
  targetHash: null,
  conflictCode: null,
});

assert.throws(
  () => validateLedgerEntry({ sourceId: 'authority-db', sourceType: 'sqlite', status: 'lost' }),
  error => error && error.code === 'MIGRATION_LEDGER_STATUS_INVALID',
);
assert.throws(
  () => createInventoryManifest({
    bundleId: 'bundle-duplicate',
    createdAt: '2026-08-13T00:00:00.000Z',
    sourceVersion: '8.0.2',
    sources: [
      { sourceId: 'same', kind: 'sqlite', pathHash: 'a'.repeat(64), availability: 'available', inventoryId: 'same' },
      { sourceId: 'same', kind: 'filesystem', pathHash: 'b'.repeat(64), availability: 'available', inventoryId: 'same' },
    ],
  }),
  error => error && error.code === 'MIGRATION_SOURCE_ID_DUPLICATE',
);
assert.throws(
  () => createInventoryManifest({
    bundleId: 'bundle-raw-path',
    createdAt: '2026-08-13T00:00:00.000Z',
    sourceVersion: '8.0.2',
    sources: [{ sourceId: 'db', kind: 'sqlite', pathHash: 'a'.repeat(64), availability: 'available', inventoryId: 'db', path: 'C:\\Users\\private\\db.sqlite' }],
  }),
  error => error && error.code === 'MIGRATION_SOURCE_FIELD_FORBIDDEN',
);
assert.throws(
  () => createInventoryManifest({
    bundleId: 'bundle-availability',
    createdAt: '2026-08-13T00:00:00.000Z',
    sourceVersion: '8.0.2',
    sources: [{ sourceId: 'db', kind: 'sqlite', pathHash: 'a'.repeat(64), availability: 'unavailable', inventoryId: 'db' }],
  }),
  error => error && error.code === 'MIGRATION_SOURCE_INVENTORY_MAPPING_INVALID',
);
assert.throws(
  () => validateManifest({ ...manifest, schemaVersion: 3 }),
  error => error && error.code === 'MIGRATION_BUNDLE_SCHEMA_UNSUPPORTED',
);

console.log('migration bundle protocol checks passed');
