'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DISPOSITIONS,
  evaluateCriticalSourceReadiness,
  loadSourceTableCatalog,
  validateSourceTableCatalog,
} = require('./sourceTableCatalog');

const fixturePath = path.join(__dirname, 'fixtures', 'phase1-authority-schema.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const catalog = loadSourceTableCatalog(path.join(__dirname, 'source-table-catalog.json'));
const result = validateSourceTableCatalog({ inventory: fixture, catalog });
const bySourceTable = new Map(catalog.tables.map(entry => [entry.sourceTable, entry]));

assert.strictEqual(fixture.schemaVersion, 1);
assert.strictEqual(fixture.tables.length, 99);
assert.deepStrictEqual(DISPOSITIONS, [
  'canonical', 'archive', 'local_partition', 'rebuildable_cache', 'quarantine_only',
]);
assert.strictEqual(result.tableCount, 99);
assert.deepStrictEqual(result.unclassified, []);
assert.deepStrictEqual(result.unknownCatalogTables, []);
assert.strictEqual(result.catalogHash.length, 64);
assert.ok(Object.isFrozen(result));
assert.ok(
  bySourceTable.get('enrollments').dependencyOrder > bySourceTable.get('schedules').dependencyOrder,
  'legacy enrollments depend on schedule-to-course reconciliation',
);

for (const entry of catalog.tables) {
  assert.ok(DISPOSITIONS.includes(entry.disposition), entry.sourceTable);
  if (entry.disposition === 'canonical') {
    assert.match(entry.target, /^(identity|access|business|question|storage|audit|migration)\.[a-z][a-z0-9_]*$/);
    assert.strictEqual(entry.stableIdStrategy, 'preserve-text');
    assert.ok(Number.isInteger(entry.dependencyOrder) && entry.dependencyOrder >= 0);
    assert.match(entry.transformerId, /^[a-z][a-z0-9_.-]*$/);
    assert.ok(Array.isArray(entry.aggregateInvariants) && entry.aggregateInvariants.length > 0);
    assert.ok(Array.isArray(entry.fileReferenceFields));
    assert.strictEqual(entry.reason, null);
  } else {
    assert.strictEqual(entry.target, null);
    assert.strictEqual(entry.transformerId, null);
    assert.strictEqual(entry.dependencyOrder, null);
    assert.ok(typeof entry.reason === 'string' && entry.reason.length >= 12);
  }
}

const dispositionCounts = Object.fromEntries(DISPOSITIONS.map(disposition => [
  disposition,
  catalog.tables.filter(entry => entry.disposition === disposition).length,
]));
assert.ok(dispositionCounts.canonical > 30);
assert.ok(dispositionCounts.archive > 10);
assert.ok(dispositionCounts.local_partition >= 2);
assert.ok(dispositionCounts.rebuildable_cache >= 3);

assert.throws(
  () => validateSourceTableCatalog({
    inventory: { ...fixture, tables: [...fixture.tables, { name: 'new_unclassified_table' }] },
    catalog,
  }),
  error => error && error.code === 'MIGRATION_SOURCE_TABLE_UNCLASSIFIED',
);

const readiness = evaluateCriticalSourceReadiness({
  declarations: [
    { sourceId: 'authority-db', availability: 'available' },
    { sourceId: 'question-files', availability: 'unavailable' },
    { sourceId: 'question-assets', availability: 'unavailable' },
  ],
  criticalSourceIds: ['authority-db', 'question-files', 'question-assets'],
});
assert.strictEqual(readiness.ready, false);
assert.deepStrictEqual(readiness.blockers, [
  { sourceId: 'question-assets', code: 'MIGRATION_CRITICAL_SOURCE_UNAVAILABLE' },
  { sourceId: 'question-files', code: 'MIGRATION_CRITICAL_SOURCE_UNAVAILABLE' },
]);
assert.strictEqual(evaluateCriticalSourceReadiness({
  declarations: [{ sourceId: 'authority-db', availability: 'available' }],
  criticalSourceIds: ['authority-db'],
}).ready, true);
assert.throws(
  () => validateSourceTableCatalog({
    inventory: fixture,
    catalog: { ...catalog, tables: [...catalog.tables, catalog.tables[0]] },
  }),
  error => error && error.code === 'MIGRATION_SOURCE_TABLE_DUPLICATE',
);

console.log('vNext source table catalog checks passed');
