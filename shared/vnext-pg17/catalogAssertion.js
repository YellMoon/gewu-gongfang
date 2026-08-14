'use strict';

const { types } = require('util');
const {
  isVNextPg17DisposableHandleForRuntime,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { MIGRATIONS, expectedCatalog, sha256 } = require('./migrationManifest');

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
const FOUNDATION_COLUMNS = Object.freeze({
  vnext_schema_meta: Object.freeze([
    Object.freeze({ name: 'schema_key', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'schema_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'applied_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_authorities: Object.freeze([
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_accounts: Object.freeze([
    Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'auth_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'access_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revocation_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_trusted_devices: Object.freeze([
    Object.freeze({ name: 'device_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'hardware_evidence_hash', dataType: 'text', udtName: 'text', nullable: 'YES', collation: 'C' }),
    Object.freeze({ name: 'risk_code', dataType: 'text', udtName: 'text', nullable: 'YES', collation: 'C' }),
    Object.freeze({ name: 'credential_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'risk_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
  ]),
  vnext_device_installations: Object.freeze([
    Object.freeze({ name: 'installation_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'device_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'installation_public_key', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'key_fingerprint', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'credential_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
  ]),
  vnext_account_device_links: Object.freeze([
    Object.freeze({ name: 'link_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'device_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'installation_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'auth_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'access_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
  ]),
});
const FOUNDATION_CONSTRAINTS = Object.freeze({
  vnext_schema_meta: Object.freeze({ count: 4, required: Object.freeze(['vnext_schema_meta_pkey', 'vnext_schema_meta_schema_key_check', 'vnext_schema_meta_schema_version_check', 'vnext_schema_meta_applied_at_check']) }),
  vnext_authorities: Object.freeze({ count: 6, required: Object.freeze(['vnext_authorities_pkey', 'vnext_authorities_status_check', 'vnext_authorities_check']) }),
  vnext_accounts: Object.freeze({ count: 13, required: Object.freeze(['vnext_accounts_pkey', 'vnext_accounts_account_id_authority_id_key', 'vnext_accounts_authority_id_fkey', 'vnext_accounts_status_check', 'vnext_accounts_check']) }),
  vnext_trusted_devices: Object.freeze({ count: 16, required: Object.freeze(['vnext_trusted_devices_pkey', 'vnext_trusted_devices_device_id_authority_id_key', 'vnext_trusted_devices_authority_id_fkey', 'vnext_trusted_devices_status_check', 'vnext_trusted_devices_check1']) }),
  vnext_device_installations: Object.freeze({ count: 17, required: Object.freeze(['vnext_device_installations_pkey', 'vnext_device_installations_authority_id_key_fingerprint_key', 'vnext_device_installations_installation_id_device_id_author_key', 'vnext_device_installations_device_id_authority_id_fkey', 'vnext_device_installations_check1']) }),
  vnext_account_device_links: Object.freeze({ count: 20, required: Object.freeze(['vnext_account_device_links_pkey', 'vnext_account_device_links_authority_id_account_id_installa_key', 'vnext_account_device_links_link_id_authority_id_account_id__key', 'vnext_account_device_links_account_id_authority_id_fkey', 'vnext_account_device_links_device_id_authority_id_fkey', 'vnext_account_device_links_installation_id_device_id_autho_fkey', 'vnext_account_device_links_check1']) }),
});
const FOUNDATION_CONSTRAINT_DEFINITIONS = Object.freeze({
  vnext_accounts_authority_id_fkey: 'FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_trusted_devices_authority_id_fkey: 'FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_trusted_devices_check1: "CHECK (status = 'revoked'::text AND revoked_at IS NOT NULL OR status <> 'revoked'::text AND revoked_at IS NULL)",
  vnext_device_installations_authority_id_key_fingerprint_key: 'UNIQUE (authority_id, key_fingerprint)',
  vnext_device_installations_installation_id_device_id_author_key: 'UNIQUE (installation_id, device_id, authority_id)',
  vnext_device_installations_device_id_authority_id_fkey: 'FOREIGN KEY (device_id, authority_id) REFERENCES vnext_control_plane.vnext_trusted_devices(device_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_device_installations_check1: "CHECK (status = 'revoked'::text AND revoked_at IS NOT NULL OR status <> 'revoked'::text AND revoked_at IS NULL)",
  vnext_account_device_links_authority_id_account_id_installa_key: 'UNIQUE (authority_id, account_id, installation_id)',
  vnext_account_device_links_link_id_authority_id_account_id__key: 'UNIQUE (link_id, authority_id, account_id, device_id, installation_id)',
  vnext_account_device_links_account_id_authority_id_fkey: 'FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_account_device_links_device_id_authority_id_fkey: 'FOREIGN KEY (device_id, authority_id) REFERENCES vnext_control_plane.vnext_trusted_devices(device_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_account_device_links_installation_id_device_id_autho_fkey: 'FOREIGN KEY (installation_id, device_id, authority_id) REFERENCES vnext_control_plane.vnext_device_installations(installation_id, device_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_account_device_links_check1: "CHECK (status = 'revoked'::text AND revoked_at IS NOT NULL OR status = 'expired'::text AND revoked_at IS NULL OR status = 'active'::text)",
});
const FOUNDATION_CONSTRAINT_CATALOG_SHA256 = '7634999dfaa13082bf4b7edfdb21673024c8bd105fbaa7538ddb6cbf67300628';
const FOUNDATION_INDEX_CATALOG_SHA256 = '09c4401426e10b07800c6a7fb7c1293cf81265c6714d984a5684c5516eb09fa5';
const FOUNDATION_TABLE_NAMES = Object.freeze(Object.keys(FOUNDATION_COLUMNS).sort());
const TARGET_RELATION_NAMES = Object.freeze([
  'vnext_schema_migrations',
  ...FOUNDATION_TABLE_NAMES,
]);
const TARGET_TABLE_NAMES = Object.freeze([...TARGET_RELATION_NAMES].sort());
const TARGET_TRIGGERS = Object.freeze([
  Object.freeze({ tableName: 'vnext_schema_migrations', triggerName: 'vnext_schema_migrations_insert_guard', functionSchema: 'vnext_control_plane', functionName: 'vnext_schema_migrations_insert_guard', enabled: 'O', definition: 'CREATE TRIGGER vnext_schema_migrations_insert_guard BEFORE INSERT ON vnext_control_plane.vnext_schema_migrations FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_insert_guard()' }),
  Object.freeze({ tableName: 'vnext_schema_migrations', triggerName: 'vnext_schema_migrations_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_schema_migrations_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_schema_migrations_no_delete BEFORE DELETE ON vnext_control_plane.vnext_schema_migrations FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()' }),
  Object.freeze({ tableName: 'vnext_schema_migrations', triggerName: 'vnext_schema_migrations_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_schema_migrations_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_schema_migrations_no_update BEFORE UPDATE ON vnext_control_plane.vnext_schema_migrations FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_update()' }),
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
        const publicShadows = await facade.query(
          "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind <> 'i' AND c.relname = ANY($1::text[])",
          [TARGET_RELATION_NAMES],
        );
        if (existing.rows[0].public_shadow !== null || publicShadows.rows.length !== 0) throw schemaDrift();
        if (existing.rows[0].relation !== null) {
          const ledger = await facade.query(
            'SELECT migration_id, semantic_version, manifest_sha256 FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version',
          );
          if (ledger.rows.length !== MIGRATIONS.length
            || ledger.rows.some((row, index) => row.migration_id !== MIGRATIONS[index].migrationId
              || String(row.semantic_version) !== String(MIGRATIONS[index].semanticVersion)
              || row.manifest_sha256 !== MIGRATIONS[index].manifestSha256)) throw schemaDrift();
          await facade.query('COMMIT');
          await assertCatalog(handle);
          return Object.freeze({ applied: false });
        }
        for (const migration of MIGRATIONS) {
          await facade.query(migration.sql);
          if (migration.postApply) {
            await facade.query(migration.postApply.text, migration.postApply.values(snapshot.appliedAt));
          }
          await facade.query(
            'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
            [migration.migrationId, migration.semanticVersion, migration.manifestSha256, snapshot.appliedAt, snapshot.appliedBy],
          );
        }
        await facade.query('COMMIT');
        await assertCatalog(handle);
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
        const publicShadows = await facade.query(
          "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind <> 'i' AND c.relname = ANY($1::text[])",
          [TARGET_RELATION_NAMES],
        );
        if (relation.rows[0].relation !== 'vnext_control_plane.vnext_schema_migrations'
          || relation.rows[0].public_shadow !== null || publicShadows.rows.length !== 0) throw schemaDrift();
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
        const foundationOwners = await facade.query(
          "SELECT c.relname AS table_name, r.rolname AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner WHERE n.nspname = 'vnext_control_plane' AND c.relname = ANY($1::text[]) AND c.relkind = 'r' ORDER BY c.relname",
          [FOUNDATION_TABLE_NAMES],
        );
        if (foundationOwners.rows.length !== FOUNDATION_TABLE_NAMES.length
          || foundationOwners.rows.some(row => row.owner !== 'vnext_pg17_owner')) throw schemaDrift();
        const foundationColumns = await facade.query(
          "SELECT table_name, column_name, data_type, udt_name, is_nullable, collation_name, column_default FROM information_schema.columns WHERE table_schema = 'vnext_control_plane' AND table_name = ANY($1::text[]) ORDER BY table_name, ordinal_position",
          [FOUNDATION_TABLE_NAMES],
        );
        let foundationOffset = 0;
        for (const tableName of FOUNDATION_TABLE_NAMES) {
          const expectedColumns = FOUNDATION_COLUMNS[tableName];
          const actualColumns = foundationColumns.rows.slice(foundationOffset, foundationOffset + expectedColumns.length);
          foundationOffset += expectedColumns.length;
          if (actualColumns.length !== expectedColumns.length
            || actualColumns.some((row, index) => row.table_name !== tableName
              || row.column_name !== expectedColumns[index].name
              || row.data_type !== expectedColumns[index].dataType
              || row.udt_name !== expectedColumns[index].udtName
              || row.is_nullable !== expectedColumns[index].nullable
              || row.collation_name !== expectedColumns[index].collation
              || row.column_default !== null)) throw schemaDrift();
        }
        if (foundationOffset !== foundationColumns.rows.length) throw schemaDrift();
        const foundationConstraints = await facade.query(
          "SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vnext_control_plane' AND c.relname = ANY($1::text[]) ORDER BY c.relname, con.conname",
          [FOUNDATION_TABLE_NAMES],
        );
        if (sha256(JSON.stringify(foundationConstraints.rows)) !== FOUNDATION_CONSTRAINT_CATALOG_SHA256) throw schemaDrift();
        for (const [tableName, expected] of Object.entries(FOUNDATION_CONSTRAINTS)) {
          const actualConstraints = foundationConstraints.rows.filter(row => row.table_name === tableName);
          if (actualConstraints.length !== expected.count
            || expected.required.some(name => !actualConstraints.some(row => row.conname === name))) throw schemaDrift();
        }
        for (const [constraintName, definition] of Object.entries(FOUNDATION_CONSTRAINT_DEFINITIONS)) {
          const constraint = foundationConstraints.rows.find(row => row.conname === constraintName);
          if (!constraint || constraint.definition !== definition) throw schemaDrift();
        }
        const foundationIndexes = await facade.query(
          "SELECT table_relation.relname AS table_name, index_relation.relname AS index_name, i.indisprimary, i.indisunique, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class table_relation ON table_relation.oid = i.indrelid JOIN pg_class index_relation ON index_relation.oid = i.indexrelid JOIN pg_namespace n ON n.oid = table_relation.relnamespace WHERE n.nspname = 'vnext_control_plane' AND table_relation.relname = ANY($1::text[]) ORDER BY table_relation.relname, index_relation.relname",
          [FOUNDATION_TABLE_NAMES],
        );
        if (sha256(JSON.stringify(foundationIndexes.rows)) !== FOUNDATION_INDEX_CATALOG_SHA256) throw schemaDrift();
        const columns = await facade.query(
          "SELECT column_name, data_type, udt_name, is_nullable, collation_name, column_default FROM information_schema.columns WHERE table_schema = 'vnext_control_plane' AND table_name = 'vnext_schema_migrations' ORDER BY ordinal_position",
        );
        if (columns.rows.length !== LEDGER_COLUMNS.length
          || columns.rows.some((row, index) => row.column_name !== LEDGER_COLUMNS[index].name
            || row.data_type !== LEDGER_COLUMNS[index].dataType
            || row.udt_name !== LEDGER_COLUMNS[index].udtName
            || row.is_nullable !== LEDGER_COLUMNS[index].nullable
            || row.collation_name !== LEDGER_COLUMNS[index].collation
            || row.column_default !== null)) throw schemaDrift();
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
          "SELECT c.relname AS table_name, t.tgname AS trigger_name, function_namespace.nspname AS function_schema, p.proname AS function_name, t.tgenabled, pg_get_triggerdef(t.oid, true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace function_namespace ON function_namespace.oid = p.pronamespace WHERE n.nspname = 'vnext_control_plane' AND c.relname = ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname, t.tgname",
          [TARGET_TABLE_NAMES],
        );
        if (triggers.rows.length !== TARGET_TRIGGERS.length
          || triggers.rows.some((row, index) => row.table_name !== TARGET_TRIGGERS[index].tableName
            || row.trigger_name !== TARGET_TRIGGERS[index].triggerName
            || row.function_schema !== TARGET_TRIGGERS[index].functionSchema
            || row.function_name !== TARGET_TRIGGERS[index].functionName
            || row.tgenabled !== TARGET_TRIGGERS[index].enabled
            || row.definition !== TARGET_TRIGGERS[index].definition)) {
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
          "SELECT has_schema_privilege('vnext_pg17_verifier', 'vnext_control_plane', 'USAGE') AS schema_usage, has_schema_privilege('vnext_pg17_verifier', 'vnext_control_plane', 'CREATE') AS verifier_schema_create, has_schema_privilege('vnext_pg17_verifier', 'public', 'CREATE') AS verifier_public_create, has_database_privilege('vnext_pg17_verifier', current_database(), 'CREATE') AS verifier_database_create, has_database_privilege('vnext_pg17_verifier', current_database(), 'TEMPORARY') AS verifier_temporary, has_schema_privilege('vnext_pg17_runtime', 'vnext_control_plane', 'USAGE') AS runtime_schema_usage, has_schema_privilege('vnext_pg17_runtime', 'vnext_control_plane', 'CREATE') AS runtime_schema_create, has_schema_privilege('vnext_pg17_runtime', 'public', 'CREATE') AS runtime_public_create, has_database_privilege('vnext_pg17_runtime', current_database(), 'CREATE') AS runtime_database_create, has_database_privilege('vnext_pg17_runtime', current_database(), 'TEMPORARY') AS runtime_temporary",
        );
        const privilege = privileges.rows[0];
        if (!privilege.schema_usage || privilege.verifier_schema_create || privilege.verifier_public_create
          || privilege.verifier_database_create || privilege.verifier_temporary || privilege.runtime_schema_usage
          || privilege.runtime_schema_create || privilege.runtime_public_create
          || privilege.runtime_database_create || privilege.runtime_temporary) {
          throw schemaDrift();
        }
        const targetPrivileges = await facade.query(
          "SELECT c.relname AS table_name, has_table_privilege('vnext_pg17_verifier', c.oid, 'SELECT') AS verifier_select, has_table_privilege('vnext_pg17_verifier', c.oid, 'INSERT') AS verifier_insert, has_table_privilege('vnext_pg17_verifier', c.oid, 'UPDATE') AS verifier_update, has_table_privilege('vnext_pg17_verifier', c.oid, 'DELETE') AS verifier_delete, has_table_privilege('vnext_pg17_verifier', c.oid, 'TRUNCATE') AS verifier_truncate, has_table_privilege('vnext_pg17_verifier', c.oid, 'REFERENCES') AS verifier_references, has_table_privilege('vnext_pg17_verifier', c.oid, 'TRIGGER') AS verifier_trigger, has_table_privilege('vnext_pg17_runtime', c.oid, 'SELECT') AS runtime_select, has_table_privilege('vnext_pg17_runtime', c.oid, 'INSERT') AS runtime_insert, has_table_privilege('vnext_pg17_runtime', c.oid, 'UPDATE') AS runtime_update, has_table_privilege('vnext_pg17_runtime', c.oid, 'DELETE') AS runtime_delete, has_table_privilege('vnext_pg17_runtime', c.oid, 'TRUNCATE') AS runtime_truncate, has_table_privilege('vnext_pg17_runtime', c.oid, 'REFERENCES') AS runtime_references, has_table_privilege('vnext_pg17_runtime', c.oid, 'TRIGGER') AS runtime_trigger FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vnext_control_plane' AND c.relname = ANY($1::text[]) ORDER BY c.relname",
          [TARGET_TABLE_NAMES],
        );
        if (targetPrivileges.rows.length !== TARGET_TABLE_NAMES.length
          || targetPrivileges.rows.some((row, index) => row.table_name !== TARGET_TABLE_NAMES[index]
            || !row.verifier_select || row.verifier_insert || row.verifier_update || row.verifier_delete
            || row.verifier_truncate || row.verifier_references || row.verifier_trigger
            || row.runtime_select || row.runtime_insert || row.runtime_update || row.runtime_delete
            || row.runtime_truncate || row.runtime_references || row.runtime_trigger)) throw schemaDrift();
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
        if (ledger.rows.length !== MIGRATIONS.length
          || ledger.rows.some((row, index) => row.migration_id !== MIGRATIONS[index].migrationId
            || String(row.semantic_version) !== String(MIGRATIONS[index].semanticVersion)
            || row.manifest_sha256 !== MIGRATIONS[index].manifestSha256)) throw schemaDrift();
        const schemaMeta = await facade.query(
          "SELECT m.schema_key, m.schema_version::text AS schema_version, m.applied_at = (SELECT applied_at FROM vnext_control_plane.vnext_schema_migrations WHERE semantic_version = 2) AS applied_at_matches FROM vnext_control_plane.vnext_schema_meta m ORDER BY m.schema_key",
        );
        if (schemaMeta.rows.length !== 1
          || schemaMeta.rows[0].schema_key !== 'control-plane-reference'
          || schemaMeta.rows[0].schema_version !== '5'
          || !schemaMeta.rows[0].applied_at_matches) throw schemaDrift();
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
