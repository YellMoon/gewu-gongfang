'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const {
  createDisposablePg17Runtime,
  createVNextPg17BusinessFoundationAdmissionDdlTrace,
  armVNextPg17BusinessFoundationAdmissionDdlTrace,
  inspectVNextPg17BusinessFoundationAdmissionDdlTrace,
  createVNextPg17BusinessFoundationAdmissionDdlFaultPlan,
  armVNextPg17BusinessFoundationAdmissionDdlFaultPlan,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('./businessFoundationCatalogAssertion');
const { createBusinessFoundationAdmissionCatalogBoundary } = require('./businessFoundationAdmissionCatalog');
const { BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS } = require('./businessFoundationAdmissionManifest');

const APPLIED_AT = '2026-08-21T00:00:00.000Z';
const APPLIED_BY = 'business-foundation-admission-catalog-test';
const LOCAL_DOCKER_HOST = process.platform === 'win32'
  ? 'npipe:////./pipe/docker_engine'
  : 'unix:///var/run/docker.sock';
const DISPOSABLE_OWNER_LABEL = `com.gewu.vnext-pg17-disposable-owner=${process.pid}`;

function runDocker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['--host', LOCAL_DOCKER_HOST, ...args], { shell: false, windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error('docker command failed')));
  });
}

async function ownedContainerIds() {
  const output = await runDocker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `label=${DISPOSABLE_OWNER_LABEL}`]);
  return output.trim() === '' ? [] : output.trim().split(/\r?\n/).sort();
}

const ADMISSION_STATE_CHECK = "SELECT to_regnamespace('migration_admission') AS schema_name, to_regclass('migration_admission.migration_admission_schema_migrations') AS ledger, to_regclass('public.migration_admission_schema_migrations') AS public_shadow";
const ADMISSION_PUBLIC_SHADOW_CHECK = "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind <> 'i' AND c.relname = ANY($1::text[])";
const ADMISSION_LEDGER_CHECK = 'SELECT migration_id, semantic_version, manifest_sha256 FROM migration_admission.migration_admission_schema_migrations ORDER BY semantic_version';
const ADMISSION_LEDGER_INSERT = 'INSERT INTO migration_admission.migration_admission_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)';

function assertAdmissionDdlTrace(queries, { reapply }) {
  const prefix = ['BEGIN', "SET LOCAL TIME ZONE 'UTC'", 'SELECT pg_advisory_xact_lock(73018, 2)', 'SET LOCAL ROLE vnext_pg17_migration_admission_owner', ADMISSION_STATE_CHECK, ADMISSION_PUBLIC_SHADOW_CHECK];
  const expected = reapply
    ? [...prefix, ADMISSION_LEDGER_CHECK, 'COMMIT']
    : [...prefix];
  if (!reapply) {
    expected.push(...BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS.flatMap((migration, index) => index === 0
      ? [migration.sql, ADMISSION_LEDGER_INSERT]
      : [migration.sql, ADMISSION_LEDGER_INSERT]));
    expected.push('COMMIT');
  }
  assert.strictEqual(queries.length, reapply ? expected.length : expected.length + 2);
  assert.deepStrictEqual(queries.slice(0, prefix.length), prefix);
  if (reapply) assert.deepStrictEqual(queries, expected);
  else {
    assert.match(queries[6], /^GRANT CREATE ON DATABASE "vnextpg17_[a-z0-9]+" TO vnext_pg17_migration_admission_owner$/);
    assert.deepStrictEqual(queries.slice(7, 7 + BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS.length * 2), expected.slice(prefix.length, -1));
    assert.match(queries[7 + BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS.length * 2], /^REVOKE CREATE ON DATABASE "vnextpg17_[a-z0-9]+" FROM vnext_pg17_migration_admission_owner$/);
    assert.strictEqual(queries[8 + BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS.length * 2], 'COMMIT');
  }
  assert.ok(queries.every(query => BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS.some(migration => query === migration.sql) || !query.includes(';')));
  assert.ok(queries.every(query => !/vnext_control_plane|\bbusiness\.|\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+migration_admission\.(?:migration_batches|migration_batch_events|migration_quarantine|migration_row_ledger)/iu.test(query)));
}

async function controlLedgerHash(handle) {
  const result = await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
    "SELECT COALESCE(string_agg(migration_id || ':' || semantic_version::text || ':' || manifest_sha256, ',' ORDER BY semantic_version), '') AS value FROM vnext_control_plane.vnext_schema_migrations",
  ));
  return result.rows[0].value;
}

