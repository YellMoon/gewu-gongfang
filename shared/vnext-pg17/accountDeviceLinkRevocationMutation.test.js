'use strict';

const assert = require('assert');
const crypto = require('node:crypto');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createVNextPg17FirstAuthorityBootstrapMutation } = require('./firstAuthorityBootstrapMutation');
const { createVNextPg17TrustedSessionVerifierBoundary } = require('./trustedSessionVerifierBoundary');
const { createVNextPg17AccessContextResolver } = require('./accessContextResolver');
const { createVNextPg17AccountDeviceLinkRevocationMutation } = require('./accountDeviceLinkRevocationMutation');

const BOOTSTRAP_NOW = '2026-08-15T00:00:00.000Z';
const NOW = '2026-08-15T00:01:00.000Z';

function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }

function manifest() {
  return { contractVersion: 1, capabilities: [
    { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
  ], roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'user.review'], teacher: [], student: [] } };
}
function command(overrides = {}) {
  return Object.freeze({ type: 'account_device_link.revoke', targetLinkId: 'target-link-1', expectedTargetRowVersion: 1, idempotencyKey: 'revoke-link-1', reasonCode: 'device_lost', ...overrides });
}
async function expectCode(action, code) { await assert.rejects(action, error => error && error.code === code); }
async function state(handle) {
  return withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => (await facade.query("SELECT (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_command_receipts) AS receipts, (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_audit_events) AS audits, (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_outbox_events) AS outbox, (SELECT status FROM vnext_control_plane.vnext_account_device_links WHERE link_id='target-link-1') AS link_status, (SELECT auth_version::int FROM vnext_control_plane.vnext_account_device_links WHERE link_id='target-link-1') AS link_auth, (SELECT access_version::int FROM vnext_control_plane.vnext_account_device_links WHERE link_id='target-link-1') AS link_access, (SELECT row_version::int FROM vnext_control_plane.vnext_account_device_links WHERE link_id='target-link-1') AS link_row, (SELECT auth_version::int FROM vnext_control_plane.vnext_accounts WHERE account_id='target-1') AS account_auth, (SELECT access_version::int FROM vnext_control_plane.vnext_accounts WHERE account_id='target-1') AS account_access, (SELECT revocation_version::int FROM vnext_control_plane.vnext_accounts WHERE account_id='target-1') AS account_revocation")).rows[0]);
}
async function insertSession(facade, sessionId, accountId, deviceId, installationId, linkId) {
  await facade.query("INSERT INTO vnext_control_plane.vnext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,revoked_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES($1,'authority-1',$2,$3,$4,$5,'online','active',$6,'2026-08-15T01:00:00.000Z',NULL,1,1,1,1,1,1,1,1,1,1,$6,$6)", [sessionId, accountId, deviceId, installationId, linkId, BOOTSTRAP_NOW]);
}
async function fixture(runtime) {
  const handle = await runtime.createIsolatedHandle();
  const catalog = createVNextPg17CatalogBoundary(runtime);
  await catalog.apply(handle, { appliedAt: BOOTSTRAP_NOW, appliedBy: 'link-revocation-test' });
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
    await insertSession(facade, 'actor-session-1', 'account-1', 'device-1', 'installation-1', 'bootstrap-bootstrap-link');
    await facade.query("INSERT INTO vnext_control_plane.vnext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES('actor-reauth-1','authority-1','actor-session-1','passkey',repeat('c',64),1,1,1,1,1,1,1,1,1,$1,'2026-08-15T00:10:00.000Z',$1)", [BOOTSTRAP_NOW]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('target-1','authority-1','active',1,1,1,1,$1,$1)", [BOOTSTRAP_NOW]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at,revoked_at) VALUES('target-device-1','authority-1','active',1,1,1,$1,$1,NULL)", [BOOTSTRAP_NOW]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at,revoked_at) VALUES('target-installation-1','authority-1','target-device-1','target-key-1',repeat('d',64),'active',1,1,$1,$1,NULL)", [BOOTSTRAP_NOW]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at,revoked_at) VALUES('target-link-1','authority-1','target-1','target-device-1','target-installation-1','active',1,1,1,$1,$1,NULL)", [BOOTSTRAP_NOW]);
    await insertSession(facade, 'target-session-1', 'target-1', 'target-device-1', 'target-installation-1', 'target-link-1');
  });
  const actorBoundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: handle, verifyPresentation: () => ({ sessionId: 'actor-session-1' }) });
  const targetBoundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: handle, verifyPresentation: () => ({ sessionId: 'target-session-1' }) });
  const actorResolver = createVNextPg17AccessContextResolver({ runtime, handle, verifierBoundary: actorBoundary, surface: 'desktop', now: () => NOW });
  const targetResolver = createVNextPg17AccessContextResolver({ runtime, handle, verifierBoundary: targetBoundary, surface: 'desktop', now: () => NOW });
  return { handle, actorResolver, targetResolver, actorAssertion: await actorBoundary.verify(null), targetAssertion: await targetBoundary.verify(null) };
}
async function runAccountDeviceLinkRevocationCases(runtime) {
  const current = await fixture(runtime);
  try {
    let ids = 0;
    const writer = createVNextPg17AccountDeviceLinkRevocationMutation({ runtime, handle: current.handle, resolver: current.actorResolver, now: () => NOW, idFactory: kind => `${kind}-${++ids}` });
    assert.ok(await current.targetResolver.resolve(current.targetAssertion));
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, command({ targetLinkId: 'bootstrap-bootstrap-link', idempotencyKey: 'self-link' })), { code: 'SELF_LINK_REVOKE_FORBIDDEN', replayed: false, status: 'rejected' });
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, command({ targetLinkId: 'missing-link', idempotencyKey: 'missing-link' })), { code: 'TARGET_LINK_NOT_ACTIVE', replayed: false, status: 'rejected' });
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, command({ expectedTargetRowVersion: 2, idempotencyKey: 'stale-link' })), { code: 'LINK_VERSION_CONFLICT', replayed: false, status: 'rejected' });
    const accepted = await writer.execute(current.actorAssertion, command());
    assert.deepStrictEqual(accepted, { code: 'ACCOUNT_DEVICE_LINK_REVOKED', linkId: 'target-link-1', replayed: false, status: 'accepted' });
    await expectCode(() => current.targetResolver.resolve(current.targetAssertion), 'VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE');
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, command()), { ...accepted, replayed: true });
    await expectCode(() => writer.execute(current.actorAssertion, command({ reasonCode: 'changed-reason' })), 'IDEMPOTENCY_KEY_CONFLICT');
    const noop = await writer.execute(current.actorAssertion, command({ idempotencyKey: 'revoked-link-noop' }));
    assert.deepStrictEqual(noop, { code: 'LINK_ALREADY_REVOKED', linkId: 'target-link-1', replayed: false, status: 'noop' });
    assert.deepStrictEqual(await writer.execute(current.actorAssertion, command({ idempotencyKey: 'revoked-link-noop' })), { ...noop, replayed: true });
    await withVNextPg17SyntheticQuery(current.handle, 'fixture-provisioner', async facade => {
      const receipt = await facade.query("SELECT canonical_result_json FROM vnext_control_plane.vnext_authorization_command_receipts WHERE idempotency_key='revoke-link-1'");
      const result = JSON.parse(receipt.rows[0].canonical_result_json);
      result.context = { accountId: 'account-1', linkId: '', policyRevision: 1 };
      const json = stable(result);
      await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts DISABLE TRIGGER vnext_authorization_command_receipts_no_update');
      await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_audit_events DISABLE TRIGGER vnext_authorization_audit_events_no_update');
      try {
        await facade.query("UPDATE vnext_control_plane.vnext_authorization_command_receipts SET canonical_result_json=$1,canonical_result_sha256=$2 WHERE idempotency_key='revoke-link-1'", [json, sha256(json)]);
        await facade.query("UPDATE vnext_control_plane.vnext_authorization_audit_events SET context_sha256=$1 WHERE receipt_id=(SELECT receipt_id FROM vnext_control_plane.vnext_authorization_command_receipts WHERE idempotency_key='revoke-link-1')", [sha256(stable(result.context))]);
      } finally {
        await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_audit_events ENABLE TRIGGER vnext_authorization_audit_events_no_update');
        await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts ENABLE TRIGGER vnext_authorization_command_receipts_no_update');
      }
    });
    await expectCode(() => writer.execute(current.actorAssertion, command()), 'IDEMPOTENCY_RECEIPT_INVALID');
  } finally { await runtime.disposeHandle(current.handle); }
  const forged = await fixture(runtime);
  try {
    let ids = 0;
    const writer = createVNextPg17AccountDeviceLinkRevocationMutation({ runtime, handle: forged.handle, resolver: forged.actorResolver, now: () => NOW, idFactory: kind => `${kind}-${++ids}` });
    await writer.execute(forged.actorAssertion, command());
    await withVNextPg17SyntheticQuery(forged.handle, 'fixture-provisioner', async facade => {
      const receipt = await facade.query("SELECT canonical_result_json FROM vnext_control_plane.vnext_authorization_command_receipts WHERE idempotency_key='revoke-link-1'");
      const result = JSON.parse(receipt.rows[0].canonical_result_json);
      result.code = 'FORGED_RESULT';
      const json = stable(result);
      await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts DISABLE TRIGGER vnext_authorization_command_receipts_no_update');
      try {
        await facade.query("UPDATE vnext_control_plane.vnext_authorization_command_receipts SET canonical_result_json=$1,canonical_result_sha256=$2 WHERE idempotency_key='revoke-link-1'", [json, sha256(json)]);
      } finally {
        await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts ENABLE TRIGGER vnext_authorization_command_receipts_no_update');
      }
    });
    await expectCode(() => writer.execute(forged.actorAssertion, command()), 'IDEMPOTENCY_RECEIPT_INVALID');
  } finally { await runtime.disposeHandle(forged.handle); }
  for (const stage of ['target', 'receipt', 'audit', 'outbox']) {
    const rollback = await fixture(runtime);
    try {
      const before = await state(rollback.handle);
      const writer = createVNextPg17AccountDeviceLinkRevocationMutation({ runtime, handle: rollback.handle, resolver: rollback.actorResolver, now: () => NOW, idFactory: kind => `rollback-${stage}-${kind}`, testHooks: { afterWrite: ({ stage: actual }) => { if (actual === stage) throw new Error('stop'); } } });
      await expectCode(() => writer.execute(rollback.actorAssertion, command({ idempotencyKey: `rollback-${stage}` })), 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAVAILABLE');
      assert.deepStrictEqual(await state(rollback.handle), before);
    } finally { await runtime.disposeHandle(rollback.handle); }
  }
}
if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  runtime.start().then(() => runAccountDeviceLinkRevocationCases(runtime)).then(() => process.stdout.write('vNext PG17 account-device-link revocation mutation checks passed\n')).finally(() => runtime.stop()).catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}
module.exports = { runAccountDeviceLinkRevocationCases, fixture, command, manifest, insertSession, NOW };
