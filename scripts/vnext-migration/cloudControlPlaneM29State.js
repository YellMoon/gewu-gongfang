'use strict';
// UTF-8: read-only deployment gate; values come from the immutable manifest.
const { MIGRATIONS, expectedCatalog } = require('../../shared/vnext-pg17/migrationManifest');
const literal = value => `'${String(value).replace(/'/g, "''")}'`;
function buildCloudControlPlaneM29StateSql() {
  const prefix = MIGRATIONS.slice(0, 28).map(m => `(${literal(m.migrationId)},${m.semanticVersion},${literal(m.manifestSha256)})`).join(',');
  const target = MIGRATIONS[28];
  const functions = ['vnext_register_named_desktop_online', 'vnext_list_named_desktop_account_devices'];
  const definitions = functions.map(name => `(${literal(name)},${literal(expectedCatalog.functionDefinitionSha256[name])})`).join(',');
  return `WITH expected(name,digest) AS (VALUES ${definitions}),
    actual AS (SELECT p.*,r.rolname AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='vnext_control_plane' AND p.proname IN (${functions.map(literal).join(',')}))
    SELECT json_build_object(
      'ledgerCount',(SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations),
      'prefixValid',NOT EXISTS(SELECT 1 FROM (VALUES ${prefix}) e(id,version,digest) LEFT JOIN vnext_control_plane.vnext_schema_migrations m ON m.migration_id=e.id AND m.semantic_version=e.version AND m.manifest_sha256=e.digest WHERE m.migration_id IS NULL),
      'targetCount',(SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations WHERE migration_id=${literal(target.migrationId)} AND semantic_version=29 AND manifest_sha256=${literal(target.manifestSha256)}),
      'columnCount',(SELECT count(*) FROM pg_attribute WHERE attrelid='vnext_control_plane.vnext_trusted_devices'::regclass AND attname='display_name' AND NOT attisdropped),
      'functionCount',(SELECT count(*) FROM actual),
      'metadataValid',EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_collation c ON c.oid=a.attcollation WHERE a.attrelid='vnext_control_plane.vnext_trusted_devices'::regclass AND a.attname='display_name' AND a.atttypid='text'::regtype AND c.collname='C' AND NOT a.attnotnull AND NOT a.attisdropped)
        AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='vnext_control_plane.vnext_trusted_devices'::regclass AND conname='vnext_trusted_devices_display_name_check' AND convalidated AND encode(sha256(convert_to(pg_get_constraintdef(oid,true),'UTF8')),'hex')='c5722d44c48fc45a8793201993c88cf9c785d0a7744bb28c296d4481018a1087')
        AND (SELECT count(*) FROM actual)=2
        AND NOT EXISTS(SELECT 1 FROM expected e LEFT JOIN actual p ON p.proname=e.name WHERE p.oid IS NULL OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>e.digest OR NOT p.prosecdef OR p.owner<>'vnext_pg17_owner' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[] OR NOT has_function_privilege('vnext_pg17_writer',p.oid,'EXECUTE') OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='vnext_pg17_writer'))))
        AND NOT has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_trusted_devices','UPDATE')
    )::text AS state;`;
}
module.exports = { buildCloudControlPlaneM29StateSql };
