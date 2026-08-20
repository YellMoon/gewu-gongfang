'use strict';

const assert = require('assert');
const { createHash } = require('crypto');
const {
  createBusinessFoundationShadowAdmissionBoundary,
  validateBusinessFoundationShadowAdmissionFixture,
} = require('./businessFoundationShadowAdmission');
const {
  createDisposablePg17Runtime,
  createVNextPg17BusinessFoundationShadowAdmissionTrace,
  armVNextPg17BusinessFoundationShadowAdmissionTrace,
  inspectVNextPg17BusinessFoundationShadowAdmissionTrace,
  createVNextPg17BusinessFoundationShadowAdmissionFaultPlan,
  armVNextPg17BusinessFoundationShadowAdmissionFaultPlan,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('./businessFoundationCatalogAssertion');
const { createBusinessFoundationAdmissionCatalogBoundary } = require('./businessFoundationAdmissionCatalog');

assert.strictEqual(typeof createBusinessFoundationShadowAdmissionBoundary, 'function');

const BATCH_HASHES = Object.freeze({
  sourceSnapshotSha256: '1'.repeat(64),
  sourceInventoryBeforeSha256: '2'.repeat(64),
  // The admission contract requires a stable source inventory before and after the read.
  sourceInventoryAfterSha256: '2'.repeat(64),
  sourceCatalogSha256: '4'.repeat(64),
  sourceContractSha256: '5'.repeat(64),
  sourceSchemaSha256: '6'.repeat(64),
  businessManifestSha256: '7'.repeat(64),
  mapperSetSha256: '8'.repeat(64),
  consentSha256: '9'.repeat(64),
  shadowTargetIdentitySha256: 'a'.repeat(64),
});
const BATCH_FIELD_ORDER = [
  'batchId', 'sourceSnapshotSha256', 'sourceInventoryBeforeSha256', 'sourceInventoryAfterSha256',
  'sourceCatalogSha256', 'sourceContractSha256', 'sourceSchemaSha256', 'businessManifestSha256',
  'mapperSetSha256', 'consentSha256', 'shadowTargetIdentitySha256', 'createdAt', 'batchRequestSha256',
];

function sha256(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
function stableSha256(value) { return sha256(JSON.stringify(value)); }

const SHADOW_ADMISSION_TRACE = Object.freeze([
  'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
  "SET LOCAL TIME ZONE 'UTC'",
  "SELECT (SELECT COUNT(*)::text FROM business.tenants) AS tenants, (SELECT COUNT(*)::text FROM business.institutions) AS institutions, (SELECT COUNT(*)::text FROM business.schools) AS schools, (SELECT COUNT(*)::text FROM business.rooms) AS rooms, (SELECT COUNT(*)::text FROM migration_admission.migration_batches) AS batches, (SELECT COUNT(*)::text FROM migration_admission.migration_batch_events) AS events, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine) AS quarantine, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger",
  'COMMIT',
  'BEGIN',
  "SET LOCAL TIME ZONE 'UTC'",
  "SELECT (SELECT COUNT(*)::text FROM business.tenants) AS tenants, (SELECT COUNT(*)::text FROM business.institutions) AS institutions, (SELECT COUNT(*)::text FROM business.schools) AS schools, (SELECT COUNT(*)::text FROM business.rooms) AS rooms, (SELECT COUNT(*)::text FROM migration_admission.migration_batches) AS batches, (SELECT COUNT(*)::text FROM migration_admission.migration_batch_events) AS events, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine) AS quarantine, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger",
  'SET LOCAL ROLE vnext_pg17_migration_admission_owner',
  'INSERT INTO migration_admission.migration_batches (batch_id, source_snapshot_sha256, source_inventory_before_sha256, source_inventory_after_sha256, source_catalog_sha256, source_contract_sha256, source_schema_sha256, business_manifest_sha256, mapper_set_sha256, consent_sha256, shadow_target_identity_sha256, batch_request_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
  "INSERT INTO migration_admission.migration_batch_events (batch_id, event_sequence, status, event_code, event_sha256, created_at) VALUES ($1, 1, 'prepared', 'PREPARED', $2, $3)",
  "INSERT INTO migration_admission.migration_batch_events (batch_id, event_sequence, status, event_code, event_sha256, created_at) VALUES ($1, 2, 'running', 'RUNNING', $2, $3)",
  'SET LOCAL ROLE NONE',
  'SET LOCAL ROLE vnext_pg17_business_owner',
  'INSERT INTO business.tenants (id, name, legacy_status, legacy_plan, legacy_archive_before, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
  'INSERT INTO business.institutions (id, tenant_id, name, contact_person_legacy, contact_phone_legacy, revenue_share, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
  'INSERT INTO business.schools (id, tenant_id, name, legacy_count, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
  'INSERT INTO business.rooms (id, tenant_id, name, address_legacy, legacy_count, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
  'SET LOCAL ROLE NONE',
  'SET LOCAL ROLE vnext_pg17_migration_admission_owner',
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  'COMMIT',
]);

const SHADOW_RECONCILIATION_TRACE = Object.freeze([
  'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
  "SET LOCAL TIME ZONE 'UTC'",
  'SELECT batch_id FROM migration_admission.migration_batches WHERE batch_id = $1',
  'SELECT source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code FROM migration_admission.migration_row_ledger WHERE batch_id = $1 ORDER BY source_relation, source_primary_key_sha256',
  'SELECT id, name, legacy_status AS "legacyStatus", legacy_plan AS "legacyPlan", to_char(legacy_archive_before AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "legacyArchiveBefore", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.tenants ORDER BY id',
  'SELECT id, tenant_id AS "tenantId", name, contact_person_legacy AS "contactPersonLegacy", contact_phone_legacy AS "contactPhoneLegacy", revenue_share::float8 AS "revenueShare", notes, legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.institutions ORDER BY id',
  'SELECT id, tenant_id AS "tenantId", name, legacy_count AS "legacyCount", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.schools ORDER BY id',
  'SELECT id, tenant_id AS "tenantId", name, address_legacy AS "addressLegacy", legacy_count AS "legacyCount", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.rooms ORDER BY id',
  'COMMIT',
]);

function batch() {
  const value = {
    batchId: 'synthetic-foundation-batch-1',
    ...BATCH_HASHES,
    createdAt: '2026-08-21T00:00:00.000Z',
  };
  const canonical = {};
  for (const key of BATCH_FIELD_ORDER) if (key !== 'batchRequestSha256') canonical[key] = value[key];
  value.batchRequestSha256 = sha256(JSON.stringify(canonical));
  return value;
}

function fixture() {
  return {
    batch: batch(),
    tenants: [{ id: 'tenant-synthetic-1', name: 'Synthetic Tenant', legacyStatus: 'active', legacyPlan: null, legacyArchiveBefore: null, legacyDeleted: false, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }],
    institutions: [{ id: 'institution-synthetic-1', tenantId: 'tenant-synthetic-1', name: 'Synthetic Institution', contactPersonLegacy: null, contactPhoneLegacy: null, revenueShare: null, notes: null, legacyDeleted: false, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }],
    schools: [{ id: 'school-synthetic-1', tenantId: 'tenant-synthetic-1', name: 'Synthetic School', legacyCount: null, legacyDeleted: false, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }],
    rooms: [{ id: 'room-synthetic-1', tenantId: 'tenant-synthetic-1', name: 'Synthetic Room', addressLegacy: null, legacyCount: null, legacyDeleted: false, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }],
  };
}

const accepted = validateBusinessFoundationShadowAdmissionFixture(fixture());
assert.ok(Object.isFrozen(accepted));
assert.strictEqual(accepted.tenants[0].id, 'tenant-synthetic-1');
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture({ ...fixture(), unexpected: true }), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture({ ...fixture(), tenants: new Proxy([], {}) }), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const missingParent = fixture();
missingParent.rooms[0].tenantId = 'missing-tenant';
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(missingParent), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const extraTenantField = fixture();
extraTenantField.tenants[0].unapproved = 'no';
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(extraTenantField), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const timestampDrift = fixture();
timestampDrift.schools[0].updatedAt = '2026-08-19T00:00:00.000Z';
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(timestampDrift), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
class SyntheticArray extends Array {}
const subclassArray = fixture();
subclassArray.rooms = new SyntheticArray(...subclassArray.rooms);
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(subclassArray), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const overflowCount = fixture();
overflowCount.rooms[0].legacyCount = 2147483648;
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(overflowCount), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const underflowCount = fixture();
underflowCount.schools[0].legacyCount = -2147483649;
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(underflowCount), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const emptyFoundation = fixture();
emptyFoundation.tenants = [];
emptyFoundation.institutions = [];
emptyFoundation.schools = [];
emptyFoundation.rooms = [];
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(emptyFoundation), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');

const boundary = createBusinessFoundationShadowAdmissionBoundary(Object.freeze({}));
assert.strictEqual(typeof boundary.admit, 'function');
assert.rejects(() => boundary.admit(Object.freeze({}), fixture()), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');

async function runBusinessFoundationShadowAdmissionCases(runtime) {
  const controlCatalog = createVNextPg17CatalogBoundary(runtime);
  const businessCatalog = createBusinessFoundationCatalogBoundary(runtime);
  const admissionCatalog = createBusinessFoundationAdmissionCatalogBoundary(runtime);
  const boundary = createBusinessFoundationShadowAdmissionBoundary(runtime);
  let handle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(handle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await businessCatalog.apply(handle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await admissionCatalog.apply(handle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await assert.rejects(() => boundary.admit(handle, emptyFoundation), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
    assert.deepStrictEqual(
      (await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query("SELECT (SELECT COUNT(*)::text FROM business.tenants) AS tenants, (SELECT COUNT(*)::text FROM migration_admission.migration_batches) AS batches, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger"))).rows,
      [{ tenants: '0', batches: '0', ledger: '0' }],
    );
    const input = fixture();
    const trace = createVNextPg17BusinessFoundationShadowAdmissionTrace(runtime, handle);
    armVNextPg17BusinessFoundationShadowAdmissionTrace(trace);
    assert.deepStrictEqual(await boundary.admit(handle, input), { admitted: true, relationCounts: { tenants: 1, institutions: 1, schools: 1, rooms: 1 } });
    const traceQueries = inspectVNextPg17BusinessFoundationShadowAdmissionTrace(trace).queries;
    assert.deepStrictEqual(traceQueries, SHADOW_ADMISSION_TRACE);
    assert.ok(traceQueries.every(query => !query.includes(';') && !/vnext_control_plane|\b(?:CREATE|ALTER|DROP|GRANT|REVOKE|DELETE|UPDATE|TRUNCATE|CALL|COPY)\b/iu.test(query)));
    const target = await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query("SELECT (SELECT COUNT(*)::text FROM business.tenants) AS tenants, (SELECT COUNT(*)::text FROM business.institutions) AS institutions, (SELECT COUNT(*)::text FROM business.schools) AS schools, (SELECT COUNT(*)::text FROM business.rooms) AS rooms, (SELECT COUNT(*)::text FROM migration_admission.migration_batches) AS batches, (SELECT COUNT(*)::text FROM migration_admission.migration_batch_events) AS events, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine) AS quarantine, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger"));
    assert.deepStrictEqual(target.rows, [{ tenants: '1', institutions: '1', schools: '1', rooms: '1', batches: '1', events: '2', quarantine: '0', ledger: '4' }]);
    const persisted = await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query("SELECT b.batch_id, b.source_snapshot_sha256, b.source_inventory_before_sha256, b.source_inventory_after_sha256, b.source_catalog_sha256, b.source_contract_sha256, b.source_schema_sha256, b.business_manifest_sha256, b.mapper_set_sha256, b.consent_sha256, b.shadow_target_identity_sha256, b.batch_request_sha256, b.created_at::text, e.event_sequence::text, e.status, e.event_code, e.event_sha256, l.source_relation, l.source_primary_key_sha256, l.canonical_source_sha256, l.target_id, l.target_logical_sha256, l.outcome, l.outcome_code, l.created_at::text AS ledger_created_at FROM migration_admission.migration_batches b JOIN migration_admission.migration_batch_events e ON e.batch_id = b.batch_id LEFT JOIN migration_admission.migration_row_ledger l ON l.batch_id = b.batch_id ORDER BY e.event_sequence, l.source_relation"));
    const snapshot = validateBusinessFoundationShadowAdmissionFixture(input);
    assert.strictEqual(persisted.rows.filter(row => row.event_sequence === '1').length, 4);
    assert.strictEqual(persisted.rows.filter(row => row.event_sequence === '2').length, 4);
    for (const row of persisted.rows) {
      assert.strictEqual(row.batch_id, snapshot.batch.batchId);
      assert.strictEqual(row.source_snapshot_sha256, snapshot.batch.sourceSnapshotSha256);
      assert.strictEqual(row.source_inventory_before_sha256, snapshot.batch.sourceInventoryBeforeSha256);
      assert.strictEqual(row.source_inventory_after_sha256, snapshot.batch.sourceInventoryAfterSha256);
      assert.strictEqual(row.source_catalog_sha256, snapshot.batch.sourceCatalogSha256);
      assert.strictEqual(row.source_contract_sha256, snapshot.batch.sourceContractSha256);
      assert.strictEqual(row.source_schema_sha256, snapshot.batch.sourceSchemaSha256);
      assert.strictEqual(row.business_manifest_sha256, snapshot.batch.businessManifestSha256);
      assert.strictEqual(row.mapper_set_sha256, snapshot.batch.mapperSetSha256);
      assert.strictEqual(row.consent_sha256, snapshot.batch.consentSha256);
      assert.strictEqual(row.shadow_target_identity_sha256, snapshot.batch.shadowTargetIdentitySha256);
      assert.strictEqual(row.batch_request_sha256, snapshot.batch.batchRequestSha256);
      assert.strictEqual(new Date(row.created_at).toISOString(), snapshot.batch.createdAt);
      assert.strictEqual(new Date(row.ledger_created_at).toISOString(), snapshot.batch.createdAt);
      assert.deepStrictEqual([row.event_sequence, row.status, row.event_code], row.event_sequence === '1' ? ['1', 'prepared', 'PREPARED'] : ['2', 'running', 'RUNNING']);
      assert.strictEqual(row.event_sha256, stableSha256({ batchId: snapshot.batch.batchId, sequence: Number(row.event_sequence), status: row.status, code: row.event_code, createdAt: snapshot.batch.createdAt }));
      const sourceRow = snapshot[row.source_relation].find(candidate => candidate.id === row.target_id);
      assert.ok(sourceRow);
      assert.strictEqual(row.source_primary_key_sha256, stableSha256(`${row.source_relation}:${sourceRow.id}`));
      assert.strictEqual(row.canonical_source_sha256, stableSha256(sourceRow));
      assert.strictEqual(row.target_logical_sha256, stableSha256(sourceRow));
      assert.deepStrictEqual([row.outcome, row.outcome_code], ['admitted', 'ADMITTED']);
    }
    const replayTrace = createVNextPg17BusinessFoundationShadowAdmissionTrace(runtime, handle);
    armVNextPg17BusinessFoundationShadowAdmissionTrace(replayTrace);
    assert.deepStrictEqual(
      await boundary.admit(handle, input),
      { admitted: false, replayed: true, relationCounts: { tenants: 1, institutions: 1, schools: 1, rooms: 1 } },
    );
    const replayQueries = inspectVNextPg17BusinessFoundationShadowAdmissionTrace(replayTrace).queries;
    assert.ok(replayQueries.length > 0 && replayQueries.every(query => !/^INSERT INTO (?:business|migration_admission)\./u.test(query)));
    const changedCanonical = fixture();
    changedCanonical.tenants[0].name = 'Changed canonical tenant';
    await assert.rejects(
      () => boundary.admit(handle, changedCanonical),
      error => error && error.code === 'VNEXT_PG17_ADMISSION_CANONICAL_HASH_CONFLICT',
    );
    const reconciliationTrace = createVNextPg17BusinessFoundationShadowAdmissionTrace(runtime, handle);
    armVNextPg17BusinessFoundationShadowAdmissionTrace(reconciliationTrace);
    assert.deepStrictEqual(
      await boundary.reconcile(handle, { batchId: input.batch.batchId }),
      { reconciled: true, relationCounts: { tenants: 1, institutions: 1, schools: 1, rooms: 1 } },
    );
    assert.deepStrictEqual(inspectVNextPg17BusinessFoundationShadowAdmissionTrace(reconciliationTrace).queries, SHADOW_RECONCILIATION_TRACE);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query("UPDATE business.tenants SET name = 'tampered' WHERE id = 'tenant-synthetic-1'"));
    await assert.rejects(
      () => boundary.admit(handle, input),
      error => error && error.code === 'VNEXT_PG17_ADMISSION_RECONCILIATION_MISMATCH',
    );
    const mismatchTrace = createVNextPg17BusinessFoundationShadowAdmissionTrace(runtime, handle);
    armVNextPg17BusinessFoundationShadowAdmissionTrace(mismatchTrace);
    await assert.rejects(
      () => boundary.reconcile(handle, { batchId: input.batch.batchId }),
      error => error && error.code === 'VNEXT_PG17_ADMISSION_RECONCILIATION_MISMATCH',
    );
    assert.deepStrictEqual(inspectVNextPg17BusinessFoundationShadowAdmissionTrace(mismatchTrace).queries, [
      ...SHADOW_RECONCILIATION_TRACE.slice(0, 5),
      'ROLLBACK',
    ]);
    assert.deepStrictEqual(
      (await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query("SELECT COUNT(*)::text AS count FROM business.tenants"))).rows,
      [{ count: '1' }],
    );
    assert.deepStrictEqual(await boundary.rollbackSyntheticTarget(handle), { destroyed: true });
    await assert.rejects(() => boundary.admit(handle, fixture()), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
    handle = null;
  } finally {
    if (handle) await runtime.disposeHandle(handle);
  }

  for (const stages of [['writeCommit'], ['writeFail', 'rollback']]) {
    const faultHandle = await runtime.createIsolatedHandle();
    let peer;
    try {
      await controlCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      await businessCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      await admissionCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      peer = await runtime.createPeerHandle(faultHandle);
      const faultPlan = createVNextPg17BusinessFoundationShadowAdmissionFaultPlan(runtime, faultHandle, stages);
      armVNextPg17BusinessFoundationShadowAdmissionFaultPlan(faultHandle, faultPlan);
      await assert.rejects(
        () => boundary.admit(faultHandle, fixture()),
        error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
      );
      await assert.rejects(() => boundary.admit(peer, fixture()), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => controlCatalog.apply(peer, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' }), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => businessCatalog.apply(peer, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' }), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => admissionCatalog.apply(peer, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' }), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => businessCatalog.assert(peer), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => businessCatalog.assertZeroSeed(peer), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => admissionCatalog.assert(peer), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => admissionCatalog.assertZeroSeed(peer), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(
        () => withVNextPg17SyntheticQuery(peer, 'business-verifier', facade => facade.query('SELECT 1')),
        error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
      );
    } finally {
      if (peer) await runtime.disposeHandle(peer);
      await runtime.disposeHandle(faultHandle);
    }
  }

  for (const scenario of ['reconcileCommit', 'reconcileRollback']) {
    const faultHandle = await runtime.createIsolatedHandle();
    let peer;
    try {
      await controlCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      await businessCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      await admissionCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      const input = fixture();
      await boundary.admit(faultHandle, input);
      if (scenario === 'reconcileRollback') {
        await withVNextPg17SyntheticQuery(faultHandle, 'fixture-provisioner', facade => facade.query("UPDATE business.tenants SET name = 'tampered' WHERE id = 'tenant-synthetic-1'"));
      }
      peer = await runtime.createPeerHandle(faultHandle);
      const faultPlan = createVNextPg17BusinessFoundationShadowAdmissionFaultPlan(runtime, faultHandle, [scenario]);
      armVNextPg17BusinessFoundationShadowAdmissionFaultPlan(faultHandle, faultPlan);
      await assert.rejects(
        () => boundary.reconcile(faultHandle, { batchId: input.batch.batchId }),
        error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
      );
      await assert.rejects(
        () => boundary.reconcile(peer, { batchId: input.batch.batchId }),
        error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
      );
      await assert.rejects(
        () => withVNextPg17SyntheticQuery(peer, 'business-verifier', facade => facade.query('SELECT 1')),
        error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
      );
    } finally {
      if (peer) await runtime.disposeHandle(peer);
      await runtime.disposeHandle(faultHandle);
    }
  }

  const rollbackHandle = await runtime.createIsolatedHandle();
  let rollbackPeer;
  try {
    await controlCatalog.apply(rollbackHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await businessCatalog.apply(rollbackHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await admissionCatalog.apply(rollbackHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await assert.rejects(() => boundary.rollbackSyntheticTarget(rollbackHandle), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
    await boundary.admit(rollbackHandle, fixture());
    rollbackPeer = await runtime.createPeerHandle(rollbackHandle);
    await assert.rejects(() => boundary.rollbackSyntheticTarget(rollbackPeer), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
    await assert.rejects(() => boundary.rollbackSyntheticTarget(rollbackHandle), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
    assert.deepStrictEqual(
      (await withVNextPg17SyntheticQuery(rollbackHandle, 'fixture-provisioner', facade => facade.query('SELECT COUNT(*)::text AS count FROM business.tenants'))).rows,
      [{ count: '1' }],
    );
    await runtime.disposeHandle(rollbackPeer);
    rollbackPeer = null;
    assert.deepStrictEqual(await boundary.rollbackSyntheticTarget(rollbackHandle), { destroyed: true });
  } finally {
    if (rollbackPeer) await runtime.disposeHandle(rollbackPeer);
    try { await runtime.disposeHandle(rollbackHandle); } catch (error) {
      if (!error || error.code !== 'VNEXT_PG17_HANDLE_INVALID') throw error;
    }
  }
}

if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  runtime.start()
    .then(() => runBusinessFoundationShadowAdmissionCases(runtime))
    .then(() => runtime.stop())
    .then(() => process.stdout.write('vNext business foundation shadow-admission checks passed\n'))
    .catch(async error => {
      try { await runtime.stop(); } catch (_) { /* retain failure */ }
      process.stderr.write(`${error.name}: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { runBusinessFoundationShadowAdmissionCases };
