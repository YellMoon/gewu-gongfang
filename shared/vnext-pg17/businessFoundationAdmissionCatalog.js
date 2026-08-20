'use strict';

const { types } = require('util');
const {
  executeBusinessFoundationAdmissionDdlPlan,
  isVNextPg17DisposableHandleForRuntime,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const {
  BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS,
  expectedBusinessFoundationAdmissionCatalog,
  sha256,
} = require('./businessFoundationAdmissionManifest');

// Fixed from a fresh disposable application.  Do not derive these from the
// manifest at assertion time: coordinated manifest/SQL edits must be drift.
const EXPECTED_CATALOG_SHA256 = Object.freeze({
  columns: '98034552820076975704993c9afd0fc4228e1679b6157ca1deb442d541ec4fa0',
  constraints: '988e8617d2e0767558e3400c0aee4852718066d757caa8df3dba534a4ad7f66c',
  indexes: '49361669b90bbf877ad39b653339f9acc252349b48b454897971fdab91749186',
  triggers: '53d2a76407ceb0af0f148dd03e9093a9b0b8522590f68edd75818b15a77be715',
  functions: '15e219480db734b0ad22bcfc49b15a9af7dbd0e4eb804a9f2464f3cfccecf0f0',
});
const ADMISSION_ROLES = Object.freeze([
  'vnext_pg17_migration_admission_migrator',
  'vnext_pg17_migration_admission_owner',
  'vnext_pg17_migration_admission_verifier',
]);
const UNPRIVILEGED_LOGIN_ROLES = Object.freeze([
  'vnext_pg17_migration_admission_migrator', 'vnext_pg17_migration_admission_verifier',
  'vnext_pg17_migrator', 'vnext_pg17_runtime', 'vnext_pg17_verifier', 'vnext_pg17_writer',
  'vnext_pg17_business_migrator', 'vnext_pg17_business_verifier',
]);

function codedError(code, message) { const error = new Error(message); error.code = code; return error; }
function invalidHandle() { return codedError('VNEXT_PG17_HANDLE_INVALID', 'vNext PG17 disposable handle is invalid'); }
function inputInvalid() { return codedError('VNEXT_PG17_MIGRATION_INPUT_INVALID', 'vNext PG17 migration input is invalid'); }
function schemaDrift() { return codedError('VNEXT_PG17_SCHEMA_DRIFT', 'vNext PG17 admission schema drift was detected'); }
function initializationSeeded() { return codedError('VNEXT_PG17_ADMISSION_INITIALIZATION_SEEDED', 'vNext PG17 admission relations are not empty'); }

function snapshotApplyInput(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw inputInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('appliedAt') || !keys.includes('appliedBy')) throw inputInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw inputInvalid();
  }
  const { appliedAt, appliedBy } = value;
  let canonicalInstant;
  try { canonicalInstant = new Date(appliedAt).toISOString(); } catch (_) { throw inputInvalid(); }
  if (typeof appliedAt !== 'string' || canonicalInstant !== appliedAt || typeof appliedBy !== 'string' || appliedBy.trim() === '') throw inputInvalid();
  return Object.freeze({ appliedAt, appliedBy });
}

function exactRoleRows(rows) {
  return rows.length === ADMISSION_ROLES.length
    && rows.every(row => !row.rolinherit && !row.rolsuper && !row.rolcreaterole && !row.rolcreatedb && !row.rolreplication && !row.rolbypassrls)
    && Boolean(rows.find(row => row.rolname === 'vnext_pg17_migration_admission_migrator' && row.rolcanlogin))
    && Boolean(rows.find(row => row.rolname === 'vnext_pg17_migration_admission_verifier' && row.rolcanlogin))
    && Boolean(rows.find(row => row.rolname === 'vnext_pg17_migration_admission_owner' && !row.rolcanlogin));
}

