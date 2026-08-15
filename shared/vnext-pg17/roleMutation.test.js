'use strict';

const assert = require('assert');
const crypto = require('node:crypto');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createVNextPg17FirstAuthorityBootstrapMutation } = require('./firstAuthorityBootstrapMutation');
const { createVNextPg17TrustedSessionVerifierBoundary } = require('./trustedSessionVerifierBoundary');
const { createVNextPg17AccessContextResolver } = require('./accessContextResolver');
const { createVNextPg17RoleMutation } = require('./roleMutation');

const BOOTSTRAP_NOW = '2026-08-15T00:00:00.000Z';
const NOW = '2026-08-15T00:01:00.000Z';

function manifest() {
  return { contractVersion: 1, capabilities: [
    { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
  ], roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'user.review'], teacher: [], student: [] } };
}
function grantCommand(overrides = {}) {
  return Object.freeze({ type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'grant-1', reasonCode: 'reviewed', ...overrides });
}
function revokeCommand(grantId, overrides = {}) {
  return Object.freeze({ type: 'role.revoke', targetGrantId: grantId, expectedTargetRowVersion: 1, idempotencyKey: 'revoke-1', reasonCode: 'departure', ...overrides });
}
async function expectCode(action, code) { await assert.rejects(action, error => error && error.code === code); }

