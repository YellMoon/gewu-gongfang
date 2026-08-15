'use strict';

const assert = require('assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createVNextPg17FirstAuthorityBootstrapMutation } = require('./firstAuthorityBootstrapMutation');
const { createVNextPg17TrustedSessionVerifierBoundary } = require('./trustedSessionVerifierBoundary');
const { createVNextPg17AccessContextResolver } = require('./accessContextResolver');
const { expectedCatalog } = require('./migrationManifest');

const BOOTSTRAP_NOW = '2026-08-15T00:00:00.000Z';
const NOW = '2026-08-15T00:01:00.000Z';

function manifest() {
  return { contractVersion: 1, capabilities: [
    { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
  ], roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'user.review'], teacher: [], student: [] } };
}

async function fixture(runtime, {
  includeReauthentication = true,
  sessionKind = 'online',
  sessionStatus = 'active',
  issuedAt = BOOTSTRAP_NOW,
  expiresAt = '2026-08-15T01:00:00.000Z',
  revokedAt = null,
  reauthenticationVerifiedAt = BOOTSTRAP_NOW,
  reauthenticationExpiresAt = '2026-08-15T00:10:00.000Z',
} = {}) {
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
    await facade.query("INSERT INTO vnext_control_plane.vnext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,revoked_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES('session-1','authority-1','account-1','device-1','installation-1','bootstrap-bootstrap-link',$1,$2,$3,$4,$5,1,1,1,1,1,1,1,1,1,1,$3,$3)", [sessionKind, sessionStatus, issuedAt, expiresAt, revokedAt]);
    if (includeReauthentication) {
      await facade.query("INSERT INTO vnext_control_plane.vnext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES('reauth-1','authority-1','session-1','passkey',repeat('c',64),1,1,1,1,1,1,1,1,1,$1,$2,$1)", [reauthenticationVerifiedAt, reauthenticationExpiresAt]);
    }
  });
  const boundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: handle, verifyPresentation: () => ({ sessionId: 'session-1' }) });
  return { handle, boundary, assertion: await boundary.verify(null) };
}

async function expectUnavailable(action) {
  await assert.rejects(action, error => error?.code === 'VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE');
}

async function targetRowsSnapshot(handle) {
  return withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const snapshot = {};
    for (const relation of expectedCatalog.relations) {
      const result = await facade.query(`SELECT row_to_json(item)::text AS row FROM ${relation} item ORDER BY row_to_json(item)::text`);
      snapshot[relation] = result.rows.map(item => item.row);
    }
    return snapshot;
  });
}

