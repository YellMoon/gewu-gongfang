'use strict';

const assert = require('assert');
const crypto = require('node:crypto');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createVNextTrustRootVerifierBoundaryReference } = require('../vNextTrustRootVerifierBoundaryReference');
const { createVNextPg17FirstAuthorityBootstrapMutation } = require('./firstAuthorityBootstrapMutation');
const { createVNextPg17EmergencyRecoveryMutation } = require('./emergencyRecoveryMutation');

const NOW = '2026-08-15T00:00:00.000Z';
const RECOVERY_NOW = '2026-08-15T00:00:01.000Z';
const HASH = 'a'.repeat(64);
const SESSION_EXPIRES_AT = '2026-08-15T01:00:00.000Z';

function policyManifest() {
  return { contractVersion: 1, capabilities: [
    { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
  ], roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'user.review'], teacher: [], student: [] } };
}

async function fixture(runtime, { afterWrite = null, boundaryNow = RECOVERY_NOW, writerNow = RECOVERY_NOW, proofExpiresAt = '2026-08-15T00:04:00.000Z' } = {}) {
  const handle = await runtime.createIsolatedHandle();
  const catalog = createVNextPg17CatalogBoundary(runtime);
  await catalog.apply(handle, { appliedAt: NOW, appliedBy: 'recovery-test' });
  const manifest = policyManifest();
  const policy = require('../vNextAuthorizationPolicyReference');
  const policyHash = crypto.createHash('sha256').update(policy.canonicalizePolicyManifest(manifest), 'utf8').digest('hex');
  const bootstrapCommand = { type: 'authority.bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'old-account-1', deviceId: 'old-device-1', installationId: 'old-installation-1', installationPublicKey: 'old-public-key-1', installationKeyFingerprint: HASH, policyManifest: manifest, idempotencyKey: 'bootstrap-key-1', reasonCode: 'initial-owner-bootstrap' };
  const bootstrapBoundary = createVNextTrustRootVerifierBoundaryReference({
    databaseBinding: handle,
    verifyBootstrapPresentation: () => ({ kind: 'deployment_bootstrap', bootstrapIntentId: bootstrapCommand.bootstrapIntentId, authorityId: bootstrapCommand.authorityId, accountId: bootstrapCommand.accountId, deviceId: bootstrapCommand.deviceId, installationId: bootstrapCommand.installationId, installationPublicKey: bootstrapCommand.installationPublicKey, installationKeyFingerprint: bootstrapCommand.installationKeyFingerprint, policyManifestSha256: policyHash, expiresAt: '2026-08-15T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: 'b'.repeat(64) }),
    verifyRecoveryPresentation: () => { throw new Error('unused'); }, now: () => NOW,
  });
  const bootstrapAssertion = await bootstrapBoundary.verifyBootstrap(null);
  const bootstrap = createVNextPg17FirstAuthorityBootstrapMutation({ runtime, handle, verifierBoundary: bootstrapBoundary, now: () => NOW, idFactory: kind => `bootstrap-${kind}` });
  await bootstrap.execute(bootstrapAssertion, bootstrapCommand);
  const command = { type: 'authority.owner_recover', recoveryEventId: 'recovery-event-1', authorityId: 'authority-1', replacementAccountId: 'replacement-account-1', replacementDeviceId: 'replacement-device-1', replacementInstallationId: 'replacement-installation-1', replacementInstallationPublicKey: 'replacement-public-key-1', replacementInstallationKeyFingerprint: 'c'.repeat(64), backupId: 'backup-1', backupManifestSha256: 'd'.repeat(64), reasonCode: 'owner-lockout', idempotencyKey: 'recovery-key-1' };
  const recoveryProof = { kind: 'owner_recovery_event', recoveryEventId: command.recoveryEventId, authorityId: command.authorityId, replacementAccountId: command.replacementAccountId, replacementDeviceId: command.replacementDeviceId, replacementInstallationId: command.replacementInstallationId, replacementInstallationPublicKey: command.replacementInstallationPublicKey, replacementInstallationKeyFingerprint: command.replacementInstallationKeyFingerprint, backupId: command.backupId, backupManifestSha256: command.backupManifestSha256, reasonCode: command.reasonCode, expiresAt: proofExpiresAt, approvalVersion: 1, assertionEvidenceSha256: 'e'.repeat(64) };
  const recoveryBoundary = createVNextTrustRootVerifierBoundaryReference({
    databaseBinding: handle,
    verifyBootstrapPresentation: () => { throw new Error('unused'); },
    verifyRecoveryPresentation: () => recoveryProof, now: () => boundaryNow,
  });
  const assertion = await recoveryBoundary.verifyRecovery(null);
  const writerConfig = { runtime, handle, verifierBoundary: recoveryBoundary, now: () => writerNow, idFactory: kind => `recovery-${kind}` };
  if (afterWrite) writerConfig.testHooks = { afterWrite };
  const writer = createVNextPg17EmergencyRecoveryMutation(writerConfig);
  return { handle, command, assertion, writer, recoveryBoundary, setRecoveryProof: patch => Object.assign(recoveryProof, patch) };
}

async function expectCode(action, code) {
  await assert.rejects(action, error => error && error.code === code);
}

async function assertRollbackBaseline(handle) {
  await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
    const rows = await facade.query("SELECT (SELECT count(*)::text FROM vnext_control_plane.vnext_accounts WHERE account_id='replacement-account-1') AS replacement_accounts, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_command_receipts WHERE actor_key='recovery:recovery-event-1') AS recovery_receipts, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_audit_events WHERE reason_code='owner-lockout') AS recovery_audits, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_outbox_events WHERE event_type='authorization.owner_recovered') AS recovery_outbox, (SELECT count(*)::text FROM vnext_control_plane.vnext_role_grants WHERE grant_id='bootstrap-bootstrap-grant' AND status='active' AND grant_version=1 AND row_version=1) AS old_grant, (SELECT count(*)::text FROM vnext_control_plane.vnext_sessions WHERE session_id='old-session-1' AND status='active' AND row_version=1) AS old_session");
    assert.deepStrictEqual(rows.rows, [{ replacement_accounts: '0', recovery_receipts: '0', recovery_audits: '0', recovery_outbox: '0', old_grant: '1', old_session: '1' }]);
  });
}

async function assertCompanionTamperRejected(runtime, { table, trigger, mutation, values }) {
  const current = await fixture(runtime);
  try {
    await insertOldActiveSession(current.handle);
    await current.writer.execute(current.assertion, current.command);
    await withVNextPg17SyntheticQuery(current.handle, 'fixture-provisioner', async facade => {
      await facade.query(`ALTER TABLE vnext_control_plane.${table} DISABLE TRIGGER ${trigger}`);
      try {
        await facade.query(mutation, values);
      } finally {
        await facade.query(`ALTER TABLE vnext_control_plane.${table} ENABLE TRIGGER ${trigger}`);
      }
    });
    await expectCode(() => current.writer.execute(current.assertion, current.command), 'IDEMPOTENCY_RECEIPT_INVALID');
  } finally {
    await runtime.disposeHandle(current.handle);
  }
}

async function insertOldActiveSession(handle, {
  sessionId = 'old-session-1', accountId = 'old-account-1', deviceId = 'old-device-1', installationId = 'old-installation-1', linkId = 'bootstrap-bootstrap-link',
} = {}) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
    'INSERT INTO vnext_control_plane.vnext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,revoked_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,1,1,1,1,1,1,1,1,1,1,$9,$9)',
    [sessionId, 'authority-1', accountId, deviceId, installationId, linkId, 'online', 'active', NOW, SESSION_EXPIRES_AT],
  ));
}

