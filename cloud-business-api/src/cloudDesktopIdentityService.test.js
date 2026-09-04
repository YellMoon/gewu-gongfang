'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  createCloudDesktopIdentityService,
  desktopRoleElevationSigningPayload,
  desktopSessionChallengeSigningPayload,
} = require('./cloudDesktopIdentityService');

const now = new Date('2026-09-01T08:00:00.000Z');
const keys = crypto.generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const calls = [];
let challengeRow = null;

const repository = {
  async createChallenge(input) {
    calls.push(['createChallenge', input]);
    challengeRow = {
      ...input,
      authorityId: 'authority-1',
      accountId: 'account-1',
      installationId: 'installation-1',
      linkId: 'link-1',
      credentialVersion: 3,
      installationPublicKey: publicKey,
      status: 'pending',
      rowVersion: 1,
    };
    return challengeRow;
  },
  async readChallenge({ challengeId }) {
    calls.push(['readChallenge', challengeId]);
    return challengeRow && challengeRow.challengeId === challengeId ? challengeRow : null;
  },
  async consumeChallengeAndCreateSession(input) {
    calls.push(['consumeChallengeAndCreateSession', input]);
    assert.strictEqual(input.expectedRowVersion, 1);
    challengeRow = { ...challengeRow, status: 'consumed', rowVersion: 2 };
    return {
      authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1',
      installationId: 'installation-1', sessionId: input.sessionId,
      expiresAt: input.sessionExpiresAt, rowVersion: 1,
    };
  },
  async readInstallationForSession(input) {
    calls.push(['readInstallationForSession', input]);
    return { installationPublicKey: publicKey };
  },
  async rotateRoleSession(input) {
    calls.push(['rotateRoleSession', input]);
    return {
      authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1',
      installationId: 'installation-1', sessionId: input.sessionId,
      expiresAt: '2026-09-01T09:00:00.000Z', rowVersion: 1,
    };
  },
  async listDevices(input) {
    calls.push(['listDevices', input]);
    return [{
      deviceId: 'device-2', installationId: 'installation-2', status: 'active',
      rowVersion: 4, createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z', revokedAt: null,
    }];
  },
  async revokeDevice(input) {
    calls.push(['revokeDevice', input]);
    return { deviceId: input.deviceId, status: 'revoked', rowVersion: 5, revokedAt: now.toISOString() };
  },
};

const contexts = {
  'teacher-token': {
    authorityId: 'authority-1', accountId: 'account-1', sessionId: 'session-teacher-1',
    deviceId: 'device-1', installationId: 'installation-1', activeRole: 'teacher',
    roles: ['super_admin', 'teacher'], teacherId: 'teacher-1', studentId: null,
    expiresAt: '2026-09-01T09:00:00.000Z', rowVersion: 7,
  },
  'admin-token': {
    authorityId: 'authority-1', accountId: 'account-1', sessionId: 'session-admin-1',
    deviceId: 'device-1', installationId: 'installation-1', activeRole: 'super_admin',
    roles: ['super_admin', 'teacher'], teacherId: 'teacher-1', studentId: null,
    expiresAt: '2026-09-01T09:00:00.000Z', rowVersion: 2,
  },
};

const issued = [];
const service = createCloudDesktopIdentityService({
  repository,
  now: () => new Date(now),
  randomBytes: size => Buffer.alloc(size, 7),
  randomId: kind => `${kind}-${calls.length + 1}`,
  sessionContext: async ({ sessionToken }) => contexts[sessionToken],
  issueSession: async input => {
    issued.push(input);
    const selectedRole = input.activeRole || 'teacher';
    return {
      token: `issued-${selectedRole}`,
      session: {
        id: input.sessionId, userId: input.accountId, deviceId: input.deviceId,
        activeRole: selectedRole, eligibleRoles: ['super_admin', 'teacher'],
        teacherId: selectedRole === 'teacher' ? 'teacher-1' : null,
        studentId: null, expiresAt: input.expiresAt, rowVersion: input.rowVersion,
      },
      profile: {
        userId: input.accountId, user: { id: input.accountId, name: 'Cloud account' },
        activeRole: selectedRole, eligibleRoles: ['super_admin', 'teacher'],
        teacherId: selectedRole === 'teacher' ? 'teacher-1' : null, studentId: null,
      },
      offlineLease: { id: `lease-${input.sessionId}`, signature: 'signed' },
    };
  },
});

