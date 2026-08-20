'use strict';

const assert = require('assert');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery, inspectVNextPg17CopyOnlyRehearsalTarget } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const {
  createVNextPg17SyntheticControlPlaneSource,
  rehearseVNextPg17ControlPlaneCopy,
} = require('./controlPlaneCopyOnlyRehearsal');

const TARGET_DATA_TABLES = Object.freeze([
  'vnext_authorities', 'vnext_accounts', 'vnext_trusted_devices', 'vnext_device_installations', 'vnext_account_device_links',
  'vnext_role_grants', 'vnext_capability_catalog', 'vnext_capability_overrides', 'vnext_data_scope_grants', 'vnext_profile_bindings',
  'vnext_verified_contacts', 'vnext_authorization_command_receipts', 'vnext_authorization_audit_events', 'vnext_authorization_outbox_events',
  'vnext_bootstrap_consumptions', 'vnext_authorization_policy_publications', 'vnext_trust_root_evidence', 'vnext_sessions', 'vnext_recent_reauthentication_events',
]);

function snapshot() {
  return {
    authorities: [{ authority_id: 'authority-1', status: 'active', created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' }],
    accounts: [{ account_id: 'account-1', authority_id: 'authority-1', status: 'active', auth_version: 1, access_version: 1, revocation_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' }],
    trustedDevices: [{ device_id: 'device-1', authority_id: 'authority-1', status: 'active', hardware_evidence_hash: null, risk_code: null, credential_version: 1, risk_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z', revoked_at: null }],
    installations: [{ installation_id: 'installation-1', authority_id: 'authority-1', device_id: 'device-1', installation_public_key: 'test-key', key_fingerprint: 'a'.repeat(64), status: 'active', credential_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z', revoked_at: null }],
    links: [{ link_id: 'link-1', authority_id: 'authority-1', account_id: 'account-1', device_id: 'device-1', installation_id: 'installation-1', status: 'active', auth_version: 1, access_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z', revoked_at: null }], roleGrants: [], capabilityCatalog: [],
    capabilityOverrides: [], dataScopeGrants: [], profileBindings: [], verifiedContacts: [],
    receipts: [], auditEvents: [], outboxEvents: [],
    legacySessions: [], legacyDeviceGrants: [], legacyOfflineLicenses: [], legacyCredentials: [],
    legacyTokens: [], legacyPasswords: [], legacyPrivateKeys: [], legacyBackups: [],
  };
}

async function runControlPlaneCopyOnlyRehearsalCases(runtime = createDisposablePg17Runtime()) {
  const ownsRuntime = arguments.length === 0;
  if (ownsRuntime) await runtime.start();
  try {
    for (const collection of ['roleGrants', 'capabilityOverrides', 'dataScopeGrants']) {
      const unsafe = snapshot();
      unsafe[collection].push({ status: 'active' });
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(unsafe),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    const authorityExtra = snapshot();
    authorityExtra.authorities[0].unexpected = 'must-not-be-dropped';
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(authorityExtra),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const crossAuthorityAccount = snapshot();
    crossAuthorityAccount.accounts[0].authority_id = 'authority-2';
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(crossAuthorityAccount),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    for (const collection of ['roleGrants', 'capabilityCatalog', 'capabilityOverrides', 'dataScopeGrants', 'profileBindings', 'verifiedContacts', 'receipts', 'auditEvents', 'outboxEvents']) {
      const unsupported = snapshot();
      unsupported[collection].push({ opaque: collection });
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(unsupported),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    const handle = await runtime.createIsolatedHandle();
    try {
      await createVNextPg17CatalogBoundary(runtime).apply(handle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-test' });
      const mutable = snapshot();
      mutable.legacySessions.push({ legacy_id: 'legacy-session-1' });
      const source = createVNextPg17SyntheticControlPlaneSource(mutable);
      mutable.authorities[0].authority_id = 'mutated-authority';
      const target = runtime.createVNextPg17CopyOnlyRehearsalTarget(handle);
      const result = await rehearseVNextPg17ControlPlaneCopy({ source, target });
      assert.strictEqual(result.status, 'boundary-verified');
      assert.deepStrictEqual(result.rollback, { attempted: false, restoredEmpty: false });
      assert.strictEqual(result.authorityCount, 1);
      assert.strictEqual(result.accountCount, 1);
      assert.strictEqual(result.deviceCount, 1);
      assert.strictEqual(result.installationCount, 1);
      assert.strictEqual(result.linkCount, 1);
      assert.strictEqual(result.activeRoleGrantCount, 0);
      assert.strictEqual(result.activeCapabilityOverrideCount, 0);
      assert.strictEqual(result.activeScopeGrantCount, 0);
      assert.strictEqual(result.activeSessionCount, 0);
      assert.strictEqual(result.activeReauthenticationCount, 0);
      assert.match(result.sourceFingerprintBefore, /^[0-9a-f]{64}$/);
      assert.strictEqual(result.sourceFingerprintAfter, result.sourceFingerprintBefore);
      assert.strictEqual(result.sourceIdentityLogicalSha256, result.targetIdentityLogicalSha256);
      assert.deepStrictEqual(result.inertInventory.legacySessions, {
        count: 1,
        sha256: require('crypto').createHash('sha256').update(JSON.stringify([{ legacy_id: 'legacy-session-1' }]), 'utf8').digest('hex'),
      });
      const trace = inspectVNextPg17CopyOnlyRehearsalTarget(target);
      assert.strictEqual(trace.queries[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ');
      assert.strictEqual(trace.queries.at(-1), 'COMMIT');
      assert.ok(trace.queries.every(text => /^(BEGIN ISOLATION LEVEL REPEATABLE READ|COMMIT|ROLLBACK|SELECT |INSERT INTO vnext_control_plane\.)/.test(text)));
      await assert.rejects(
        () => rehearseVNextPg17ControlPlaneCopy({ source, target }),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_TARGET_NOT_EMPTY',
      );
      const ordered = snapshot();
      ordered.legacySessions.push({ legacy_id: 'legacy-a' }, { legacy_id: 'legacy-b' });
      const permuted = snapshot();
      permuted.legacySessions.push({ legacy_id: 'legacy-b' }, { legacy_id: 'legacy-a' });
      const orderedHandle = await runtime.createIsolatedHandle();
      const permutedHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(orderedHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-canonical-test' });
        await createVNextPg17CatalogBoundary(runtime).apply(permutedHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-canonical-test' });
        const orderedResult = await rehearseVNextPg17ControlPlaneCopy({ source: createVNextPg17SyntheticControlPlaneSource(ordered), target: runtime.createVNextPg17CopyOnlyRehearsalTarget(orderedHandle) });
        const permutedResult = await rehearseVNextPg17ControlPlaneCopy({ source: createVNextPg17SyntheticControlPlaneSource(permuted), target: runtime.createVNextPg17CopyOnlyRehearsalTarget(permutedHandle) });
        assert.strictEqual(orderedResult.sourceFingerprintBefore, permutedResult.sourceFingerprintBefore);
        assert.deepStrictEqual(orderedResult.inertInventory, permutedResult.inertInventory);
      } finally {
        await runtime.disposeHandle(orderedHandle);
        await runtime.disposeHandle(permutedHandle);
      }
      const nonEmptyHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(nonEmptyHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-nonempty-test' });
        await withVNextPg17SyntheticQuery(nonEmptyHandle, 'fixture-provisioner', facade =>
          facade.query("INSERT INTO vnext_control_plane.vnext_capability_catalog(capability_id,status,surface_mask,created_at) VALUES('legacy-capability','retired','desktop','2026-08-20T00:00:00.000Z')"));
        await assert.rejects(
          () => rehearseVNextPg17ControlPlaneCopy({ source, target: runtime.createVNextPg17CopyOnlyRehearsalTarget(nonEmptyHandle) }),
          error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_TARGET_NOT_EMPTY',
        );
      } finally { await runtime.disposeHandle(nonEmptyHandle); }
      const driftHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(driftHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-drift-test' });
        await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', facade =>
          facade.query('ALTER TABLE vnext_control_plane.vnext_authorities ALTER COLUMN status SET DEFAULT \'active\''));
        await assert.rejects(
          () => rehearseVNextPg17ControlPlaneCopy({ source, target: runtime.createVNextPg17CopyOnlyRehearsalTarget(driftHandle) }),
          error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
        );
      } finally { await runtime.disposeHandle(driftHandle); }
      for (const stages of [['commit'], ['accounts', 'rollback']]) {
        const uncertainHandle = await runtime.createIsolatedHandle();
        try {
          await createVNextPg17CatalogBoundary(runtime).apply(uncertainHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-uncertain-test' });
          const uncertainTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(uncertainHandle);
          const faultPlan = runtime.createVNextPg17CopyOnlyRehearsalFaultPlan(uncertainHandle, stages);
          await assert.rejects(
            () => rehearseVNextPg17ControlPlaneCopy({ source, target: uncertainTarget, faultPlan }),
            error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_TARGET_UNAVAILABLE',
          );
          assert.strictEqual(inspectVNextPg17CopyOnlyRehearsalTarget(uncertainTarget).poisoned, true);
          await assert.rejects(
            () => rehearseVNextPg17ControlPlaneCopy({ source, target: uncertainTarget }),
            error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
          );
        } finally { await runtime.disposeHandle(uncertainHandle); }
      }
      const mismatchHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(mismatchHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-mismatch-test' });
        const mismatchTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(mismatchHandle);
        const faultPlan = runtime.createVNextPg17CopyOnlyRehearsalFaultPlan(mismatchHandle, 'postReadMismatch');
        await assert.rejects(
          () => rehearseVNextPg17ControlPlaneCopy({ source, target: mismatchTarget, faultPlan }),
          error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH',
        );
        await withVNextPg17SyntheticQuery(mismatchHandle, 'fixture-provisioner', async facade => {
          for (const table of TARGET_DATA_TABLES) {
            assert.strictEqual(Number((await facade.query(`SELECT COUNT(*)::int AS count FROM vnext_control_plane.${table}`)).rows[0].count), 0);
          }
        });
      } finally { await runtime.disposeHandle(mismatchHandle); }
      for (const stage of ['authorities', 'accounts', 'trustedDevices', 'installations', 'links']) {
        const rollbackHandle = await runtime.createIsolatedHandle();
        try {
          await createVNextPg17CatalogBoundary(runtime).apply(rollbackHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-rollback-test' });
          const rollbackTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(rollbackHandle);
          const faultPlan = runtime.createVNextPg17CopyOnlyRehearsalFaultPlan(rollbackHandle, stage);
          await assert.rejects(
            () => rehearseVNextPg17ControlPlaneCopy({ source, target: rollbackTarget, faultPlan }),
            error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_ROLLED_BACK',
          );
          await withVNextPg17SyntheticQuery(rollbackHandle, 'fixture-provisioner', async facade => {
            for (const table of TARGET_DATA_TABLES) {
              assert.strictEqual(Number((await facade.query(`SELECT COUNT(*)::int AS count FROM vnext_control_plane.${table}`)).rows[0].count), 0);
            }
          });
        } finally { await runtime.disposeHandle(rollbackHandle); }
      }
    } finally {
      await runtime.disposeHandle(handle);
    }
  } finally {
    if (ownsRuntime) await runtime.stop();
  }
}

if (require.main === module) {
  runControlPlaneCopyOnlyRehearsalCases().then(() => {
    process.stdout.write('vNext PG17 control-plane copy-only rehearsal checks passed\n');
  });
}

module.exports = { runControlPlaneCopyOnlyRehearsalCases };