async function insertSession(facade, sessionId, accountId, deviceId, installationId, linkId, values) {
  await facade.query('INSERT INTO vnext_control_plane.vnext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,revoked_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,$13,1,1,1,1,1,1,1,$9,$9)', [sessionId, 'authority-1', accountId, deviceId, installationId, linkId, 'online', 'active', BOOTSTRAP_NOW, '2026-08-15T01:00:00.000Z', values.auth, values.access, values.revocation]);
}
async function fixture(runtime) {
  const handle = await runtime.createIsolatedHandle();
  const catalog = createVNextPg17CatalogBoundary(runtime);
  await catalog.apply(handle, { appliedAt: BOOTSTRAP_NOW, appliedBy: 'role-mutation-test' });
  const policy = require('../vNextAuthorizationPolicyReference');
  const canonical = policy.canonicalizePolicyManifest(manifest());
  const bootstrapBoundary = require('../vNextTrustRootVerifierBoundaryReference').createVNextTrustRootVerifierBoundaryReference({
    databaseBinding: handle,
    verifyBootstrapPresentation: () => ({ kind: 'deployment_bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: 'a'.repeat(64), policyManifestSha256: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex'), expiresAt: '2026-08-15T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: 'b'.repeat(64) }),
    verifyRecoveryPresentation: () => { throw new Error('unused'); }, now: () => BOOTSTRAP_NOW,
  });
  const bootstrap = createVNextPg17FirstAuthorityBootstrapMutation({ runtime, handle, verifierBoundary: bootstrapBoundary, now: () => BOOTSTRAP_NOW, idFactory: kind => `bootstrap-${kind}` });
  await bootstrap.execute(await bootstrapBoundary.verifyBootstrap(null), { type: 'authority.bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: 'a'.repeat(64), policyManifest: manifest(), idempotencyKey: 'bootstrap-key-1', reasonCode: 'bootstrap' });
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    await insertSession(facade, 'actor-session-1', 'account-1', 'device-1', 'installation-1', 'bootstrap-bootstrap-link', { auth: 1, access: 1, revocation: 1 });
    await facade.query("INSERT INTO vnext_control_plane.vnext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES('actor-reauth-1','authority-1','actor-session-1','passkey',repeat('c',64),1,1,1,1,1,1,1,1,1,$1,'2026-08-15T00:10:00.000Z',$1)", [BOOTSTRAP_NOW]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('target-1','authority-1','active',1,1,1,1,$1,$1)", [BOOTSTRAP_NOW]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at,revoked_at) VALUES('target-device-1','authority-1','active',1,1,1,$1,$1,NULL)", [BOOTSTRAP_NOW]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at,revoked_at) VALUES('target-installation-1','authority-1','target-device-1','target-key-1',repeat('d',64),'active',1,1,$1,$1,NULL)", [BOOTSTRAP_NOW]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at,revoked_at) VALUES('target-link-1','authority-1','target-1','target-device-1','target-installation-1','active',1,1,1,$1,$1,NULL)", [BOOTSTRAP_NOW]);
    await insertSession(facade, 'target-session-1', 'target-1', 'target-device-1', 'target-installation-1', 'target-link-1', { auth: 1, access: 1, revocation: 1 });
  });
  const actorBoundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: handle, verifyPresentation: () => ({ sessionId: 'actor-session-1' }) });
  const targetBoundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: handle, verifyPresentation: () => ({ sessionId: 'target-session-1' }) });
  const actorResolver = createVNextPg17AccessContextResolver({ runtime, handle, verifierBoundary: actorBoundary, surface: 'desktop', now: () => NOW });
  const targetResolver = createVNextPg17AccessContextResolver({ runtime, handle, verifierBoundary: targetBoundary, surface: 'desktop', now: () => NOW });
  return { handle, actorResolver, targetResolver, actorAssertion: await actorBoundary.verify(null), targetAssertion: await targetBoundary.verify(null) };
}
async function counts(handle) {
  return withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => (await facade.query("SELECT (SELECT count(*)::int FROM vnext_control_plane.vnext_role_grants) AS grants, (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_command_receipts) AS receipts, (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_audit_events) AS audits, (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_outbox_events) AS outbox, (SELECT auth_version::int FROM vnext_control_plane.vnext_accounts WHERE account_id='target-1') AS auth, (SELECT access_version::int FROM vnext_control_plane.vnext_accounts WHERE account_id='target-1') AS access, (SELECT revocation_version::int FROM vnext_control_plane.vnext_accounts WHERE account_id='target-1') AS revocation")).rows[0]);
}
async function runRoleMutationCases(runtime) {
  const current = await fixture(runtime);
  try {
    let ids = 0;
    const writer = createVNextPg17RoleMutation({ runtime, handle: current.handle, resolver: current.actorResolver, now: () => NOW, idFactory: kind => `${kind}-${++ids}` });
    assert.ok(await current.targetResolver.resolve(current.targetAssertion));
    const granted = await writer.execute(current.actorAssertion, grantCommand());
    assert.deepStrictEqual(granted, { code: 'ROLE_GRANTED', grantId: 'role-grant-1', replayed: false, status: 'accepted' });
    await expectCode(() => current.targetResolver.resolve(current.targetAssertion), 'VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE');
    const beforeReplay = ids;
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, grantCommand()), { ...granted, replayed: true });
    assert.strictEqual(ids, beforeReplay);
    await expectCode(() => writer.execute(current.actorAssertion, grantCommand({ reasonCode: 'changed' })), 'IDEMPOTENCY_KEY_CONFLICT');
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, grantCommand({ idempotencyKey: 'duplicate' })), { code: 'ROLE_GRANT_CONFLICT', replayed: false, status: 'rejected' });
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, revokeCommand(granted.grantId)), { code: 'ROLE_REVOKED', grantId: granted.grantId, replayed: false, status: 'accepted' });
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, revokeCommand(granted.grantId, { expectedTargetRowVersion: 2, idempotencyKey: 'noop' })), { code: 'ROLE_ALREADY_REVOKED', grantId: granted.grantId, replayed: false, status: 'noop' });
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, revokeCommand('bootstrap-bootstrap-grant', { idempotencyKey: 'last-admin' })), { code: 'LAST_SUPER_ADMIN_REVOKE_FORBIDDEN', replayed: false, status: 'rejected' });
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, grantCommand({ targetAccountId: 'missing', idempotencyKey: 'missing' })), { code: 'TARGET_ACCOUNT_NOT_ACTIVE', replayed: false, status: 'rejected' });
  } finally { await runtime.disposeHandle(current.handle); }
  for (const stage of ['target', 'account', 'receipt', 'audit', 'outbox']) {
    const rollback = await fixture(runtime);
    try {
      const before = await counts(rollback.handle);
      const writer = createVNextPg17RoleMutation({ runtime, handle: rollback.handle, resolver: rollback.actorResolver, now: () => NOW, idFactory: kind => `rollback-${stage}-${kind}`, testHooks: { afterWrite: ({ stage: actual }) => { if (actual === stage) throw new Error('stop'); } } });
      await expectCode(() => writer.execute(rollback.actorAssertion, grantCommand({ idempotencyKey: `rollback-${stage}` })), 'ROLE_MUTATION_UNAVAILABLE');
      assert.deepStrictEqual(await counts(rollback.handle), before);
    } finally { await runtime.disposeHandle(rollback.handle); }
  }
}
if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  runtime.start().then(() => runRoleMutationCases(runtime)).then(() => process.stdout.write('vNext PG17 role mutation checks passed\n')).finally(() => runtime.stop()).catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}
module.exports = { runRoleMutationCases };
