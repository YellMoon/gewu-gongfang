'use strict';

const { types } = require('util');
const {
  executeBusinessFoundationDdlPlan,
  isVNextPg17DisposableHandleForRuntime,
  readBusinessFoundationZeroSeedCounts,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { BUSINESS_FOUNDATION_MIGRATIONS, expectedBusinessFoundationCatalog, sha256 } = require('./businessFoundationManifest');

const EXPECTED_CATALOG_SHA256 = Object.freeze({
  columns: '4bc4f88977a57d85d59c67276575d18d254ce659c10c09d439d2cbd35dac1dad',
  constraints: 'c2df5b48365be4fc34338a0fdb0793087d0c30a37525ea822636c1ca9673ed0e',
  indexes: 'aa8de02eacfdf1415d17e0c8ed4664ee5c654801de0706b72229a2227e801240',
  triggers: '657b4ce9d8f5c3b48b0ae236e5c483d40fefddd29d3feb527ddda9a5df2ab751',
  functions: 'b839f3a57a4a83f8b4e937bfd84f1e9ddda076b145ddf2f4e6512d159d0c409c',
});

const BUSINESS_VERIFIER_READABLE_IDENTITIES = new Set([
  'tenants.id',
  'institutions.id',
  'schools.id',
  'rooms.id',
  'teachers.id',
  'students.id',
  'courses.id',
  'schedules.id',
]);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidHandle() {
  return codedError('VNEXT_PG17_HANDLE_INVALID', 'vNext PG17 disposable handle is invalid');
}

function inputInvalid() {
  return codedError('VNEXT_PG17_MIGRATION_INPUT_INVALID', 'vNext PG17 migration input is invalid');
}

function schemaDrift() {
  return codedError('VNEXT_PG17_SCHEMA_DRIFT', 'vNext PG17 business schema drift was detected');
}

function initializationSeeded() {
  return codedError('VNEXT_PG17_BUSINESS_INITIALIZATION_SEEDED', 'vNext PG17 business foundation is not empty');
}

function snapshotApplyInput(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw inputInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('appliedAt') || !keys.includes('appliedBy')) throw inputInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw inputInvalid();
  }
  const { appliedAt, appliedBy } = value;
  let canonicalInstant;
  try {
    canonicalInstant = new Date(appliedAt).toISOString();
  } catch (_) {
    throw inputInvalid();
  }
  if (typeof appliedAt !== 'string' || canonicalInstant !== appliedAt
    || typeof appliedBy !== 'string' || appliedBy.trim() === '') throw inputInvalid();
  return Object.freeze({ appliedAt, appliedBy });
}

