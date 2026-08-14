'use strict';

const assert = require('assert');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');

async function runCatalogAssertionCases(runtime) {
  const catalog = createVNextPg17CatalogBoundary(runtime);
  let priorHandle;
  const createHandle = async () => {
    if (priorHandle) {
      await runtime.disposeHandle(priorHandle);
    }
    priorHandle = await runtime.createIsolatedHandle();
    return priorHandle;
  };
  try {
    await assert.rejects(
      () => catalog.assert({}),
      error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
    );
    const migrationInput = {
      appliedAt: '2026-08-14T00:00:00.000Z',
      appliedBy: 'pg17-test',
    };
    const preexistingShadowHandle = await createHandle();
    await withVNextPg17SyntheticQuery(preexistingShadowHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_schema_migrations (id integer)',
    ));
    await assert.rejects(
      () => catalog.apply(preexistingShadowHandle, migrationInput),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(preexistingShadowHandle, 'fixture-provisioner', async facade => {
      const target = await facade.query("SELECT to_regclass('vnext_control_plane.vnext_schema_migrations') AS relation");
      assert.strictEqual(target.rows[0].relation, null);
    });
    const handle = await createHandle();
    await assert.rejects(
      () => catalog.assert(handle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await catalog.apply(handle, migrationInput);
    await assert.doesNotReject(() => catalog.assert(handle));
    assert.deepStrictEqual(await catalog.apply(handle, migrationInput), { applied: false });
    await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      await facade.query('BEGIN READ ONLY');
      try {
        const before = await facade.query('SELECT txid_current_if_assigned() AS transaction_id');
        assert.strictEqual(before.rows[0].transaction_id, null);
        await catalog.assert(handle);
        const after = await facade.query('SELECT txid_current_if_assigned() AS transaction_id');
        assert.strictEqual(after.rows[0].transaction_id, null);
      } finally {
        await facade.query('ROLLBACK');
      }
    });
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
        "INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ('future', 3, repeat('a', 64), now(), 'fixture')",
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
        'DELETE FROM vnext_control_plane.vnext_schema_migrations',
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query(
        'CREATE TEMPORARY TABLE runtime_should_not_create (id integer)',
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query(
        'CREATE TABLE public.runtime_should_not_create (id integer)',
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query(
        'TRUNCATE vnext_control_plane.vnext_schema_migrations',
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query(
        'ALTER TABLE vnext_control_plane.vnext_schema_migrations DISABLE TRIGGER ALL',
      )),
    );
    await assert.doesNotReject(
      () => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query(
        'SELECT migration_id FROM vnext_control_plane.vnext_schema_migrations',
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query(
        "INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ('verifier-write', 2, repeat('a', 64), now(), 'verifier')",
      )),
    );
    await assert.doesNotReject(() => catalog.assert(handle));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations ADD COLUMN unexpected_column integer',
    ));
    await assert.rejects(
      () => catalog.assert(handle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const triggerHandle = await createHandle();
    await catalog.apply(triggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(triggerHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations DISABLE TRIGGER vnext_schema_migrations_no_delete',
    ));
    await assert.rejects(
      () => catalog.assert(triggerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const aclHandle = await createHandle();
    await catalog.apply(aclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(aclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT INSERT ON vnext_control_plane.vnext_schema_migrations TO vnext_pg17_verifier',
    ));
    await assert.rejects(
      () => catalog.assert(aclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const functionHandle = await createHandle();
    await catalog.apply(functionHandle, migrationInput);
    await withVNextPg17SyntheticQuery(functionHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete() OWNER TO vnext_pg17_migrator',
    ));
    await assert.rejects(
      () => catalog.assert(functionHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const pathHandle = await createHandle();
    await catalog.apply(pathHandle, migrationInput);
    await withVNextPg17SyntheticQuery(pathHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete() SET search_path TO public',
    ));
    await assert.rejects(
      () => catalog.assert(pathHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const ownerHandle = await createHandle();
    await catalog.apply(ownerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(ownerHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations OWNER TO vnext_pg17_migrator',
    ));
    await assert.rejects(
      () => catalog.assert(ownerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const extraRelationHandle = await createHandle();
    await catalog.apply(extraRelationHandle, migrationInput);
    await withVNextPg17SyntheticQuery(extraRelationHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE vnext_control_plane.unapproved_target_relation (id integer)',
    ));
    await assert.rejects(
      () => catalog.assert(extraRelationHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const constraintHandle = await createHandle();
    await catalog.apply(constraintHandle, migrationInput);
    await withVNextPg17SyntheticQuery(constraintHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations DROP CONSTRAINT vnext_schema_migrations_semantic_version_key',
    ));
    await assert.rejects(
      () => catalog.assert(constraintHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const functionSourceHandle = await createHandle();
    await catalog.apply(functionSourceHandle, migrationInput);
    await withVNextPg17SyntheticQuery(functionSourceHandle, 'fixture-provisioner', facade => facade.query(
      "CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RETURN OLD; END; $$",
    ));
    await assert.rejects(
      () => catalog.assert(functionSourceHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const checkDefinitionHandle = await createHandle();
    await catalog.apply(checkDefinitionHandle, migrationInput);
    await withVNextPg17SyntheticQuery(checkDefinitionHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations DROP CONSTRAINT vnext_schema_migrations_semantic_version_check',
    ));
    await withVNextPg17SyntheticQuery(checkDefinitionHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations ADD CONSTRAINT vnext_schema_migrations_semantic_version_check CHECK (semantic_version >= 0)',
    ));
    await assert.rejects(
      () => catalog.assert(checkDefinitionHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const nullabilityHandle = await createHandle();
    await catalog.apply(nullabilityHandle, migrationInput);
    await withVNextPg17SyntheticQuery(nullabilityHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations ALTER COLUMN applied_by DROP NOT NULL',
    ));
    await assert.rejects(
      () => catalog.assert(nullabilityHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const functionAclHandle = await createHandle();
    await catalog.apply(functionAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(functionAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete() TO PUBLIC',
    ));
    await assert.rejects(
      () => catalog.assert(functionAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const roleHandle = await createHandle();
    await catalog.apply(roleHandle, migrationInput);
    await withVNextPg17SyntheticQuery(roleHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER ROLE vnext_pg17_owner LOGIN',
    ));
    await assert.rejects(
      () => catalog.assert(roleHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(roleHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER ROLE vnext_pg17_owner NOLOGIN',
    ));
    await assert.doesNotReject(() => catalog.assert(roleHandle));

    const publicSchemaAclHandle = await createHandle();
    await catalog.apply(publicSchemaAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(publicSchemaAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT CREATE ON SCHEMA public TO PUBLIC',
    ));
    await assert.rejects(
      () => catalog.assert(publicSchemaAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const databaseTempAclHandle = await createHandle();
    await catalog.apply(databaseTempAclHandle, migrationInput);
    const database = await withVNextPg17SyntheticQuery(databaseTempAclHandle, 'fixture-provisioner', facade => facade.query(
      'SELECT current_database() AS database_name',
    ));
    assert.match(database.rows[0].database_name, /^vnextpg17_[a-z0-9]+$/);
    await withVNextPg17SyntheticQuery(databaseTempAclHandle, 'fixture-provisioner', facade => facade.query(
      `GRANT TEMPORARY ON DATABASE "${database.rows[0].database_name}" TO PUBLIC`,
    ));
    await assert.rejects(
      () => catalog.assert(databaseTempAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const runtimeLedgerAclHandle = await createHandle();
    await catalog.apply(runtimeLedgerAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(runtimeLedgerAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT SELECT ON vnext_control_plane.vnext_schema_migrations TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(runtimeLedgerAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const runtimeSchemaAclHandle = await createHandle();
    await catalog.apply(runtimeSchemaAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(runtimeSchemaAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT CREATE ON SCHEMA vnext_control_plane TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(runtimeSchemaAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const membershipHandle = await createHandle();
    await catalog.apply(membershipHandle, migrationInput);
    await withVNextPg17SyntheticQuery(membershipHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT vnext_pg17_owner TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(membershipHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(membershipHandle, 'fixture-provisioner', facade => facade.query(
      'REVOKE vnext_pg17_owner FROM vnext_pg17_runtime',
    ));
    await assert.doesNotReject(() => catalog.assert(membershipHandle));

    const publicShadowHandle = await createHandle();
    await catalog.apply(publicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(publicShadowHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_schema_migrations (id integer)',
    ));
    await assert.rejects(
      () => catalog.assert(publicShadowHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const extraIndexHandle = await createHandle();
    await catalog.apply(extraIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(extraIndexHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE INDEX unapproved_applied_by_index ON vnext_control_plane.vnext_schema_migrations (applied_by)',
    ));
    await assert.rejects(
      () => catalog.assert(extraIndexHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const extraViewHandle = await createHandle();
    await catalog.apply(extraViewHandle, migrationInput);
    await withVNextPg17SyntheticQuery(extraViewHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE VIEW vnext_control_plane.unapproved_target_view AS SELECT 1 AS id',
    ));
    await assert.rejects(
      () => catalog.assert(extraViewHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const runtimeDatabaseAclHandle = await createHandle();
    await catalog.apply(runtimeDatabaseAclHandle, migrationInput);
    const runtimeDatabase = await withVNextPg17SyntheticQuery(runtimeDatabaseAclHandle, 'fixture-provisioner', facade => facade.query(
      'SELECT current_database() AS database_name',
    ));
    assert.match(runtimeDatabase.rows[0].database_name, /^vnextpg17_[a-z0-9]+$/);
    await withVNextPg17SyntheticQuery(runtimeDatabaseAclHandle, 'fixture-provisioner', facade => facade.query(
      `GRANT CREATE ON DATABASE "${runtimeDatabase.rows[0].database_name}" TO vnext_pg17_runtime`,
    ));
    await assert.rejects(
      () => catalog.assert(runtimeDatabaseAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const databaseOwnerHandle = await createHandle();
    await catalog.apply(databaseOwnerHandle, migrationInput);
    const ownerDatabase = await withVNextPg17SyntheticQuery(databaseOwnerHandle, 'fixture-provisioner', facade => facade.query(
      'SELECT current_database() AS database_name',
    ));
    assert.match(ownerDatabase.rows[0].database_name, /^vnextpg17_[a-z0-9]+$/);
    await withVNextPg17SyntheticQuery(databaseOwnerHandle, 'fixture-provisioner', facade => facade.query(
      `ALTER DATABASE "${ownerDatabase.rows[0].database_name}" OWNER TO vnext_pg17_migrator`,
    ));
    await assert.rejects(
      () => catalog.assert(databaseOwnerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const rolePrivilegeHandle = await createHandle();
    await catalog.apply(rolePrivilegeHandle, migrationInput);
    await withVNextPg17SyntheticQuery(rolePrivilegeHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER ROLE vnext_pg17_runtime CREATEROLE',
    ));
    await assert.rejects(
      () => catalog.assert(rolePrivilegeHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(rolePrivilegeHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER ROLE vnext_pg17_runtime NOCREATEROLE',
    ));
    await assert.doesNotReject(() => catalog.assert(rolePrivilegeHandle));
  } finally {
    if (priorHandle) {
      await runtime.disposeHandle(priorHandle);
    }
  }
}

async function main() {
  const runtime = createDisposablePg17Runtime();
  try {
    await runtime.start();
    await runCatalogAssertionCases(runtime);
  } finally {
    await runtime.stop();
  }
  console.log('vNext PG17 catalog assertion checks passed');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runCatalogAssertionCases };
