'use strict';

const { MIGRATIONS } = require('../../shared/vnext-pg17/migrationManifest');

function sqlLiteral(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function buildCloudControlPlaneM16UpgradeSql() {
  const prefix = MIGRATIONS.slice(0, 15);
  const migration = MIGRATIONS[15];
  if (prefix.length !== 15 || !migration || migration.semanticVersion !== 16
    || prefix.some((item, index) => item.semanticVersion !== index + 1)) {
    throw new Error('vNext control-plane migration manifest is invalid');
  }
  const expectedRows = prefix.map(item => `(${sqlLiteral(item.migrationId)},${item.semanticVersion},${sqlLiteral(item.manifestSha256)})`).join(',');
  const lines = [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    `DO $$ BEGIN IF (SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations) <> 15 OR EXISTS (SELECT 1 FROM (VALUES ${expectedRows}) AS expected(migration_id,semantic_version,manifest_sha256) LEFT JOIN vnext_control_plane.vnext_schema_migrations actual USING (migration_id,semantic_version,manifest_sha256) WHERE actual.migration_id IS NULL) THEN RAISE EXCEPTION 'VNEXT_CLOUD_CONTROL_PLANE_PREFIX_INVALID' USING ERRCODE='P0001'; END IF; END $$;`,
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vnext_pg17_writer') THEN CREATE ROLE vnext_pg17_writer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vnext_pg17_identity_verifier') THEN CREATE ROLE vnext_pg17_identity_verifier LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$;",
    'GRANT vnext_pg17_owner TO gewu_app;',
    'GRANT CREATE ON DATABASE gewu_cloud TO vnext_pg17_owner;',
    'SET LOCAL ROLE vnext_pg17_owner;',
    migration.sql,
    `INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES (${sqlLiteral(migration.migrationId)}, ${migration.semanticVersion}, ${sqlLiteral(migration.manifestSha256)}, transaction_timestamp(), 'gewu-cloud-control-m16-upgrade');`,
    'RESET ROLE;',
    'GRANT CONNECT ON DATABASE gewu_cloud TO vnext_pg17_identity_verifier, vnext_pg17_writer;',
    'GRANT USAGE ON SCHEMA vnext_control_plane TO vnext_pg17_writer;',
    'REVOKE CREATE ON DATABASE gewu_cloud FROM vnext_pg17_owner;',
    'REVOKE vnext_pg17_owner FROM gewu_app;',
    'COMMIT;',
  ];
  return Object.freeze({ sql: `${lines.join('\n')}\n`, migrationCount: 1 });
}

module.exports = Object.freeze({ buildCloudControlPlaneM16UpgradeSql });