function createBusinessFoundationCatalogBoundary(runtime) {
  if (!runtime || typeof runtime !== 'object' || types.isProxy(runtime)) throw invalidHandle();

  async function apply(handle, input) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    return executeBusinessFoundationDdlPlan(runtime, handle, snapshotApplyInput(input));
  }

  async function assert(handle) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    return withVNextPg17SyntheticQuery(handle, 'business-verifier', async facade => {
      try {
        await facade.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const relations = await facade.query(
          "SELECT n.nspname || '.' || c.relname AS relation FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'business' AND c.relkind <> 'i' ORDER BY c.relname",
        );
        const ledger = await facade.query(
          'SELECT migration_id, semantic_version, manifest_sha256 FROM business.business_schema_migrations ORDER BY semantic_version',
        );
        const ownership = await facade.query(
          "SELECT n.nspname AS schema_name, schema_owner.rolname AS schema_owner, c.relname AS relation, relation_owner.rolname AS relation_owner FROM pg_namespace n JOIN pg_roles schema_owner ON schema_owner.oid = n.nspowner JOIN pg_class c ON c.relnamespace = n.oid JOIN pg_roles relation_owner ON relation_owner.oid = c.relowner WHERE n.nspname = 'business' AND c.relkind = 'r' ORDER BY c.relname",
        );
        const catalogQueries = Object.freeze({
          columns: "SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type, t.typname AS udt_name, CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable, NULLIF(coll.collname, 'default') AS collation_name, pg_get_expr(ad.adbin, ad.adrelid) AS column_default FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_type t ON t.oid = a.atttypid LEFT JOIN pg_collation coll ON coll.oid = a.attcollation LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum WHERE n.nspname = 'business' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum",
          constraints: "SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'business' ORDER BY c.relname, con.conname",
          indexes: "SELECT c.relname AS table_name, irel.relname AS index_name, i.indisprimary, i.indisunique, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class irel ON irel.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'business' ORDER BY c.relname, irel.relname",
          triggers: "SELECT c.relname AS table_name, t.tgname AS trigger_name, pn.nspname AS function_schema, p.proname AS function_name, t.tgenabled, pg_get_triggerdef(t.oid, true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace WHERE n.nspname = 'business' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname",
          functions: "SELECT p.proname, r.rolname AS owner, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner WHERE n.nspname = 'business' ORDER BY p.proname",
        });
        const catalog = {};
        for (const [key, text] of Object.entries(catalogQueries)) catalog[key] = (await facade.query(text)).rows;
        const roleRows = await facade.query(
          "SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN ('vnext_pg17_business_migrator', 'vnext_pg17_business_owner', 'vnext_pg17_business_verifier') ORDER BY rolname",
        );
        const memberships = await facade.query(
          "SELECT member_role.rolname AS member, granted_role.rolname AS role, m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid = m.member JOIN pg_roles granted_role ON granted_role.oid = m.roleid WHERE member_role.rolname IN ('vnext_pg17_business_migrator', 'vnext_pg17_business_owner', 'vnext_pg17_business_verifier') OR granted_role.rolname IN ('vnext_pg17_business_migrator', 'vnext_pg17_business_owner', 'vnext_pg17_business_verifier') ORDER BY member_role.rolname, granted_role.rolname",
        );
        const privilege = await facade.query(
          "SELECT has_schema_privilege('vnext_pg17_business_verifier', 'business', 'USAGE') AS verifier_usage, has_schema_privilege('vnext_pg17_business_verifier', 'business', 'CREATE') AS verifier_create, has_schema_privilege('vnext_pg17_verifier', 'business', 'USAGE') AS control_verifier_usage, has_database_privilege('vnext_pg17_business_verifier', current_database(), 'CREATE') AS verifier_database_create, has_database_privilege('vnext_pg17_business_verifier', current_database(), 'TEMPORARY') AS verifier_temporary, has_database_privilege('vnext_pg17_business_owner', current_database(), 'CREATE') AS owner_database_create, has_column_privilege('vnext_pg17_business_verifier', 'business.tenants', 'id', 'SELECT') AS tenants_id_select, has_column_privilege('vnext_pg17_business_verifier', 'business.institutions', 'id', 'SELECT') AS institutions_id_select, has_column_privilege('vnext_pg17_business_verifier', 'business.schools', 'id', 'SELECT') AS schools_id_select, has_column_privilege('vnext_pg17_business_verifier', 'business.rooms', 'id', 'SELECT') AS rooms_id_select, has_column_privilege('vnext_pg17_business_verifier', 'business.teachers', 'id', 'SELECT') AS teachers_id_select, has_column_privilege('vnext_pg17_business_verifier', 'business.students', 'id', 'SELECT') AS students_id_select, has_column_privilege('vnext_pg17_business_verifier', 'business.courses', 'id', 'SELECT') AS courses_id_select, has_column_privilege('vnext_pg17_business_verifier', 'business.schedules', 'id', 'SELECT') AS schedules_id_select, has_column_privilege('vnext_pg17_business_verifier', 'business.institutions', 'contact_person_legacy', 'SELECT') AS contact_person_select, has_column_privilege('vnext_pg17_business_verifier', 'business.institutions', 'contact_phone_legacy', 'SELECT') AS contact_phone_select, has_column_privilege('vnext_pg17_business_verifier', 'business.institutions', 'notes', 'SELECT') AS notes_select, has_column_privilege('vnext_pg17_business_verifier', 'business.students', 'phone_legacy', 'SELECT') AS student_phone_select, has_column_privilege('vnext_pg17_business_verifier', 'business.teachers', 'phone_legacy', 'SELECT') AS teacher_phone_select",
        );
        const defaultAcl = await facade.query("SELECT COUNT(*)::text AS count FROM pg_default_acl WHERE defaclrole = 'vnext_pg17_business_owner'::regrole");
        const tablePrivileges = await facade.query(
          "SELECT c.relname AS relation, has_table_privilege('vnext_pg17_business_verifier', c.oid, 'SELECT') AS verifier_select, has_table_privilege('vnext_pg17_business_verifier', c.oid, 'INSERT') AS verifier_insert, has_table_privilege('vnext_pg17_business_verifier', c.oid, 'UPDATE') AS verifier_update, has_table_privilege('vnext_pg17_business_verifier', c.oid, 'DELETE') AS verifier_delete, has_table_privilege('vnext_pg17_business_verifier', c.oid, 'TRUNCATE') AS verifier_truncate, has_table_privilege('vnext_pg17_business_verifier', c.oid, 'REFERENCES') AS verifier_references, has_table_privilege('vnext_pg17_business_verifier', c.oid, 'TRIGGER') AS verifier_trigger FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'business' AND c.relkind = 'r' ORDER BY c.relname",
        );
        const verifierColumnPrivileges = await facade.query(
          "SELECT c.relname AS relation, a.attname AS column_name, has_column_privilege('vnext_pg17_business_verifier', c.oid, a.attname, 'SELECT') AS column_select, has_column_privilege('vnext_pg17_business_verifier', c.oid, a.attname, 'INSERT') AS column_insert, has_column_privilege('vnext_pg17_business_verifier', c.oid, a.attname, 'UPDATE') AS column_update, has_column_privilege('vnext_pg17_business_verifier', c.oid, a.attname, 'REFERENCES') AS column_references FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid WHERE n.nspname = 'business' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum",
        );
        const functionPrivileges = await facade.query(
          "SELECT p.proname, has_function_privilege('vnext_pg17_business_migrator', p.oid, 'EXECUTE') AS business_migrator_execute, has_function_privilege('vnext_pg17_business_verifier', p.oid, 'EXECUTE') AS business_verifier_execute, has_function_privilege('vnext_pg17_migrator', p.oid, 'EXECUTE') AS control_migrator_execute, has_function_privilege('vnext_pg17_runtime', p.oid, 'EXECUTE') AS control_runtime_execute, has_function_privilege('vnext_pg17_verifier', p.oid, 'EXECUTE') AS control_verifier_execute, has_function_privilege('vnext_pg17_writer', p.oid, 'EXECUTE') AS control_writer_execute FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'business' ORDER BY p.proname",
        );
        const controlPrivileges = await facade.query(
          "SELECT role_name, c.relname AS relation, has_schema_privilege(role_name, 'business', 'USAGE') AS schema_usage, has_schema_privilege(role_name, 'business', 'CREATE') AS schema_create, has_table_privilege(role_name, c.oid, 'SELECT') AS table_select, has_table_privilege(role_name, c.oid, 'INSERT') AS table_insert, has_table_privilege(role_name, c.oid, 'UPDATE') AS table_update, has_table_privilege(role_name, c.oid, 'DELETE') AS table_delete, has_table_privilege(role_name, c.oid, 'TRUNCATE') AS table_truncate, has_table_privilege(role_name, c.oid, 'REFERENCES') AS table_references, has_table_privilege(role_name, c.oid, 'TRIGGER') AS table_trigger, has_any_column_privilege(role_name, c.oid, 'SELECT') AS any_column_select, has_any_column_privilege(role_name, c.oid, 'INSERT') AS any_column_insert, has_any_column_privilege(role_name, c.oid, 'UPDATE') AS any_column_update, has_any_column_privilege(role_name, c.oid, 'REFERENCES') AS any_column_references FROM (VALUES ('vnext_pg17_migrator'::name), ('vnext_pg17_runtime'::name), ('vnext_pg17_verifier'::name), ('vnext_pg17_writer'::name)) AS roles(role_name) CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'business' AND c.relkind = 'r' ORDER BY role_name, c.relname",
        );
        await facade.query('COMMIT');
        if (relations.rows.length !== expectedBusinessFoundationCatalog.relations.length
          || relations.rows.some((row, index) => row.relation !== expectedBusinessFoundationCatalog.relations[index])
          || ledger.rows.length !== BUSINESS_FOUNDATION_MIGRATIONS.length || ledger.rows.some((row, index) => row.migration_id !== BUSINESS_FOUNDATION_MIGRATIONS[index].migrationId
            || String(row.semantic_version) !== String(BUSINESS_FOUNDATION_MIGRATIONS[index].semanticVersion)
            || row.manifest_sha256 !== BUSINESS_FOUNDATION_MIGRATIONS[index].manifestSha256)
          || ownership.rows.length !== expectedBusinessFoundationCatalog.relations.length || ownership.rows.some(row => row.schema_name !== 'business' || row.schema_owner !== 'vnext_pg17_business_owner' || row.relation_owner !== 'vnext_pg17_business_owner')
          || Object.entries(catalog).some(([key, rows]) => sha256(JSON.stringify(rows)) !== EXPECTED_CATALOG_SHA256[key])
          || roleRows.rows.length !== 3 || roleRows.rows.some(row => row.rolinherit || row.rolsuper || row.rolcreaterole || row.rolcreatedb || row.rolreplication || row.rolbypassrls)
          || !roleRows.rows.find(row => row.rolname === 'vnext_pg17_business_migrator' && row.rolcanlogin)
          || !roleRows.rows.find(row => row.rolname === 'vnext_pg17_business_verifier' && row.rolcanlogin)
          || !roleRows.rows.find(row => row.rolname === 'vnext_pg17_business_owner' && !row.rolcanlogin)
          || JSON.stringify(memberships.rows) !== JSON.stringify([{ member: 'vnext_pg17_business_migrator', role: 'vnext_pg17_business_owner', admin_option: false, inherit_option: false, set_option: true }])
          || privilege.rows.length !== 1 || !privilege.rows[0].verifier_usage || privilege.rows[0].verifier_create || privilege.rows[0].control_verifier_usage || privilege.rows[0].verifier_database_create || privilege.rows[0].verifier_temporary || privilege.rows[0].owner_database_create
          || !privilege.rows[0].tenants_id_select || !privilege.rows[0].institutions_id_select || !privilege.rows[0].schools_id_select || !privilege.rows[0].rooms_id_select || !privilege.rows[0].teachers_id_select || !privilege.rows[0].students_id_select || !privilege.rows[0].courses_id_select || !privilege.rows[0].schedules_id_select || privilege.rows[0].contact_person_select || privilege.rows[0].contact_phone_select || privilege.rows[0].notes_select || privilege.rows[0].student_phone_select || privilege.rows[0].teacher_phone_select
          || defaultAcl.rows.length !== 1 || defaultAcl.rows[0].count !== '0'
          || tablePrivileges.rows.length !== expectedBusinessFoundationCatalog.relations.length || tablePrivileges.rows.some(row => (row.relation === 'business_schema_migrations' ? !row.verifier_select : row.verifier_select)
            || row.verifier_insert || row.verifier_update || row.verifier_delete || row.verifier_truncate || row.verifier_references || row.verifier_trigger)
          || verifierColumnPrivileges.rows.some(row => (row.relation === 'business_schema_migrations'
            ? !row.column_select
            : row.column_select !== BUSINESS_VERIFIER_READABLE_IDENTITIES.has(`${row.relation}.${row.column_name}`))
            || row.column_insert || row.column_update || row.column_references)
          || functionPrivileges.rows.length !== 3 || functionPrivileges.rows.some(row => row.business_migrator_execute || row.business_verifier_execute || row.control_migrator_execute || row.control_runtime_execute || row.control_verifier_execute || row.control_writer_execute)
          || controlPrivileges.rows.length !== expectedBusinessFoundationCatalog.relations.length * 4 || controlPrivileges.rows.some(row => row.schema_usage || row.schema_create || row.table_select || row.table_insert || row.table_update || row.table_delete || row.table_truncate || row.table_references || row.table_trigger || row.any_column_select || row.any_column_insert || row.any_column_update || row.any_column_references)) throw schemaDrift();
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
    try {
      const counts = await readBusinessFoundationZeroSeedCounts(runtime, handle);
      if (counts.length !== 10 || counts.some(row => row.count !== '0')) throw initializationSeeded();
      return Object.freeze({ zeroSeed: true });
    } catch (error) {
      if (error && (error.code === 'VNEXT_PG17_BUSINESS_INITIALIZATION_SEEDED' || error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE')) throw error;
      throw schemaDrift();
    }
  }

  return Object.freeze({ apply, assert, assertZeroSeed });
}

module.exports = { createBusinessFoundationCatalogBoundary };
