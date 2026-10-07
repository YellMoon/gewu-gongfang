'use strict';
const { MIGRATIONS, expectedCatalog } = require('../../shared/vnext-pg17/migrationManifest');
const literal = value => `'${String(value).replace(/'/g, "''")}'`;
function buildCloudControlPlaneM30StateSql() {
  const prefix = MIGRATIONS.slice(0, 29).map(m => `(${literal(m.migrationId)},${m.semanticVersion},${literal(m.manifestSha256)})`).join(',');
  const target = MIGRATIONS[29];
  return `WITH expected(name,digest) AS (VALUES ('vnext_read_miniapp_account_fence',${literal(expectedCatalog.functionDefinitionSha256.vnext_read_miniapp_account_fence)})),
    actual AS (SELECT p.*,r.rolname AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='vnext_control_plane' AND p.proname='vnext_read_miniapp_account_fence')
    SELECT json_build_object(
      'ledgerCount',(SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations),
      'prefixValid',NOT EXISTS(SELECT 1 FROM (VALUES ${prefix}) e(id,version,digest) LEFT JOIN vnext_control_plane.vnext_schema_migrations m ON m.migration_id=e.id AND m.semantic_version=e.version AND m.manifest_sha256=e.digest WHERE m.migration_id IS NULL),
      'targetCount',(SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations WHERE migration_id=${literal(target.migrationId)} AND semantic_version=30 AND manifest_sha256=${literal(target.manifestSha256)}),
      'functionCount',(SELECT count(*) FROM actual),
      'metadataValid',(SELECT count(*) FROM actual)=1
        AND NOT EXISTS(SELECT 1 FROM expected e LEFT JOIN actual p ON p.proname=e.name WHERE p.oid IS NULL OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>e.digest OR NOT p.prosecdef OR p.owner<>'vnext_pg17_owner' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[] OR NOT has_function_privilege('vnext_pg17_identity_verifier',p.oid,'EXECUTE') OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='vnext_pg17_identity_verifier'))))
        AND NOT has_table_privilege('vnext_pg17_identity_verifier','vnext_control_plane.vnext_accounts','SELECT')
        AND NOT has_table_privilege('vnext_pg17_identity_verifier','vnext_control_plane.vnext_accounts','UPDATE')
    )::text AS state;`;
}
module.exports = { buildCloudControlPlaneM30StateSql };
