'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { bootstrapVNextControlPlaneReference } = require('./vNextControlPlaneReferenceKernel');
const policy = require('./vNextAuthorizationPolicyReference');
const { createVNextTrustedSessionVerifierBoundary } = require('./vNextTrustedSessionVerifierBoundaryReference');
const { createVNextAccessContextResolverReference } = require('./vNextAccessContextResolverReference');
const { createVNextPolicyPublicationMutationReference } = require('./vNextPolicyPublicationMutationReference');

const NOW = '2026-08-14T01:00:00.000Z';
const THEN = '2026-08-14T00:00:00.000Z';
const HASH = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const H = 'a'.repeat(64);
const candidate = policy.createPolicyManifest({
  capabilities: [
    { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'policy.view', status: 'active', allowedSurfaces: ['desktop'] },
  ],
  roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'policy.view', 'user.review'], teacher: [], student: [] },
});

function seed() {
  const db = new Database(':memory:');
  bootstrapVNextControlPlaneReference(db);
  db.prepare("INSERT INTO vNext_authorities VALUES(?,?,?,?)").run('authority-1', 'active', THEN, THEN);
  db.prepare("INSERT INTO vNext_accounts VALUES(?,?,?,?,?,?,?,?,?)").run('account-1', 'authority-1', 'active', 1, 1, 1, 1, THEN, THEN);
  db.prepare("INSERT INTO vNext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run('device-1', 'authority-1', 'active', 1, 1, 1, THEN, THEN);
  db.prepare("INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('installation-1', 'authority-1', 'device-1', 'key-1', 'fingerprint-1', 'active', 1, 1, THEN, THEN);
  db.prepare("INSERT INTO vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('link-1', 'authority-1', 'account-1', 'device-1', 'installation-1', 'active', 1, 1, 1, THEN, THEN);
  db.prepare("INSERT INTO vNext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('session-1', 'authority-1', 'account-1', 'device-1', 'installation-1', 'link-1', 'online', 'active', THEN, '2026-08-14T08:00:00.000Z', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, THEN, THEN);
  db.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('role-1', 'authority-1', 'account-1', 'super_admin', 'active', 1, 1, THEN, THEN, THEN);
  db.prepare("INSERT INTO vNext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('reauth-1', 'authority-1', 'session-1', 'passkey', H, 1, 1, 1, 1, 1, 1, 1, 1, 1, '2026-08-14T00:50:00.000Z', '2026-08-14T01:10:00.000Z', '2026-08-14T00:50:00.000Z');
  const canonical = policy.canonicalizePolicyManifest(policy.DEFAULT_POLICY_MANIFEST);
  const manifestHash = policy.policyManifestSha256(policy.DEFAULT_POLICY_MANIFEST);
  const result = JSON.stringify({ authorityId: 'authority-1', code: 'POLICY_PUBLISHED', policyContractVersion: 1, policyManifestSha256: manifestHash, policyRevision: 1, publicationId: 'publication-1', status: 'accepted' });
  db.prepare("INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('receipt-1', 'authority-1', 'system', null, 'seed-publication', 'authorization_policy.publish', 'authorization_policy', 'authority-1', H, 0, 'accepted', 'POLICY_PUBLISHED', result, HASH(result), 1, THEN);
  db.prepare("INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES(?,?,?,?,?,?,?,?)").run('publication-1', 'authority-1', 'receipt-1', 1, 1, canonical, manifestHash, THEN);
  let sequence = 0;
  const boundary = createVNextTrustedSessionVerifierBoundary({ verifyPresentation: () => ({ sessionId: 'session-1' }) });
  const resolver = createVNextAccessContextResolverReference({ db, verifierBoundary: boundary, surface: 'desktop', now: () => NOW });
  return { db, boundary, resolver, idFactory: kind => `${kind}-${++sequence}` };
}

(async () => {
  const fixture = seed();
  try {
    const assertion = await fixture.boundary.verify({ ignored: true });
    const service = createVNextPolicyPublicationMutationReference({ db: fixture.db, resolver: fixture.resolver, now: () => NOW, idFactory: fixture.idFactory });
    const command = { type: 'authorization_policy.publish', expectedPolicyRevision: 1, idempotencyKey: 'publish-1', reasonCode: 'policy_reviewed', manifest: candidate };
    assert.deepStrictEqual(service.execute(assertion, command), { code: 'POLICY_PUBLISHED', policyRevision: 2, replayed: false, status: 'accepted' });
    assert.strictEqual(fixture.db.prepare('SELECT MAX(policy_revision) AS revision FROM vNext_authorization_policy_publications').get().revision, 2);
    assert.strictEqual(fixture.db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_audit_events').get().count, 1);
    assert.strictEqual(fixture.db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_outbox_events').get().count, 1);
    assert.deepStrictEqual(service.execute(assertion, command), { code: 'POLICY_PUBLISHED', policyRevision: 2, replayed: true, status: 'accepted' });
    assert.throws(() => service.execute(assertion, { ...command, reasonCode: 'changed' }), error => error.code === 'IDEMPOTENCY_KEY_CONFLICT');
    assert.deepStrictEqual(service.execute(assertion, { ...command, expectedPolicyRevision: 2, idempotencyKey: 'unchanged-1' }), { code: 'POLICY_UNCHANGED', policyRevision: 2, replayed: false, status: 'noop' });
    assert.strictEqual(fixture.db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_policy_publications').get().count, 2);
    assert.deepStrictEqual(service.execute(assertion, { ...command, expectedPolicyRevision: 0, idempotencyKey: 'bootstrap-1' }), { code: 'FIRST_POLICY_BOOTSTRAP_REQUIRED', policyRevision: 2, replayed: false, status: 'rejected' });
    const conflict = { ...command, expectedPolicyRevision: 1, idempotencyKey: 'conflict-1' };
    assert.deepStrictEqual(service.execute(assertion, conflict), { code: 'POLICY_REVISION_CONFLICT', policyRevision: 2, replayed: false, status: 'rejected' });
    assert.deepStrictEqual(service.execute(assertion, conflict), { code: 'POLICY_REVISION_CONFLICT', policyRevision: 2, replayed: true, status: 'rejected' });
    for (const unsafeManifest of [
      policy.createPolicyManifest({ capabilities: candidate.capabilities, roleDefaults: { super_admin: ['device.revoke', 'policy.view', 'user.review'], teacher: [], student: [] } }),
      policy.createPolicyManifest({ capabilities: candidate.capabilities.map(item => item.capabilityId === 'access.manage' ? { ...item, status: 'retired' } : item), roleDefaults: candidate.roleDefaults }),
      policy.createPolicyManifest({ capabilities: candidate.capabilities.map(item => item.capabilityId === 'access.manage' ? { ...item, allowedSurfaces: ['miniapp'] } : item), roleDefaults: candidate.roleDefaults }),
    ]) assert.throws(() => service.execute(assertion, { ...command, expectedPolicyRevision: 2, idempotencyKey: `unsafe-${Math.random()}`, manifest: unsafeManifest }), error => error.code === 'POLICY_MANAGEMENT_CAPABILITY_REQUIRED');
    assert.strictEqual(fixture.db.prepare('SELECT MAX(policy_revision) AS revision FROM vNext_authorization_policy_publications').get().revision, 2, 'unsafe policy is never published');
    let manifestGetterReads = 0;
    const unstableCommand = { ...command, idempotencyKey: 'unstable-1' };
    Object.defineProperty(unstableCommand, 'manifest', { enumerable: true, get() { manifestGetterReads += 1; return candidate; } });
    assert.throws(() => service.execute(assertion, unstableCommand), error => error.code === 'POLICY_PUBLICATION_INPUT_INVALID');
    assert.strictEqual(manifestGetterReads, 0, 'candidate manifest accessors are rejected before they are read');
    let nestedGetterReads = 0;
    const nestedManifest = { ...candidate, roleDefaults: { ...candidate.roleDefaults } };
    Object.defineProperty(nestedManifest.roleDefaults, 'super_admin', { enumerable: true, get() { nestedGetterReads += 1; return ['access.manage']; } });
    assert.throws(() => service.execute(assertion, { ...command, idempotencyKey: 'nested-getter-1', manifest: nestedManifest }), error => error.code === 'POLICY_PUBLICATION_INPUT_INVALID');
    assert.strictEqual(nestedGetterReads, 0, 'nested manifest accessors are rejected before they are read');
    let capabilityGetterReads = 0;
    const capabilityGetterManifest = { ...candidate, capabilities: candidate.capabilities.map(item => ({ ...item })) };
    Object.defineProperty(capabilityGetterManifest.capabilities[1], 'status', { enumerable: true, get() { capabilityGetterReads += 1; return 'active'; } });
    assert.throws(() => service.execute(assertion, { ...command, idempotencyKey: 'capability-getter-1', manifest: capabilityGetterManifest }), error => error.code === 'POLICY_PUBLICATION_INPUT_INVALID');
    assert.strictEqual(capabilityGetterReads, 0, 'nested capability accessors are rejected before they are read');
    const proxyManifest = new Proxy(candidate, {});
    assert.throws(() => service.execute(assertion, { ...command, idempotencyKey: 'proxy-manifest-1', manifest: proxyManifest }), error => error.code === 'POLICY_PUBLICATION_INPUT_INVALID');
    assert.throws(() => service.execute(assertion, { ...command, idempotencyKey: 'spoof-1', authorityId: 'other' }), error => error.code === 'POLICY_PUBLICATION_INPUT_INVALID');
  } finally { fixture.db.close(); }

  const replayFixture = seed();
  try {
    const assertion = await replayFixture.boundary.verify(null);
    const service = createVNextPolicyPublicationMutationReference({ db: replayFixture.db, resolver: replayFixture.resolver, now: () => NOW, idFactory: replayFixture.idFactory });
    const command = { type: 'authorization_policy.publish', expectedPolicyRevision: 1, idempotencyKey: 'tamper-1', reasonCode: 'policy_reviewed', manifest: candidate };
    service.execute(assertion, command);
    replayFixture.db.exec('DROP TRIGGER vNext_authorization_audit_events_no_update');
    replayFixture.db.prepare("UPDATE vNext_authorization_audit_events SET context_sha256=? WHERE receipt_id!='receipt-1'").run('b'.repeat(64));
    replayFixture.db.exec("CREATE TRIGGER vNext_authorization_audit_events_no_update BEFORE UPDATE ON vNext_authorization_audit_events BEGIN SELECT RAISE(ABORT,'vNext audit is append-only'); END");
    assert.throws(() => service.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID');
  } finally { replayFixture.db.close(); }

  const left = seed(); const right = seed();
  try {
    assert.throws(() => createVNextPolicyPublicationMutationReference({ db: right.db, resolver: left.resolver }), error => error.code === 'POLICY_PUBLICATION_CONFIGURATION_INVALID', 'a resolver is bound to the database it reads');
  } finally { left.db.close(); right.db.close(); }
  console.log('vNext policy publication mutation reference checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