function createBusinessFoundationAdmissionCatalogBoundary(runtime) {
  if (!runtime || typeof runtime !== 'object' || types.isProxy(runtime)) throw invalidHandle();

  async function apply(handle, input) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    return executeBusinessFoundationAdmissionDdlPlan(runtime, handle, snapshotApplyInput(input));
  }

  async function assert(handle) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    return withVNextPg17SyntheticQuery(handle, 'migration-admission-verifier', async facade => {
      try {
        await facade.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const relations = await facade.query(
          "SELECT n.nspname || '.' || c.relname AS relation FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'migration_admission' AND c.relkind = 'r' ORDER BY array_position($1::text[], n.nspname || '.' || c.relname)",
          [expectedBusinessFoundationAdmissionCatalog.relations],
        );
        const ledger = await facade.query('SELECT migration_id, semantic_version, manifest_sha256 FROM migration_admission.migration_admission_schema_migrations ORDER BY semantic_version');
        const ownership = await facade.query("SELECT n.nspname AS schema_name, schema_owner.rolname AS schema_owner, c.relname AS relation, relation_owner.rolname AS relation_owner FROM pg_namespace n JOIN pg_roles schema_owner ON schema_owner.oid = n.nspowner JOIN pg_class c ON c.relnamespace = n.oid JOIN pg_roles relation_owner ON relation_owner.oid = c.relowner WHERE n.nspname = 'migration_admission' AND c.relkind = 'r' ORDER BY c.relname");
        const catalogQueries = Object.freeze({
          columns: "SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type, t.typname AS udt_name, CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable, NULLIF(coll.collname, 'default') AS collation_name, pg_get_expr(ad.adbin, ad.adrelid) AS column_default FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_type t ON t.oid = a.atttypid LEFT JOIN pg_collation coll ON coll.oid = a.attcollation LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum WHERE n.nspname = 'migration_admission' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum",
          constraints: "SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'migration_admission' ORDER BY c.relname, con.conname",
          indexes: "SELECT c.relname AS table_name, irel.relname AS index_name, i.indisprimary, i.indisunique, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class irel ON irel.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'migration_admission' ORDER BY c.relname, irel.relname",
          triggers: "SELECT c.relname AS table_name, t.tgname AS trigger_name, pn.nspname AS function_schema, p.proname AS function_name, t.tgenabled, pg_get_triggerdef(t.oid, true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace WHERE n.nspname = 'migration_admission' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname",
          functions: "SELECT p.proname, r.rolname AS owner, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner WHERE n.nspname = 'migration_admission' ORDER BY p.proname",
        });
        const catalog = {};
        for (const [key, text] of Object.entries(catalogQueries)) catalog[key] = (await facade.query(text)).rows;
        const roleRows = await facade.query("SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = ANY($1::name[]) ORDER BY rolname", [ADMISSION_ROLES]);
        const memberships = await facade.query("SELECT member_role.rolname AS member, granted_role.rolname AS role, m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid = m.member JOIN pg_roles granted_role ON granted_role.oid = m.roleid WHERE member_role.rolname = ANY($1::name[]) OR granted_role.rolname = ANY($1::name[]) ORDER BY member_role.rolname, granted_role.rolname", [ADMISSION_ROLES]);
        const rolePrivileges = await facade.query("SELECT role_name, c.relname AS relation, has_schema_privilege(role_name, 'migration_admission', 'USAGE') AS schema_usage, has_schema_privilege(role_name, 'migration_admission', 'CREATE') AS schema_create, has_database_privilege(role_name, current_database(), 'CREATE') AS database_create, has_database_privilege(role_name, current_database(), 'TEMPORARY') AS database_temporary, has_table_privilege(role_name, c.oid, 'SELECT') AS table_select, has_table_privilege(role_name, c.oid, 'INSERT') AS table_insert, has_table_privilege(role_name, c.oid, 'UPDATE') AS table_update, has_table_privilege(role_name, c.oid, 'DELETE') AS table_delete, has_table_privilege(role_name, c.oid, 'TRUNCATE') AS table_truncate, has_table_privilege(role_name, c.oid, 'REFERENCES') AS table_references, has_table_privilege(role_name, c.oid, 'TRIGGER') AS table_trigger, has_any_column_privilege(role_name, c.oid, 'SELECT') AS any_column_select, has_any_column_privilege(role_name, c.oid, 'INSERT') AS any_column_insert, has_any_column_privilege(role_name, c.oid, 'UPDATE') AS any_column_update, has_any_column_privilege(role_name, c.oid, 'REFERENCES') AS any_column_references FROM unnest($1::name[]) AS roles(role_name) CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'migration_admission' AND c.relkind = 'r' ORDER BY role_name, c.relname", [UNPRIVILEGED_LOGIN_ROLES]);
        const functionPrivileges = await facade.query("SELECT p.proname, role_name, has_function_privilege(role_name, p.oid, 'EXECUTE') AS can_execute FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN unnest($1::name[]) AS roles(role_name) WHERE n.nspname = 'migration_admission' ORDER BY p.proname, role_name", [UNPRIVILEGED_LOGIN_ROLES]);
        const foreignPrivileges = await facade.query("SELECT role_name, n.nspname AS schema_name, c.relname AS relation, has_schema_privilege(role_name, n.oid, 'USAGE') AS schema_usage, has_schema_privilege(role_name, n.oid, 'CREATE') AS schema_create, has_table_privilege(role_name, c.oid, 'SELECT') AS table_select, has_table_privilege(role_name, c.oid, 'INSERT') AS table_insert, has_table_privilege(role_name, c.oid, 'UPDATE') AS table_update, has_table_privilege(role_name, c.oid, 'DELETE') AS table_delete, has_table_privilege(role_name, c.oid, 'TRUNCATE') AS table_truncate, has_table_privilege(role_name, c.oid, 'REFERENCES') AS table_references, has_table_privilege(role_name, c.oid, 'TRIGGER') AS table_trigger, has_any_column_privilege(role_name, c.oid, 'SELECT') AS any_column_select, has_any_column_privilege(role_name, c.oid, 'INSERT') AS any_column_insert, has_any_column_privilege(role_name, c.oid, 'UPDATE') AS any_column_update, has_any_column_privilege(role_name, c.oid, 'REFERENCES') AS any_column_references FROM (VALUES ('vnext_pg17_migration_admission_migrator'::name), ('vnext_pg17_migration_admission_verifier'::name)) AS roles(role_name) CROSS JOIN pg_namespace n CROSS JOIN pg_class c WHERE n.nspname IN ('business', 'vnext_control_plane') AND c.relnamespace = n.oid AND c.relkind = 'r' ORDER BY role_name, n.nspname, c.relname");
        const foreignFunctionPrivileges = await facade.query("SELECT role_name, n.nspname AS schema_name, p.proname, has_function_privilege(role_name, p.oid, 'EXECUTE') AS can_execute FROM (VALUES ('vnext_pg17_migration_admission_migrator'::name), ('vnext_pg17_migration_admission_verifier'::name)) AS roles(role_name) CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('business', 'vnext_control_plane') ORDER BY role_name, n.nspname, p.proname");
        const defaultAcl = await facade.query("SELECT owner.rolname AS owner, COUNT(default_acl.oid)::text AS count FROM pg_roles owner LEFT JOIN pg_default_acl default_acl ON default_acl.defaclrole = owner.oid WHERE owner.rolname = ANY($1::name[]) GROUP BY owner.rolname ORDER BY owner.rolname", [ADMISSION_ROLES]);
        await facade.query('COMMIT');

        const migration = BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[0];
        const expectedMemberships = [{ member: 'vnext_pg17_migration_admission_migrator', role: 'vnext_pg17_migration_admission_owner', admin_option: false, inherit_option: false, set_option: true }];
        const catalogHashes = Object.fromEntries(Object.entries(catalog).map(([key, rows]) => [key, sha256(JSON.stringify(rows))]));
        const badRolePrivilege = rolePrivileges.rows.some(row => {
          const verifier = row.role_name === 'vnext_pg17_migration_admission_verifier';
          const verifierRead = verifier && row.table_select && row.any_column_select;
          return (verifier ? (!row.schema_usage || row.schema_create || row.database_create || row.database_temporary || !verifierRead) : (row.schema_usage || row.schema_create || row.database_create || row.database_temporary || row.table_select || row.any_column_select))
            || row.table_insert || row.table_update || row.table_delete || row.table_truncate || row.table_references || row.table_trigger || row.any_column_insert || row.any_column_update || row.any_column_references;
        });
        if (relations.rows.length !== expectedBusinessFoundationAdmissionCatalog.relations.length
          || relations.rows.some((row, index) => row.relation !== expectedBusinessFoundationAdmissionCatalog.relations[index])
          || ledger.rows.length !== 1 || ledger.rows[0].migration_id !== migration.migrationId || String(ledger.rows[0].semantic_version) !== String(migration.semanticVersion) || ledger.rows[0].manifest_sha256 !== migration.manifestSha256
          || ownership.rows.length !== expectedBusinessFoundationAdmissionCatalog.relations.length || ownership.rows.some(row => row.schema_name !== 'migration_admission' || row.schema_owner !== 'vnext_pg17_migration_admission_owner' || row.relation_owner !== 'vnext_pg17_migration_admission_owner')
          || Object.entries(catalogHashes).some(([key, value]) => value !== EXPECTED_CATALOG_SHA256[key])
          || !exactRoleRows(roleRows.rows)
          || JSON.stringify(memberships.rows) !== JSON.stringify(expectedMemberships)
          || rolePrivileges.rows.length !== UNPRIVILEGED_LOGIN_ROLES.length * expectedBusinessFoundationAdmissionCatalog.relations.length || badRolePrivilege
          || functionPrivileges.rows.some(row => row.can_execute)
          || foreignPrivileges.rows.some(row => row.schema_usage || row.schema_create || row.table_select || row.table_insert || row.table_update || row.table_delete || row.table_truncate || row.table_references || row.table_trigger || row.any_column_select || row.any_column_insert || row.any_column_update || row.any_column_references)
          || foreignFunctionPrivileges.rows.some(row => row.can_execute)
          || defaultAcl.rows.length !== ADMISSION_ROLES.length || defaultAcl.rows.some(row => row.count !== '0')) throw schemaDrift();
        return Object.freeze({ asserted: true });
      } catch (error) {
        try { await facade.query('ROLLBACK'); } catch (_) { /* normalized below */ }
        if (error && (error.code === 'VNEXT_PG17_SCHEMA_DRIFT' || error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE')) throw error;
        throw schemaDrift();
      }
    });
  }

  async function assertZeroSeed(handle) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    return withVNextPg17SyntheticQuery(handle, 'migration-admission-verifier', async facade => {
      try {
        await facade.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const counts = await facade.query("SELECT 'migration_batch_events'::text AS relation, COUNT(*)::text AS count FROM migration_admission.migration_batch_events UNION ALL SELECT 'migration_batches'::text AS relation, COUNT(*)::text AS count FROM migration_admission.migration_batches UNION ALL SELECT 'migration_quarantine'::text AS relation, COUNT(*)::text AS count FROM migration_admission.migration_quarantine UNION ALL SELECT 'migration_row_ledger'::text AS relation, COUNT(*)::text AS count FROM migration_admission.migration_row_ledger ORDER BY relation");
        await facade.query('COMMIT');
        if (counts.rows.length !== 4 || counts.rows.some(row => row.count !== '0')) throw initializationSeeded();
        return Object.freeze({ zeroSeed: true });
      } catch (error) {
        try { await facade.query('ROLLBACK'); } catch (_) { /* normalized below */ }
        if (error && (error.code === 'VNEXT_PG17_ADMISSION_INITIALIZATION_SEEDED' || error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE')) throw error;
        throw schemaDrift();
      }
    });
  }

  return Object.freeze({ apply, assert, assertZeroSeed });
}

module.exports = { createBusinessFoundationAdmissionCatalogBoundary };
