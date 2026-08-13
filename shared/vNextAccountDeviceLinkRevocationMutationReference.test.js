'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { bootstrapVNextControlPlaneReference } = require('./vNextControlPlaneReferenceKernel');
const policy = require('./vNextAuthorizationPolicyReference');
const { createVNextTrustedSessionVerifierBoundary } = require('./vNextTrustedSessionVerifierBoundaryReference');
const { createVNextAccessContextResolverReference } = require('./vNextAccessContextResolverReference');
const { createVNextAccountDeviceLinkRevocationMutationReference } = require('./vNextAccountDeviceLinkRevocationMutationReference');
const { createVNextPolicyPublicationMutationReference } = require('./vNextPolicyPublicationMutationReference');

const NOW = '2026-08-14T01:00:00.000Z';
const THEN = '2026-08-14T00:00:00.000Z';
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const EVIDENCE = 'a'.repeat(64);

function addIdentity(db, suffix, accountId, linkId) {
  db.prepare('INSERT INTO vNext_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(accountId, 'authority-1', 'active', 1, 1, 1, 1, THEN, THEN);
  db.prepare('INSERT INTO vNext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(`device-${suffix}`, 'authority-1', 'active', 1, 1, 1, THEN, THEN);
  db.prepare('INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`installation-${suffix}`, 'authority-1', `device-${suffix}`, `key-${suffix}`, `fingerprint-${suffix}`, 'active', 1, 1, THEN, THEN);
  db.prepare('INSERT INTO vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(linkId, 'authority-1', accountId, `device-${suffix}`, `installation-${suffix}`, 'active', 1, 1, 1, THEN, THEN);
  db.prepare('INSERT INTO vNext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(`session-${suffix}`, 'authority-1', accountId, `device-${suffix}`, `installation-${suffix}`, linkId, 'online', 'active', THEN, '2026-08-14T08:00:00.000Z', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, THEN, THEN);
}

function seed({ surface = 'desktop', reauth = true } = {}) {
  const db = new Database(':memory:');
  bootstrapVNextControlPlaneReference(db);
  db.prepare('INSERT INTO vNext_authorities VALUES(?,?,?,?)').run('authority-1', 'active', THEN, THEN);
  addIdentity(db, 'actor', 'account-actor', 'link-actor');
  addIdentity(db, 'target', 'account-target', 'link-target');
  db.prepare('INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('role-actor', 'authority-1', 'account-actor', 'super_admin', 'active', 1, 1, THEN, THEN, THEN);
  if (reauth) db.prepare('INSERT INTO vNext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('reauth-actor', 'authority-1', 'session-actor', 'passkey', EVIDENCE, 1, 1, 1, 1, 1, 1, 1, 1, 1, '2026-08-14T00:50:00.000Z', '2026-08-14T01:10:00.000Z', '2026-08-14T00:50:00.000Z');
  const canonical = policy.canonicalizePolicyManifest(policy.DEFAULT_POLICY_MANIFEST);
  const manifestHash = policy.policyManifestSha256(policy.DEFAULT_POLICY_MANIFEST);
  const result = JSON.stringify({ authorityId: 'authority-1', code: 'POLICY_PUBLISHED', policyContractVersion: 1, policyManifestSha256: manifestHash, policyRevision: 1, publicationId: 'publication-1', status: 'accepted' });
  db.prepare('INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('receipt-publication', 'authority-1', 'system', null, 'seed-publication', 'authorization_policy.publish', 'authorization_policy', 'authority-1', EVIDENCE, 0, 'accepted', 'POLICY_PUBLISHED', result, sha256(result), 1, THEN);
  db.prepare('INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES(?,?,?,?,?,?,?,?)').run('publication-1', 'authority-1', 'receipt-publication', 1, 1, canonical, manifestHash, THEN);
  let sequence = 0;
  const actorBoundary = createVNextTrustedSessionVerifierBoundary({ verifyPresentation: () => ({ sessionId: 'session-actor' }) });
  const targetBoundary = createVNextTrustedSessionVerifierBoundary({ verifyPresentation: () => ({ sessionId: 'session-target' }) });
  const resolver = createVNextAccessContextResolverReference({ db, verifierBoundary: actorBoundary, surface, now: () => NOW });
  const targetResolver = createVNextAccessContextResolverReference({ db, verifierBoundary: targetBoundary, surface: 'desktop', now: () => NOW });
  return { db, actorBoundary, targetBoundary, resolver, targetResolver, idFactory: kind => `${kind}-${++sequence}` };
}

async function advancePolicyRevision(fixture) {
  const assertion = await fixture.actorBoundary.verify(null);
  const manifest = policy.createPolicyManifest({
    capabilities: [...policy.DEFAULT_POLICY_MANIFEST.capabilities, { capabilityId: 'policy.view', status: 'active', allowedSurfaces: ['desktop'] }],
    roleDefaults: policy.DEFAULT_POLICY_MANIFEST.roleDefaults,
  });
  const publisher = createVNextPolicyPublicationMutationReference({ db: fixture.db, resolver: fixture.resolver, now: () => NOW, idFactory: fixture.idFactory });
  assert.strictEqual(publisher.execute(assertion, { type: 'authorization_policy.publish', expectedPolicyRevision: 1, idempotencyKey: 'advance-policy', reasonCode: 'policy_reviewed', manifest }).status, 'accepted');
}

(async () => {
  const fixture = seed();
  try {
    const assertion = await fixture.actorBoundary.verify(null);
    const targetAssertion = await fixture.targetBoundary.verify(null);
    const service = createVNextAccountDeviceLinkRevocationMutationReference({ db: fixture.db, resolver: fixture.resolver, now: () => NOW, idFactory: fixture.idFactory });
    const command = { type: 'account_device_link.revoke', targetLinkId: 'link-target', expectedTargetRowVersion: 1, idempotencyKey: 'revoke-1', reasonCode: 'device_lost' };
    assert.deepStrictEqual(service.execute(assertion, { ...command, idempotencyKey: 'bad-version', expectedTargetRowVersion: 2 }), { code: 'ACCOUNT_DEVICE_LINK_VERSION_CONFLICT', linkId: 'link-target', replayed: false, status: 'rejected' });
    assert.deepStrictEqual(service.execute(assertion, command), { code: 'ACCOUNT_DEVICE_LINK_REVOKED', linkId: 'link-target', replayed: false, status: 'accepted' });
    assert.deepStrictEqual(fixture.db.prepare("SELECT status,auth_version,access_version,row_version,revoked_at FROM vNext_account_device_links WHERE link_id='link-target'").get(), { status: 'revoked', auth_version: 2, access_version: 2, row_version: 2, revoked_at: NOW });
    assert.deepStrictEqual(fixture.db.prepare("SELECT auth_version,access_version,revocation_version FROM vNext_accounts WHERE account_id='account-target'").get(), { auth_version: 1, access_version: 1, revocation_version: 1 });
    assert.throws(() => fixture.targetResolver.resolve(targetAssertion), error => error.code === 'VNEXT_ACCESS_CONTEXT_UNAVAILABLE');
    assert.deepStrictEqual(service.execute(assertion, command), { code: 'ACCOUNT_DEVICE_LINK_REVOKED', linkId: 'link-target', replayed: true, status: 'accepted' });
    assert.deepStrictEqual(service.execute(assertion, { ...command, idempotencyKey: 'noop-1', expectedTargetRowVersion: 2 }), { code: 'ACCOUNT_DEVICE_LINK_ALREADY_REVOKED', linkId: 'link-target', replayed: false, status: 'noop' });
    assert.deepStrictEqual(service.execute(assertion, { ...command, idempotencyKey: 'noop-1', expectedTargetRowVersion: 2 }), { code: 'ACCOUNT_DEVICE_LINK_ALREADY_REVOKED', linkId: 'link-target', replayed: true, status: 'noop' });
    assert.deepStrictEqual(service.execute(assertion, { ...command, idempotencyKey: 'noop-stale-1', expectedTargetRowVersion: 1 }), { code: 'ACCOUNT_DEVICE_LINK_ALREADY_REVOKED', linkId: 'link-target', replayed: false, status: 'noop' });
    assert.deepStrictEqual(service.execute(assertion, { ...command, idempotencyKey: 'noop-stale-1', expectedTargetRowVersion: 1 }), { code: 'ACCOUNT_DEVICE_LINK_ALREADY_REVOKED', linkId: 'link-target', replayed: true, status: 'noop' });
    assert.deepStrictEqual(service.execute(assertion, { ...command, idempotencyKey: 'self-1', targetLinkId: 'link-actor' }), { code: 'ACCOUNT_DEVICE_LINK_SELF_REVOKE_FORBIDDEN', linkId: 'link-actor', replayed: false, status: 'rejected' });
    assert.throws(() => service.execute(assertion, { ...command, reasonCode: 'different' }), error => error.code === 'IDEMPOTENCY_KEY_CONFLICT');
  } finally { fixture.db.close(); }

  const policyAdvance = seed();
  try {
    const assertion = await policyAdvance.actorBoundary.verify(null);
    const service = createVNextAccountDeviceLinkRevocationMutationReference({ db: policyAdvance.db, resolver: policyAdvance.resolver, now: () => NOW, idFactory: policyAdvance.idFactory });
    const command = { type: 'account_device_link.revoke', targetLinkId: 'link-target', expectedTargetRowVersion: 1, idempotencyKey: 'policy-replay', reasonCode: 'device_lost' };
    service.execute(assertion, command);
    await advancePolicyRevision(policyAdvance);
    assert.deepStrictEqual(service.execute(assertion, command), { code: 'ACCOUNT_DEVICE_LINK_REVOKED', linkId: 'link-target', replayed: true, status: 'accepted' });
  } finally { policyAdvance.db.close(); }

  const tamper = seed();
  try {
    const assertion = await tamper.actorBoundary.verify(null);
    const service = createVNextAccountDeviceLinkRevocationMutationReference({ db: tamper.db, resolver: tamper.resolver, now: () => NOW, idFactory: tamper.idFactory });
    const command = { type: 'account_device_link.revoke', targetLinkId: 'link-target', expectedTargetRowVersion: 1, idempotencyKey: 'tamper-link', reasonCode: 'device_lost' };
    service.execute(assertion, command);
    tamper.db.prepare("UPDATE vNext_account_device_links SET status='active',revoked_at=NULL WHERE link_id='link-target'").run();
    assert.throws(() => service.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID');
  } finally { tamper.db.close(); }

  const timeTamper = seed();
  try {
    const assertion = await timeTamper.actorBoundary.verify(null);
    const service = createVNextAccountDeviceLinkRevocationMutationReference({ db: timeTamper.db, resolver: timeTamper.resolver, now: () => NOW, idFactory: timeTamper.idFactory });
    const command = { type: 'account_device_link.revoke', targetLinkId: 'link-target', expectedTargetRowVersion: 1, idempotencyKey: 'tamper-time', reasonCode: 'device_lost' };
    service.execute(assertion, command);
    timeTamper.db.prepare("UPDATE vNext_account_device_links SET updated_at='2026-08-14T01:01:00.000Z',revoked_at='2026-08-14T01:01:00.000Z' WHERE link_id='link-target'").run();
    assert.throws(() => service.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID');
  } finally { timeTamper.db.close(); }

  const noReauth = seed({ reauth: false });
  const miniapp = seed({ surface: 'miniapp' });
  const noRole = seed();
  const noCapability = seed();
  try {
    const command = { type: 'account_device_link.revoke', targetLinkId: 'link-target', expectedTargetRowVersion: 1, idempotencyKey: 'deny-1', reasonCode: 'device_lost' };
    const noReauthAssertion = await noReauth.actorBoundary.verify(null);
    const miniappAssertion = await miniapp.actorBoundary.verify(null);
    const noRoleAssertion = await noRole.actorBoundary.verify(null);
    noRole.db.prepare("UPDATE vNext_role_grants SET status='revoked',revoked_at=? WHERE grant_id='role-actor'").run(NOW);
    const canonical = policy.canonicalizePolicyManifest(policy.createPolicyManifest({ capabilities: policy.DEFAULT_POLICY_MANIFEST.capabilities.filter(item => item.capabilityId !== 'device.revoke'), roleDefaults: { super_admin: ['access.manage', 'user.review'], teacher: [], student: [] } }));
    noCapability.db.exec('DROP TRIGGER vNext_authorization_policy_publications_no_update');
    noCapability.db.prepare("UPDATE vNext_authorization_policy_publications SET canonical_manifest_json=?,policy_manifest_sha256=? WHERE publication_id='publication-1'").run(canonical, policy.policyManifestSha256(JSON.parse(canonical)));
    noCapability.db.exec("CREATE TRIGGER vNext_authorization_policy_publications_no_update BEFORE UPDATE ON vNext_authorization_policy_publications BEGIN SELECT RAISE(ABORT,'vNext policy publication is append-only'); END");
    const noCapabilityAssertion = await noCapability.actorBoundary.verify(null);
    assert.throws(() => createVNextAccountDeviceLinkRevocationMutationReference({ db: noReauth.db, resolver: noReauth.resolver, now: () => NOW }).execute(noReauthAssertion, command), error => error.code === 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
    assert.throws(() => createVNextAccountDeviceLinkRevocationMutationReference({ db: miniapp.db, resolver: miniapp.resolver, now: () => NOW }).execute(miniappAssertion, command), error => error.code === 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
    assert.throws(() => createVNextAccountDeviceLinkRevocationMutationReference({ db: noRole.db, resolver: noRole.resolver, now: () => NOW }).execute(noRoleAssertion, command), error => error.code === 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
    assert.throws(() => createVNextAccountDeviceLinkRevocationMutationReference({ db: noCapability.db, resolver: noCapability.resolver, now: () => NOW }).execute(noCapabilityAssertion, command), error => error.code === 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
    assert.throws(() => createVNextAccountDeviceLinkRevocationMutationReference({ db: miniapp.db, resolver: miniapp.resolver, now: () => NOW }).execute({}, command), error => error.code === 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
  } finally { noReauth.db.close(); miniapp.db.close(); noRole.db.close(); noCapability.db.close(); }

  for (const hookName of ['afterTarget', 'afterReceipt', 'afterAudit', 'afterOutbox']) {
    const rollback = seed();
    try {
      const assertion = await rollback.actorBoundary.verify(null);
      const service = createVNextAccountDeviceLinkRevocationMutationReference({ db: rollback.db, resolver: rollback.resolver, now: () => NOW, idFactory: rollback.idFactory, testHooks: { [hookName]() { throw new Error(`rollback-${hookName}`); } } });
      assert.throws(() => service.execute(assertion, { type: 'account_device_link.revoke', targetLinkId: 'link-target', expectedTargetRowVersion: 1, idempotencyKey: `rollback-${hookName}`, reasonCode: 'device_lost' }), new RegExp(`rollback-${hookName}`));
      assert.deepStrictEqual(rollback.db.prepare("SELECT status,auth_version,access_version,row_version FROM vNext_account_device_links WHERE link_id='link-target'").get(), { status: 'active', auth_version: 1, access_version: 1, row_version: 1 });
      assert.strictEqual(rollback.db.prepare("SELECT COUNT(*) AS count FROM vNext_authorization_command_receipts WHERE command_type='account_device_link.revoke'").get().count, 0);
      assert.strictEqual(rollback.db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_audit_events').get().count, 0);
      assert.strictEqual(rollback.db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_outbox_events').get().count, 0);
    } finally { rollback.db.close(); }
  }
  const left = seed(); const right = seed();
  try {
    assert.throws(() => createVNextAccountDeviceLinkRevocationMutationReference({ db: right.db, resolver: left.resolver }), error => error.code === 'ACCOUNT_DEVICE_LINK_REVOCATION_CONFIGURATION_INVALID');
    const assertion = await left.actorBoundary.verify(null);
    const service = createVNextAccountDeviceLinkRevocationMutationReference({ db: left.db, resolver: left.resolver, now: () => NOW });
    assert.throws(() => service.execute(assertion, { type: 'account_device_link.revoke', targetLinkId: 'link-target', expectedTargetRowVersion: 1, idempotencyKey: 'extra', reasonCode: 'device_lost', authorityId: 'authority-2' }), error => error.code === 'ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID');
    const accessor = { type: 'account_device_link.revoke', targetLinkId: 'link-target', expectedTargetRowVersion: 1, idempotencyKey: 'accessor', reasonCode: 'device_lost' };
    Object.defineProperty(accessor, 'reasonCode', { enumerable: true, get() { return 'device_lost'; } });
    assert.throws(() => service.execute(assertion, accessor), error => error.code === 'ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID');
  } finally { left.db.close(); right.db.close(); }
  console.log('vNext account device link revocation mutation reference checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
