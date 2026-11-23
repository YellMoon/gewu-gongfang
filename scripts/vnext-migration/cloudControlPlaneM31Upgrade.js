'use strict';

const { MIGRATIONS, expectedCatalog } = require('../../shared/vnext-pg17/migrationManifest');
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";

function buildCloudControlPlaneM31UpgradeSql() {
  const prefix = MIGRATIONS.slice(0, 30);
  const migration = MIGRATIONS[30];
  if (migration?.semanticVersion !== 31 || prefix.some((item, index) => item.semanticVersion !== index + 1)) {
    throw new Error('Invalid desktop session resume migration');
  }
  const values = migrations => migrations
    .map(item => '(' + literal(item.migrationId) + ',' + item.semanticVersion + ',' + literal(item.manifestSha256) + ')').join(',');
  const functions = ['vnext_start_desktop_session_challenge', 'vnext_exchange_desktop_session_challenge'];
  const functionValues = functions.map(name => '(' + literal(name) + ',' + literal(expectedCatalog.functionDefinitionSha256[name]) + ')').join(',');
  const target = literal(migration.migrationId);
  return [
    '\\set ON_ERROR_STOP on', 'BEGIN;',
    "SELECT pg_advisory_xact_lock(hashtextextended('vnext-pg17-desktop-session-resume-window-31',0));",
    'GRANT vnext_pg17_owner TO gewu_app;', 'SET LOCAL ROLE vnext_pg17_owner;',
    `DO $$ BEGIN IF EXISTS(
      SELECT 1 FROM (VALUES ${values(prefix)}) expected(migration_id,semantic_version,manifest_sha256)
      LEFT JOIN vnext_control_plane.vnext_schema_migrations actual USING (migration_id,semantic_version,manifest_sha256)
      WHERE actual.migration_id IS NULL
    ) OR EXISTS(
      SELECT 1 FROM vnext_control_plane.vnext_schema_migrations
      WHERE (migration_id=${target} OR semantic_version=31)
        AND (migration_id,semantic_version,manifest_sha256) IS DISTINCT FROM (${target},31,${literal(migration.manifestSha256)})
    ) THEN RAISE EXCEPTION 'CLOUD_CONTROL_PLANE_M31_STATE_INVALID'; END IF; END $$;`,
    `SELECT NOT EXISTS (SELECT 1 FROM vnext_control_plane.vnext_schema_migrations WHERE migration_id=${target}) AS apply_m31 \\gset`,
    '\\if :apply_m31',
    migration.sql,
    `INSERT INTO vnext_control_plane.vnext_schema_migrations
      (migration_id,semantic_version,manifest_sha256,applied_at,applied_by)
      VALUES ${values([migration]).slice(0, -1)},transaction_timestamp(),'gewu-cloud-control-m31-upgrade');`,
    '\\endif',
    `DO $$ BEGIN IF EXISTS (
      SELECT 1 FROM (VALUES ${functionValues}) expected(name,digest)
      LEFT JOIN pg_proc p ON p.pronamespace='vnext_control_plane'::regnamespace AND p.proname=expected.name
      WHERE p.oid IS NULL OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>expected.digest
        OR NOT p.prosecdef OR p.proowner<>'vnext_pg17_owner'::regrole
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
        OR NOT has_function_privilege('vnext_pg17_writer',p.oid,'EXECUTE')
        OR has_function_privilege('public',p.oid,'EXECUTE')
    ) THEN RAISE EXCEPTION 'CLOUD_CONTROL_PLANE_M31_VERIFICATION_FAILED'; END IF; END $$;`,
    'RESET ROLE;', 'REVOKE vnext_pg17_owner FROM gewu_app;', 'COMMIT;',
    `SELECT json_build_object('verified', true, 'applied', :'apply_m31'::boolean, 'migrationId', ${target})::text;`,
    '',
  ].join('\n');
}

module.exports = { buildCloudControlPlaneM31UpgradeSql };