async function runAccessContextResolverCases(runtime) {
  assert.match(
    fs.readFileSync(path.join(__dirname, 'accessContextResolver.js'), 'utf8'),
    /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/,
  );
  const current = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: current.handle, verifierBoundary: current.boundary, surface: 'desktop', now: () => NOW });
    const before = await targetRowsSnapshot(current.handle);
    const context = await resolver.resolve(current.assertion);
    assert.strictEqual(context.authorityId, 'authority-1');
    assert.deepStrictEqual(context.roles, ['super_admin']);
    assert.deepStrictEqual(context.capabilityIds, ['access.manage', 'device.revoke', 'user.review']);
    assert.strictEqual(context.reauthenticatedUntil, '2026-08-15T00:10:00.000Z');
    assert.strictEqual(Object.isFrozen(context), true);
    assert.deepStrictEqual(await targetRowsSnapshot(current.handle), before);
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

  for (const options of [
    { reauthenticationExpiresAt: NOW },
    { reauthenticationVerifiedAt: '2026-08-15T00:02:00.000Z', reauthenticationExpiresAt: '2026-08-15T00:10:00.000Z' },
  ]) {
    const staleReauthentication = await fixture(runtime, options);
    try {
      const resolver = createVNextPg17AccessContextResolver({ runtime, handle: staleReauthentication.handle, verifierBoundary: staleReauthentication.boundary, surface: 'desktop', now: () => NOW });
      const context = await resolver.resolve(staleReauthentication.assertion);
      assert.strictEqual(context.reauthenticatedUntil, null);
    } finally {
      await runtime.disposeHandle(staleReauthentication.handle);
    }
  }

  const expired = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: expired.handle, verifierBoundary: expired.boundary, surface: 'desktop', now: () => '2026-08-15T01:00:00.000Z' });
    await expectUnavailable(() => resolver.resolve(expired.assertion));
  } finally {
    await runtime.disposeHandle(expired.handle);
  }

  for (const options of [
    { includeReauthentication: false, sessionKind: 'initialization' },
    { includeReauthentication: false, sessionStatus: 'expired' },
    { includeReauthentication: false, sessionStatus: 'revoked', revokedAt: '2026-08-15T00:01:00.000Z' },
    { includeReauthentication: false, issuedAt: '2026-08-15T00:02:00.000Z' },
  ]) {
    const invalidSession = await fixture(runtime, options);
    try {
      const resolver = createVNextPg17AccessContextResolver({ runtime, handle: invalidSession.handle, verifierBoundary: invalidSession.boundary, surface: 'desktop', now: () => NOW });
      await expectUnavailable(() => resolver.resolve(invalidSession.assertion));
    } finally {
      await runtime.disposeHandle(invalidSession.handle);
    }
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

  const parentsAndVectors = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: parentsAndVectors.handle, verifierBoundary: parentsAndVectors.boundary, surface: 'desktop', now: () => NOW });
    const cases = [
      ["UPDATE vnext_control_plane.vnext_authorities SET status='disabled' WHERE authority_id='authority-1'", "UPDATE vnext_control_plane.vnext_authorities SET status='active' WHERE authority_id='authority-1'"],
      ["UPDATE vnext_control_plane.vnext_accounts SET status='disabled' WHERE authority_id='authority-1' AND account_id='account-1'", "UPDATE vnext_control_plane.vnext_accounts SET status='active' WHERE authority_id='authority-1' AND account_id='account-1'"],
      ["UPDATE vnext_control_plane.vnext_trusted_devices SET status='risk_limited' WHERE authority_id='authority-1' AND device_id='device-1'", "UPDATE vnext_control_plane.vnext_trusted_devices SET status='active' WHERE authority_id='authority-1' AND device_id='device-1'"],
      ["UPDATE vnext_control_plane.vnext_device_installations SET status='retired' WHERE authority_id='authority-1' AND device_id='device-1' AND installation_id='installation-1'", "UPDATE vnext_control_plane.vnext_device_installations SET status='active' WHERE authority_id='authority-1' AND device_id='device-1' AND installation_id='installation-1'"],
      ["UPDATE vnext_control_plane.vnext_account_device_links SET status='expired' WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'", "UPDATE vnext_control_plane.vnext_account_device_links SET status='active' WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'"],
      ["UPDATE vnext_control_plane.vnext_accounts SET auth_version=2 WHERE authority_id='authority-1' AND account_id='account-1'", "UPDATE vnext_control_plane.vnext_accounts SET auth_version=1 WHERE authority_id='authority-1' AND account_id='account-1'"],
      ["UPDATE vnext_control_plane.vnext_accounts SET access_version=2 WHERE authority_id='authority-1' AND account_id='account-1'", "UPDATE vnext_control_plane.vnext_accounts SET access_version=1 WHERE authority_id='authority-1' AND account_id='account-1'"],
      ["UPDATE vnext_control_plane.vnext_accounts SET revocation_version=2 WHERE authority_id='authority-1' AND account_id='account-1'", "UPDATE vnext_control_plane.vnext_accounts SET revocation_version=1 WHERE authority_id='authority-1' AND account_id='account-1'"],
      ["UPDATE vnext_control_plane.vnext_trusted_devices SET credential_version=2 WHERE authority_id='authority-1' AND device_id='device-1'", "UPDATE vnext_control_plane.vnext_trusted_devices SET credential_version=1 WHERE authority_id='authority-1' AND device_id='device-1'"],
      ["UPDATE vnext_control_plane.vnext_trusted_devices SET risk_version=2 WHERE authority_id='authority-1' AND device_id='device-1'", "UPDATE vnext_control_plane.vnext_trusted_devices SET risk_version=1 WHERE authority_id='authority-1' AND device_id='device-1'"],
      ["UPDATE vnext_control_plane.vnext_device_installations SET credential_version=2 WHERE authority_id='authority-1' AND device_id='device-1' AND installation_id='installation-1'", "UPDATE vnext_control_plane.vnext_device_installations SET credential_version=1 WHERE authority_id='authority-1' AND device_id='device-1' AND installation_id='installation-1'"],
      ["UPDATE vnext_control_plane.vnext_account_device_links SET auth_version=2 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'", "UPDATE vnext_control_plane.vnext_account_device_links SET auth_version=1 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'"],
      ["UPDATE vnext_control_plane.vnext_account_device_links SET access_version=2 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'", "UPDATE vnext_control_plane.vnext_account_device_links SET access_version=1 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'"],
      ["UPDATE vnext_control_plane.vnext_account_device_links SET row_version=2 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'", "UPDATE vnext_control_plane.vnext_account_device_links SET row_version=1 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'"],
    ];
    for (const [change, restore] of cases) {
      await withVNextPg17SyntheticQuery(parentsAndVectors.handle, 'fixture-provisioner', facade => facade.query(change));
      await expectUnavailable(() => resolver.resolve(parentsAndVectors.assertion));
      await withVNextPg17SyntheticQuery(parentsAndVectors.handle, 'fixture-provisioner', facade => facade.query(restore));
    }
  } finally {
    await runtime.disposeHandle(parentsAndVectors.handle);
  }
}

if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  runtime.start().then(() => runAccessContextResolverCases(runtime)).then(() => process.stdout.write('vNext PG17 AccessContext resolver checks passed\n')).finally(() => runtime.stop()).catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}

module.exports = { runAccessContextResolverCases };
