'use strict';

const assert = require('assert');
const crypto = require('node:crypto');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createVNextPg17FirstAuthorityBootstrapMutation } = require('./firstAuthorityBootstrapMutation');
const { createVNextPg17TrustedSessionVerifierBoundary } = require('./trustedSessionVerifierBoundary');
const { createVNextPg17AccessContextResolver } = require('./accessContextResolver');
const { createVNextPg17PolicyPublicationMutation } = require('./policyPublicationMutation');

const BOOTSTRAP_NOW = '2026-08-15T00:00:00.000Z';
const NOW = '2026-08-15T00:01:00.000Z';

function initialManifest() {
  return { contractVersion: 1, capabilities: [
    { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
  ], roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'user.review'], teacher: [], student: [] } };
}

function nextManifest() {
  const manifest = initialManifest();
  manifest.capabilities[2].allowedSurfaces = ['desktop', 'miniapp'];
  return manifest;
}

function command(overrides = {}) {
  return Object.freeze({ type: 'authorization_policy.publish', expectedPolicyRevision: 1, idempotencyKey: 'policy-key-2', reasonCode: 'policy-update', manifest: nextManifest(), ...overrides });
}
async function expectCode(action, code) {
  await assert.rejects(action, error => error && error.code === code);
}
async function effectCounts(handle) {
  return withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const result = await facade.query("SELECT (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_policy_publications) AS publications, (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_command_receipts) AS receipts, (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_audit_events) AS audits, (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_outbox_events) AS outbox, (SELECT count(*)::int FROM vnext_control_plane.vnext_accounts) AS accounts, (SELECT count(*)::int FROM vnext_control_plane.vnext_sessions) AS sessions");
    return result.rows[0];
  });
}

async function fixture(runtime) {
  const handle = await runtime.createIsolatedHandle();
  const catalog = createVNextPg17CatalogBoundary(runtime);
  await catalog.apply(handle, { appliedAt: BOOTSTRAP_NOW, appliedBy: 'policy-mutation-test' });
  const policy = require('../vNextAuthorizationPolicyReference');
  const manifestHash = crypto.createHash('sha256').update(policy.canonicalizePolicyManifest(initialManifest()), 'utf8').digest('hex');
  const bootstrapBoundary = require('../vNextTrustRootVerifierBoundaryReference').createVNextTrustRootVerifierBoundaryReference({
    databaseBinding: handle,
    verifyBootstrapPresentation: () => ({ kind: 'deployment_bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: 'a'.repeat(64), policyManifestSha256: manifestHash, expiresAt: '2026-08-15T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: 'b'.repeat(64) }),
    verifyRecoveryPresentation: () => { throw new Error('unused'); }, now: () => BOOTSTRAP_NOW,
  });
  const bootstrap = createVNextPg17FirstAuthorityBootstrapMutation({ runtime, handle, verifierBoundary: bootstrapBoundary, now: () => BOOTSTRAP_NOW, idFactory: kind => `bootstrap-${kind}` });
  await bootstrap.execute(await bootstrapBoundary.verifyBootstrap(null), { type: 'authority.bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: 'a'.repeat(64), policyManifest: initialManifest(), idempotencyKey: 'bootstrap-key-1', reasonCode: 'bootstrap' });
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    await facade.query("INSERT INTO vnext_control_plane.vnext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,revoked_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES('session-1','authority-1','account-1','device-1','installation-1','bootstrap-bootstrap-link','online','active',$1,'2026-08-15T01:00:00.000Z',NULL,1,1,1,1,1,1,1,1,1,1,$1,$1)", [BOOTSTRAP_NOW]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES('reauth-1','authority-1','session-1','passkey',repeat('c',64),1,1,1,1,1,1,1,1,1,$1,'2026-08-15T00:10:00.000Z',$1)", [BOOTSTRAP_NOW]);
  });
  const boundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: handle, verifyPresentation: () => ({ sessionId: 'session-1' }) });
  const resolver = createVNextPg17AccessContextResolver({ runtime, handle, verifierBoundary: boundary, surface: 'desktop', now: () => NOW });
  return { handle, boundary, resolver, assertion: await boundary.verify(null) };
}