(async () => {
  const challenge = await service.startChallenge({ authorizationId: 'session-original-1', deviceId: 'device-1' });
  assert.deepStrictEqual(Object.keys(challenge).sort(), [
    'authorizationId', 'credentialVersion', 'expiresAt', 'id', 'nonce', 'nonceIssuedAt', 'rowVersion',
  ]);
  const sessionProof = crypto.sign(null, Buffer.from(desktopSessionChallengeSigningPayload({
    challengeId: challenge.id,
    authorizationId: challenge.authorizationId,
    deviceId: 'device-1',
    credentialVersion: challenge.credentialVersion,
    nonce: challenge.nonce,
    nonceIssuedAt: challenge.nonceIssuedAt,
  }), 'utf8'), keys.privateKey).toString('base64');
  const resumed = await service.exchangeChallenge({
    challengeId: challenge.id, signature: sessionProof, expectedRowVersion: challenge.rowVersion,
  });
  assert.strictEqual(resumed.session.activeRole, 'teacher');
  assert.strictEqual(issued[0].accountId, 'account-1');
  await assert.rejects(
    () => service.exchangeChallenge({ challengeId: challenge.id, signature: sessionProof, expectedRowVersion: 1 }),
    error => error.code === 'DESKTOP_SESSION_CHALLENGE_REPLAYED',
  );

  const elevationIssuedAt = now.toISOString();
  const elevationSignature = crypto.sign(null, Buffer.from(desktopRoleElevationSigningPayload({
    sessionId: contexts['teacher-token'].sessionId,
    deviceId: contexts['teacher-token'].deviceId,
    activeRole: 'super_admin',
    sessionVersion: contexts['teacher-token'].rowVersion,
    elevationIssuedAt,
  }), 'utf8'), keys.privateKey).toString('base64');
  const switched = await service.switchRole({
    sessionToken: 'teacher-token', activeRole: 'super_admin', elevationIssuedAt, elevationSignature,
  });
  assert.strictEqual(switched.session.activeRole, 'super_admin');
  assert.strictEqual(calls.find(call => call[0] === 'rotateRoleSession')[1].expectedRowVersion, 7);
  await assert.rejects(
    () => service.switchRole({ sessionToken: 'teacher-token', activeRole: 'student' }),
    error => error.code === 'ACTIVE_ROLE_NOT_GRANTED',
  );

  const devices = await service.listDevices({ sessionToken: 'admin-token' });
  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].deviceId, 'device-2');
  const revoked = await service.revokeDevice({
    sessionToken: 'admin-token', deviceId: 'device-2', expectedRowVersion: 4, reason: 'user_request',
  });
  assert.deepStrictEqual(revoked, { deviceId: 'device-2', status: 'revoked', rowVersion: 5, revokedAt: now.toISOString() });
  await assert.rejects(
    () => service.revokeDevice({ sessionToken: 'teacher-token', deviceId: 'device-2', expectedRowVersion: 4, reason: 'user_request' }),
    error => error.code === 'DESKTOP_SUPER_ADMIN_ROLE_REQUIRED',
  );
  await assert.rejects(
    () => service.revokeDevice({ sessionToken: 'admin-token', deviceId: 'device-1', expectedRowVersion: 1, reason: 'user_request' }),
    error => error.code === 'DESKTOP_DEVICE_SELF_REVOCATION_FORBIDDEN',
  );
  console.log('cloud desktop identity service checks passed');
})().catch(error => { console.error(error); process.exit(1); });
