'use strict';

const assert = require('assert');
const crypto = require('node:crypto');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createVNextPg17FirstAuthorityBootstrapMutation } = require('./firstAuthorityBootstrapMutation');
const { createVNextPg17TrustedSessionVerifierBoundary } = require('./trustedSessionVerifierBoundary');
const { createVNextPg17AccessContextResolver } = require('./accessContextResolver');

const BOOTSTRAP_NOW = '2026-08-15T00:00:00.000Z';
const NOW = '2026-08-15T00:01:00.000Z';

function manifest() {
  return { contractVersion: 1, capabilities: [
    { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
  ], roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'user.review'], teacher: [], student: [] } };
}

async function fixture(runtime, { includeReauthentication = true } = {}) {
  const handle = await runtime.createIsolatedHandle();
  const catalog = createVNextPg17CatalogBoundary(runtime);
  await catalog.apply(handle, { appliedAt: BOOTSTRAP_NOW, appliedBy: 'access-context-test' });
  const policy = require('../vNextAuthorizationPolicyReference');
  const policyHash = crypto.createHash('sha256').update(policy.canonicalizePolicyManifest(manifest()), 'utf8').digest('hex');
  const bootstrapBoundary = require('../vNextTrustRootVerifierBoundaryReference').createVNextTrustRootVerifierBoundaryReference({
    databaseBinding: handle,
    verifyBootstrapPresentation: () => ({ kind: 'deployment_bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: 'a'.repeat(64), policyManifestSha256: policyHash, expiresAt: '2026-08-15T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: 'b'.repeat(64) }),
    verifyRecoveryPresentation: () => { throw new Error('unused'); }, now: () => BOOTSTRAP_NOW,
  });
  const bootstrapAssertion = await bootstrapBoundary.verifyBootstrap(null);
  const bootstrap = createVNextPg17FirstAuthorityBootstrapMutation({ runtime, handle, verifierBoundary: bootstrapBoundary, now: () => BOOTSTRAP_NOW, idFactory: kind => `bootstrap-${kind}` });
  await bootstrap.execute(bootstrapAssertion, { type: 'authority.bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: 'a'.repeat(64), policyManifest: manifest(), idempotencyKey: 'bootstrap-key-1', reasonCode: 'bootstrap' });
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    await facade.query("INSERT INTO vnext_control_plane.vnext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,revoked_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES('session-1','authority-1','account-1','device-1','installation-1','bootstrap-bootstrap-link','online','active',$1,$2,NULL,1,1,1,1,1,1,1,1,1,1,$1,$1)", [BOOTSTRAP_NOW, '2026-08-15T01:00:00.000Z']);
    if (includeReauthentication) {
      await facade.query("INSERT INTO vnext_control_plane.vnext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES('reauth-1','authority-1','session-1','passkey',repeat('c',64),1,1,1,1,1,1,1,1,1,$1,$2,$1)", [BOOTSTRAP_NOW, '2026-08-15T00:10:00.000Z']);
    }
  });
  const boundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: handle, verifyPresentation: () => ({ sessionId: 'session-1' }) });
  return { handle, boundary, assertion: await boundary.verify(null) };
}

async function expectUnavailable(action) {
  await assert.rejects(action, error => error?.code === 'VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE');
}

async function runAccessContextResolverCases(runtime) {
  const current = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: current.handle, verifierBoundary: current.boundary, surface: 'desktop', now: () => NOW });
    const context = await resolver.resolve(current.assertion);
    assert.strictEqual(context.authorityId, 'authority-1');
    assert.deepStrictEqual(context.roles, ['super_admin']);
    assert.deepStrictEqual(context.capabilityIds, ['access.manage', 'device.revoke', 'user.review']);
    assert.strictEqual(context.reauthenticatedUntil, '2026-08-15T00:10:00.000Z');
    assert.strictEqual(Object.isFrozen(context), true);
  } finally {
    await runtime.disposeHandle(current.handle);
  }

  const miniapp = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: miniapp.handle, verifierBoundary: miniapp.boundary, surface: 'miniapp', now: () => NOW });
    const context = await resolver.resolve(miniapp.assertion);
    assert.deepStrictEqual(context.capabilityIds, []);
  } finally {
    await runtime.disposeHandle(miniapp.handle);
  }

  const withoutReauth = await fixture(runtime, { includeReauthentication: false });
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: withoutReauth.handle, verifierBoundary: withoutReauth.boundary, surface: 'desktop', now: () => NOW });
    const context = await resolver.resolve(withoutReauth.assertion);
    assert.strictEqual(context.reauthenticatedUntil, null);
  } finally {
    await runtime.disposeHandle(withoutReauth.handle);
  }

  const expired = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: expired.handle, verifierBoundary: expired.boundary, surface: 'desktop', now: () => '2026-08-15T01:00:00.000Z' });
    await expectUnavailable(() => resolver.resolve(expired.assertion));
  } finally {
    await runtime.disposeHandle(expired.handle);
  }

  const stale = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: stale.handle, verifierBoundary: stale.boundary, surface: 'desktop', now: () => NOW });
    await expectUnavailable(() => resolver.resolve({}));
    await withVNextPg17SyntheticQuery(stale.handle, 'fixture-provisioner', facade => facade.query("UPDATE vnext_control_plane.vnext_accounts SET access_version=2, updated_at='2026-08-15T00:01:00.000Z' WHERE authority_id='authority-1' AND account_id='account-1'"));
    await expectUnavailable(() => resolver.resolve(stale.assertion));
  } finally {
    await runtime.disposeHandle(stale.handle);
  }
}

if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  runtime.start().then(() => runAccessContextResolverCases(runtime)).then(() => process.stdout.write('vNext PG17 AccessContext resolver checks passed\n')).finally(() => runtime.stop()).catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}

module.exports = { runAccessContextResolverCases };
