'use strict';

const assert = require('assert');

const {
  EXPECTED_MINIAPP_STUDENT_ACCESS_MANIFEST_SHA256,
  MINIAPP_STUDENT_ACCESS_MIGRATION,
  PRODUCTION_BUSINESS_LEDGER_MIGRATIONS,
  assertProductionBusinessLedgerRows,
} = require('./productionBusinessLedgerReceipt');
const { BUSINESS_FOUNDATION_MIGRATIONS, sha256 } = require('./businessFoundationManifest');

assert.strictEqual(
  BUSINESS_FOUNDATION_MIGRATIONS.length,
  2,
  'the disposable foundation catalog must not pretend that a production-only applied migration is part of its bootstrap sequence'
);
assert.deepStrictEqual(
  PRODUCTION_BUSINESS_LEDGER_MIGRATIONS.map(migration => [migration.migrationId, migration.semanticVersion]),
  [
    ['business-foundation-1', 1],
    ['business-core-scheduling-2', 2],
    ['business-miniapp-student-access-3', 3],
    ['business-storage-agent-tasks-4', 4],
  ],
  'the production receipt must cover every installed business migration in order'
);
assert.match(MINIAPP_STUDENT_ACCESS_MIGRATION.sql, /^BEGIN;[\s\S]*COMMIT;\s*$/, 'the receipt must retain the deployed transaction artifact');
assert.strictEqual(
  EXPECTED_MINIAPP_STUDENT_ACCESS_MANIFEST_SHA256,
  '3f85ebba7522d9faf09e98bc67a53205ace5d2e1531e9a6ad8ab22a9fffffb00',
  'the receipt must pin the hash actually recorded by production'
);
assert.strictEqual(
  sha256(MINIAPP_STUDENT_ACCESS_MIGRATION.sql.trim()),
  EXPECTED_MINIAPP_STUDENT_ACCESS_MANIFEST_SHA256,
  'the receipt must use the same canonical trimming rule that created the production ledger row'
);

const exactLedgerRows = PRODUCTION_BUSINESS_LEDGER_MIGRATIONS.map(migration => ({
  migration_id: migration.migrationId,
  semantic_version: migration.semanticVersion,
  manifest_sha256: migration.manifestSha256,
}));
assert.deepStrictEqual(
  assertProductionBusinessLedgerRows(exactLedgerRows),
  exactLedgerRows,
  'an exact production ledger must be accepted without writing to it'
);
assert.throws(
  () => assertProductionBusinessLedgerRows(exactLedgerRows.slice(0, 2)),
  /PRODUCTION_BUSINESS_LEDGER_DRIFT/,
  'a missing applied migration must fail closed'
);
assert.throws(
  () => assertProductionBusinessLedgerRows([...exactLedgerRows, { ...exactLedgerRows[2], manifest_sha256: '0'.repeat(64) }]),
  /PRODUCTION_BUSINESS_LEDGER_DRIFT/,
  'a duplicate or altered migration receipt must fail closed'
);

console.log('production business ledger receipt checks passed');
