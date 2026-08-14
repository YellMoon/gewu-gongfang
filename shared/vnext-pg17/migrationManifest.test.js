'use strict';

const assert = require('assert');
const {
  FIRST_MIGRATION,
  expectedCatalog,
  sha256,
} = require('./migrationManifest');

async function runManifestCases() {
  assert.strictEqual(FIRST_MIGRATION.semanticVersion, 1);
  assert.match(FIRST_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual(expectedCatalog.relations, ['vnext_control_plane.vnext_schema_migrations']);
  assert.deepStrictEqual(expectedCatalog.triggers, [
    'vnext_schema_migrations_insert_guard',
    'vnext_schema_migrations_no_delete',
    'vnext_schema_migrations_no_update',
  ]);
  assert.strictEqual(sha256(FIRST_MIGRATION.sql), FIRST_MIGRATION.manifestSha256);
}

if (require.main === module) {
  runManifestCases().then(() => {
    console.log('vNext PG17 migration manifest checks passed');
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runManifestCases };
