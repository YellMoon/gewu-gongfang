'use strict';

const { MIGRATIONS } = require('../../shared/vnext-pg17/migrationManifest');
function sqlLiteral(value) { return `'${String(value).replace(/'/gu, "''")}'`; }

function buildCloudControlPlaneM23UpgradeSql() {
  const prefix = MIGRATIONS.slice(0, 22); const migration = MIGRATIONS[22];
  if (prefix.length !== 22 || !migration || migration.semanticVersion !== 23
    || prefix.some((item, index) => item.semanticVersion !== index + 1)) {
    throw new Error('vNext control-plane migration manifest is invalid');
  }
  const expectedRows = prefix.map(item => `(${sqlLiteral(item.migrationId)},${item.semanticVersion},${sqlLiteral(item.manifestSha256)})`).join(',');
  const lines = [
    '\\set ON_ERROR_STOP on', 'BEGIN;',
    `DO $$ BEGIN IF (SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations) <> 22 OR EXISTS (SELECT 1 FROM (VALUES ${expectedRows}) AS expected(migration_id,semantic_version,manifest_sha256) LEFT JOIN vnext_control_plane.vnext_schema_migrations actual USING (migration_id,semantic_version,manifest_sha256) WHERE actual.migration_id IS NULL) THEN RAISE EXCEPTION 'VNEXT_CLOUD_CONTROL_PLANE_M22_PREFIX_INVALID' USING ERRCODE='P0001'; END IF; END $$;`,
    'GRANT vnext_pg17_owner TO gewu_app;', 'SET LOCAL ROLE vnext_pg17_owner;', migration.sql,
    `INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES (${sqlLiteral(migration.migrationId)}, ${migration.semanticVersion}, ${sqlLiteral(migration.manifestSha256)}, transaction_timestamp(), 'gewu-cloud-control-m23-upgrade');`,
    'RESET ROLE;', 'REVOKE vnext_pg17_owner FROM gewu_app;', 'COMMIT;',
  ];
  return Object.freeze({ sql: `${lines.join('\n')}\n`, migrationCount: 1, migrationId: migration.migrationId, semanticVersion: migration.semanticVersion, manifestSha256: migration.manifestSha256 });
}

module.exports = Object.freeze({ buildCloudControlPlaneM23UpgradeSql });
