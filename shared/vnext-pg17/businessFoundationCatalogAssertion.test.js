'use strict';

const assert = require('assert');
const { execFile } = require('child_process');
const {
  createDisposablePg17Runtime,
  createVNextPg17BusinessFoundationDdlTrace,
  armVNextPg17BusinessFoundationDdlTrace,
  inspectVNextPg17BusinessFoundationDdlTrace,
  createVNextPg17BusinessFoundationDdlFaultPlan,
  armVNextPg17BusinessFoundationDdlFaultPlan,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('./businessFoundationCatalogAssertion');
const { BUSINESS_FOUNDATION_MIGRATIONS } = require('./businessFoundationManifest');

const APPLIED_AT = '2026-08-21T00:00:00.000Z';
const APPLY_INPUT = Object.freeze({ appliedAt: APPLIED_AT, appliedBy: 'business-foundation-test' });
const LOCAL_DOCKER_HOST = process.platform === 'win32'
  ? 'npipe:////./pipe/docker_engine'
  : 'unix:///var/run/docker.sock';
const DISPOSABLE_OWNER_LABEL = `com.gewu.vnext-pg17-disposable-owner=${process.pid}`;

function runDocker(args) {
  return new Promise((resolve, reject) => {
    execFile('docker', ['--host', LOCAL_DOCKER_HOST, ...args], { windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function ownedContainerIds() {
  const output = await runDocker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `label=${DISPOSABLE_OWNER_LABEL}`]);
  return output.trim() === '' ? [] : output.trim().split(/\r?\n/).sort();
}

function assertReapplyTrace(queries) {
  assert.deepStrictEqual(queries, [
    'BEGIN',
    "SET LOCAL TIME ZONE 'UTC'",
    'SELECT pg_advisory_xact_lock(73018, 1)',
    'SET LOCAL ROLE vnext_pg17_business_owner',
    "SELECT to_regclass('business.business_schema_migrations') AS ledger, to_regclass('public.business_schema_migrations') AS public_shadow",
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind <> 'i' AND c.relname = ANY($1::text[])",
    'SELECT migration_id, semantic_version, manifest_sha256 FROM business.business_schema_migrations ORDER BY semantic_version',
    'COMMIT',
  ]);
}

async function runBusinessFoundationCatalogAssertionCases(runtime) {
  const controlCatalog = createVNextPg17CatalogBoundary(runtime);
  const businessCatalog = createBusinessFoundationCatalogBoundary(runtime);
  const handle = await runtime.createIsolatedHandle();
  try {
    await assert.rejects(() => businessCatalog.apply({}, APPLY_INPUT), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
    await assert.rejects(() => businessCatalog.apply(handle, { appliedAt: APPLIED_AT, appliedBy: '  ' }), error => error && error.code === 'VNEXT_PG17_MIGRATION_INPUT_INVALID');
    await assert.rejects(() => businessCatalog.apply(handle, new Proxy(APPLY_INPUT, {})), error => error && error.code === 'VNEXT_PG17_MIGRATION_INPUT_INVALID');
    await controlCatalog.apply(handle, APPLY_INPUT);
    await controlCatalog.assert(handle);

    const trace = createVNextPg17BusinessFoundationDdlTrace(runtime, handle);
    armVNextPg17BusinessFoundationDdlTrace(trace);
    assert.deepStrictEqual(await businessCatalog.apply(handle, APPLY_INPUT), Object.freeze({ applied: true }));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const ledger = await facade.query(
        'SELECT migration_id, semantic_version, manifest_sha256 FROM business.business_schema_migrations ORDER BY semantic_version',
      );
      assert.deepStrictEqual(
        ledger.rows,
        BUSINESS_FOUNDATION_MIGRATIONS.map(migration => ({
          migration_id: migration.migrationId,
          semantic_version: migration.semanticVersion,
          manifest_sha256: migration.manifestSha256,
        })),
        'a fresh closed business DDL apply must append every fixed migration exactly once and in ledger order'
      );
    });
    const ddlTrace = inspectVNextPg17BusinessFoundationDdlTrace(trace).queries;
    assert.strictEqual(ddlTrace[0], 'BEGIN');
    assert.strictEqual(ddlTrace[1], "SET LOCAL TIME ZONE 'UTC'");
    assert.strictEqual(ddlTrace[2], 'SELECT pg_advisory_xact_lock(73018, 1)');
    assert.strictEqual(ddlTrace[3], 'SET LOCAL ROLE vnext_pg17_business_owner');
    assert.match(ddlTrace[6], /^GRANT CREATE ON DATABASE "vnextpg17_[a-f0-9]{16}" TO vnext_pg17_business_owner$/);
    assert.match(ddlTrace.at(-2), /^REVOKE CREATE ON DATABASE "vnextpg17_[a-f0-9]{16}" FROM vnext_pg17_business_owner$/);
    assert.strictEqual(ddlTrace.at(-1), 'COMMIT');
    assert.deepStrictEqual(ddlTrace.slice(0, 6), [
      'BEGIN',
      "SET LOCAL TIME ZONE 'UTC'",
      'SELECT pg_advisory_xact_lock(73018, 1)',
      'SET LOCAL ROLE vnext_pg17_business_owner',
      "SELECT to_regclass('business.business_schema_migrations') AS ledger, to_regclass('public.business_schema_migrations') AS public_shadow",
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind <> 'i' AND c.relname = ANY($1::text[])",
    ]);
    assert.deepStrictEqual(ddlTrace.slice(7, -2), BUSINESS_FOUNDATION_MIGRATIONS.flatMap(migration => [
      migration.sql,
      'INSERT INTO business.business_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
    ]));
    assert.ok(ddlTrace.every(statement => !statement.includes('vnext_control_plane')));
    assert.ok(ddlTrace.every(statement => !/\b(?:INSERT|UPDATE|DELETE)\s+INTO?\s+business\.(?:tenants|institutions|schools|rooms|teachers|students|courses|course_student_pricings|schedules|schedule_student_overrides)\b/i.test(statement)));
    assert.deepStrictEqual(await businessCatalog.assert(handle), Object.freeze({ asserted: true }));
    assert.deepStrictEqual(await businessCatalog.assertZeroSeed(handle), Object.freeze({ zeroSeed: true }));
    const orphanDetailHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(orphanDetailHandle, APPLY_INPUT);
      await businessCatalog.apply(orphanDetailHandle, APPLY_INPUT);
      await withVNextPg17SyntheticQuery(orphanDetailHandle, 'fixture-provisioner', async facade => {
        await facade.query("SET session_replication_role = 'replica'");
        try {
          await facade.query("INSERT INTO business.course_student_pricings (tenant_id, course_id, student_id, tuition, teacher_fee) VALUES ('orphan-tenant', 'orphan-course', 'orphan-student', 0, 0)");
        } finally {
          await facade.query("SET session_replication_role = 'origin'");
        }
      });
      await assert.rejects(
        () => businessCatalog.assertZeroSeed(orphanDetailHandle),
        error => error && error.code === 'VNEXT_PG17_BUSINESS_INITIALIZATION_SEEDED',
        'zero-seed verification must directly detect orphaned detail rows rather than infer their absence from parent foreign keys',
      );
    } finally {
      await runtime.disposeHandle(orphanDetailHandle);
    }
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await assert.rejects(
        () => facade.query("INSERT INTO business.institutions (id, tenant_id, name, legacy_deleted, created_at, updated_at) VALUES ('institution-missing-tenant', 'missing-tenant', 'Fictional institution', false, $1, $1)", [APPLIED_AT]),
        error => error && error.code === '23503' && error.constraint === 'institutions_tenant_fk',
      );
      await assert.rejects(
        () => facade.query("INSERT INTO business.tenants (id, name, legacy_deleted, created_at, updated_at) VALUES (' ', 'Fictional tenant', false, $1, $1)", [APPLIED_AT]),
        error => error && error.code === '23514',
      );
      await assert.rejects(
        () => facade.query("INSERT INTO business.tenants (id, name, legacy_deleted, created_at, updated_at) VALUES ('tenant-invalid-bool', 'Fictional tenant', 'not-bool', $1, $1)", [APPLIED_AT]),
        error => error && error.code === '22P02',
      );
      await assert.rejects(
        () => facade.query("INSERT INTO business.tenants (id, name, legacy_deleted, created_at, updated_at) VALUES ('tenant-infinite-time', 'Fictional tenant', false, 'infinity', 'infinity')"),
        error => error && error.code === '23514',
      );
      await assert.rejects(
        () => facade.query("INSERT INTO business.tenants (id, name, legacy_deleted, created_at, updated_at) VALUES ('tenant-reversed-time', 'Fictional tenant', false, '2026-08-21T00:00:01.000Z', '2026-08-21T00:00:00.000Z')"),
        error => error && error.code === '23514',
      );
      await facade.query("INSERT INTO business.tenants (id, name, legacy_deleted, created_at, updated_at) VALUES ('tenant-behavior', 'Fictional tenant', false, $1, $1)", [APPLIED_AT]);
      await facade.query("INSERT INTO business.institutions (id, tenant_id, name, legacy_deleted, created_at, updated_at) VALUES ('institution-behavior', 'tenant-behavior', 'Fictional institution', false, $1, $1)", [APPLIED_AT]);
      await assert.rejects(
        () => facade.query("INSERT INTO business.schools (id, tenant_id, name, legacy_count, legacy_deleted, created_at, updated_at) VALUES ('school-fractional-count', 'tenant-behavior', 'Fictional school', '1.5', false, $1, $1)", [APPLIED_AT]),
        error => error && error.code === '22P02',
      );
      await facade.query("INSERT INTO business.schools (id, tenant_id, name, legacy_count, legacy_deleted, created_at, updated_at) VALUES ('school-behavior', 'tenant-behavior', 'Fictional school', 1, false, $1, $1)", [APPLIED_AT]);
      await facade.query("INSERT INTO business.rooms (id, tenant_id, name, legacy_count, legacy_deleted, created_at, updated_at) VALUES ('room-behavior', 'tenant-behavior', 'Fictional room', 1, false, $1, $1)", [APPLIED_AT]);
    });

    const crossTenantHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(crossTenantHandle, APPLY_INPUT);
      await businessCatalog.apply(crossTenantHandle, APPLY_INPUT);
      await withVNextPg17SyntheticQuery(crossTenantHandle, 'fixture-provisioner', async facade => {
        for (const tenantId of ['tenant-a', 'tenant-b']) {
          await facade.query("INSERT INTO business.tenants (id, name, legacy_deleted, created_at, updated_at) VALUES ($1, $1, false, $2, $2)", [tenantId, APPLIED_AT]);
        }
        await facade.query("INSERT INTO business.institutions (id, tenant_id, name, legacy_deleted, created_at, updated_at) VALUES ('institution-b', 'tenant-b', 'Fictional institution', false, $1, $1)", [APPLIED_AT]);
        await facade.query("INSERT INTO business.teachers (id, tenant_id, name, legacy_deleted, created_at, updated_at) VALUES ('teacher-b', 'tenant-b', 'Fictional teacher', false, $1, $1)", [APPLIED_AT]);
        await assert.rejects(
          () => facade.query("INSERT INTO business.courses (id, tenant_id, name, display_name, course_type, legacy_source_type, institution_id, billing_unit, teacher_fee_mode, teacher_id, legacy_active, legacy_deleted, created_at, updated_at) VALUES ('course-cross-tenant', 'tenant-a', 'Fictional course', 'Fictional course', 1, 1, 'institution-b', 1, 1, 'teacher-b', true, false, $1, $1)", [APPLIED_AT]),
          error => error && error.code === '23503',
          'a course must not cross a tenant boundary through either institution or teacher',
        );
      });
    } finally {
      await runtime.disposeHandle(crossTenantHandle);
    }

    const driftedPrefixHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(driftedPrefixHandle, APPLY_INPUT);
      await withVNextPg17SyntheticQuery(driftedPrefixHandle, 'fixture-provisioner', async facade => {
        const database = await facade.query('SELECT current_database() AS database');
        await facade.query(`GRANT CREATE ON DATABASE "${database.rows[0].database}" TO vnext_pg17_business_owner`);
        try {
          await facade.query('SET ROLE vnext_pg17_business_owner');
          await facade.query(BUSINESS_FOUNDATION_MIGRATIONS[0].sql);
          await facade.query(
            'INSERT INTO business.business_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
            [BUSINESS_FOUNDATION_MIGRATIONS[0].migrationId, BUSINESS_FOUNDATION_MIGRATIONS[0].semanticVersion, BUSINESS_FOUNDATION_MIGRATIONS[0].manifestSha256, APPLIED_AT, 'prefix-fixture'],
          );
        } finally {
          await facade.query('RESET ROLE');
          await facade.query(`REVOKE CREATE ON DATABASE "${database.rows[0].database}" FROM vnext_pg17_business_owner`);
        }
        await facade.query('ALTER TABLE business.tenants ADD COLUMN forged text');
      });
      await assert.rejects(
        () => businessCatalog.apply(driftedPrefixHandle, APPLY_INPUT),
        error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
        'a partial ledger must reject a drifted v1 prefix before it can append another immutable ledger row',
      );
      await withVNextPg17SyntheticQuery(driftedPrefixHandle, 'fixture-provisioner', async facade => {
        const ledger = await facade.query('SELECT semantic_version FROM business.business_schema_migrations ORDER BY semantic_version');
        assert.deepStrictEqual(ledger.rows, [{ semantic_version: 1 }]);
        await facade.query('ALTER TABLE business.tenants DROP COLUMN forged');
      });
      await assert.rejects(
        () => businessCatalog.apply(driftedPrefixHandle, APPLY_INPUT),
        error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
        'a clean partial ledger is not an upgrade target: no business deployment exists yet, so foundation creation stays a single immutable transaction',
      );
      await withVNextPg17SyntheticQuery(driftedPrefixHandle, 'fixture-provisioner', async facade => {
        const ledger = await facade.query('SELECT semantic_version FROM business.business_schema_migrations ORDER BY semantic_version');
        assert.deepStrictEqual(ledger.rows, [{ semantic_version: 1 }]);
      });
      await assert.rejects(
        () => businessCatalog.assert(driftedPrefixHandle),
        error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
        'a partial ledger is never a complete business catalog',
      );
    } finally {
      await runtime.disposeHandle(driftedPrefixHandle);
    }
    await assert.rejects(() => businessCatalog.assertZeroSeed(handle), error => error && error.code === 'VNEXT_PG17_BUSINESS_INITIALIZATION_SEEDED');
    assert.deepStrictEqual(await businessCatalog.assert(handle), Object.freeze({ asserted: true }));
    const reapplyTrace = createVNextPg17BusinessFoundationDdlTrace(runtime, handle);
    armVNextPg17BusinessFoundationDdlTrace(reapplyTrace);
    assert.deepStrictEqual(await businessCatalog.apply(handle, APPLY_INPUT), Object.freeze({ applied: false }));
    assertReapplyTrace(inspectVNextPg17BusinessFoundationDdlTrace(reapplyTrace).queries);
    assert.deepStrictEqual(await businessCatalog.assert(handle), Object.freeze({ asserted: true }));
    await controlCatalog.assert(handle);
    const peerHandle = await runtime.createPeerHandle(handle);
    try {
      assert.deepStrictEqual(await businessCatalog.apply(peerHandle, APPLY_INPUT), Object.freeze({ applied: false }));
      assert.deepStrictEqual(await businessCatalog.assert(peerHandle), Object.freeze({ asserted: true }));
    } finally {
      await runtime.disposeHandle(peerHandle);
    }

    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
      'GRANT SELECT (contact_phone_legacy) ON business.institutions TO vnext_pg17_business_verifier',
    ));
    await assert.rejects(() => businessCatalog.assert(handle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const unlistedPiiPrivilegeHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(unlistedPiiPrivilegeHandle, APPLY_INPUT);
      await businessCatalog.apply(unlistedPiiPrivilegeHandle, APPLY_INPUT);
      await withVNextPg17SyntheticQuery(unlistedPiiPrivilegeHandle, 'fixture-provisioner', facade => facade.query(
        'GRANT SELECT (parent_wechat_legacy) ON business.students TO vnext_pg17_business_verifier',
      ));
      await assert.rejects(
        () => businessCatalog.assert(unlistedPiiPrivilegeHandle),
        error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
        'the verifier must not receive an unapproved student PII column merely because it is not named in the catalog assertion',
      );
    } finally {
      await runtime.disposeHandle(unlistedPiiPrivilegeHandle);
    }

    const functionDriftHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(functionDriftHandle, APPLY_INPUT);
      await businessCatalog.apply(functionDriftHandle, APPLY_INPUT);
      await withVNextPg17SyntheticQuery(functionDriftHandle, 'fixture-provisioner', facade => facade.query(
        'GRANT EXECUTE ON FUNCTION business.business_schema_migrations_insert_guard() TO PUBLIC',
      ));
      await assert.rejects(() => businessCatalog.assert(functionDriftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    } finally {
      await runtime.disposeHandle(functionDriftHandle);
    }

    const controlPrivilegeDriftHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(controlPrivilegeDriftHandle, APPLY_INPUT);
      await businessCatalog.apply(controlPrivilegeDriftHandle, APPLY_INPUT);
      await withVNextPg17SyntheticQuery(controlPrivilegeDriftHandle, 'fixture-provisioner', facade => facade.query(
        'GRANT SELECT (contact_phone_legacy) ON business.institutions TO vnext_pg17_runtime',
      ));
      await assert.rejects(() => businessCatalog.assert(controlPrivilegeDriftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    } finally {
      await runtime.disposeHandle(controlPrivilegeDriftHandle);
    }

    const columnDmlDriftHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(columnDmlDriftHandle, APPLY_INPUT);
      await businessCatalog.apply(columnDmlDriftHandle, APPLY_INPUT);
      await withVNextPg17SyntheticQuery(columnDmlDriftHandle, 'fixture-provisioner', facade => facade.query(
        'GRANT INSERT (id) ON business.tenants TO vnext_pg17_runtime',
      ));
      await assert.rejects(() => businessCatalog.assert(columnDmlDriftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    } finally {
      await runtime.disposeHandle(columnDmlDriftHandle);
    }

    const shadowFailureHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(shadowFailureHandle, APPLY_INPUT);
      await withVNextPg17SyntheticQuery(shadowFailureHandle, 'fixture-provisioner', facade => facade.query(
        'CREATE TABLE public.business_schema_migrations (id integer)',
      ));
      await assert.rejects(() => businessCatalog.apply(shadowFailureHandle, APPLY_INPUT), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
      await withVNextPg17SyntheticQuery(shadowFailureHandle, 'fixture-provisioner', async facade => {
        const relation = await facade.query("SELECT to_regclass('business.business_schema_migrations') AS relation");
        const ownerCreate = await facade.query("SELECT has_database_privilege('vnext_pg17_business_owner', current_database(), 'CREATE') AS can_create");
        assert.deepStrictEqual(relation.rows, [{ relation: null }]);
        assert.deepStrictEqual(ownerCreate.rows, [{ can_create: false }]);
      });
      await withVNextPg17SyntheticQuery(shadowFailureHandle, 'fixture-provisioner', facade => facade.query(
        'DROP TABLE public.business_schema_migrations',
      ));
      assert.deepStrictEqual(await businessCatalog.apply(shadowFailureHandle, APPLY_INPUT), Object.freeze({ applied: true }));
      assert.deepStrictEqual(await businessCatalog.assert(shadowFailureHandle), Object.freeze({ asserted: true }));
    } finally {
      await runtime.disposeHandle(shadowFailureHandle);
    }

    const commitUncertainHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(commitUncertainHandle, APPLY_INPUT);
      const faultPlan = createVNextPg17BusinessFoundationDdlFaultPlan(runtime, commitUncertainHandle, ['commit']);
      armVNextPg17BusinessFoundationDdlFaultPlan(commitUncertainHandle, faultPlan);
      await assert.rejects(() => businessCatalog.apply(commitUncertainHandle, APPLY_INPUT), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => businessCatalog.apply(commitUncertainHandle, APPLY_INPUT), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await withVNextPg17SyntheticQuery(commitUncertainHandle, 'fixture-provisioner', async facade => {
        const ownerCreate = await facade.query("SELECT has_database_privilege('vnext_pg17_business_owner', current_database(), 'CREATE') AS can_create");
        assert.deepStrictEqual(ownerCreate.rows, [{ can_create: false }]);
      });
    } finally {
      await runtime.disposeHandle(commitUncertainHandle);
    }

    const rollbackUncertainHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(rollbackUncertainHandle, APPLY_INPUT);
      await withVNextPg17SyntheticQuery(rollbackUncertainHandle, 'fixture-provisioner', facade => facade.query(
        'CREATE TABLE public.business_schema_migrations (id integer)',
      ));
      const faultPlan = createVNextPg17BusinessFoundationDdlFaultPlan(runtime, rollbackUncertainHandle, ['rollback']);
      armVNextPg17BusinessFoundationDdlFaultPlan(rollbackUncertainHandle, faultPlan);
      await assert.rejects(() => businessCatalog.apply(rollbackUncertainHandle, APPLY_INPUT), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => businessCatalog.apply(rollbackUncertainHandle, APPLY_INPUT), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await withVNextPg17SyntheticQuery(rollbackUncertainHandle, 'fixture-provisioner', async facade => {
        const relation = await facade.query("SELECT to_regclass('business.business_schema_migrations') AS relation");
        const ownerCreate = await facade.query("SELECT has_database_privilege('vnext_pg17_business_owner', current_database(), 'CREATE') AS can_create");
        assert.deepStrictEqual(relation.rows, [{ relation: null }]);
        assert.deepStrictEqual(ownerCreate.rows, [{ can_create: false }]);
      });
    } finally {
      await runtime.disposeHandle(rollbackUncertainHandle);
    }

    const singleFlightHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(singleFlightHandle, APPLY_INPUT);
      const firstApply = businessCatalog.apply(singleFlightHandle, APPLY_INPUT);
      await assert.rejects(() => businessCatalog.apply(singleFlightHandle, APPLY_INPUT), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
      assert.deepStrictEqual(await firstApply, Object.freeze({ applied: true }));
      assert.deepStrictEqual(await businessCatalog.apply(singleFlightHandle, APPLY_INPUT), Object.freeze({ applied: false }));
    } finally {
      await runtime.disposeHandle(singleFlightHandle);
    }

    const faultPlanHandle = await runtime.createIsolatedHandle();
    const faultPlanPeerHandle = await runtime.createIsolatedHandle();
    try {
      await controlCatalog.apply(faultPlanHandle, APPLY_INPUT);
      await controlCatalog.apply(faultPlanPeerHandle, APPLY_INPUT);
      const faultPlan = createVNextPg17BusinessFoundationDdlFaultPlan(runtime, faultPlanHandle, ['commit']);
      await assert.throws(
        () => armVNextPg17BusinessFoundationDdlFaultPlan(faultPlanPeerHandle, faultPlan),
        error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
      );
      assert.deepStrictEqual(await businessCatalog.apply(faultPlanPeerHandle, APPLY_INPUT), Object.freeze({ applied: true }));
      assert.deepStrictEqual(await businessCatalog.apply(faultPlanHandle, APPLY_INPUT), Object.freeze({ applied: true }));
    } finally {
      await runtime.disposeHandle(faultPlanPeerHandle);
      await runtime.disposeHandle(faultPlanHandle);
    }

    const closedHandle = await runtime.createIsolatedHandle();
    await runtime.disposeHandle(closedHandle);
    await assert.rejects(() => businessCatalog.apply(closedHandle, APPLY_INPUT), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');

    const foreignRuntime = createDisposablePg17Runtime();
    try {
      await foreignRuntime.start();
      const foreignHandle = await foreignRuntime.createIsolatedHandle();
      try {
        await assert.rejects(() => businessCatalog.apply(foreignHandle, APPLY_INPUT), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
      } finally {
        await foreignRuntime.disposeHandle(foreignHandle);
      }
    } finally {
      await foreignRuntime.stop();
    }
  } finally {
    await runtime.disposeHandle(handle);
  }
}

async function main() {
  const runtime = createDisposablePg17Runtime();
  const containerBaseline = await ownedContainerIds();
  try {
    await runtime.start();
    await runBusinessFoundationCatalogAssertionCases(runtime);
  } finally {
    await runtime.stop();
    assert.deepStrictEqual(await ownedContainerIds(), containerBaseline);
  }
  console.log('vNext business foundation catalog checks passed');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runBusinessFoundationCatalogAssertionCases };
