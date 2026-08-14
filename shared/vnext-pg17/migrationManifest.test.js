'use strict';

const assert = require('assert');
const {
  FIRST_MIGRATION,
  FOUNDATION_IDENTITY_DEVICE_MIGRATION,
  ROLE_GRANTS_MIGRATION,
  CAPABILITY_CATALOG_MIGRATION,
  MIGRATIONS,
  expectedCatalog,
  sha256,
} = require('./migrationManifest');

async function runManifestCases() {
  assert.strictEqual(FIRST_MIGRATION.semanticVersion, 1);
  assert.ok(Object.isFrozen(MIGRATIONS));
  assert.ok(Object.isFrozen(FOUNDATION_IDENTITY_DEVICE_MIGRATION));
  assert.match(FIRST_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.ok(expectedCatalog.relations.includes('vnext_control_plane.vnext_schema_migrations'));
  assert.deepStrictEqual(expectedCatalog.triggers, [
    'vnext_schema_migrations_insert_guard',
    'vnext_schema_migrations_no_delete',
    'vnext_schema_migrations_no_update',
  ]);
  assert.strictEqual(sha256(FIRST_MIGRATION.sql), FIRST_MIGRATION.manifestSha256);
  assert.deepStrictEqual(MIGRATIONS.map(migration => migration.semanticVersion), [1, 2, 3, 4]);
  assert.strictEqual(FOUNDATION_IDENTITY_DEVICE_MIGRATION.migrationId, 'vnext-pg17-foundation-identity-device-2');
  assert.match(FOUNDATION_IDENTITY_DEVICE_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(
    sha256(FOUNDATION_IDENTITY_DEVICE_MIGRATION.sql),
    FOUNDATION_IDENTITY_DEVICE_MIGRATION.manifestSha256,
  );
  assert.ok(Object.isFrozen(ROLE_GRANTS_MIGRATION));
  assert.strictEqual(ROLE_GRANTS_MIGRATION.migrationId, 'vnext-pg17-role-grants-3');
  assert.strictEqual(ROLE_GRANTS_MIGRATION.semanticVersion, 3);
  assert.match(ROLE_GRANTS_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(ROLE_GRANTS_MIGRATION.sql), ROLE_GRANTS_MIGRATION.manifestSha256);
  assert.match(ROLE_GRANTS_MIGRATION.sql, /CREATE UNIQUE INDEX vnext_role_grants_one_active_role/);
  assert.match(ROLE_GRANTS_MIGRATION.sql, /granted_by_account_id IS NULL OR btrim\(granted_by_account_id\) <> ''/);
  assert.ok(Object.isFrozen(CAPABILITY_CATALOG_MIGRATION));
  assert.strictEqual(CAPABILITY_CATALOG_MIGRATION.migrationId, 'vnext-pg17-capability-catalog-4');
  assert.strictEqual(CAPABILITY_CATALOG_MIGRATION.semanticVersion, 4);
  assert.match(CAPABILITY_CATALOG_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(CAPABILITY_CATALOG_MIGRATION.sql), CAPABILITY_CATALOG_MIGRATION.manifestSha256);
  assert.match(CAPABILITY_CATALOG_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_capability_catalog/);
  assert.match(CAPABILITY_CATALOG_MIGRATION.sql, /btrim\(surface_mask\) <> ''/);
  assert.deepStrictEqual(expectedCatalog.relations, [
    'vnext_control_plane.vnext_account_device_links',
    'vnext_control_plane.vnext_accounts',
    'vnext_control_plane.vnext_authorities',
    'vnext_control_plane.vnext_capability_catalog',
    'vnext_control_plane.vnext_device_installations',
    'vnext_control_plane.vnext_role_grants',
    'vnext_control_plane.vnext_schema_meta',
    'vnext_control_plane.vnext_schema_migrations',
    'vnext_control_plane.vnext_trusted_devices',
  ]);
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