async function runPolicyPublicationMutationCases(runtime) {
  const current = await fixture(runtime);
  try {
    let idCalls = 0;
    const writer = createVNextPg17PolicyPublicationMutation({ runtime, handle: current.handle, resolver: current.resolver, now: () => NOW, idFactory: kind => `${kind}-${++idCalls}` });
    const accepted = await writer.execute(current.assertion, command());
    assert.deepStrictEqual(accepted, { code: 'POLICY_PUBLISHED', policyRevision: 2, replayed: false, status: 'accepted' });
    const publicationCount = await withVNextPg17SyntheticQuery(current.handle, 'fixture-provisioner', facade => facade.query("SELECT count(*)::int AS count FROM vnext_control_plane.vnext_authorization_policy_publications WHERE authority_id='authority-1'"));
    assert.strictEqual(publicationCount.rows[0].count, 2);
    const beforeReplayIds = idCalls;
    assert.deepStrictEqual(await writer.execute(current.assertion, command()), { ...accepted, replayed: true });
    assert.strictEqual(idCalls, beforeReplayIds);
    await expectCode(() => writer.execute(current.assertion, command({ reasonCode: 'changed-reason' })), 'IDEMPOTENCY_KEY_CONFLICT');
    assert.deepStrictEqual(await writer.execute(current.assertion, command({ expectedPolicyRevision: 0, idempotencyKey: 'policy-first' })), { code: 'FIRST_POLICY_BOOTSTRAP_REQUIRED', policyRevision: 2, replayed: false, status: 'rejected' });
    assert.deepStrictEqual(await writer.execute(current.assertion, command({ expectedPolicyRevision: 1, idempotencyKey: 'policy-stale', manifest: initialManifest() })), { code: 'POLICY_REVISION_CONFLICT', policyRevision: 2, replayed: false, status: 'rejected' });
    assert.deepStrictEqual(await writer.execute(current.assertion, command({ expectedPolicyRevision: 2, idempotencyKey: 'policy-noop' })), { code: 'POLICY_UNCHANGED', policyRevision: 2, replayed: false, status: 'noop' });
    assert.deepStrictEqual(await writer.execute(current.assertion, command({ expectedPolicyRevision: 2, idempotencyKey: 'policy-a-again', manifest: initialManifest() })), { code: 'POLICY_PUBLISHED', policyRevision: 3, replayed: false, status: 'accepted' });
  } finally {
    await runtime.disposeHandle(current.handle);
  }

  const unauthorized = await fixture(runtime);
  try {
    const writer = createVNextPg17PolicyPublicationMutation({ runtime, handle: unauthorized.handle, resolver: unauthorized.resolver, now: () => NOW, idFactory: kind => `unauthorized-${kind}` });
    await expectCode(() => writer.execute({}, command()), 'POLICY_PUBLICATION_UNAUTHORIZED');
    const miniappResolver = createVNextPg17AccessContextResolver({ runtime, handle: unauthorized.handle, verifierBoundary: unauthorized.boundary, surface: 'miniapp', now: () => NOW });
    const miniappWriter = createVNextPg17PolicyPublicationMutation({ runtime, handle: unauthorized.handle, resolver: miniappResolver, now: () => NOW, idFactory: kind => `miniapp-${kind}` });
    await expectCode(() => miniappWriter.execute(unauthorized.assertion, command({ idempotencyKey: 'miniapp-key' })), 'POLICY_PUBLICATION_UNAUTHORIZED');
  } finally {
    await runtime.disposeHandle(unauthorized.handle);
  }

  const selfLock = await fixture(runtime);
  try {
    const writer = createVNextPg17PolicyPublicationMutation({ runtime, handle: selfLock.handle, resolver: selfLock.resolver, now: () => NOW, idFactory: kind => `self-lock-${kind}` });
    const invalid = nextManifest();
    invalid.roleDefaults.super_admin = invalid.roleDefaults.super_admin.filter(item => item !== 'access.manage');
    await expectCode(() => writer.execute(selfLock.assertion, command({ manifest: invalid, idempotencyKey: 'policy-self-lock' })), 'POLICY_MANAGEMENT_CAPABILITY_REQUIRED');
  } finally {
    await runtime.disposeHandle(selfLock.handle);
  }

  for (const stage of ['receipt', 'publication', 'audit', 'outbox']) {
    const rollback = await fixture(runtime);
    try {
      const before = await effectCounts(rollback.handle);
      const writer = createVNextPg17PolicyPublicationMutation({
        runtime, handle: rollback.handle, resolver: rollback.resolver, now: () => NOW, idFactory: kind => `rollback-${stage}-${kind}`,
        testHooks: { afterWrite: ({ stage: actual }) => { if (actual === stage) throw new Error('stop'); } },
      });
      await expectCode(() => writer.execute(rollback.assertion, command({ idempotencyKey: `policy-rollback-${stage}` })), 'POLICY_PUBLICATION_UNAVAILABLE');
      assert.deepStrictEqual(await effectCounts(rollback.handle), before);
    } finally {
      await runtime.disposeHandle(rollback.handle);
    }
  }
}

if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  runtime.start().then(() => runPolicyPublicationMutationCases(runtime)).then(() => process.stdout.write('vNext PG17 policy publication mutation checks passed\n')).finally(() => runtime.stop()).catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}

module.exports = { runPolicyPublicationMutationCases };