async function insertSecondOldAdministrator(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    await facade.query('INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES($1,$2,$3,1,1,1,1,$4,$4)', ['old-account-2', 'authority-1', 'active', NOW]);
    await facade.query('INSERT INTO vnext_control_plane.vnext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,1,1,1,$4,$4,NULL)', ['old-device-2', 'authority-1', 'active', NOW]);
    await facade.query('INSERT INTO vnext_control_plane.vnext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,1,1,$7,$7,NULL)', ['old-installation-2', 'authority-1', 'old-device-2', 'old-public-key-2', 'f'.repeat(64), 'active', NOW]);
    await facade.query('INSERT INTO vnext_control_plane.vnext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,1,1,1,$7,$7,NULL)', ['old-link-2', 'authority-1', 'old-account-2', 'old-device-2', 'old-installation-2', 'active', NOW]);
    await facade.query('INSERT INTO vnext_control_plane.vnext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,ends_at,revoked_at,granted_by_account_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,1,$6,NULL,NULL,NULL,$6,$6)', ['old-grant-2', 'authority-1', 'old-account-2', 'super_admin', 'active', NOW]);
  });
  await insertOldActiveSession(handle, { sessionId: 'old-session-2', accountId: 'old-account-2', deviceId: 'old-device-2', installationId: 'old-installation-2', linkId: 'old-link-2' });
}

