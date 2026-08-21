'use strict';

const { MIGRATIONS } = require('../../shared/vnext-pg17/migrationManifest');

function buildCloudControlPlaneBootstrapSql() {
  const migrations = MIGRATIONS.slice(0, 15);
  if (migrations.length !== 15 || migrations.some((migration, index) => migration.semanticVersion !== index + 1)) {
    throw new Error('vNext control-plane migration manifest is invalid');
  }
  const lines = [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vnext_pg17_owner') THEN CREATE ROLE vnext_pg17_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vnext_pg17_verifier') THEN CREATE ROLE vnext_pg17_verifier NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$;",
    'GRANT vnext_pg17_owner TO gewu_app;',
    'GRANT CREATE ON DATABASE gewu_cloud TO vnext_pg17_owner;',
    'SET LOCAL ROLE vnext_pg17_owner;',
  ];
  for (const migration of migrations) {
    lines.push(migration.sql);
    lines.push(`INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ('${migration.migrationId}', ${migration.semanticVersion}, '${migration.manifestSha256}', transaction_timestamp(), 'gewu-cloud-control-bootstrap');`);
  }
  lines.push('RESET ROLE;');
  lines.push('REVOKE CREATE ON DATABASE gewu_cloud FROM vnext_pg17_owner;');
  lines.push('REVOKE vnext_pg17_owner FROM gewu_app;');
  lines.push('COMMIT;');
  return Object.freeze({ sql: `${lines.join('\n')}\n`, migrationCount: migrations.length });
}

module.exports = Object.freeze({ buildCloudControlPlaneBootstrapSql });
