'use strict';

const { types } = require('util');
const {
  isVNextPg17DisposableHandleForRuntime,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { FIRST_MIGRATION, expectedCatalog, sha256 } = require('./migrationManifest');

const LEDGER_COLUMNS = Object.freeze([
  Object.freeze({ name: 'migration_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
  Object.freeze({ name: 'semantic_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
  Object.freeze({ name: 'manifest_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
  Object.freeze({ name: 'applied_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  Object.freeze({ name: 'applied_by', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
]);
const LEDGER_TRIGGERS = Object.freeze([
  'vnext_schema_migrations_insert_guard',
  'vnext_schema_migrations_no_delete',
  'vnext_schema_migrations_no_update',
]);
const LEDGER_FUNCTIONS = Object.freeze([
  'vnext_schema_migrations_insert_guard',
  'vnext_schema_migrations_no_delete',
  'vnext_schema_migrations_no_update',
]);
const LEDGER_CONSTRAINTS = Object.freeze([
  Object.freeze({ name: 'vnext_schema_migrations_applied_at_check', type: 'c', definition: "CHECK (applied_at <> 'infinity'::timestamp with time zone AND applied_at <> '-infinity'::timestamp with time zone)" }),
  Object.freeze({ name: 'vnext_schema_migrations_applied_by_check', type: 'c', definition: "CHECK (btrim(applied_by) <> ''::text)" }),
  Object.freeze({ name: 'vnext_schema_migrations_manifest_sha256_check', type: 'c', definition: "CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'::text)" }),
  Object.freeze({ name: 'vnext_schema_migrations_migration_id_check', type: 'c', definition: "CHECK (btrim(migration_id) <> ''::text)" }),
  Object.freeze({ name: 'vnext_schema_migrations_pkey', type: 'p', definition: 'PRIMARY KEY (migration_id)' }),
  Object.freeze({ name: 'vnext_schema_migrations_semantic_version_check', type: 'c', definition: 'CHECK (semantic_version > 0)' }),
  Object.freeze({ name: 'vnext_schema_migrations_semantic_version_key', type: 'u', definition: 'UNIQUE (semantic_version)' }),
]);
const SYNTHETIC_ROLES = Object.freeze([
  Object.freeze({ name: 'vnext_pg17_migrator', canLogin: true, inherit: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false }),
  Object.freeze({ name: 'vnext_pg17_owner', canLogin: false, inherit: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false }),
  Object.freeze({ name: 'vnext_pg17_runtime', canLogin: true, inherit: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false }),
  Object.freeze({ name: 'vnext_pg17_verifier', canLogin: true, inherit: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false }),
]);
const SYNTHETIC_MEMBERSHIPS = Object.freeze([
  Object.freeze({ member: 'vnext_pg17_migrator', role: 'vnext_pg17_owner', admin: false, inherit: false, set: true }),
]);
const LEDGER_INDEXES = Object.freeze([
  Object.freeze({ name: 'vnext_schema_migrations_pkey', primary: true, unique: true }),
  Object.freeze({ name: 'vnext_schema_migrations_semantic_version_key', primary: false, unique: true }),
]);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidHandle() {
  return codedError('VNEXT_PG17_HANDLE_INVALID', 'vNext PG17 disposable handle is invalid');
}

function schemaDrift() {
  return codedError('VNEXT_PG17_SCHEMA_DRIFT', 'vNext PG17 target catalog differs from its immutable manifest');
}

function inputInvalid() {
  return codedError('VNEXT_PG17_MIGRATION_INPUT_INVALID', 'vNext PG17 migration input is invalid');
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
  if (typeof appliedAt !== 'string' || new Date(appliedAt).toISOString() !== appliedAt
    || typeof appliedBy !== 'string' || appliedBy.trim() === '') throw inputInvalid();
  return Object.freeze({ appliedAt, appliedBy });
}

function createVNextPg17CatalogBoundary(runtime) {
  if (!runtime || typeof runtime !== 'object' || types.isProxy(runtime)) throw invalidHandle();

  async function apply(handle, input) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    const snapshot = snapshotApplyInput(input);
    return withVNextPg17SyntheticQuery(handle, 'migrator', async facade => {
      try {
        await facade.query('BEGIN');
        await facade.query("SET LOCAL TIME ZONE 'UTC'");
        await facade.query('SELECT pg_advisory_xact_lock(73017, 1)');
        await facade.query('SET LOCAL ROLE vnext_pg17_owner');
        const existing = await facade.query(
          "SELECT to_regclass('vnext_control_plane.vnext_schema_migrations') AS relation, to_regclass('public.vnext_schema_migrations') AS public_shadow",
        );
        if (existing.rows[0].public_shadow !== null) throw schemaDrift();
        if (existing.rows[0].relation !== null) {
          const ledger = await facade.query(
            'SELECT migration_id, semantic_version, manifest_sha256 FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version',
          );
          if (ledger.rows.length !== 1
            || ledger.rows[0].migration_id !== FIRST_MIGRATION.migrationId
            || Number(ledger.rows[0].semantic_version) !== FIRST_MIGRATION.semanticVersion
            || ledger.rows[0].manifest_sha256 !== FIRST_MIGRATION.manifestSha256) throw schemaDrift();
          await facade.query('COMMIT');
          return Object.freeze({ applied: false });
        }
        await facade.query(FIRST_MIGRATION.sql);
        await facade.query(
          'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
          [FIRST_MIGRATION.migrationId, FIRST_MIGRATION.semanticVersion, FIRST_MIGRATION.manifestSha256, snapshot.appliedAt, snapshot.appliedBy],
        );
        await facade.query('COMMIT');
        return Object.freeze({ applied: true });
      } catch (error) {
        try { await facade.query('ROLLBACK'); } catch (_) { /* no-op */ }
        if (error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT') throw error;
        throw schemaDrift();
      }
    });
  }

  async function assertCatalog(handle) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    return withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      try {
        const relation = await facade.query(
          "SELECT to_regclass('vnext_control_plane.vnext_schema_migrations') AS relation, to_regclass('public.vnext_schema_migrations') AS public_shadow",
        );
        if (relation.rows[0].relation !== 'vnext_control_plane.vnext_schema_migrations'
          || relation.rows[0].public_shadow !== null) throw schemaDrift();
        const databaseOwnership = await facade.query(
          'SELECT r.rolname AS database_owner FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE d.datname = current_database()',
        );
        if (databaseOwnership.rows.length !== 1
          || databaseOwnership.rows[0].database_owner !== expectedCatalog.owners.database) throw schemaDrift();
        const ownership = await facade.query(
          "SELECT schema_owner.rolname AS schema_owner, table_owner.rolname AS table_owner FROM pg_namespace n JOIN pg_roles schema_owner ON schema_owner.oid = n.nspowner JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = 'vnext_schema_migrations' JOIN pg_roles table_owner ON table_owner.oid = c.relowner WHERE n.nspname = 'vnext_control_plane' AND c.relkind = 'r'",
        );
        if (ownership.rows.length !== 1
          || ownership.rows[0].schema_owner !== expectedCatalog.owners.schema
          || ownership.rows[0].table_owner !== expectedCatalog.owners.table) throw schemaDrift();
        const relations = await facade.query(
          "SELECT n.nspname || '.' || c.relname AS relation FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vnext_control_plane' AND c.relkind <> 'i' ORDER BY c.relname",
        );
        if (relations.rows.length !== expectedCatalog.relations.length
          || relations.rows.some((row, index) => row.relation !== expectedCatalog.relations[index])) throw schemaDrift();
        const columns = await facade.query(
          "SELECT column_name, data_type, udt_name, is_nullable, collation_name FROM information_schema.columns WHERE table_schema = 'vnext_control_plane' AND table_name = 'vnext_schema_migrations' ORDER BY ordinal_position",
        );
        if (columns.rows.length !== LEDGER_COLUMNS.length
          || columns.rows.some((row, index) => row.column_name !== LEDGER_COLUMNS[index].name
            || row.data_type !== LEDGER_COLUMNS[index].dataType
            || row.udt_name !== LEDGER_COLUMNS[index].udtName
            || row.is_nullable !== LEDGER_COLUMNS[index].nullable
            || row.collation_name !== LEDGER_COLUMNS[index].collation)) throw schemaDrift();
        const constraints = await facade.query(
          "SELECT conname, contype, pg_get_constraintdef(oid, true) AS definition FROM pg_constraint WHERE conrelid = 'vnext_control_plane.vnext_schema_migrations'::regclass ORDER BY conname",
        );
        if (constraints.rows.length !== LEDGER_CONSTRAINTS.length
          || constraints.rows.some((row, index) => row.conname !== LEDGER_CONSTRAINTS[index].name
            || row.contype !== LEDGER_CONSTRAINTS[index].type
            || row.definition !== LEDGER_CONSTRAINTS[index].definition)) throw schemaDrift();
        const indexes = await facade.query(
          "SELECT index_relation.relname AS index_name, i.indisprimary, i.indisunique FROM pg_index i JOIN pg_class index_relation ON index_relation.oid = i.indexrelid WHERE i.indrelid = 'vnext_control_plane.vnext_schema_migrations'::regclass ORDER BY index_relation.relname",
        );
        if (indexes.rows.length !== LEDGER_INDEXES.length
          || indexes.rows.some((row, index) => row.index_name !== LEDGER_INDEXES[index].name
            || row.indisprimary !== LEDGER_INDEXES[index].primary
            || row.indisunique !== LEDGER_INDEXES[index].unique)) throw schemaDrift();
        const triggers = await facade.query(
          "SELECT t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vnext_control_plane' AND c.relname = 'vnext_schema_migrations' AND NOT t.tgisinternal ORDER BY t.tgname",
        );
        if (triggers.rows.length !== LEDGER_TRIGGERS.length
          || triggers.rows.some((row, index) => row.tgname !== LEDGER_TRIGGERS[index] || row.tgenabled !== 'O')) {
          throw schemaDrift();
        }
        const roles = await facade.query(
          "SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN ('vnext_pg17_migrator', 'vnext_pg17_owner', 'vnext_pg17_runtime', 'vnext_pg17_verifier') ORDER BY rolname",
        );
        if (roles.rows.length !== SYNTHETIC_ROLES.length
          || roles.rows.some((row, index) => row.rolname !== SYNTHETIC_ROLES[index].name
            || row.rolcanlogin !== SYNTHETIC_ROLES[index].canLogin
            || row.rolinherit !== SYNTHETIC_ROLES[index].inherit
            || row.rolsuper !== SYNTHETIC_ROLES[index].superuser
            || row.rolcreaterole !== SYNTHETIC_ROLES[index].createRole
            || row.rolcreatedb !== SYNTHETIC_ROLES[index].createDb
            || row.rolreplication !== SYNTHETIC_ROLES[index].replication
            || row.rolbypassrls !== SYNTHETIC_ROLES[index].bypassRls)) throw schemaDrift();
        const memberships = await facade.query(
          "SELECT member_role.rolname AS member, granted_role.rolname AS role, m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid = m.member JOIN pg_roles granted_role ON granted_role.oid = m.roleid WHERE member_role.rolname IN ('vnext_pg17_migrator', 'vnext_pg17_owner', 'vnext_pg17_runtime', 'vnext_pg17_verifier') ORDER BY member_role.rolname, granted_role.rolname",
        );
        if (memberships.rows.length !== SYNTHETIC_MEMBERSHIPS.length
          || memberships.rows.some((row, index) => row.member !== SYNTHETIC_MEMBERSHIPS[index].member
            || row.role !== SYNTHETIC_MEMBERSHIPS[index].role
            || row.admin_option !== SYNTHETIC_MEMBERSHIPS[index].admin
            || row.inherit_option !== SYNTHETIC_MEMBERSHIPS[index].inherit
            || row.set_option !== SYNTHETIC_MEMBERSHIPS[index].set)) throw schemaDrift();
        const privileges = await facade.query(
          "SELECT has_schema_privilege('vnext_pg17_verifier', 'vnext_control_plane', 'USAGE') AS schema_usage, has_schema_privilege('vnext_pg17_verifier', 'vnext_control_plane', 'CREATE') AS verifier_schema_create, has_table_privilege('vnext_pg17_verifier', 'vnext_control_plane.vnext_schema_migrations', 'SELECT') AS can_select, has_table_privilege('vnext_pg17_verifier', 'vnext_control_plane.vnext_schema_migrations', 'INSERT') AS can_insert, has_table_privilege('vnext_pg17_verifier', 'vnext_control_plane.vnext_schema_migrations', 'UPDATE') AS can_update, has_table_privilege('vnext_pg17_verifier', 'vnext_control_plane.vnext_schema_migrations', 'DELETE') AS can_delete, has_table_privilege('vnext_pg17_runtime', 'vnext_control_plane.vnext_schema_migrations', 'SELECT') AS runtime_select, has_schema_privilege('vnext_pg17_runtime', 'vnext_control_plane', 'CREATE') AS runtime_schema_create, has_schema_privilege('vnext_pg17_runtime', 'public', 'CREATE') AS runtime_public_create, has_database_privilege('vnext_pg17_runtime', current_database(), 'CREATE') AS runtime_database_create, has_database_privilege('vnext_pg17_runtime', current_database(), 'TEMPORARY') AS runtime_temporary",
        );
        const privilege = privileges.rows[0];
        if (!privilege.schema_usage || privilege.verifier_schema_create || !privilege.can_select
          || privilege.can_insert || privilege.can_update || privilege.can_delete || privilege.runtime_select
          || privilege.runtime_schema_create || privilege.runtime_public_create
          || privilege.runtime_database_create || privilege.runtime_temporary) {
          throw schemaDrift();
        }
        const functions = await facade.query(
          "SELECT p.proname, r.rolname AS owner, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) AS definition, has_function_privilege('vnext_pg17_runtime', p.oid, 'EXECUTE') AS runtime_execute, has_function_privilege('vnext_pg17_verifier', p.oid, 'EXECUTE') AS verifier_execute FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner WHERE n.nspname = 'vnext_control_plane' ORDER BY p.proname",
        );
        if (functions.rows.length !== LEDGER_FUNCTIONS.length
          || functions.rows.some((row, index) => row.proname !== LEDGER_FUNCTIONS[index]
            || row.owner !== 'vnext_pg17_owner' || !row.prosecdef
            || !Array.isArray(row.proconfig) || row.proconfig.length !== 1
            || row.proconfig[0] !== 'search_path=pg_catalog, pg_temp'
            || row.runtime_execute || row.verifier_execute
            || sha256(row.definition) !== expectedCatalog.functionDefinitionSha256[row.proname])) throw schemaDrift();
        const ledger = await facade.query(
          'SELECT migration_id, semantic_version, manifest_sha256 FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version',
        );
        if (ledger.rows.length !== 1
          || ledger.rows[0].migration_id !== FIRST_MIGRATION.migrationId
          || Number(ledger.rows[0].semantic_version) !== FIRST_MIGRATION.semanticVersion
          || ledger.rows[0].manifest_sha256 !== FIRST_MIGRATION.manifestSha256) throw schemaDrift();
        return Object.freeze({ asserted: true });
      } catch (error) {
        if (error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT') throw error;
        throw schemaDrift();
      }
    });
  }

  return Object.freeze({ apply, assert: assertCatalog });
}

module.exports = { createVNextPg17CatalogBoundary };
