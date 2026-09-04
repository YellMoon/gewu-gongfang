'use strict';

const assert = require('assert');
const crypto = require('node:crypto');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');

const hash = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

async function insertSession(facade, {
  sessionId, deviceId, installationId, linkId, issuedAt, expiresAt, accountAccessVersion = 1,
}) {
  await facade.query(
    `INSERT INTO vnext_control_plane.vnext_sessions(
       session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,
       issued_at,expires_at,revoked_at,account_auth_version,account_access_version,account_revocation_version,
       device_credential_version,device_risk_version,installation_credential_version,link_auth_version,
       link_access_version,link_row_version,row_version,created_at,updated_at
     ) VALUES($1,'authority-1','account-1',$2,$3,$4,'online','active',$5,$6,NULL,1,$7,1,1,1,1,1,1,1,1,$5,$5)`,
    [sessionId, deviceId, installationId, linkId, issuedAt, expiresAt, accountAccessVersion],
  );
}

async function provision(handle, issuedAt, expiresAt) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    await facade.query("INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES('authority-1','active',$1,$1)", [issuedAt]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('account-1','authority-1','active',1,1,1,1,$1,$1)", [issuedAt]);
    await facade.query(
      "INSERT INTO vnext_control_plane.vnext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,ends_at,revoked_at,granted_by_account_id,created_at,updated_at) VALUES('grant-super-admin-1','authority-1','account-1','super_admin','active',1,1,$1,NULL,NULL,NULL,$1,$1)",
      [issuedAt],
    );
    for (const suffix of ['actor', 'target']) {
      await facade.query(
        `INSERT INTO vnext_control_plane.vnext_trusted_devices(
           device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at,revoked_at
         ) VALUES($1,'authority-1','active',1,1,1,$2,$2,NULL)`,
        [`device-${suffix}`, issuedAt],
      );
      await facade.query(
        `INSERT INTO vnext_control_plane.vnext_device_installations(
           installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,
           credential_version,row_version,created_at,updated_at,revoked_at
         ) VALUES($1,'authority-1',$2,$3,$4,'active',1,1,$5,$5,NULL)`,
        [`installation-${suffix}`, `device-${suffix}`, `public-key-${suffix}`, hash(`key-${suffix}`), issuedAt],
      );
      await facade.query(
        `INSERT INTO vnext_control_plane.vnext_account_device_links(
           link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,
           row_version,created_at,updated_at,revoked_at
         ) VALUES($1,'authority-1','account-1',$2,$3,'active',1,1,1,$4,$4,NULL)`,
        [`link-${suffix}`, `device-${suffix}`, `installation-${suffix}`, issuedAt],
      );
      await insertSession(facade, {
        sessionId: `session-${suffix}`, deviceId: `device-${suffix}`,
        installationId: `installation-${suffix}`, linkId: `link-${suffix}`, issuedAt, expiresAt,
      });
    }
  });
}

