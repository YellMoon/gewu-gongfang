'use strict';

const assert = require('assert');
const { createCloudDesktopIdentityPgRepository } = require('./cloudDesktopIdentityPgRepository');

const calls = [];
const writerPool = {
  async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('vnext_start_desktop_session_challenge')) return { rows: [{
      challengeId: values[0], authorizationId: values[1], authorityId: 'authority-1', accountId: 'account-1',
      deviceId: values[2], installationId: 'installation-1', linkId: 'link-1', credentialVersion: 1,
      installationPublicKey: 'pem', nonceSha256: values[3], nonceIssuedAt: new Date(values[4]),
      expiresAt: new Date(values[5]), status: 'pending', rowVersion: '1',
    }] };
    if (sql.includes('FROM vnext_control_plane.vnext_desktop_session_challenges')) return { rows: [{
      challengeId: values[0], authorizationId: 'session-original-1', authorityId: 'authority-1', accountId: 'account-1',
      deviceId: 'device-1', installationId: 'installation-1', linkId: 'link-1', credentialVersion: '1',
      installationPublicKey: 'pem', nonceSha256: 'a'.repeat(64), nonceIssuedAt: new Date('2026-09-01T08:00:00Z'),
      expiresAt: new Date('2026-09-01T08:05:00Z'), status: 'pending', rowVersion: '1',
    }] };
    if (sql.includes('vnext_exchange_desktop_session_challenge')) return { rows: [{
      authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1',
      sessionId: values[2], expiresAt: new Date(values[3]), rowVersion: '1',
    }] };
    if (sql.includes('vnext_read_desktop_session_installation')) return { rows: [{ installationPublicKey: 'pem' }] };
    if (sql.includes('vnext_rotate_desktop_role_session')) return { rows: [{
      authorityId: values[0], accountId: values[1], deviceId: 'device-1', installationId: 'installation-1',
      sessionId: values[4], expiresAt: new Date('2026-09-01T09:00:00Z'), rowVersion: '1',
    }] };
    if (sql.includes('vnext_list_desktop_account_devices')) return { rows: [{
      deviceId: 'device-2', installationId: 'installation-2', status: 'active', rowVersion: '4',
      createdAt: new Date('2026-08-01T00:00:00Z'), updatedAt: new Date('2026-08-02T00:00:00Z'),
      lastSeenAt: new Date('2026-08-02T00:00:00Z'), revokedAt: null,
    }] };
    if (sql.includes('vnext_revoke_desktop_device')) return { rows: [{
      deviceId: values[3], status: 'revoked', rowVersion: '5', revokedAt: new Date('2026-09-01T08:00:00Z'),
    }] };
    throw new Error(`unexpected SQL: ${sql}`);
  },
};

(async () => {
  const repository = createCloudDesktopIdentityPgRepository({ writerPool });
  const challenge = await repository.createChallenge({
    challengeId: 'challenge-1', authorizationId: 'session-original-1', deviceId: 'device-1',
    nonceSha256: 'a'.repeat(64), nonceIssuedAt: '2026-09-01T08:00:00.000Z', expiresAt: '2026-09-01T08:05:00.000Z',
  });
  assert.strictEqual(challenge.rowVersion, 1);
  assert.strictEqual(challenge.expiresAt, '2026-09-01T08:05:00.000Z');
  assert.strictEqual((await repository.readChallenge({ challengeId: 'challenge-1' })).credentialVersion, 1);
  assert.strictEqual((await repository.consumeChallengeAndCreateSession({
    challengeId: 'challenge-1', expectedRowVersion: 1, sessionId: 'session-2', sessionExpiresAt: '2026-09-01T09:00:00.000Z',
    receiptId: 'receipt-1', auditEventId: 'audit-1', outboxEventId: 'outbox-1', signatureSha256: 'b'.repeat(64),
  })).rowVersion, 1);
  assert.strictEqual((await repository.readInstallationForSession({ authorityId: 'authority-1', accountId: 'account-1', sessionId: 'session-1' })).installationPublicKey, 'pem');
  assert.strictEqual((await repository.rotateRoleSession({
    authorityId: 'authority-1', accountId: 'account-1', previousSessionId: 'session-1', expectedRowVersion: 7,
    sessionId: 'session-3', activeRole: 'super_admin', receiptId: 'receipt-2', auditEventId: 'audit-2', outboxEventId: 'outbox-2',
  })).sessionId, 'session-3');
  assert.strictEqual((await repository.listDevices({ authorityId: 'authority-1', accountId: 'account-1' }))[0].rowVersion, 4);
  assert.strictEqual((await repository.revokeDevice({
    authorityId: 'authority-1', actorAccountId: 'account-1', actorSessionId: 'session-3', deviceId: 'device-2',
    expectedRowVersion: 4, reason: 'user_request', receiptId: 'receipt-3', auditEventId: 'audit-3', outboxEventId: 'outbox-3',
  })).rowVersion, 5);
  assert.ok(calls.every(call => !/\b(?:INSERT|UPDATE|DELETE)\b/u.test(call.sql)), 'runtime uses reviewed SECURITY DEFINER functions, not broad direct table writes');
  console.log('cloud desktop identity PostgreSQL repository checks passed');
})().catch(error => { console.error(error); process.exit(1); });
