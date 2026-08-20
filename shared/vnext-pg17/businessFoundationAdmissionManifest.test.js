'use strict';

const assert = require('assert');
const {
  BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS,
  EXPECTED_BUSINESS_FOUNDATION_ADMISSION_MANIFEST_SHA256,
  expectedBusinessFoundationAdmissionCatalog,
  sha256,
} = require('./businessFoundationAdmissionManifest');

async function runBusinessFoundationAdmissionManifestCases() {
  assert.deepStrictEqual(
    BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS.map(migration => [migration.migrationId, migration.semanticVersion]),
    [['business-foundation-admission-1', 1]],
  );
  assert.strictEqual(
    BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].manifestSha256,
    EXPECTED_BUSINESS_FOUNDATION_ADMISSION_MANIFEST_SHA256,
  );
  assert.strictEqual(
    sha256(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql),
    EXPECTED_BUSINESS_FOUNDATION_ADMISSION_MANIFEST_SHA256,
  );
  assert.deepStrictEqual(expectedBusinessFoundationAdmissionCatalog.relations, [
    'migration_admission.migration_admission_schema_migrations',
    'migration_admission.migration_batches',
    'migration_admission.migration_batch_events',
    'migration_admission.migration_quarantine',
    'migration_admission.migration_row_ledger',
  ]);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /CREATE SCHEMA migration_admission/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /CREATE TABLE migration_admission\.migration_admission_schema_migrations/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /batch_request_sha256 text COLLATE "C" NOT NULL UNIQUE/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /source_inventory_before_sha256 text COLLATE "C" NOT NULL/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /source_inventory_after_sha256 text COLLATE "C" NOT NULL/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /source_contract_sha256 text COLLATE "C" NOT NULL/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /source_schema_sha256 text COLLATE "C" NOT NULL/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /shadow_target_identity_sha256 text COLLATE "C" NOT NULL/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /migration_batch_events_insert_guard/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /event_code text COLLATE "C" NOT NULL CHECK \(event_code IN \('PREPARED','RUNNING','RECONCILED','QUARANTINED','ROLLED_BACK','SOURCE_SNAPSHOT_CHANGED','SOURCE_SCHEMA_DRIFT','TARGET_CATALOG_DRIFT','TARGET_NONEMPTY','RECONCILIATION_MISMATCH','TRANSACTION_UNCERTAIN'\)\)/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /migration_row_ledger_insert_guard/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /migration_batch_prepared_pair/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /migration_row_ledger_quarantine_pair/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /outcome_code IN \('ADMITTED','SOURCE_ROW_INVALID','DEPENDENCY_MISSING','IDENTITY_CONFLICT','CANONICAL_HASH_CONFLICT'\)/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /outcome = 'admitted' AND target_id IS NOT NULL AND btrim\(target_id\) <> '' AND target_logical_sha256 IS NOT NULL/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /outcome = 'quarantined' AND target_id IS NULL AND target_logical_sha256 IS NULL/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /quarantine reason must equal ledger code/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /REVOKE EXECUTE ON FUNCTION migration_admission\.migration_batch_prepared_pair\(\) FROM PUBLIC/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /REVOKE EXECUTE ON FUNCTION migration_admission\.migration_row_ledger_insert_guard\(\) FROM PUBLIC/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /SECURITY DEFINER/);
  assert.match(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /SET search_path = pg_catalog, pg_temp/);
  assert.doesNotMatch(BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0].sql, /vnext_control_plane|better-sqlite3|node:fs|node:path|rds/i);
}

if (require.main === module) {
  runBusinessFoundationAdmissionManifestCases().then(() => {
    console.log('vNext business foundation admission manifest checks passed');
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runBusinessFoundationAdmissionManifestCases };
