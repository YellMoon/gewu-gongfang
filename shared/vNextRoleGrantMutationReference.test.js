'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { bootstrapVNextControlPlaneReference } = require('./vNextControlPlaneReferenceKernel');
const policy = require('./vNextAuthorizationPolicyReference');
const { createVNextTrustedSessionVerifierBoundary } = require('./vNextTrustedSessionVerifierBoundaryReference');
const { createVNextAccessContextResolverReference } = require('./vNextAccessContextResolverReference');
const { createVNextRoleGrantMutationReference } = require('./vNextRoleGrantMutationReference');

const NOW = '2026-08-14T01:00:00.000Z';
const THEN = '2026-08-14T00:00:00.000Z';
const HASH = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
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
  addIdentity(db, 'actor', 'actor-1', 'link-actor');
  addIdentity(db, 'target', 'target-1', 'link-target');
  db.prepare('INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('actor-admin', 'authority-1', 'actor-1', 'super_admin', 'active', 1, 1, THEN, THEN, THEN);
  if (reauth) db.prepare('INSERT INTO vNext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('actor-reauth', 'authority-1', 'session-actor', 'passkey', EVIDENCE, 1, 1, 1, 1, 1, 1, 1, 1, 1, '2026-08-14T00:50:00.000Z', '2026-08-14T01:10:00.000Z', '2026-08-14T00:50:00.000Z');
  const canonical = policy.canonicalizePolicyManifest(policy.DEFAULT_POLICY_MANIFEST);
  const manifestHash = policy.policyManifestSha256(policy.DEFAULT_POLICY_MANIFEST);
  const result = JSON.stringify({ authorityId: 'authority-1', code: 'POLICY_PUBLISHED', policyContractVersion: 1, policyManifestSha256: manifestHash, policyRevision: 1, publicationId: 'publication-1', status: 'accepted' });
  db.prepare('INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('publication-receipt', 'authority-1', 'system', null, 'seed-publication', 'authorization_policy.publish', 'authorization_policy', 'authority-1', EVIDENCE, 0, 'accepted', 'POLICY_PUBLISHED', result, HASH(result), 1, THEN);
  db.prepare('INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES(?,?,?,?,?,?,?,?)').run('publication-1', 'authority-1', 'publication-receipt', 1, 1, canonical, manifestHash, THEN);
  let sequence = 0;
  const actorBoundary = createVNextTrustedSessionVerifierBoundary({ verifyPresentation: () => ({ sessionId: 'session-actor' }) });
  const targetBoundary = createVNextTrustedSessionVerifierBoundary({ verifyPresentation: () => ({ sessionId: 'session-target' }) });
  const resolver = createVNextAccessContextResolverReference({ db, verifierBoundary: actorBoundary, surface, now: () => NOW });
  const targetResolver = createVNextAccessContextResolverReference({ db, verifierBoundary: targetBoundary, surface: 'desktop', now: () => NOW });
  return { db, actorBoundary, targetBoundary, resolver, targetResolver, idFactory: kind => `${kind}-${++sequence}` };
}

(async () => {
  const fixture = seed();
  try {
    const assertion = await fixture.actorBoundary.verify(null);
    const targetAssertion = await fixture.targetBoundary.verify(null);
    const service = createVNextRoleGrantMutationReference({ db: fixture.db, resolver: fixture.resolver, now: () => NOW, idFactory: fixture.idFactory });
    const grant = { type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'grant-1', reasonCode: 'reviewed' };
    assert.deepStrictEqual(service.execute(assertion, grant), { code: 'ROLE_GRANTED', grantId: 'role-grant-1', replayed: false, status: 'accepted' });
    assert.throws(() => fixture.targetResolver.resolve(targetAssertion), error => error.code === 'VNEXT_ACCESS_CONTEXT_UNAVAILABLE');
    assert.deepStrictEqual(service.execute(assertion, grant), { code: 'ROLE_GRANTED', grantId: 'role-grant-1', replayed: true, status: 'accepted' });
    assert.throws(() => service.execute(assertion, { ...grant, reasonCode: 'different' }), error => error.code === 'IDEMPOTENCY_KEY_CONFLICT');
    const revoke = { type: 'role.revoke', targetGrantId: 'role-grant-1', expectedTargetRowVersion: 1, idempotencyKey: 'revoke-1', reasonCode: 'departure' };
    assert.deepStrictEqual(service.execute(assertion, revoke), { code: 'ROLE_REVOKED', grantId: 'role-grant-1', replayed: false, status: 'accepted' });
    assert.deepStrictEqual(service.execute(assertion, { ...revoke, expectedTargetRowVersion: 2, idempotencyKey: 'noop-1' }), { code: 'ROLE_ALREADY_REVOKED', grantId: 'role-grant-1', replayed: false, status: 'noop' });
    assert.throws(() => service.execute({}, grant), error => error.code === 'AUTHORIZATION_DENIED');
    assert.throws(() => service.execute(assertion, { ...grant, idempotencyKey: 'extra', authorityId: 'authority-2' }), error => error.code === 'MUTATION_INPUT_INVALID');
    const accessor = { ...grant, idempotencyKey: 'accessor' };
    Object.defineProperty(accessor, 'reasonCode', { enumerable: true, get() { return 'reviewed'; } });
    assert.throws(() => service.execute(assertion, accessor), error => error.code === 'MUTATION_INPUT_INVALID');
    assert.throws(() => service.execute(assertion, new Proxy({ ...grant, idempotencyKey: 'proxy' }, {})), error => error.code === 'MUTATION_INPUT_INVALID');
  } finally { fixture.db.close(); }

  const conflicts = seed();
  try {
    const assertion = await conflicts.actorBoundary.verify(null);
    const service = createVNextRoleGrantMutationReference({ db: conflicts.db, resolver: conflicts.resolver, now: () => NOW, idFactory: conflicts.idFactory });
    const missing = { type: 'role.grant', targetAccountId: 'missing', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'missing', reasonCode: 'reviewed' };
    assert.deepStrictEqual(service.execute(assertion, missing), { code: 'TARGET_ACCOUNT_NOT_ACTIVE', replayed: false, status: 'rejected' });
    assert.deepStrictEqual(service.execute(assertion, missing), { code: 'TARGET_ACCOUNT_NOT_ACTIVE', replayed: true, status: 'rejected' });
    const grant = { type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'first-grant', reasonCode: 'reviewed' };
    const granted = service.execute(assertion, grant);
    assert.deepStrictEqual(service.execute(assertion, { ...grant, idempotencyKey: 'conflict' }), { code: 'ROLE_GRANT_CONFLICT', replayed: false, status: 'rejected' });
    assert.deepStrictEqual(service.execute(assertion, { type: 'role.revoke', targetGrantId: granted.grantId, expectedTargetRowVersion: 2, idempotencyKey: 'stale-revoke', reasonCode: 'test' }), { code: 'ROLE_GRANT_VERSION_CONFLICT', replayed: false, status: 'rejected' });
  } finally { conflicts.db.close(); }

  const lastAdmin = seed();
  try {
    const assertion = await lastAdmin.actorBoundary.verify(null);
    const service = createVNextRoleGrantMutationReference({ db: lastAdmin.db, resolver: lastAdmin.resolver, now: () => NOW, idFactory: lastAdmin.idFactory });
    assert.deepStrictEqual(service.execute(assertion, { type: 'role.revoke', targetGrantId: 'actor-admin', expectedTargetRowVersion: 1, idempotencyKey: 'last-admin', reasonCode: 'test' }), { code: 'LAST_SUPER_ADMIN_REVOKE_FORBIDDEN', replayed: false, status: 'rejected' });
  } finally { lastAdmin.db.close(); }

  const invalidClock = seed();
  try {
    const assertion = await invalidClock.actorBoundary.verify(null);
    const service = createVNextRoleGrantMutationReference({ db: invalidClock.db, resolver: invalidClock.resolver, now: () => 'not-a-time' });
    assert.throws(() => service.execute(assertion, { type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'invalid-clock', reasonCode: 'test' }), error => error.code === 'AUTHORIZATION_DENIED');
  } finally { invalidClock.db.close(); }

  const auditTamper = seed();
  try {
    const assertion = await auditTamper.actorBoundary.verify(null);
    const service = createVNextRoleGrantMutationReference({ db: auditTamper.db, resolver: auditTamper.resolver, now: () => NOW, idFactory: auditTamper.idFactory });
    const command = { type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'audit-tamper', reasonCode: 'reviewed' };
    service.execute(assertion, command);
    auditTamper.db.exec('DROP TRIGGER vNext_authorization_audit_events_no_update');
    auditTamper.db.prepare("UPDATE vNext_authorization_audit_events SET context_sha256=? WHERE receipt_id!='publication-receipt'").run('b'.repeat(64));
    auditTamper.db.exec("CREATE TRIGGER vNext_authorization_audit_events_no_update BEFORE UPDATE ON vNext_authorization_audit_events BEGIN SELECT RAISE(ABORT,'vNext audit is append-only'); END");
    assert.throws(() => service.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID');
  } finally { auditTamper.db.close(); }

  for (const [label, statement] of [
    ['missing audit', "DELETE FROM vNext_authorization_audit_events WHERE receipt_id!='publication-receipt'"],
    ['wrong audit reason', "UPDATE vNext_authorization_audit_events SET reason_code='forged' WHERE receipt_id!='publication-receipt'"],
    ['aggregate kind', "UPDATE vNext_authorization_outbox_events SET aggregate_kind='forged'"],
    ['payload hash', "UPDATE vNext_authorization_outbox_events SET payload_sha256='b' || substr(payload_sha256,2)"],
    ['aggregate version', 'UPDATE vNext_authorization_outbox_events SET aggregate_version=2'],
  ]) {
    const fixture = seed();
    try {
      const assertion = await fixture.actorBoundary.verify(null);
      const service = createVNextRoleGrantMutationReference({ db: fixture.db, resolver: fixture.resolver, now: () => NOW, idFactory: fixture.idFactory });
      const command = { type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: `tamper-${label}`, reasonCode: 'reviewed' };
      service.execute(assertion, command);
      const audit = label.includes('audit'); const trigger = audit ? 'vNext_authorization_audit_events' : 'vNext_authorization_outbox_events';
      fixture.db.exec(`DROP TRIGGER ${trigger}_no_${label === 'missing audit' ? 'delete' : 'update'}`);
      fixture.db.exec(statement);
      const operation = label === 'missing audit' ? 'DELETE' : 'UPDATE';
      const message = audit ? 'vNext audit is append-only' : 'vNext outbox event is append-only';
      fixture.db.exec(`CREATE TRIGGER ${trigger}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${trigger} BEGIN SELECT RAISE(ABORT,'${message}'); END`);
      assert.throws(() => service.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID', label);
    } finally { fixture.db.close(); }
  }

  const jointTamper = seed();
  try {
    const assertion = await jointTamper.actorBoundary.verify(null);
    const service = createVNextRoleGrantMutationReference({ db: jointTamper.db, resolver: jointTamper.resolver, now: () => NOW, idFactory: jointTamper.idFactory });
    const command = { type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'joint-tamper', reasonCode: 'reviewed' };
    service.execute(assertion, command);
    jointTamper.db.exec('DROP TRIGGER vNext_authorization_command_receipts_no_update; DROP TRIGGER vNext_authorization_outbox_events_no_update');
    jointTamper.db.prepare("UPDATE vNext_authorization_command_receipts SET committed_auth_version=99,committed_access_version=99 WHERE command_type='role.grant'").run();
    const payload = JSON.stringify({ accountId: 'target-1', accessVersion: 99, authVersion: 99, grantId: 'role-grant-1', role: 'teacher' });
    jointTamper.db.prepare("UPDATE vNext_authorization_outbox_events SET canonical_payload_json=?,payload_sha256=?").run(payload, HASH(payload));
    jointTamper.db.exec("CREATE TRIGGER vNext_authorization_command_receipts_no_update BEFORE UPDATE ON vNext_authorization_command_receipts BEGIN SELECT RAISE(ABORT,'vNext command receipt is append-only'); END; CREATE TRIGGER vNext_authorization_outbox_events_no_update BEFORE UPDATE ON vNext_authorization_outbox_events BEGIN SELECT RAISE(ABORT,'vNext outbox event is append-only'); END");
    assert.throws(() => service.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID');
  } finally { jointTamper.db.close(); }

  const targetTamper = seed();
  try {
    const assertion = await targetTamper.actorBoundary.verify(null);
    const service = createVNextRoleGrantMutationReference({ db: targetTamper.db, resolver: targetTamper.resolver, now: () => NOW, idFactory: targetTamper.idFactory });
    const command = { type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'target-tamper', reasonCode: 'reviewed' };
    service.execute(assertion, command);
    targetTamper.db.exec('DROP TRIGGER vNext_authorization_outbox_events_no_update');
    targetTamper.db.prepare("UPDATE vNext_role_grants SET account_id='actor-1' WHERE grant_id='role-grant-1'").run();
    const payload = JSON.stringify({ accountId: 'actor-1', accessVersion: 2, authVersion: 2, grantId: 'role-grant-1', role: 'teacher' });
    targetTamper.db.prepare('UPDATE vNext_authorization_outbox_events SET canonical_payload_json=?,payload_sha256=?').run(payload, HASH(payload));
    targetTamper.db.exec("CREATE TRIGGER vNext_authorization_outbox_events_no_update BEFORE UPDATE ON vNext_authorization_outbox_events BEGIN SELECT RAISE(ABORT,'vNext outbox event is append-only'); END");
    assert.throws(() => service.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID');
  } finally { targetTamper.db.close(); }

  for (const options of [{ reauth: false }, { surface: 'miniapp' }]) {
    const fixture = seed(options);
    try {
      const assertion = await fixture.actorBoundary.verify(null);
      const service = createVNextRoleGrantMutationReference({ db: fixture.db, resolver: fixture.resolver, now: () => NOW });
      assert.throws(() => service.execute(assertion, { type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: `deny-${options.surface || 'reauth'}`, reasonCode: 'test' }), error => error.code === 'AUTHORIZATION_DENIED');
    } finally { fixture.db.close(); }
  }

  for (const hookName of ['afterTarget', 'afterAccount', 'afterReceipt', 'afterAudit', 'afterOutbox']) {
    const fixture = seed();
    try {
      const assertion = await fixture.actorBoundary.verify(null);
      const service = createVNextRoleGrantMutationReference({ db: fixture.db, resolver: fixture.resolver, now: () => NOW, idFactory: fixture.idFactory, testHooks: { [hookName]() { throw new Error(`rollback-${hookName}`); } } });
      assert.throws(() => service.execute(assertion, { type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: `rollback-${hookName}`, reasonCode: 'test' }), new RegExp(`rollback-${hookName}`));
      assert.strictEqual(fixture.db.prepare('SELECT COUNT(*) AS count FROM vNext_role_grants WHERE account_id=?').get('target-1').count, 0);
      assert.strictEqual(fixture.db.prepare("SELECT auth_version FROM vNext_accounts WHERE account_id='target-1'").get().auth_version, 1);
      assert.strictEqual(fixture.db.prepare("SELECT COUNT(*) AS count FROM vNext_authorization_command_receipts WHERE command_type LIKE 'role.%'").get().count, 0);
    } finally { fixture.db.close(); }
  }

  const left = seed(); const right = seed();
  try {
    assert.throws(() => createVNextRoleGrantMutationReference({ db: right.db, resolver: left.resolver }), error => error.code === 'ROLE_MUTATION_CONFIGURATION_INVALID');
    assert.throws(() => createVNextRoleGrantMutationReference({ db: left.db, resolver: left.resolver, unexpected: true }), error => error.code === 'ROLE_MUTATION_CONFIGURATION_INVALID');
    const accessor = { db: left.db, resolver: left.resolver };
    Object.defineProperty(accessor, 'now', { enumerable: true, get() { return () => NOW; } });
    assert.throws(() => createVNextRoleGrantMutationReference(accessor), error => error.code === 'ROLE_MUTATION_CONFIGURATION_INVALID');
  } finally { left.db.close(); right.db.close(); }
  console.log('vNext role mutation reference checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
