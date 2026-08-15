'use strict';

const assert = require('assert');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createVNextTrustRootVerifierBoundaryReference } = require('../vNextTrustRootVerifierBoundaryReference');
const { createVNextPg17FirstAuthorityBootstrapMutation } = require('./firstAuthorityBootstrapMutation');

const NOW = '2026-08-15T00:00:00.000Z';
const HASH = 'a'.repeat(64);

function manifest() {
  return {
    contractVersion: 1,
    capabilities: [
      { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
      { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
      { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
    ],
    roleDefaults: {
      super_admin: ['access.manage', 'device.revoke', 'user.review'],
      teacher: [],
      student: [],
    },
  };
}

async function createFixture(runtime, { afterWrite = null, commandOverrides = {}, now = NOW, writerNow = now } = {}) {
  const handle = await runtime.createIsolatedHandle();
  const catalog = createVNextPg17CatalogBoundary(runtime);
  await catalog.apply(handle, { appliedAt: NOW, appliedBy: 'bootstrap-test' });
  const command = {
    type: 'authority.bootstrap',
    bootstrapIntentId: 'bootstrap-intent-1',
    authorityId: 'authority-1',
    accountId: 'account-1',
    deviceId: 'device-1',
    installationId: 'installation-1',
    installationPublicKey: 'synthetic-public-key-1',
    installationKeyFingerprint: HASH,
    policyManifest: manifest(),
    idempotencyKey: 'bootstrap-key-1',
    reasonCode: 'initial-owner-bootstrap',
    ...commandOverrides,
  };
  const policy = require('../vNextAuthorizationPolicyReference');
  const crypto = require('node:crypto');
  const policyManifestSha256 = crypto.createHash('sha256').update(policy.canonicalizePolicyManifest(command.policyManifest), 'utf8').digest('hex');
  const verifier = createVNextTrustRootVerifierBoundaryReference({
    databaseBinding: handle,
    verifyBootstrapPresentation: () => ({
      kind: 'deployment_bootstrap',
      bootstrapIntentId: command.bootstrapIntentId,
      authorityId: command.authorityId,
      accountId: command.accountId,
      deviceId: command.deviceId,
      installationId: command.installationId,
      installationPublicKey: command.installationPublicKey,
      installationKeyFingerprint: command.installationKeyFingerprint,
      policyManifestSha256,
      expiresAt: '2026-08-15T00:04:00.000Z',
      approvalVersion: 1,
      assertionEvidenceSha256: 'b'.repeat(64),
    }),
    verifyRecoveryPresentation: () => { throw new Error('unused'); },
    now: () => now,
  });
  const assertion = await verifier.verifyBootstrap(null);
  let idCalls = 0;
  const writerConfig = { runtime, handle, verifierBoundary: verifier, now: () => writerNow, idFactory: kind => { idCalls += 1; return `${kind}-1`; } };
  if (afterWrite) writerConfig.testHooks = { afterWrite };
  const writer = createVNextPg17FirstAuthorityBootstrapMutation(writerConfig);
  return { handle, catalog, assertion, command, writer, idCalls: () => idCalls, verifier };
}

async function expectCode(action, code) {
  await assert.rejects(action, error => error && error.code === code);
}

async function targetCounts(handle) {
  return withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
    const rows = await facade.query("SELECT (SELECT COUNT(*)::text FROM vnext_control_plane.vnext_authorities) AS authorities, (SELECT COUNT(*)::text FROM vnext_control_plane.vnext_accounts) AS accounts, (SELECT COUNT(*)::text FROM vnext_control_plane.vnext_bootstrap_consumptions) AS markers, (SELECT COUNT(*)::text FROM vnext_control_plane.vnext_authorization_policy_publications) AS publications, (SELECT COUNT(*)::text FROM vnext_control_plane.vnext_trust_root_evidence) AS evidence, (SELECT COUNT(*)::text FROM vnext_control_plane.vnext_authorization_audit_events) AS audit, (SELECT COUNT(*)::text FROM vnext_control_plane.vnext_authorization_outbox_events) AS outbox");
    return rows.rows[0];
  });
}

async function runFirstAuthorityBootstrapMutationCases(runtime) {
  const fixture = await createFixture(runtime);
  try {
    assert.deepStrictEqual(await fixture.writer.execute(fixture.assertion, fixture.command), {
      authorityId: 'authority-1', code: 'AUTHORITY_BOOTSTRAPPED', replayed: false, status: 'accepted',
    });
    assert.deepStrictEqual(await targetCounts(fixture.handle), { authorities: '1', accounts: '1', markers: '1', publications: '1', evidence: '1', audit: '1', outbox: '1' });
    const idCalls = fixture.idCalls();
    assert.deepStrictEqual(await fixture.writer.execute(fixture.assertion, fixture.command), {
      authorityId: 'authority-1', code: 'AUTHORITY_BOOTSTRAPPED', replayed: true, status: 'accepted',
    });
    assert.strictEqual(fixture.idCalls(), idCalls);
    await expectCode(() => fixture.writer.execute({}, fixture.command), 'BOOTSTRAP_ASSERTION_MISMATCH');
    assert.deepStrictEqual(await targetCounts(fixture.handle), { authorities: '1', accounts: '1', markers: '1', publications: '1', evidence: '1', audit: '1', outbox: '1' });
  } finally {
    await runtime.disposeHandle(fixture.handle);
  }

  const conflict = await createFixture(runtime);
  try {
    await conflict.writer.execute(conflict.assertion, conflict.command);
    await expectCode(() => conflict.writer.execute(conflict.assertion, { ...conflict.command, reasonCode: 'different-reason' }), 'IDEMPOTENCY_KEY_CONFLICT');
    await expectCode(() => conflict.writer.execute(conflict.assertion, { ...conflict.command, idempotencyKey: 'another-key' }), 'BOOTSTRAP_ALREADY_CONSUMED');
  } finally {
    await runtime.disposeHandle(conflict.handle);
  }

  for (const failureStage of ['authority', 'account', 'device', 'installation', 'link', 'grant', 'receipt', 'marker', 'publication', 'evidence', 'audit', 'outbox']) {
    const rollback = await createFixture(runtime, { afterWrite: ({ stage }) => { if (stage === failureStage) throw new Error('inject rollback'); } });
    try {
      await expectCode(() => rollback.writer.execute(rollback.assertion, rollback.command), 'BOOTSTRAP_UNAVAILABLE');
      assert.deepStrictEqual(await targetCounts(rollback.handle), { authorities: '0', accounts: '0', markers: '0', publications: '0', evidence: '0', audit: '0', outbox: '0' });
    } finally {
      await runtime.disposeHandle(rollback.handle);
    }
  }

  const expired = await createFixture(runtime, { writerNow: '2026-08-15T00:04:00.000Z' });
  try {
    await expectCode(() => expired.writer.execute(expired.assertion, expired.command), 'BOOTSTRAP_ASSERTION_MISMATCH');
    assert.deepStrictEqual(await targetCounts(expired.handle), { authorities: '0', accounts: '0', markers: '0', publications: '0', evidence: '0', audit: '0', outbox: '0' });
  } finally {
    await runtime.disposeHandle(expired.handle);
  }
}

if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  runtime.start().then(() => runFirstAuthorityBootstrapMutationCases(runtime)).then(() => {
    process.stdout.write('vNext PG17 first authority bootstrap mutation checks passed\n');
  }).finally(() => runtime.stop()).catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}

module.exports = { runFirstAuthorityBootstrapMutationCases };
