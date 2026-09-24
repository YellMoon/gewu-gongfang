'use strict';
// UTF-8: real isolated PostgreSQL, through the production registration adapter.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery, issueVNextPg17OnlineIdentityAssertion } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createUnifiedDesktopRegistrationEvidence } = require('./unifiedDesktopRegistrationEvidence');
const { createDesktopRegistrationPgAdapter } = require('../../cloud-business-api/src/desktopRegistrationPgAdapter');
const { buildCloudControlPlaneM29StateSql } = require('../../scripts/vnext-migration/cloudControlPlaneM29State');
const sha = value => createHash('sha256').update(value).digest('hex');

async function runDesktopDeviceNamesCases() {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  let handle;
  try {
    handle = await runtime.createIsolatedHandle();
    await createVNextPg17CatalogBoundary(runtime).apply(handle, { appliedAt: new Date().toISOString(), appliedBy: 'device-names-test' });
    const query = (role, sql, values) => withVNextPg17SyntheticQuery(handle, role, db => db.query(sql, values));
    const deploymentState = JSON.parse((await query('fixture-provisioner', buildCloudControlPlaneM29StateSql())).rows[0].state);
    assert.deepEqual(deploymentState, { ledgerCount: 29, prefixValid: true, targetCount: 1, columnCount: 1, functionCount: 2, metadataValid: true });
    const register = createDesktopRegistrationPgAdapter({ writerPool: { query: (sql, values) => query('writer', sql, values) } });
    await query('fixture-provisioner', "INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES('authority-name','active',now(),now())");
    await query('fixture-provisioner', "INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('account-name','authority-name','active',2,3,4,1,now(),now()),('other-account','authority-name','active',1,1,1,1,now(),now())");
    async function candidate(suffix, deviceName, deviceSuffix = suffix) {
      const canonicalRequestJson = JSON.stringify({ authorityId: 'authority-name', accountId: 'account-name', deviceId: `device-${deviceSuffix}`, installationId: `install-${deviceSuffix}`, keyFingerprint: sha(deviceSuffix), idempotencyKey: `idempotency-${suffix}`, ...(deviceName === undefined ? {} : { deviceName }) });
      await issueVNextPg17OnlineIdentityAssertion(runtime, handle, {
        assertionId: `assertion-${suffix}`, authorityId: 'authority-name', accountId: 'account-name', deviceId: `device-${deviceSuffix}`, installationId: `install-${deviceSuffix}`,
        installationPublicKey: `public-${deviceSuffix}`, keyFingerprint: sha(deviceSuffix), audience: 'unified-desktop', nonceSha256: sha(suffix), canonicalRequestSha256: sha(canonicalRequestJson), identityProofSha256: sha('proof'), hardwareEvidenceSha256: sha(deviceSuffix), issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
      return { assertionId: `assertion-${suffix}`, idempotencyKey: `idempotency-${suffix}`, receiptId: `receipt-${suffix}`, auditEventId: `audit-${suffix}`, outboxEventId: `outbox-${suffix}`, sessionId: `session-${suffix}`, linkId: `link-${suffix}`, sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(), ...createUnifiedDesktopRegistrationEvidence({ sessionId: `session-${suffix}` }), ...(deviceName === undefined ? {} : { deviceName, canonicalRequestJson }) };
    }
    const state = async () => (await query('fixture-provisioner', `SELECT
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY device_id) FROM vnext_control_plane.vnext_trusted_devices d) AS devices,
      (SELECT count(*)::int FROM vnext_control_plane.vnext_sessions) AS sessions,
      (SELECT count(*)::int FROM vnext_control_plane.vnext_account_device_links) AS links,
      (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_command_receipts) AS receipts,
      (SELECT count(*)::int FROM vnext_control_plane.vnext_online_identity_assertion_consumptions) AS consumptions`)).rows;
    const first = await candidate('first', '\u6559\u5ba4\u7535\u8111');
    assert.deepEqual(await register(first), { receiptId: first.receiptId, sessionId: first.sessionId, replayed: false });
    const settled = await state();
    assert.equal(settled[0].devices[0].display_name, first.deviceName);
    assert.equal((await register(first)).replayed, true);
    assert.deepEqual(await state(), settled, 'exact replay does not rename or create records');
    await assert.rejects(register({ ...first, canonicalRequestJson: first.canonicalRequestJson.replace(first.deviceName, 'Injected') }), /VNEXT_DESKTOP_NAME_ASSERTION_MISMATCH/);
    assert.deepEqual(await state(), settled);
    const listSql = 'SELECT * FROM vnext_control_plane.vnext_list_named_desktop_account_devices($1,$2)';
    const listed = (await query('writer', listSql, ['authority-name', 'account-name'])).rows;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].deviceName, first.deviceName);
    assert.equal((await query('writer', listSql, ['authority-name', 'other-account'])).rows.length, 0);
    assert.equal((await query('writer', listSql, ['wrong-authority', 'account-name'])).rows.length, 0);
    for (const role of ['identity-verifier', 'migrator']) {
      await assert.rejects(query(role, listSql, ['authority-name', 'account-name']), error => error.code === '42501');
    }
    await assert.rejects(query('writer', "UPDATE vnext_control_plane.vnext_trusted_devices SET display_name='bypass'"), error => error.code === '42501');
    for (const [index, name] of ['', ' padded ', 'x'.repeat(129), 'bad\nname', 'bad\u202ename', 42].entries()) {
      const invalid = await candidate(`invalid-${index}`, name);
      // Empty or non-string names still explicitly exercise the named SQL path.
      await assert.rejects(register({ ...invalid, deviceName: 'route-named' }), /VNEXT_DESKTOP_NAME_REQUEST_INVALID/);
      assert.deepEqual(await state(), settled, 'invalid metadata creates no registration side effects');
    }
    const rollback = await candidate('rollback', 'New room');
    await assert.rejects(register({ ...rollback, outboxEventId: first.outboxEventId }));
    assert.deepEqual(await state(), settled, 'downstream failure rolls back registration and name together');
    const rename = await candidate('rename', 'Updated room', 'first');
    await register(rename);
    assert.equal((await query('writer', listSql, ['authority-name', 'account-name'])).rows[0].deviceName, 'Updated room');
    await register(first);
    assert.equal((await query('writer', listSql, ['authority-name', 'account-name'])).rows[0].deviceName, 'Updated room', 'old replay cannot restore stale name');
    const legacy = await candidate('legacy');
    await register(legacy);
    const withLegacy = (await query('writer', listSql, ['authority-name', 'account-name'])).rows;
    assert.equal(withLegacy.find(row => row.deviceId === 'device-legacy').deviceName, null);
    const account = (await query('fixture-provisioner', "SELECT auth_version,access_version,revocation_version,row_version FROM vnext_control_plane.vnext_accounts WHERE account_id='account-name'")).rows[0];
    assert.deepEqual(Object.values(account).map(Number), [2, 3, 4, 1], 'display metadata never grants roles or bumps account versions');
    const revoked = await candidate('revoked', 'Denied');
    await query('fixture-provisioner', "UPDATE vnext_control_plane.vnext_accounts SET status='revoked',revocation_version=5 WHERE account_id='account-name'");
    const beforeRevoked = await state();
    await assert.rejects(register(revoked));
    assert.deepEqual(await state(), beforeRevoked);
    console.log('Desktop device names PostgreSQL registration, replay, isolation, rollback and privilege checks passed');
  } finally {
    if (handle) await runtime.disposeHandle(handle);
    await runtime.stop();
  }
}
if (require.main === module) runDesktopDeviceNamesCases().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runDesktopDeviceNamesCases };
