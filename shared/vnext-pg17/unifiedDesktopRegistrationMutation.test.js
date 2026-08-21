'use strict';

const assert = require('assert');
const { createHash } = require('node:crypto');
const {
  createDisposablePg17Runtime,
  withVNextPg17SyntheticQuery,
  issueVNextPg17OnlineIdentityAssertion,
  registerVNextPg17UnifiedDesktopOnline,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createUnifiedDesktopRegistrationEvidence } = require('./unifiedDesktopRegistrationEvidence');

const AT = new Date().toISOString();
const LATER = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const SESSION_END = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
const hash = character => character.repeat(64);

async function runUnifiedDesktopRegistrationMutationCases(runtime) {
  const ownedRuntime = !runtime;
  const activeRuntime = runtime || createDisposablePg17Runtime();
  if (ownedRuntime) await activeRuntime.start();
  const handle = await activeRuntime.createIsolatedHandle();
  let peerHandle;
  const catalog = createVNextPg17CatalogBoundary(activeRuntime);
  try {
    await catalog.apply(handle, { appliedAt: AT, appliedBy: 'unified-desktop-test' });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query("INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES('authority-1','active',$1,$1)", [AT]);
      await facade.query("INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('account-1','authority-1','active',2,3,4,1,$1,$1)", [AT]);
    });
    const assertion = {
      assertionId: 'assertion-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', keyFingerprint: hash('a'), audience: 'unified-desktop', nonceSha256: hash('b'), canonicalRequestSha256: hash('c'), identityProofSha256: hash('d'), hardwareEvidenceSha256: hash('e'), issuedAt: AT, expiresAt: LATER,
    };
    await assert.rejects(() => issueVNextPg17OnlineIdentityAssertion(activeRuntime, handle, { ...assertion, assertionId: 'assertion-wrong-audience', audience: 'mobile-app', nonceSha256: hash('0') }));
    await issueVNextPg17OnlineIdentityAssertion(activeRuntime, handle, assertion);
    await assert.rejects(() => issueVNextPg17OnlineIdentityAssertion(activeRuntime, handle, { ...assertion, assertionId: 'assertion-repeated-nonce' }));
    const registration = Object.assign({
      assertionId: 'assertion-1', idempotencyKey: 'idempotency-1', receiptId: 'receipt-1', auditEventId: 'audit-1', outboxEventId: 'outbox-1', sessionId: 'session-1', linkId: 'link-1', sessionExpiresAt: SESSION_END,
    }, createUnifiedDesktopRegistrationEvidence({ sessionId: 'session-1' }));
    assert.deepStrictEqual(await registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, registration), { receiptId: 'receipt-1', sessionId: 'session-1', replayed: false });
    assert.deepStrictEqual(await registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, registration), { receiptId: 'receipt-1', sessionId: 'session-1', replayed: true });
    await assert.rejects(() => registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, { ...registration, idempotencyKey: 'idempotency-consumed' }));
    await issueVNextPg17OnlineIdentityAssertion(activeRuntime, handle, { ...assertion, assertionId: 'assertion-2', nonceSha256: hash('9') });
    assert.deepStrictEqual(await registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, { ...registration, assertionId: 'assertion-2' }), { receiptId: 'receipt-1', sessionId: 'session-1', replayed: true });
    await issueVNextPg17OnlineIdentityAssertion(activeRuntime, handle, { ...assertion, assertionId: 'assertion-concurrent', nonceSha256: hash('8') });
    peerHandle = await activeRuntime.createPeerHandle(handle);
    const concurrentRegistration = { ...registration, assertionId: 'assertion-concurrent', idempotencyKey: 'idempotency-concurrent', receiptId: 'receipt-concurrent', auditEventId: 'audit-concurrent', outboxEventId: 'outbox-concurrent', sessionId: 'session-concurrent', linkId: 'link-concurrent', canonicalResultJson: '{"sessionId":"session-concurrent"}', canonicalPayloadJson: '{"sessionId":"session-concurrent"}' };
    const concurrentResults = await Promise.all([
      registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, concurrentRegistration),
      registerVNextPg17UnifiedDesktopOnline(activeRuntime, peerHandle, concurrentRegistration),
    ]);
    assert.deepStrictEqual(concurrentResults.sort((left, right) => Number(left.replayed) - Number(right.replayed)), [
      { receiptId: 'receipt-concurrent', sessionId: 'session-concurrent', replayed: false },
      { receiptId: 'receipt-concurrent', sessionId: 'session-concurrent', replayed: true },
    ]);
    await issueVNextPg17OnlineIdentityAssertion(activeRuntime, handle, { ...assertion, assertionId: 'assertion-version-changed', nonceSha256: hash('7') });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
      'UPDATE vnext_control_plane.vnext_accounts SET revocation_version = 5, updated_at = $1 WHERE account_id = \'account-1\'', [AT],
    ));
    await assert.rejects(() => registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, { ...registration, assertionId: 'assertion-version-changed', idempotencyKey: 'idempotency-version-changed', receiptId: 'receipt-version-changed', auditEventId: 'audit-version-changed', outboxEventId: 'outbox-version-changed', sessionId: 'session-version-changed', linkId: 'link-version-changed', canonicalResultJson: '{"sessionId":"session-version-changed"}', canonicalPayloadJson: '{"sessionId":"session-version-changed"}' }));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
      "INSERT INTO vnext_control_plane.vnext_online_identity_assertions(assertion_id,authority_id,account_id,account_auth_version,account_access_version,account_revocation_version,device_id,installation_id,installation_public_key,key_fingerprint,audience,nonce_sha256,canonical_request_sha256,identity_proof_sha256,hardware_evidence_sha256,issued_at,expires_at,created_at) VALUES('assertion-expired','authority-1','account-1',2,3,4,'expired-device','expired-installation','expired-key',$1,'unified-desktop',$2,$3,$4,$5,transaction_timestamp() - interval '2 minutes',transaction_timestamp() - interval '1 minute',transaction_timestamp() - interval '2 minutes')",
        [hash('0'), hash('1'), hash('2'), hash('3'), hash('4')],
      ));
    await assert.rejects(() => registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, Object.assign({ ...registration, assertionId: 'assertion-expired', idempotencyKey: 'idempotency-expired', receiptId: 'receipt-expired', auditEventId: 'audit-expired', outboxEventId: 'outbox-expired', sessionId: 'session-expired', linkId: 'link-expired' }, createUnifiedDesktopRegistrationEvidence({ sessionId: 'session-expired' }))));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query("INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('account-2','authority-1','active',1,1,1,1,$1,$1)", [AT]);
    });
    await issueVNextPg17OnlineIdentityAssertion(activeRuntime, handle, { ...assertion, assertionId: 'assertion-cross-account', accountId: 'account-2', nonceSha256: hash('2') });
    assert.deepStrictEqual(await registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, Object.assign({ ...registration, assertionId: 'assertion-cross-account', idempotencyKey: 'idempotency-cross-account', receiptId: 'receipt-cross-account', auditEventId: 'audit-cross-account', outboxEventId: 'outbox-cross-account', sessionId: 'session-cross-account', linkId: 'link-cross-account' }, createUnifiedDesktopRegistrationEvidence({ sessionId: 'session-cross-account' }))), { receiptId: 'receipt-cross-account', sessionId: 'session-cross-account', replayed: false });
    await issueVNextPg17OnlineIdentityAssertion(activeRuntime, handle, { ...assertion, assertionId: 'assertion-revoked-parent', accountId: 'account-2', deviceId: 'device-3', installationId: 'installation-3', installationPublicKey: 'public-key-3', keyFingerprint: hash('3'), nonceSha256: hash('4') });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
      'UPDATE vnext_control_plane.vnext_accounts SET status = \'revoked\', updated_at = $1 WHERE account_id = \'account-2\'', [AT],
    ));
    await assert.rejects(() => registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, { ...registration, assertionId: 'assertion-revoked-parent', idempotencyKey: 'idempotency-revoked-parent', receiptId: 'receipt-revoked-parent', auditEventId: 'audit-revoked-parent', outboxEventId: 'outbox-revoked-parent', sessionId: 'session-revoked-parent', linkId: 'link-revoked-parent', canonicalResultJson: '{"sessionId":"session-revoked-parent"}', canonicalPayloadJson: '{"sessionId":"session-revoked-parent"}' }));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const counts = await facade.query("SELECT (SELECT count(*)::text FROM vnext_control_plane.vnext_trusted_devices) AS devices, (SELECT count(*)::text FROM vnext_control_plane.vnext_device_installations) AS installations, (SELECT count(*)::text FROM vnext_control_plane.vnext_account_device_links) AS links, (SELECT count(*)::text FROM vnext_control_plane.vnext_sessions) AS sessions, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_command_receipts) AS receipts, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_audit_events) AS audits, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_outbox_events) AS outbox, (SELECT count(*)::text FROM vnext_control_plane.vnext_online_identity_assertion_consumptions) AS consumptions");
      assert.deepStrictEqual(counts.rows, [{ devices: '1', installations: '1', links: '2', sessions: '3', receipts: '3', audits: '3', outbox: '3', consumptions: '4' }]);
      const receipt = await facade.query("SELECT committed_auth_version::text AS auth, committed_access_version::text AS access, committed_revocation_version::text AS revocation FROM vnext_control_plane.vnext_authorization_command_receipts WHERE receipt_id = 'receipt-1'");
      assert.deepStrictEqual(receipt.rows, [{ auth: '2', access: '3', revocation: '4' }]);
      const evidenceRows = await facade.query("SELECT r.canonical_result_json, r.canonical_result_sha256, o.canonical_payload_json, o.payload_sha256 FROM vnext_control_plane.vnext_authorization_command_receipts r JOIN vnext_control_plane.vnext_authorization_outbox_events o ON o.receipt_id=r.receipt_id AND o.authority_id=r.authority_id WHERE r.receipt_id = 'receipt-1'");
      assert.deepStrictEqual(evidenceRows.rows, [{ canonical_result_json: '{"sessionId":"session-1"}', canonical_result_sha256: createHash('sha256').update('{"sessionId":"session-1"}', 'utf8').digest('hex'), canonical_payload_json: '{"sessionId":"session-1"}', payload_sha256: createHash('sha256').update('{"sessionId":"session-1"}', 'utf8').digest('hex') }]);
    });
    await issueVNextPg17OnlineIdentityAssertion(activeRuntime, handle, { ...assertion, assertionId: 'assertion-hardware-conflict', nonceSha256: hash('5'), hardwareEvidenceSha256: hash('6') });
    await assert.rejects(() => registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, Object.assign({ ...registration, assertionId: 'assertion-hardware-conflict', idempotencyKey: 'idempotency-hardware-conflict', receiptId: 'receipt-hardware-conflict', auditEventId: 'audit-hardware-conflict', outboxEventId: 'outbox-hardware-conflict', sessionId: 'session-hardware-conflict', linkId: 'link-hardware-conflict' }, createUnifiedDesktopRegistrationEvidence({ sessionId: 'session-hardware-conflict' }))));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
      'UPDATE vnext_control_plane.vnext_accounts SET status = \'revoked\', revocation_version = 6, updated_at = $1 WHERE account_id = \'account-1\'', [AT],
    ));
    await assert.rejects(() => registerVNextPg17UnifiedDesktopOnline(activeRuntime, handle, registration));
    await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'writer', facade => facade.query("INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES('writer-1','active',now(),now())")));
    await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'writer', facade => facade.query("INSERT INTO vnext_control_plane.vnext_online_identity_assertions(assertion_id,authority_id,account_id,account_auth_version,account_access_version,account_revocation_version,device_id,installation_id,installation_public_key,key_fingerprint,audience,nonce_sha256,canonical_request_sha256,identity_proof_sha256,hardware_evidence_sha256,issued_at,expires_at,created_at) VALUES('writer-assertion','authority-1','account-1',1,1,1,'writer-device','writer-installation','writer-key',$1,'unified-desktop',$1,$1,$1,$1,$2,$2,$2)", [hash('0'), AT])));
  } finally { if (peerHandle) await activeRuntime.disposeHandle(peerHandle); await activeRuntime.disposeHandle(handle); if (ownedRuntime) await activeRuntime.stop(); }
}

if (require.main === module) {
  runUnifiedDesktopRegistrationMutationCases().then(() => process.stdout.write('unified desktop registration mutation checks passed\n')).catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { runUnifiedDesktopRegistrationMutationCases };