async function insertOrdinaryAccountSession(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    await facade.query('INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES($1,$2,$3,1,1,1,1,$4,$4)', ['ordinary-account-1', 'authority-1', 'active', NOW]);
    await facade.query('INSERT INTO vnext_control_plane.vnext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,1,1,1,$4,$4,NULL)', ['ordinary-device-1', 'authority-1', 'active', NOW]);
    await facade.query('INSERT INTO vnext_control_plane.vnext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,1,1,$7,$7,NULL)', ['ordinary-installation-1', 'authority-1', 'ordinary-device-1', 'ordinary-public-key-1', '1'.repeat(64), 'active', NOW]);
    await facade.query('INSERT INTO vnext_control_plane.vnext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,1,1,1,$7,$7,NULL)', ['ordinary-link-1', 'authority-1', 'ordinary-account-1', 'ordinary-device-1', 'ordinary-installation-1', 'active', NOW]);
    await facade.query('INSERT INTO vnext_control_plane.vnext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,ends_at,revoked_at,granted_by_account_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,1,$6,NULL,NULL,NULL,$6,$6)', ['ordinary-teacher-grant-1', 'authority-1', 'ordinary-account-1', 'teacher', 'active', NOW]);
    await facade.query('INSERT INTO vnext_control_plane.vnext_profile_bindings(binding_id,authority_id,account_id,profile_type,profile_id,status,evidence_hash,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8,NULL)', ['ordinary-profile-binding-1', 'authority-1', 'ordinary-account-1', 'teacher', 'ordinary-profile-1', 'active', 'ordinary-evidence-1', NOW]);
    await facade.query('INSERT INTO vnext_control_plane.vnext_data_scope_grants(scope_grant_id,authority_id,account_id,scope_type,scope_value_hash,effect,status,starts_at,ends_at,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,1,$8,$8,NULL)', ['ordinary-scope-grant-1', 'authority-1', 'ordinary-account-1', 'teacher_profile', 'ordinary-scope-value-1', 'allow', 'active', NOW]);
  });
  await insertOldActiveSession(handle, { sessionId: 'ordinary-session-1', accountId: 'ordinary-account-1', deviceId: 'ordinary-device-1', installationId: 'ordinary-installation-1', linkId: 'ordinary-link-1' });
}

