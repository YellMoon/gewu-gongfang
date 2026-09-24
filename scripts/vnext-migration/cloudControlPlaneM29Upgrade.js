'use strict';
// UTF-8: immutable M1-M28 prefix, atomic presentation-only extension.
const { MIGRATIONS } = require('../../shared/vnext-pg17/migrationManifest');
const literal = value => `'${String(value).replace(/'/g, "''")}'`;
function buildCloudControlPlaneM29UpgradeSql() {
  const prefix = MIGRATIONS.slice(0, 28), migration = MIGRATIONS[28];
  if (prefix.length !== 28 || migration?.semanticVersion !== 29 || prefix.some((item, index) => item.semanticVersion !== index + 1)) throw new Error('vNext control-plane migration manifest is invalid');
  const expectedRows = prefix.map(item => `(${literal(item.migrationId)},${item.semanticVersion},${literal(item.manifestSha256)})`).join(',');
  const lines = [
    '\\set ON_ERROR_STOP on', 'BEGIN;',
    `DO $$ BEGIN IF (SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations) <> 28 OR EXISTS (SELECT 1 FROM (VALUES ${expectedRows}) AS expected(migration_id,semantic_version,manifest_sha256) LEFT JOIN vnext_control_plane.vnext_schema_migrations actual USING (migration_id,semantic_version,manifest_sha256) WHERE actual.migration_id IS NULL) THEN RAISE EXCEPTION 'VNEXT_CLOUD_CONTROL_PLANE_M28_PREFIX_INVALID' USING ERRCODE='P0001'; END IF; END $$;`,
    'GRANT vnext_pg17_owner TO gewu_app;', 'SET LOCAL ROLE vnext_pg17_owner;', migration.sql,
    `INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id,semantic_version,manifest_sha256,applied_at,applied_by) VALUES (${literal(migration.migrationId)},29,${literal(migration.manifestSha256)},transaction_timestamp(),'gewu-cloud-control-m29-upgrade');`,
    'RESET ROLE;', 'REVOKE vnext_pg17_owner FROM gewu_app;', 'COMMIT;',
  ];
  return Object.freeze({ sql: lines.join('\n') + '\n', migrationCount: 1, migrationId: migration.migrationId, semanticVersion: 29, manifestSha256: migration.manifestSha256 });
}
module.exports = { buildCloudControlPlaneM29UpgradeSql };
