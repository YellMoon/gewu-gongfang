'use strict';

const assert = require('assert');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { bootstrapVNextControlPlaneReference } = require('./vNextControlPlaneReferenceKernel');
const { createVNextTrustRootVerifierBoundaryReference } = require('./vNextTrustRootVerifierBoundaryReference');
const { createVNextEmergencyRecoveryReference } = require('./vNextEmergencyRecoveryReference');

const HASH = 'a'.repeat(64);
const NOW = '2026-08-14T00:00:00.000Z';
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const canonical = value => `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(',')}}`;

(async () => {
  const db = new Database(':memory:');
  try {
    bootstrapVNextControlPlaneReference(db);
    const verifier = createVNextTrustRootVerifierBoundaryReference({
      databaseBinding: db,
      verifyBootstrapPresentation: () => { throw new Error('unused'); },
      verifyRecoveryPresentation: presentation => ({ kind: 'owner_recovery_event', recoveryEventId: 'recovery-event-1', authorityId: 'authority-1', replacementAccountId: 'replacement-account-1', replacementDeviceId: 'replacement-device-1', replacementInstallationId: 'replacement-installation-1', replacementInstallationPublicKey: 'replacement-public-key-1', replacementInstallationKeyFingerprint: HASH, backupId: 'backup-1', backupManifestSha256: HASH, reasonCode: 'owner-lockout', expiresAt: '2026-08-14T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: HASH, ...(presentation || {}) }),
      now: () => NOW,
    });
    const writer = createVNextEmergencyRecoveryReference({ db, verifier, now: () => '2026-08-14T00:01:00.000Z', idFactory: prefix => `${prefix}-1` });
    const assertion = await verifier.verifyRecovery(null);
    const command = { type: 'authority.owner_recover', recoveryEventId: 'recovery-event-1', authorityId: 'authority-1', replacementAccountId: 'replacement-account-1', replacementDeviceId: 'replacement-device-1', replacementInstallationId: 'replacement-installation-1', replacementInstallationPublicKey: 'replacement-public-key-1', replacementInstallationKeyFingerprint: HASH, backupId: 'backup-1', backupManifestSha256: HASH, reasonCode: 'owner-lockout', idempotencyKey: 'recovery-key-1' };
    assert.throws(() => writer.execute(assertion, { ...command, extra: 'forged' }), error => error.code === 'RECOVERY_INPUT_INVALID');
    let getterReads = 0;
    const accessorCommand = { ...command }; Object.defineProperty(accessorCommand, 'reasonCode', { enumerable: true, get() { getterReads += 1; return command.reasonCode; } });
    assert.throws(() => writer.execute(assertion, accessorCommand), error => error.code === 'RECOVERY_INPUT_INVALID');
    assert.strictEqual(getterReads, 0, 'a recovery command must be copied from data descriptors without executing a getter');
    db.prepare("INSERT INTO vNext_authorities(authority_id,status,created_at,updated_at) VALUES(?,?,?,?)").run('authority-1', 'active', NOW, NOW);
    const noncanonicalClockWriter = createVNextEmergencyRecoveryReference({ db, verifier, now: () => '2026-08-14T00:01:00+00:00', idFactory: prefix => `${prefix}-clock` });
    assert.throws(() => noncanonicalClockWriter.execute(assertion, command), error => error.code === 'RECOVERY_INPUT_INVALID');
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM vNext_accounts WHERE authority_id='authority-1'").get().count, 0, 'a rejected clock value must create no recovery records');
    for (const [field, value] of Object.entries({ recoveryEventId: 'other-event', authorityId: 'other-authority', replacementAccountId: 'other-account', replacementDeviceId: 'other-device', replacementInstallationId: 'other-installation', replacementInstallationPublicKey: 'other-key', replacementInstallationKeyFingerprint: 'b'.repeat(64), backupId: 'other-backup', backupManifestSha256: 'b'.repeat(64), reasonCode: 'other-reason' })) {
      const mismatchedAssertion = await verifier.verifyRecovery({ [field]: value });
      assert.throws(() => writer.execute(mismatchedAssertion, command), error => error.code === 'RECOVERY_ASSERTION_MISMATCH', `${field} proof mismatch must fail before writes`);
      assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM vNext_accounts WHERE authority_id='authority-1'").get().count, 0, `${field} mismatch must leave no recovery account`);
    }
    const foreignBoundary = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: db, verifyBootstrapPresentation: () => { throw new Error('unused'); }, verifyRecoveryPresentation: () => ({ kind: 'owner_recovery_event', recoveryEventId: 'recovery-event-1', authorityId: 'authority-1', replacementAccountId: 'replacement-account-1', replacementDeviceId: 'replacement-device-1', replacementInstallationId: 'replacement-installation-1', replacementInstallationPublicKey: 'replacement-public-key-1', replacementInstallationKeyFingerprint: HASH, backupId: 'backup-1', backupManifestSha256: HASH, reasonCode: 'owner-lockout', expiresAt: '2026-08-14T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: HASH }), now: () => NOW });
    const foreignAssertion = await foreignBoundary.verifyRecovery(null);
    assert.throws(() => writer.execute(foreignAssertion, command), error => error.code === 'RECOVERY_ASSERTION_MISMATCH', 'an assertion branded by another boundary must fail closed');
    const expiredBoundary = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: db, verifyBootstrapPresentation: () => { throw new Error('unused'); }, verifyRecoveryPresentation: () => ({ kind: 'owner_recovery_event', recoveryEventId: 'recovery-event-1', authorityId: 'authority-1', replacementAccountId: 'replacement-account-1', replacementDeviceId: 'replacement-device-1', replacementInstallationId: 'replacement-installation-1', replacementInstallationPublicKey: 'replacement-public-key-1', replacementInstallationKeyFingerprint: HASH, backupId: 'backup-1', backupManifestSha256: HASH, reasonCode: 'owner-lockout', expiresAt: '2026-08-14T00:01:00.000Z', approvalVersion: 1, assertionEvidenceSha256: HASH }), now: () => NOW });
    const expiredWriter = createVNextEmergencyRecoveryReference({ db, verifier: expiredBoundary, now: () => '2026-08-14T00:01:00.000Z', idFactory: prefix => `${prefix}-expired` });
    const expiredAssertion = await expiredBoundary.verifyRecovery(null);
    assert.throws(() => expiredWriter.execute(expiredAssertion, command), error => error.code === 'RECOVERY_ASSERTION_MISMATCH', 'an assertion expiring at writer time must be rejected');
    db.prepare("INSERT INTO vNext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run('old-account-1', 'authority-1', 'active', 1, 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run('old-device-1', 'authority-1', 'active', 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('old-installation-1', 'authority-1', 'old-device-1', 'old-public-key', 'b'.repeat(64), 'active', 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('old-link-1', 'authority-1', 'old-account-1', 'old-device-1', 'old-installation-1', 'active', 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('old-super-admin-1', 'authority-1', 'old-account-1', 'super_admin', 'active', 1, 1, NOW, NOW, NOW);
    db.prepare("INSERT INTO vNext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run('old-account-2', 'authority-1', 'active', 1, 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run('old-device-2', 'authority-1', 'active', 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('old-installation-2', 'authority-1', 'old-device-2', 'old-public-key-2', 'c'.repeat(64), 'active', 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('old-link-2', 'authority-1', 'old-account-2', 'old-device-2', 'old-installation-2', 'active', 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('old-super-admin-2', 'authority-1', 'old-account-2', 'super_admin', 'active', 1, 1, NOW, NOW, NOW);
    db.prepare("INSERT INTO vNext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run('ordinary-account', 'authority-1', 'active', 1, 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run('ordinary-device', 'authority-1', 'active', 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('ordinary-installation', 'authority-1', 'ordinary-device', 'ordinary-public-key', 'd'.repeat(64), 'active', 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('ordinary-link', 'authority-1', 'ordinary-account', 'ordinary-device', 'ordinary-installation', 'active', 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('ordinary-teacher-grant', 'authority-1', 'ordinary-account', 'teacher', 'active', 1, 1, NOW, NOW, NOW);
    db.prepare("INSERT INTO vNext_profile_bindings(binding_id,authority_id,account_id,profile_type,profile_id,status,evidence_hash,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('ordinary-profile', 'authority-1', 'ordinary-account', 'teacher', 'profile-1', 'active', HASH, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_data_scope_grants(scope_grant_id,authority_id,account_id,scope_type,scope_value_hash,effect,status,starts_at,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('ordinary-scope', 'authority-1', 'ordinary-account', 'teacher_profile', HASH, 'allow', 'active', NOW, 1, NOW, NOW);
    db.exec('CREATE TABLE recovery_business_fixture (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO recovery_business_fixture(id,value) VALUES(?,?)').run('business-1', 'unchanged');
    const preserved = {
      role: db.prepare("SELECT * FROM vNext_role_grants WHERE grant_id='ordinary-teacher-grant'").get(),
      profile: db.prepare("SELECT * FROM vNext_profile_bindings WHERE binding_id='ordinary-profile'").get(),
      scope: db.prepare("SELECT * FROM vNext_data_scope_grants WHERE scope_grant_id='ordinary-scope'").get(),
      business: db.prepare('SELECT * FROM recovery_business_fixture WHERE id=?').get('business-1'),
    };
    db.prepare("INSERT INTO vNext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('old-session-1', 'authority-1', 'old-account-1', 'old-device-1', 'old-installation-1', 'old-link-1', 'online', 'active', NOW, '2026-08-14T01:00:00.000Z', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('old-session-2', 'authority-1', 'old-account-2', 'old-device-2', 'old-installation-2', 'old-link-2', 'online', 'active', NOW, '2026-08-14T01:00:00.000Z', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('ordinary-session', 'authority-1', 'ordinary-account', 'ordinary-device', 'ordinary-installation', 'ordinary-link', 'online', 'active', NOW, '2026-08-14T01:00:00.000Z', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, NOW, NOW);
    for (const failureStage of ['account', 'device', 'installation', 'link', 'old-grant', 'old-account', 'session', 'replacement-grant', 'receipt', 'evidence', 'audit', 'outbox']) {
      const failingWriter = createVNextEmergencyRecoveryReference({ db, verifier, now: () => '2026-08-14T00:01:00.000Z', idFactory: prefix => `${prefix}-${failureStage}`, testHooks: { afterWrite: ({ stage }) => { if (stage === failureStage) throw new Error('injected'); } } });
      assert.throws(() => failingWriter.execute(assertion, command), /injected/);
      assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM vNext_accounts WHERE authority_id='authority-1' AND account_id='replacement-account-1'").get().count, 0, `${failureStage} must roll back replacement account`);
      assert.strictEqual(db.prepare("SELECT status FROM vNext_role_grants WHERE grant_id='old-super-admin-1'").get().status, 'active', `${failureStage} must roll back old grant revocation`);
      assert.strictEqual(db.prepare("SELECT status FROM vNext_sessions WHERE session_id='old-session-1'").get().status, 'active', `${failureStage} must roll back old session revocation`);
    }
    for (const column of ['auth_version', 'access_version', 'revocation_version', 'row_version']) {
      const accountConflictWriter = createVNextEmergencyRecoveryReference({ db, verifier, now: () => '2026-08-14T00:01:00.000Z', idFactory: prefix => `${prefix}-${column}-conflict`, testHooks: { afterWrite: ({ stage }) => { if (stage === 'link') db.prepare(`UPDATE vNext_accounts SET ${column}=${column}+1 WHERE account_id='old-account-1'`).run(); } } });
      assert.throws(() => accountConflictWriter.execute(assertion, command), error => error.code === 'RECOVERY_CONFLICT', `${column} must be part of the captured account CAS vector`);
      assert.strictEqual(db.prepare(`SELECT ${column} AS value FROM vNext_accounts WHERE account_id='old-account-1'`).get().value, 1, `${column} conflict hook must roll back with the recovery transaction`);
    }
    let sessionConflictInjected = false;
    const sessionConflictWriter = createVNextEmergencyRecoveryReference({ db, verifier, now: () => '2026-08-14T00:01:00.000Z', idFactory: prefix => `${prefix}-session-conflict`, testHooks: { afterWrite: ({ stage }) => { if (stage === 'old-account' && !sessionConflictInjected) { sessionConflictInjected = true; db.prepare("UPDATE vNext_sessions SET status='revoked', revoked_at=?, updated_at=?, row_version=row_version+1 WHERE session_id='old-session-1'").run('2026-08-14T00:00:30.000Z', '2026-08-14T00:00:30.000Z'); } } } });
    assert.throws(() => sessionConflictWriter.execute(assertion, command), error => error.code === 'RECOVERY_CONFLICT', 'captured session versions must be CAS-protected');
    assert.strictEqual(db.prepare("SELECT row_version FROM vNext_sessions WHERE session_id='old-session-1'").get().row_version, 1, 'session conflict hook must roll back with the recovery transaction');
    db.prepare("INSERT INTO vNext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run('fingerprint-device', 'authority-1', 'active', 1, 1, 1, NOW, NOW);
    db.prepare("INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('fingerprint-installation', 'authority-1', 'fingerprint-device', 'other-public-key', HASH, 'active', 1, 1, NOW, NOW);
    assert.throws(() => writer.execute(assertion, command), error => error.code === 'RECOVERY_REPLACEMENT_EXISTS', 'an occupied replacement fingerprint must fail before any recovery write');
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM vNext_accounts WHERE authority_id='authority-1' AND account_id='replacement-account-1'").get().count, 0, 'fingerprint rejection must not leave a replacement account');
    db.prepare("DELETE FROM vNext_device_installations WHERE installation_id='fingerprint-installation'").run();
    db.prepare("DELETE FROM vNext_trusted_devices WHERE device_id='fingerprint-device'").run();
    assert.deepStrictEqual(writer.execute(assertion, command), { authorityId: 'authority-1', code: 'OWNER_RECOVERY_COMPLETED', replacementAccountId: 'replacement-account-1', replayed: false, status: 'accepted' });
    const receipt = db.prepare("SELECT * FROM vNext_authorization_command_receipts WHERE authority_id='authority-1' AND actor_key='recovery:recovery-event-1'").get();
    const evidence = db.prepare('SELECT * FROM vNext_trust_root_evidence WHERE receipt_id=?').get(receipt.receipt_id);
    const audit = db.prepare('SELECT * FROM vNext_authorization_audit_events WHERE receipt_id=?').get(receipt.receipt_id);
    const outbox = db.prepare('SELECT * FROM vNext_authorization_outbox_events WHERE receipt_id=?').get(receipt.receipt_id);
    assert.deepStrictEqual({ actor: receipt.actor_account_id, actorKey: receipt.actor_key, idempotencyKey: receipt.idempotency_key, command: receipt.command_type, target: receipt.target_id, outcome: receipt.outcome, code: receipt.result_code, result: receipt.canonical_result_json, resultHash: receipt.canonical_result_sha256 }, { actor: null, actorKey: 'recovery:recovery-event-1', idempotencyKey: 'recovery-key-1', command: command.type, target: command.authorityId, outcome: 'accepted', code: 'OWNER_RECOVERY_COMPLETED', result: '{"authorityId":"authority-1","code":"OWNER_RECOVERY_COMPLETED","replacementAccountId":"replacement-account-1","status":"accepted"}', resultHash: sha256('{"authorityId":"authority-1","code":"OWNER_RECOVERY_COMPLETED","replacementAccountId":"replacement-account-1","status":"accepted"}') });
    assert.deepStrictEqual({ kind: evidence.actor_kind, event: evidence.event_id, backup: evidence.backup_id, backupHash: evidence.backup_manifest_sha256, assertionHash: evidence.assertion_evidence_sha256 }, { kind: 'owner_recovery_event', event: command.recoveryEventId, backup: command.backupId, backupHash: command.backupManifestSha256, assertionHash: HASH });
    assert.strictEqual(audit.reason_code, command.reasonCode); assert.strictEqual(audit.context_sha256, sha256('{"authorityId":"authority-1","recoveryEventId":"recovery-event-1"}'));
    const payload = JSON.parse(outbox.canonical_payload_json);
    assert.deepStrictEqual({ type: outbox.event_type, kind: outbox.aggregate_kind, id: outbox.aggregate_id, version: outbox.aggregate_version }, { type: 'authorization.owner_recovered', kind: 'authority', id: 'authority-1', version: 1 });
    assert.strictEqual(outbox.payload_sha256, sha256(outbox.canonical_payload_json));
    assert.deepStrictEqual(payload, { authorityId: 'authority-1', recoveryEventSha256: sha256('recovery-event-1'), replacementAccountId: 'replacement-account-1', replacementDeviceId: 'replacement-device-1', replacementInstallationId: 'replacement-installation-1', replacementLinkId: 'recovery-link-1', revokedGrantCount: 2, revokedGrantIdsSha256: sha256(JSON.stringify(['old-super-admin-1', 'old-super-admin-2'])), revokedSessionCount: 3, revokedSessionIdsSha256: sha256(JSON.stringify(['old-session-1', 'old-session-2', 'ordinary-session'])) });
    const mutateAppendOnly = (table, trigger, sql, args, restore) => { const triggerSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger).sql; db.exec(`DROP TRIGGER ${trigger}`); db.prepare(sql).run(...args); db.exec(triggerSql); assert.throws(() => writer.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID', `${table} companion mismatch must fail closed after schema revalidation`); const restoreTriggerSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger).sql; db.exec(`DROP TRIGGER ${trigger}`); restore(); db.exec(restoreTriggerSql); };
    mutateAppendOnly('evidence', 'vNext_trust_root_evidence_no_update', "UPDATE vNext_trust_root_evidence SET backup_manifest_sha256=? WHERE evidence_id=?", ['b'.repeat(64), evidence.evidence_id], () => db.prepare("UPDATE vNext_trust_root_evidence SET backup_manifest_sha256=? WHERE evidence_id=?").run(HASH, evidence.evidence_id));
    mutateAppendOnly('audit', 'vNext_authorization_audit_events_no_update', "UPDATE vNext_authorization_audit_events SET context_sha256=? WHERE event_id=?", ['b'.repeat(64), audit.event_id], () => db.prepare("UPDATE vNext_authorization_audit_events SET context_sha256=? WHERE event_id=?").run(sha256('{\"authorityId\":\"authority-1\",\"recoveryEventId\":\"recovery-event-1\"}'), audit.event_id));
    const malformedPayload = canonical({ ...payload, extra: true });
    assert.strictEqual(malformedPayload, canonical(JSON.parse(malformedPayload)), 'malformed companion payload must remain canonical and hash-self-consistent');
    mutateAppendOnly('outbox', 'vNext_authorization_outbox_events_no_update', "UPDATE vNext_authorization_outbox_events SET canonical_payload_json=?, payload_sha256=? WHERE event_id=?", [malformedPayload, sha256(malformedPayload), outbox.event_id], () => db.prepare("UPDATE vNext_authorization_outbox_events SET canonical_payload_json=?, payload_sha256=? WHERE event_id=?").run(outbox.canonical_payload_json, outbox.payload_sha256, outbox.event_id));
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM vNext_role_grants WHERE authority_id='authority-1' AND role='super_admin' AND status='active'").get().count, 1);
    assert.strictEqual(db.prepare("SELECT status FROM vNext_role_grants WHERE grant_id='old-super-admin-1'").get().status, 'revoked');
    assert.strictEqual(db.prepare("SELECT status FROM vNext_role_grants WHERE grant_id='old-super-admin-2'").get().status, 'revoked');
    assert.strictEqual(db.prepare("SELECT status FROM vNext_sessions WHERE session_id='old-session-1'").get().status, 'revoked');
    assert.strictEqual(db.prepare("SELECT status FROM vNext_sessions WHERE session_id='old-session-2'").get().status, 'revoked');
    assert.strictEqual(db.prepare("SELECT status FROM vNext_sessions WHERE session_id='ordinary-session'").get().status, 'revoked');
    for (const accountId of ['old-account-1', 'old-account-2']) assert.deepStrictEqual(db.prepare('SELECT auth_version,access_version,revocation_version,row_version FROM vNext_accounts WHERE account_id=?').get(accountId), { auth_version: 2, access_version: 2, revocation_version: 2, row_version: 2 }, `${accountId} versions increment once`);
    assert.deepStrictEqual(db.prepare("SELECT auth_version,access_version,revocation_version,row_version FROM vNext_accounts WHERE account_id='ordinary-account'").get(), { auth_version: 1, access_version: 1, revocation_version: 1, row_version: 1 }, 'ordinary-only account versions must not change when its session is revoked');
    assert.deepStrictEqual({
      role: db.prepare("SELECT * FROM vNext_role_grants WHERE grant_id='ordinary-teacher-grant'").get(),
      profile: db.prepare("SELECT * FROM vNext_profile_bindings WHERE binding_id='ordinary-profile'").get(),
      scope: db.prepare("SELECT * FROM vNext_data_scope_grants WHERE scope_grant_id='ordinary-scope'").get(),
      business: db.prepare('SELECT * FROM recovery_business_fixture WHERE id=?').get('business-1'),
    }, preserved, 'ordinary role, profile, scope, and business data must remain byte-for-byte unchanged');
    assert.deepStrictEqual(writer.execute(assertion, command), { authorityId: 'authority-1', code: 'OWNER_RECOVERY_COMPLETED', replacementAccountId: 'replacement-account-1', replayed: true, status: 'accepted' });
    db.prepare("INSERT INTO vNext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('post-recovery-session', 'authority-1', 'replacement-account-1', 'replacement-device-1', 'replacement-installation-1', 'recovery-link-1', 'online', 'active', '2026-08-14T00:02:00.000Z', '2026-08-14T01:00:00.000Z', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, '2026-08-14T00:02:00.000Z', '2026-08-14T00:02:00.000Z');
    assert.deepStrictEqual(writer.execute(assertion, command), { authorityId: 'authority-1', code: 'OWNER_RECOVERY_COMPLETED', replacementAccountId: 'replacement-account-1', replayed: true, status: 'accepted' }, 'a later replacement-owner session must not invalidate an idempotent recovery retry');
    const changedReasonCommand = { ...command, reasonCode: 'different-owner-reason' };
    assert.throws(() => writer.execute({}, changedReasonCommand), error => error.code === 'RECOVERY_ASSERTION_MISMATCH', 'a fake assertion must never reveal an idempotency conflict');
    const changedReasonAssertion = await verifier.verifyRecovery({ reasonCode: 'different-owner-reason' });
    assert.throws(() => writer.execute(changedReasonAssertion, changedReasonCommand), error => error.code === 'IDEMPOTENCY_KEY_CONFLICT');
    assert.throws(() => writer.execute(assertion, { ...command, idempotencyKey: 'recovery-key-2' }), error => error.code === 'RECOVERY_EVENT_ALREADY_CONSUMED');
    db.prepare("UPDATE vNext_role_grants SET status='revoked', revoked_at=?, updated_at=?, row_version=row_version+1 WHERE authority_id=? AND account_id=? AND role='super_admin'").run('2026-08-14T00:02:00.000Z', '2026-08-14T00:02:00.000Z', 'authority-1', 'replacement-account-1');
    assert.throws(() => writer.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID', 'replay must prove that the replacement super-admin is still the sole active recovery grant');
    const zeroDb = new Database(':memory:');
    bootstrapVNextControlPlaneReference(zeroDb);
    zeroDb.prepare("INSERT INTO vNext_authorities(authority_id,status,created_at,updated_at) VALUES(?,?,?,?)").run('authority-2', 'active', NOW, NOW);
    const zeroGrantVerifier = createVNextTrustRootVerifierBoundaryReference({
      databaseBinding: zeroDb,
      verifyBootstrapPresentation: () => { throw new Error('unused'); },
      verifyRecoveryPresentation: () => ({ kind: 'owner_recovery_event', recoveryEventId: 'recovery-event-2', authorityId: 'authority-2', replacementAccountId: 'replacement-account-2', replacementDeviceId: 'replacement-device-2', replacementInstallationId: 'replacement-installation-2', replacementInstallationPublicKey: 'replacement-public-key-2', replacementInstallationKeyFingerprint: 'b'.repeat(64), backupId: 'backup-2', backupManifestSha256: 'b'.repeat(64), reasonCode: 'owner-lockout', expiresAt: '2026-08-14T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: 'b'.repeat(64) }),
      now: () => NOW,
    });
    const zeroGrantWriter = createVNextEmergencyRecoveryReference({ db: zeroDb, verifier: zeroGrantVerifier, now: () => '2026-08-14T00:01:00.000Z', idFactory: prefix => `${prefix}-2` });
    const zeroGrantAssertion = await zeroGrantVerifier.verifyRecovery(null);
    const zeroGrantCommand = { type: 'authority.owner_recover', recoveryEventId: 'recovery-event-2', authorityId: 'authority-2', replacementAccountId: 'replacement-account-2', replacementDeviceId: 'replacement-device-2', replacementInstallationId: 'replacement-installation-2', replacementInstallationPublicKey: 'replacement-public-key-2', replacementInstallationKeyFingerprint: 'b'.repeat(64), backupId: 'backup-2', backupManifestSha256: 'b'.repeat(64), reasonCode: 'owner-lockout', idempotencyKey: 'recovery-key-2' };
    assert.deepStrictEqual(zeroGrantWriter.execute(zeroGrantAssertion, zeroGrantCommand), { authorityId: 'authority-2', code: 'OWNER_RECOVERY_COMPLETED', replacementAccountId: 'replacement-account-2', replayed: false, status: 'accepted' }, 'a lockout with zero prior super-admin grants must recover to exactly one new owner');
    assert.strictEqual(zeroDb.prepare('SELECT COUNT(*) AS count FROM vNext_authorities').get().count, 1, 'zero-grant recovery fixture must have exactly one authority');
    assert.strictEqual(zeroDb.prepare("SELECT COUNT(*) AS count FROM vNext_role_grants WHERE authority_id='authority-2' AND role='super_admin' AND status='active'").get().count, 1);
    for (const table of ['vNext_authorization_command_receipts', 'vNext_trust_root_evidence', 'vNext_authorization_audit_events', 'vNext_authorization_outbox_events']) assert.strictEqual(zeroDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1, table);
    zeroDb.close();
  } finally { db.close(); }
  console.log('vNext emergency recovery reference checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