async function runEmergencyRecoveryMutationCases(runtime) {
  const current = await fixture(runtime);
  try {
    await insertOldActiveSession(current.handle);
    await insertSecondOldAdministrator(current.handle);
    await insertOrdinaryAccountSession(current.handle);
    assert.deepStrictEqual(await current.writer.execute(current.assertion, current.command), { authorityId: 'authority-1', code: 'OWNER_RECOVERY_COMPLETED', replacementAccountId: 'replacement-account-1', replayed: false, status: 'accepted' });
    assert.deepStrictEqual(await current.writer.execute(current.assertion, current.command), { authorityId: 'authority-1', code: 'OWNER_RECOVERY_COMPLETED', replacementAccountId: 'replacement-account-1', replayed: true, status: 'accepted' });
    current.setRecoveryProof({ reasonCode: 'changed-owner-reason' });
    const changedAssertion = await current.recoveryBoundary.verifyRecovery(null);
    await expectCode(() => current.writer.execute(changedAssertion, { ...current.command, reasonCode: 'changed-owner-reason' }), 'IDEMPOTENCY_KEY_CONFLICT');
    await expectCode(() => current.writer.execute(current.assertion, { ...current.command, idempotencyKey: 'recovery-key-2' }), 'RECOVERY_EVENT_ALREADY_CONSUMED');
    await withVNextPg17SyntheticQuery(current.handle, 'verifier', async facade => {
      const rows = await facade.query("SELECT (SELECT count(*)::text FROM vnext_control_plane.vnext_authorities) AS authorities, (SELECT count(*)::text FROM vnext_control_plane.vnext_bootstrap_consumptions) AS markers, (SELECT count(*)::text FROM vnext_control_plane.vnext_role_grants WHERE authority_id='authority-1' AND role='super_admin' AND status='active') AS active_admins, (SELECT count(*)::text FROM vnext_control_plane.vnext_sessions WHERE authority_id='authority-1' AND status='active') AS active_sessions, (SELECT count(*)::text FROM vnext_control_plane.vnext_trust_root_evidence WHERE actor_kind='owner_recovery_event') AS evidence");
      assert.deepStrictEqual(rows.rows, [{ authorities: '1', markers: '1', active_admins: '1', active_sessions: '0', evidence: '1' }]);
      const accounts = await facade.query("SELECT account_id || ':' || auth_version::text || ':' || access_version::text || ':' || revocation_version::text || ':' || row_version::text AS state FROM vnext_control_plane.vnext_accounts WHERE account_id IN ('old-account-1','old-account-2') ORDER BY account_id");
      assert.deepStrictEqual(accounts.rows, [{ state: 'old-account-1:2:2:2:2' }, { state: 'old-account-2:2:2:2:2' }]);
      const grants = await facade.query("SELECT grant_id || ':' || status || ':' || grant_version::text || ':' || row_version::text AS state FROM vnext_control_plane.vnext_role_grants WHERE grant_id IN ('bootstrap-bootstrap-grant','old-grant-2') ORDER BY grant_id");
      assert.deepStrictEqual(grants.rows, [{ state: 'bootstrap-bootstrap-grant:revoked:2:2' }, { state: 'old-grant-2:revoked:2:2' }]);
      const sessions = await facade.query("SELECT session_id || ':' || status || ':' || row_version::text || ':' || to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS state FROM vnext_control_plane.vnext_sessions WHERE session_id IN ('old-session-1','old-session-2') ORDER BY session_id");
      assert.deepStrictEqual(sessions.rows, [{ state: 'old-session-1:revoked:2:2026-08-15T00:00:01.000Z' }, { state: 'old-session-2:revoked:2:2026-08-15T00:00:01.000Z' }]);
      const ordinary = await facade.query("SELECT (SELECT auth_version || ':' || access_version || ':' || revocation_version || ':' || row_version FROM vnext_control_plane.vnext_accounts WHERE account_id='ordinary-account-1') AS account_state, (SELECT status || ':' || grant_version::text || ':' || row_version::text FROM vnext_control_plane.vnext_role_grants WHERE grant_id='ordinary-teacher-grant-1') AS role_state, (SELECT status || ':' || row_version::text FROM vnext_control_plane.vnext_profile_bindings WHERE binding_id='ordinary-profile-binding-1') AS profile_state, (SELECT status || ':' || row_version::text FROM vnext_control_plane.vnext_data_scope_grants WHERE scope_grant_id='ordinary-scope-grant-1') AS scope_state, (SELECT status || ':' || row_version::text FROM vnext_control_plane.vnext_sessions WHERE session_id='ordinary-session-1') AS session_state");
      assert.deepStrictEqual(ordinary.rows, [{ account_state: '1:1:1:1', role_state: 'active:1:1', profile_state: 'active:1', scope_state: 'active:1', session_state: 'revoked:2' }]);
    });
  } finally {
    await runtime.disposeHandle(current.handle);
  }

  const zeroAdmin = await fixture(runtime);
  try {
    await withVNextPg17SyntheticQuery(zeroAdmin.handle, 'fixture-provisioner', facade => facade.query("UPDATE vnext_control_plane.vnext_role_grants SET status='revoked', grant_version=2, row_version=2, revoked_at=$1, updated_at=$1 WHERE grant_id='bootstrap-bootstrap-grant'", ['2026-08-15T00:00:00.500Z']));
    assert.deepStrictEqual(await zeroAdmin.writer.execute(zeroAdmin.assertion, zeroAdmin.command), { authorityId: 'authority-1', code: 'OWNER_RECOVERY_COMPLETED', replacementAccountId: 'replacement-account-1', replayed: false, status: 'accepted' });
    await withVNextPg17SyntheticQuery(zeroAdmin.handle, 'verifier', async facade => {
      const rows = await facade.query("SELECT account_id || ':' || role || ':' || status || ':' || COALESCE(granted_by_account_id, 'NULL') AS state FROM vnext_control_plane.vnext_role_grants WHERE authority_id='authority-1' AND status='active' ORDER BY grant_id");
      assert.deepStrictEqual(rows.rows, [{ state: 'replacement-account-1:super_admin:active:NULL' }]);
    });
  } finally {
    await runtime.disposeHandle(zeroAdmin.handle);
  }

  for (const failedStage of ['account', 'device', 'installation', 'link', 'old-grant', 'old-account', 'session', 'replacement-grant', 'receipt', 'evidence', 'audit', 'outbox']) {
    const rollback = await fixture(runtime, { afterWrite: ({ stage }) => { if (stage === failedStage) throw new Error(`fail-${failedStage}`); } });
    try {
      await insertOldActiveSession(rollback.handle);
      await expectCode(() => rollback.writer.execute(rollback.assertion, rollback.command), 'RECOVERY_UNAVAILABLE');
      await assertRollbackBaseline(rollback.handle);
    } finally {
      await runtime.disposeHandle(rollback.handle);
    }
  }

  const rejected = await fixture(runtime);
  try {
    await insertOldActiveSession(rejected.handle);
    await expectCode(() => rejected.writer.execute({}, rejected.command), 'RECOVERY_ASSERTION_MISMATCH');
    await assertRollbackBaseline(rejected.handle);
    await expectCode(() => rejected.writer.execute(rejected.assertion, { ...rejected.command, reasonCode: 'different-owner-reason' }), 'RECOVERY_ASSERTION_MISMATCH');
    await assertRollbackBaseline(rejected.handle);
  } finally {
    await runtime.disposeHandle(rejected.handle);
  }

  const expired = await fixture(runtime, { writerNow: '2026-08-15T00:04:00.000Z' });
  try {
    await insertOldActiveSession(expired.handle);
    await expectCode(() => expired.writer.execute(expired.assertion, expired.command), 'RECOVERY_ASSERTION_MISMATCH');
    await assertRollbackBaseline(expired.handle);
  } finally {
    await runtime.disposeHandle(expired.handle);
  }

  await assertCompanionTamperRejected(runtime, {
    table: 'vnext_trust_root_evidence', trigger: 'vnext_trust_root_evidence_no_update',
    mutation: "UPDATE vnext_control_plane.vnext_trust_root_evidence SET backup_manifest_sha256=$1 WHERE actor_kind='owner_recovery_event'", values: ['f'.repeat(64)],
  });
  await assertCompanionTamperRejected(runtime, {
    table: 'vnext_authorization_audit_events', trigger: 'vnext_authorization_audit_events_no_update',
    mutation: "UPDATE vnext_control_plane.vnext_authorization_audit_events SET context_sha256=$1 WHERE reason_code='owner-lockout'", values: ['f'.repeat(64)],
  });
  await assertCompanionTamperRejected(runtime, {
    table: 'vnext_authorization_outbox_events', trigger: 'vnext_authorization_outbox_events_no_update',
    mutation: "UPDATE vnext_control_plane.vnext_authorization_outbox_events SET canonical_payload_json=$1, payload_sha256=$2 WHERE event_type='authorization.owner_recovered'", values: ['{}', crypto.createHash('sha256').update('{}', 'utf8').digest('hex')],
  });
}

if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  runtime.start().then(() => runEmergencyRecoveryMutationCases(runtime)).then(() => process.stdout.write('vNext PG17 emergency recovery mutation checks passed\n')).finally(() => runtime.stop()).catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}

module.exports = { runEmergencyRecoveryMutationCases };