async function runCloudDesktopSessionControlCases(runtime) {
  const ownedRuntime = !runtime;
  const activeRuntime = runtime || createDisposablePg17Runtime();
  if (ownedRuntime) await activeRuntime.start();
  const handle = await activeRuntime.createIsolatedHandle();
  try {
    const now = Date.now();
    const issuedAt = new Date(now - 60_000).toISOString();
    const challengeIssuedAt = new Date(now).toISOString();
    const challengeExpiresAt = new Date(now + 5 * 60_000).toISOString();
    const sessionExpiresAt = new Date(now + 60 * 60_000).toISOString();
    await createVNextPg17CatalogBoundary(activeRuntime).apply(handle, { appliedAt: issuedAt, appliedBy: 'desktop-cloud-session-control-test' });
    await provision(handle, issuedAt, sessionExpiresAt);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await insertSession(facade, {
        sessionId: 'session-expired', deviceId: 'device-actor', installationId: 'installation-actor',
        linkId: 'link-actor', issuedAt, expiresAt: new Date(now - 1_000).toISOString(),
      });
      await insertSession(facade, {
        sessionId: 'session-revoked', deviceId: 'device-actor', installationId: 'installation-actor',
        linkId: 'link-actor', issuedAt, expiresAt: sessionExpiresAt,
      });
      await facade.query("UPDATE vnext_control_plane.vnext_sessions SET status='revoked',revoked_at=$1,row_version=row_version+1,updated_at=$1 WHERE session_id='session-revoked'", [challengeIssuedAt]);
    });

    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      for (const [challengeId, authorizationId] of [
        ['challenge-expired', 'session-expired'],
        ['challenge-revoked', 'session-revoked'],
      ]) {
        await assert.rejects(
          () => facade.query(
            'SELECT * FROM vnext_control_plane.vnext_start_desktop_session_challenge($1,$2,$3,$4,$5,$6)',
            [challengeId, authorizationId, 'device-actor', hash(challengeId), challengeIssuedAt, challengeExpiresAt],
          ),
          error => error?.code === 'P0001' && /AUTHORIZATION_INVALID/.test(error.message),
          'an expired or revoked source session must not create a challenge',
        );
      }
      const challenge = await facade.query(
        'SELECT * FROM vnext_control_plane.vnext_start_desktop_session_challenge($1,$2,$3,$4,$5,$6)',
        ['challenge-1', 'session-actor', 'device-actor', hash('challenge-nonce'), challengeIssuedAt, challengeExpiresAt],
      );
      assert.deepStrictEqual(challenge.rows.map(row => ({
        challengeId: row.challengeId,
        authorizationId: row.authorizationId,
        deviceId: row.deviceId,
        installationId: row.installationId,
        credentialVersion: Number(row.credentialVersion),
        installationPublicKey: row.installationPublicKey,
        status: row.status,
        rowVersion: Number(row.rowVersion),
      })), [{
        challengeId: 'challenge-1', authorizationId: 'session-actor', deviceId: 'device-actor',
        installationId: 'installation-actor', credentialVersion: 1,
        installationPublicKey: 'public-key-actor', status: 'pending', rowVersion: 1,
      }]);
      const installation = await facade.query(
        'SELECT * FROM vnext_control_plane.vnext_read_desktop_session_installation($1,$2,$3)',
        ['authority-1', 'account-1', 'session-actor'],
      );
      assert.deepStrictEqual(installation.rows, [{ installationPublicKey: 'public-key-actor' }]);
      await assert.rejects(
        () => facade.query("UPDATE vnext_control_plane.vnext_desktop_session_challenges SET status='expired' WHERE challenge_id='challenge-1'"),
        error => error?.code === '42501',
        'the writer must use reviewed functions and cannot update challenges directly',
      );
    });

    const canonicalExchange = JSON.stringify({ sessionId: 'session-exchanged' });
    const canonicalExchangePayload = JSON.stringify({ type: 'desktop.session_issued', sessionId: 'session-exchanged' });
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const exchanged = await facade.query(
        'SELECT * FROM vnext_control_plane.vnext_exchange_desktop_session_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [
          'challenge-1', 1, 'session-exchanged', sessionExpiresAt,
          'receipt-exchange', 'audit-exchange', 'outbox-exchange', hash('signature'), hash('exchange-request'),
          canonicalExchange, hash(canonicalExchange), canonicalExchangePayload, hash(canonicalExchangePayload),
        ],
      );
      assert.deepStrictEqual(exchanged.rows.map(row => ({ sessionId: row.sessionId, rowVersion: Number(row.rowVersion) })), [{ sessionId: 'session-exchanged', rowVersion: 1 }]);
      const replay = await facade.query(
        'SELECT * FROM vnext_control_plane.vnext_exchange_desktop_session_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [
          'challenge-1', 1, 'session-replay', sessionExpiresAt,
          'receipt-replay', 'audit-replay', 'outbox-replay', hash('signature-replay'), hash('exchange-replay'),
          '{}', hash('{}'), '{}', hash('{}'),
        ],
      );
      assert.deepStrictEqual(replay.rows, [], 'a consumed challenge must not mint another session');
      const pendingRoleRace = await facade.query(
        'SELECT * FROM vnext_control_plane.vnext_start_desktop_session_challenge($1,$2,$3,$4,$5,$6)',
        ['challenge-role-race', 'session-exchanged', 'device-actor', hash('challenge-role-race'), challengeIssuedAt, challengeExpiresAt],
      );
      assert.strictEqual(pendingRoleRace.rows[0].status, 'pending');
    });

    const canonicalRole = JSON.stringify({ sessionId: 'session-role-teacher', activeRole: 'teacher' });
    const canonicalRolePayload = JSON.stringify({ type: 'desktop.active_role_changed', activeRole: 'teacher' });
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const rotated = await facade.query(
        'SELECT * FROM vnext_control_plane.vnext_rotate_desktop_role_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [
          'authority-1', 'account-1', 'session-exchanged', 1, 'session-role-teacher', 'teacher',
          'receipt-role', 'audit-role', 'outbox-role', hash('role-request'), canonicalRole, hash(canonicalRole),
          canonicalRolePayload, hash(canonicalRolePayload),
        ],
      );
      assert.deepStrictEqual(rotated.rows.map(row => ({ sessionId: row.sessionId, rowVersion: Number(row.rowVersion) })), [{ sessionId: 'session-role-teacher', rowVersion: 1 }]);
      await assert.rejects(
        () => facade.query(
          'SELECT * FROM vnext_control_plane.vnext_exchange_desktop_session_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          [
            'challenge-role-race', 1, 'session-race-bypass', sessionExpiresAt,
            'receipt-race', 'audit-race', 'outbox-race', hash('race-signature'), hash('race-request'),
            '{}', hash('{}'), '{}', hash('{}'),
          ],
        ),
        error => error?.code === 'P0001' && /AUTHORIZATION_INVALID/.test(error.message),
        'a role switch that revokes the source session must invalidate an already-created challenge',
      );
    });

    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const devices = await facade.query(
        'SELECT * FROM vnext_control_plane.vnext_list_desktop_account_devices($1,$2)',
        ['authority-1', 'account-1'],
      );
      assert.deepStrictEqual(new Set(devices.rows.map(row => row.deviceId)), new Set(['device-actor', 'device-target']));
    });

    const canonicalRevoke = JSON.stringify({ deviceId: 'device-target', status: 'revoked' });
    const canonicalRevokePayload = JSON.stringify({ type: 'desktop.device_revoked', deviceId: 'device-target' });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query("UPDATE vnext_control_plane.vnext_role_grants SET status='revoked',revoked_at=$1,row_version=row_version+1,updated_at=$1 WHERE grant_id='grant-super-admin-1'", [challengeIssuedAt]);
    });
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      await assert.rejects(
        () => facade.query(
          'SELECT * FROM vnext_control_plane.vnext_revoke_desktop_device($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
          ['authority-1', 'account-1', 'session-role-teacher', 'device-target', 1, 'security', 'receipt-no-grant', 'audit-no-grant', 'outbox-no-grant', hash('no-grant'), '{}', hash('{}'), '{}', hash('{}')],
        ),
        error => error?.code === '42501' && /SUPER_ADMIN_REQUIRED/.test(error.message),
        'device revocation must lock and require an active super-admin grant in the same transaction',
      );
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const target = await facade.query("SELECT status FROM vnext_control_plane.vnext_trusted_devices WHERE device_id='device-target'");
      assert.deepStrictEqual(target.rows, [{ status: 'active' }]);
      await facade.query(
        "INSERT INTO vnext_control_plane.vnext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,ends_at,revoked_at,granted_by_account_id,created_at,updated_at) VALUES('grant-super-admin-2','authority-1','account-1','super_admin','active',1,1,$1,NULL,NULL,NULL,$1,$1)",
        [challengeIssuedAt],
      );
      await facade.query("UPDATE vnext_control_plane.vnext_accounts SET access_version=2,row_version=row_version+1,updated_at=$1 WHERE account_id='account-1'", [challengeIssuedAt]);
    });
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      await assert.rejects(
        () => facade.query(
          'SELECT * FROM vnext_control_plane.vnext_revoke_desktop_device($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
          ['authority-1', 'account-1', 'session-role-teacher', 'device-target', 1, 'security', 'receipt-stale-parent', 'audit-stale-parent', 'outbox-stale-parent', hash('stale-parent'), '{}', hash('{}'), '{}', hash('{}')],
        ),
        error => error?.code === 'P0001' && /SESSION_PARENT_REVOKED/.test(error.message),
        'a stale actor session must not revoke another device after its account version changes',
      );
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await insertSession(facade, {
        sessionId: 'session-role-admin', deviceId: 'device-actor', installationId: 'installation-actor',
        linkId: 'link-actor', issuedAt: challengeIssuedAt, expiresAt: sessionExpiresAt, accountAccessVersion: 2,
      });
    });
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const revoked = await facade.query(
        'SELECT * FROM vnext_control_plane.vnext_revoke_desktop_device($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [
          'authority-1', 'account-1', 'session-role-admin', 'device-target', 1, 'lost',
          'receipt-revoke', 'audit-revoke', 'outbox-revoke', hash('revoke-request'), canonicalRevoke,
          hash(canonicalRevoke), canonicalRevokePayload, hash(canonicalRevokePayload),
        ],
      );
      assert.deepStrictEqual(revoked.rows.map(row => ({ deviceId: row.deviceId, status: row.status, rowVersion: Number(row.rowVersion) })), [{ deviceId: 'device-target', status: 'revoked', rowVersion: 2 }]);
      await assert.rejects(
        () => facade.query(
          'SELECT * FROM vnext_control_plane.vnext_revoke_desktop_device($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
          ['authority-1', 'account-1', 'session-role-admin', 'device-actor', 1, 'lost', 'receipt-self', 'audit-self', 'outbox-self', hash('self'), '{}', hash('{}'), '{}', hash('{}')],
        ),
        error => error?.code === 'P0001' && /SELF_REVOCATION/.test(error.message),
      );
    });

    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const state = await facade.query(
        `SELECT
           (SELECT status FROM vnext_control_plane.vnext_desktop_session_challenges WHERE challenge_id='challenge-1') AS challenge_status,
           (SELECT status FROM vnext_control_plane.vnext_sessions WHERE session_id='session-exchanged') AS exchanged_status,
           (SELECT status FROM vnext_control_plane.vnext_sessions WHERE session_id='session-role-teacher') AS actor_status,
           (SELECT status FROM vnext_control_plane.vnext_sessions WHERE session_id='session-target') AS target_session_status,
           (SELECT count(*)::int FROM vnext_control_plane.vnext_sessions WHERE session_id='session-race-bypass') AS race_sessions,
           (SELECT status FROM vnext_control_plane.vnext_trusted_devices WHERE device_id='device-target') AS target_device_status,
           (SELECT row_version::int FROM vnext_control_plane.vnext_trusted_devices WHERE device_id='device-target') AS target_device_version,
           (SELECT status FROM vnext_control_plane.vnext_device_installations WHERE installation_id='installation-target') AS target_installation_status,
           (SELECT status FROM vnext_control_plane.vnext_account_device_links WHERE link_id='link-target') AS target_link_status,
           (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_command_receipts WHERE receipt_id IN ('receipt-exchange','receipt-role','receipt-revoke')) AS receipts,
           (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_audit_events WHERE event_id IN ('audit-exchange','audit-role','audit-revoke')) AS audits,
           (SELECT count(*)::int FROM vnext_control_plane.vnext_authorization_outbox_events WHERE event_id IN ('outbox-exchange','outbox-role','outbox-revoke')) AS outbox`,
      );
      assert.deepStrictEqual(state.rows, [{
        challenge_status: 'consumed', exchanged_status: 'revoked', actor_status: 'active',
        target_session_status: 'revoked', race_sessions: 0, target_device_status: 'revoked', target_device_version: 2,
        target_installation_status: 'revoked', target_link_status: 'revoked', receipts: 3, audits: 3, outbox: 3,
      }]);
    });
  } finally {
    await activeRuntime.disposeHandle(handle);
    if (ownedRuntime) await activeRuntime.stop();
  }
}

if (require.main === module) {
  runCloudDesktopSessionControlCases()
    .then(() => process.stdout.write('vNext PG17 cloud desktop session control checks passed\n'))
    .catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}

module.exports = { runCloudDesktopSessionControlCases };