async function runBusinessFoundationAdmissionCatalogCases(runtime) {
  const controlCatalog = createVNextPg17CatalogBoundary(runtime);
  const businessCatalog = createBusinessFoundationCatalogBoundary(runtime);
  const admissionCatalog = createBusinessFoundationAdmissionCatalogBoundary(runtime);
  const handle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(handle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await businessCatalog.apply(handle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    const controlBefore = await controlLedgerHash(handle);
    const trace = createVNextPg17BusinessFoundationAdmissionDdlTrace(runtime, handle);
    armVNextPg17BusinessFoundationAdmissionDdlTrace(trace);
    assert.deepStrictEqual(await admissionCatalog.apply(handle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }), { applied: true });
    assertAdmissionDdlTrace(inspectVNextPg17BusinessFoundationAdmissionDdlTrace(trace).queries, { reapply: false });
    assert.deepStrictEqual(await admissionCatalog.assert(handle), { asserted: true });
    assert.deepStrictEqual(await admissionCatalog.assertZeroSeed(handle), { zeroSeed: true });
    const reapplyTrace = createVNextPg17BusinessFoundationAdmissionDdlTrace(runtime, handle);
    armVNextPg17BusinessFoundationAdmissionDdlTrace(reapplyTrace);
    assert.deepStrictEqual(await admissionCatalog.apply(handle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }), { applied: false });
    assertAdmissionDdlTrace(inspectVNextPg17BusinessFoundationAdmissionDdlTrace(reapplyTrace).queries, { reapply: true });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('SET session_replication_role = replica');
      try {
        await facade.query('DELETE FROM migration_admission.migration_admission_schema_migrations WHERE semantic_version = 2');
      } finally {
        await facade.query('SET session_replication_role = origin');
      }
    });
    await assert.rejects(
      () => admissionCatalog.apply(handle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
      'INSERT INTO migration_admission.migration_admission_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
      [BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[1].migrationId, BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[1].semanticVersion, BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS[1].manifestSha256, APPLIED_AT, APPLIED_BY],
    ));
    const peer = await runtime.createPeerHandle(handle);
    try {
      const faultPlan = createVNextPg17BusinessFoundationAdmissionDdlFaultPlan(runtime, handle, ['commit']);
      assert.throws(
        () => armVNextPg17BusinessFoundationAdmissionDdlFaultPlan(peer, faultPlan),
        error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
      );
      assert.deepStrictEqual(await admissionCatalog.apply(peer, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }), { applied: false });
    } finally {
      await runtime.disposeHandle(peer);
    }
    assert.strictEqual(await controlLedgerHash(handle), controlBefore);
    await controlCatalog.assert(handle);
    await businessCatalog.assert(handle);
  } finally {
    await runtime.disposeHandle(handle);
  }

  const shadowHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(shadowHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await businessCatalog.apply(shadowHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await withVNextPg17SyntheticQuery(shadowHandle, 'fixture-provisioner', facade => facade.query('CREATE TABLE public.migration_batches (id integer)'));
    await assert.rejects(
      () => admissionCatalog.apply(shadowHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
  } finally {
    await runtime.disposeHandle(shadowHandle);
  }

  const triggerDriftHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(triggerDriftHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await businessCatalog.apply(triggerDriftHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await admissionCatalog.apply(triggerDriftHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await withVNextPg17SyntheticQuery(triggerDriftHandle, 'fixture-provisioner', facade => facade.query('ALTER TABLE migration_admission.migration_row_ledger DISABLE TRIGGER migration_row_ledger_no_update'));
    await assert.rejects(() => admissionCatalog.assert(triggerDriftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
  } finally {
    await runtime.disposeHandle(triggerDriftHandle);
  }

  const privilegeDriftHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(privilegeDriftHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await businessCatalog.apply(privilegeDriftHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await admissionCatalog.apply(privilegeDriftHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await withVNextPg17SyntheticQuery(privilegeDriftHandle, 'fixture-provisioner', facade => facade.query('GRANT INSERT ON migration_admission.migration_batches TO vnext_pg17_writer'));
    await assert.rejects(() => admissionCatalog.assert(privilegeDriftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
  } finally {
    await runtime.disposeHandle(privilegeDriftHandle);
  }

  const functionDriftHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(functionDriftHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await businessCatalog.apply(functionDriftHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await admissionCatalog.apply(functionDriftHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await withVNextPg17SyntheticQuery(functionDriftHandle, 'fixture-provisioner', facade => facade.query('GRANT EXECUTE ON FUNCTION migration_admission.migration_row_ledger_insert_guard() TO PUBLIC'));
    await assert.rejects(() => admissionCatalog.assert(functionDriftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
  } finally {
    await runtime.disposeHandle(functionDriftHandle);
  }

  const crossSchemaPrivilegeHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(crossSchemaPrivilegeHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await businessCatalog.apply(crossSchemaPrivilegeHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await admissionCatalog.apply(crossSchemaPrivilegeHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await withVNextPg17SyntheticQuery(crossSchemaPrivilegeHandle, 'fixture-provisioner', facade => facade.query('GRANT INSERT ON business.tenants TO vnext_pg17_migration_admission_migrator'));
    await assert.rejects(() => admissionCatalog.assert(crossSchemaPrivilegeHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
  } finally {
    await runtime.disposeHandle(crossSchemaPrivilegeHandle);
  }

  const commitFaultHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(commitFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await businessCatalog.apply(commitFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    const faultPlan = createVNextPg17BusinessFoundationAdmissionDdlFaultPlan(runtime, commitFaultHandle, ['commit']);
    armVNextPg17BusinessFoundationAdmissionDdlFaultPlan(commitFaultHandle, faultPlan);
    await assert.rejects(
      () => admissionCatalog.apply(commitFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
    await assert.rejects(
      () => admissionCatalog.apply(commitFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
  } finally {
    await runtime.disposeHandle(commitFaultHandle);
  }

  const rollbackFaultHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(rollbackFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await businessCatalog.apply(rollbackFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await withVNextPg17SyntheticQuery(rollbackFaultHandle, 'fixture-provisioner', facade => facade.query('CREATE TABLE public.migration_quarantine (id integer)'));
    const faultPlan = createVNextPg17BusinessFoundationAdmissionDdlFaultPlan(runtime, rollbackFaultHandle, ['rollback']);
    armVNextPg17BusinessFoundationAdmissionDdlFaultPlan(rollbackFaultHandle, faultPlan);
    await assert.rejects(
      () => admissionCatalog.apply(rollbackFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
    await assert.rejects(
      () => admissionCatalog.apply(rollbackFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
  } finally {
    await runtime.disposeHandle(rollbackFaultHandle);
  }

  const revokeFaultHandle = await runtime.createIsolatedHandle();
  let revokeFaultPeer;
  try {
    await controlCatalog.apply(revokeFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await businessCatalog.apply(revokeFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    revokeFaultPeer = await runtime.createPeerHandle(revokeFaultHandle);
    const faultPlan = createVNextPg17BusinessFoundationAdmissionDdlFaultPlan(runtime, revokeFaultHandle, ['revoke']);
    armVNextPg17BusinessFoundationAdmissionDdlFaultPlan(revokeFaultHandle, faultPlan);
    await assert.rejects(
      () => admissionCatalog.apply(revokeFaultHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
    await assert.rejects(
      () => admissionCatalog.apply(revokeFaultPeer, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
    await assert.rejects(
      () => admissionCatalog.assert(revokeFaultPeer),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
    await assert.rejects(
      () => admissionCatalog.assertZeroSeed(revokeFaultPeer),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
  } finally {
    if (revokeFaultPeer) await runtime.disposeHandle(revokeFaultPeer);
    await runtime.disposeHandle(revokeFaultHandle);
  }

  const concurrentHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(concurrentHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    await businessCatalog.apply(concurrentHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY });
    const attempts = await Promise.allSettled([
      admissionCatalog.apply(concurrentHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }),
      admissionCatalog.apply(concurrentHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }),
    ]);
    assert.strictEqual(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
    assert.strictEqual(attempts.filter(attempt => attempt.status === 'rejected' && attempt.reason && attempt.reason.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE').length, 1);
    assert.deepStrictEqual(await admissionCatalog.apply(concurrentHandle, { appliedAt: APPLIED_AT, appliedBy: APPLIED_BY }), { applied: false });
  } finally {
    await runtime.disposeHandle(concurrentHandle);
  }
}

if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  (async () => {
    const baseline = await ownedContainerIds();
    let completed = false;
    try {
      await runtime.start();
      await runBusinessFoundationAdmissionCatalogCases(runtime);
      completed = true;
    } finally {
      try { await runtime.stop(); } finally { assert.deepStrictEqual(await ownedContainerIds(), baseline); }
    }
    if (completed) process.stdout.write('vNext business foundation admission catalog checks passed\n');
  })().catch(error => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runBusinessFoundationAdmissionCatalogCases };
