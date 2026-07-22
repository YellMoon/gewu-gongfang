const assert = require('assert');

async function main() {
  const {
    OFFLINE_LEASE_MAX_MS,
    canStartBusinessRuntime,
    createDesktopIdentityClient,
    desktopIdentityExpiryDelay,
    isDesktopIdentityNetworkFailure,
    partitionKeyForIdentity,
    preferredActiveRole,
    registrationViewForChallenge,
    resolveDesktopGateState,
  } = await import('./desktopIdentityClient.mjs');

  const at = new Date('2026-07-17T10:00:00.000Z');
  assert.strictEqual(OFFLINE_LEASE_MAX_MS, 72 * 60 * 60 * 1000);
  assert.strictEqual(isDesktopIdentityNetworkFailure(new TypeError('fetch failed')), true);
  assert.strictEqual(isDesktopIdentityNetworkFailure({ cause: { code: 'ECONNREFUSED' } }), true);
  assert.strictEqual(isDesktopIdentityNetworkFailure({ code: 'DESKTOP_DEVICE_NOT_ACTIVE' }), false);
  assert.strictEqual(
    isDesktopIdentityNetworkFailure({ code: 'DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID' }),
    false
  );
  assert.strictEqual(preferredActiveRole(['super_admin', 'teacher']), 'teacher');
  assert.strictEqual(preferredActiveRole(['super_admin', 'teacher'], 'super_admin'), 'super_admin');
  assert.strictEqual(preferredActiveRole(['super_admin']), 'super_admin');
  assert.strictEqual(partitionKeyForIdentity({
    userId: 'canonical-human',
    activeRole: 'teacher',
    teacherId: 'teacher-self',
  }), 'canonical-human:teacher:teacher-self');
  assert.strictEqual(partitionKeyForIdentity({
    userId: 'canonical-human',
    activeRole: 'super_admin',
  }), 'canonical-human:super_admin:all');

  assert.deepStrictEqual(resolveDesktopGateState({
    vaultStatus: { state: 'empty', sealed: false, unlocked: false },
    online: true,
    now: at,
  }), { kind: 'registration-required' });
  assert.deepStrictEqual(resolveDesktopGateState({
    vaultStatus: { state: 'legacy_upgrade_required', legacyUpgradeRequired: true },
    online: true,
    now: at,
  }), { kind: 'upgrade-required' });
  assert.deepStrictEqual(resolveDesktopGateState({
    vaultStatus: { state: 'sealed', sealed: true, unlocked: false, deviceId: 'device-2' },
    online: true,
    now: at,
  }), { kind: 'locked', deviceId: 'device-2' });

  const unlockedVault = {
    state: 'unlocked',
    sealed: true,
    unlocked: true,
    deviceId: 'device-2',
    authorizationId: 'authorization-device-2',
    credentialVersion: 1,
    user: { id: 'canonical-human', name: '超级管理员老师' },
    eligibleRoles: ['super_admin', 'teacher'],
    activeRole: 'teacher',
    teacherId: 'teacher-self',
    studentId: null,
  };
  const validLease = {
    id: 'offline-lease-1',
    userId: 'canonical-human',
    deviceId: 'device-2',
    authorizationId: 'authorization-device-2',
    credentialVersion: 1,
    eligibleRoles: ['super_admin', 'teacher'],
    activeRole: 'teacher',
    teacherId: 'teacher-self',
    issuedAt: '2026-07-17T09:00:00.000Z',
    expiresAt: '2026-07-20T09:00:00.000Z',
    scope: { kind: 'teacher', teacherId: 'teacher-self' },
  };
  const offline = resolveDesktopGateState({
    vaultStatus: { ...unlockedVault, offlineLease: validLease },
    online: false,
    now: at,
  });
  assert.strictEqual(offline.kind, 'offline-unlocked');
  assert.strictEqual(offline.activeRole, 'teacher');
  assert.strictEqual(offline.expiresAt, validLease.expiresAt);
  assert.strictEqual(offline.partitionKey, 'canonical-human:teacher:teacher-self');
  assert.strictEqual(canStartBusinessRuntime({ gateState: offline }), true);
  assert.strictEqual(canStartBusinessRuntime({ gateState: { kind: 'locked' } }), false);
  assert.strictEqual(canStartBusinessRuntime({ gateState: { kind: 'offline-blocked' } }), false);

  assert.strictEqual(resolveDesktopGateState({
    vaultStatus: { ...unlockedVault, offlineLease: { ...validLease, expiresAt: '2026-07-17T09:59:59.000Z' } },
    online: false,
    now: at,
  }).kind, 'offline-blocked');
  assert.strictEqual(resolveDesktopGateState({
    vaultStatus: {
      ...unlockedVault,
      offlineLease: {
        ...validLease,
        issuedAt: '2026-07-17T08:59:59.000Z',
        expiresAt: '2026-07-20T09:00:00.000Z',
      },
    },
    online: false,
    now: at,
  }).kind, 'offline-blocked', 'leases longer than 72 hours must fail closed');
  assert.strictEqual(resolveDesktopGateState({
    vaultStatus: unlockedVault,
    online: true,
    now: at,
  }).kind, 'online-authentication-required');

  const onlineSession = {
    token: 'short-online-session',
    expiresAt: '2026-07-17T18:00:00.000Z',
    session: {
      id: 'session-teacher',
      deviceId: 'device-2',
      userId: 'canonical-human',
      eligibleRoles: ['super_admin', 'teacher'],
      activeRole: 'teacher',
      rowVersion: 1,
      expiresAt: '2026-07-17T18:00:00.000Z',
    },
    profile: unlockedVault,
  };
  const serverProfile = {
    userId: 'canonical-human',
    user: { id: 'canonical-human', name: '超级管理员老师' },
    activeRole: 'teacher',
    eligibleRoles: ['super_admin', 'teacher'],
    teacherId: 'teacher-self',
    studentId: null,
  };
  const online = resolveDesktopGateState({
    vaultStatus: unlockedVault,
    online: true,
    onlineSession,
    now: at,
  });
  assert.strictEqual(online.kind, 'online-unlocked');
  assert.strictEqual(online.activeRole, 'teacher');
  assert.strictEqual(online.expiresAt, onlineSession.expiresAt);
  assert.strictEqual(online.partitionKey, 'canonical-human:teacher:teacher-self');
  assert.strictEqual(canStartBusinessRuntime({ gateState: online }), true);
  assert.strictEqual(desktopIdentityExpiryDelay(online, at), 8 * 60 * 60 * 1000);
  assert.strictEqual(desktopIdentityExpiryDelay(offline, at), 71 * 60 * 60 * 1000);
  assert.strictEqual(desktopIdentityExpiryDelay({ ...offline, expiresAt: at.toISOString() }, at), 0);
  assert.strictEqual(desktopIdentityExpiryDelay({ kind: 'locked' }, at), null);
  assert.strictEqual(resolveDesktopGateState({
    vaultStatus: unlockedVault,
    online: true,
    onlineSession: { ...onlineSession, expiresAt: '2026-07-17T09:59:59.000Z' },
    now: at,
  }).kind, 'online-authentication-required');

  assert.strictEqual(registrationViewForChallenge({ status: 'pending_phone' }).kind, 'phone-verification-required');
  assert.strictEqual(
    registrationViewForChallenge({ status: 'identity_verified_pending_approval' }).kind,
    'approval-pending'
  );
  assert.strictEqual(
    registrationViewForChallenge({ status: 'approved_pending_exchange' }).kind,
    'password-setup-required'
  );
  assert.strictEqual(registrationViewForChallenge({ status: 'rejected' }).kind, 'registration-rejected');
  assert.strictEqual(registrationViewForChallenge({ status: 'expired' }).kind, 'registration-expired');
  assert.strictEqual(registrationViewForChallenge({ status: 'cancelled' }).kind, 'registration-rejected');
  assert.strictEqual(registrationViewForChallenge({ status: 'conflict' }).kind, 'registration-rejected');

  const bridgeCalls = [];
  const desktopIdentity = {
    status: async () => unlockedVault,
    beginRegistration: async input => {
      bridgeCalls.push(['beginRegistration', input]);
      return {
        deviceId: 'device-2',
        deviceName: input.deviceName,
        deviceKind: 'desktop-client',
        publicKey: 'PUBLIC-KEY',
        keyFingerprint: 'f'.repeat(64),
      };
    },
    completeRegistration: async input => {
      bridgeCalls.push(['completeRegistration', input]);
      return { ...unlockedVault, offlineLease: input.offlineLease };
    },
    unlock: async input => {
      bridgeCalls.push(['unlock', input]);
      return { ...unlockedVault, offlineLease: validLease };
    },
    lock: async () => { bridgeCalls.push(['lock']); },
    refreshOfflineLease: async input => {
      bridgeCalls.push(['refreshOfflineLease', input]);
      return { ...unlockedVault, offlineLease: input.offlineLease };
    },
    signChallenge: async input => {
      bridgeCalls.push(['signChallenge', input]);
      if (input.purpose === 'role-elevation') {
        return {
          purpose: input.purpose,
          deviceId: 'device-2',
          signature: 'elevation-signature',
          elevationIssuedAt: '2026-07-17T10:00:00.000Z',
        };
      }
      return { purpose: input.purpose, deviceId: 'device-2', signature: `${input.purpose}-signature` };
    },
  };
  const requests = [];
  const responses = [
    {
      success: true,
      data: {
        challenge: {
          id: 'registration-challenge',
          challengeSecret: 'registration-secret',
          shortCode: '123456',
          status: 'pending_phone',
          rowVersion: 1,
          expiresAt: '2026-07-17T10:10:00.000Z',
          qrValue: 'weixin://desktop-registration-challenge',
          qrImageDataUrl: 'data:image/jpeg;base64,/9j/4A==',
        },
      },
    },
    {
      success: true,
      data: {
        challenge: {
          id: 'registration-challenge',
          deviceId: 'device-2',
          status: 'identity_verified_pending_approval',
          rowVersion: 2,
          expiresAt: '2026-07-17T10:10:00.000Z',
        },
      },
    },
    {
      success: true,
      data: {
        challenge: {
          id: 'registration-challenge',
          deviceId: 'device-2',
          status: 'approved_pending_exchange',
          rowVersion: 3,
          expiresAt: '2026-07-17T10:10:00.000Z',
        },
      },
    },
    {
      success: true,
      data: {
        authorization: {
          id: 'authorization-device-2',
          deviceId: 'device-2',
          deviceName: '第二台电脑',
          deviceKind: 'desktop-client',
          userId: 'canonical-human',
          keyFingerprint: 'f'.repeat(64),
          status: 'active',
          credentialVersion: 1,
          lastPhoneVerifiedAt: '2026-07-17T10:00:00.000Z',
          phoneReverifyDueAt: '2026-08-16T10:00:00.000Z',
        },
        session: onlineSession.session,
        token: 'registration-session-token',
        offlineLease: validLease,
        profile: serverProfile,
      },
    },
    {
      success: true,
      data: {
        challenge: {
          id: 'daily-session-challenge',
          authorizationId: 'authorization-device-2',
          deviceId: 'device-2',
          credentialVersion: 1,
          nonce: 'daily-nonce',
          nonceIssuedAt: '2026-07-17T10:00:00.000Z',
          rowVersion: 1,
          expiresAt: '2026-07-17T10:02:00.000Z',
        },
      },
    },
    {
      success: true,
      data: {
        session: { ...onlineSession.session, id: 'daily-session' },
        token: 'daily-session-token',
        offlineLease: validLease,
        profile: serverProfile,
      },
    },
    {
      success: true,
      data: {
        session: {
          ...onlineSession.session,
          id: 'session-super-admin',
          activeRole: 'super_admin',
          rowVersion: 1,
        },
        token: 'super-admin-session-token',
      },
    },
    {
      success: true,
      data: {
        session: {
          ...onlineSession.session,
          id: 'session-teacher-2',
          activeRole: 'teacher',
          rowVersion: 1,
        },
        token: 'teacher-session-token-2',
      },
    },
  ];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const body = responses.shift();
    return { ok: true, status: 200, json: async () => body };
  };
  const savedSessions = [];
  const events = [];
  const sessionStore = {
    save: async value => { savedSessions.push(value); return value; },
    clear: async () => { events.push('session-cleared'); },
  };
  const client = createDesktopIdentityClient({
    desktopIdentity,
    fetchImpl,
    now: () => new Date(at),
    sessionStore,
    clearRoleCache: async partitionKey => { events.push(`cache-cleared:${partitionKey}`); },
  });

  const pending = await client.beginRegistration({
    baseUrl: 'https://identity.example/scheduling/',
    deviceName: '第二台电脑',
  });
  assert.strictEqual(pending.challenge.status, 'pending_phone');
  assert.strictEqual(pending.challengeSecret, 'registration-secret');
  assert.strictEqual(pending.qrValue, 'weixin://desktop-registration-challenge');
  assert.strictEqual(pending.qrImageDataUrl, 'data:image/jpeg;base64,/9j/4A==');
  assert.deepStrictEqual(requests[0].body, {
    deviceId: 'device-2',
    deviceName: '第二台电脑',
    publicKey: 'PUBLIC-KEY',
    keyFingerprint: 'f'.repeat(64),
    purpose: 'register',
  });
  assert.ok(!Object.hasOwn(requests[0].body, 'phone'));
  assert.ok(!Object.hasOwn(requests[0].body, 'userId'));
  assert.ok(!Object.hasOwn(requests[0].body, 'role'));

  const phoneVerified = await client.pollRegistration(pending);
  assert.strictEqual(phoneVerified.challenge.status, 'identity_verified_pending_approval');
  const approved = await client.pollRegistration(phoneVerified);
  assert.strictEqual(approved.challenge.status, 'approved_pending_exchange');

  const registered = await client.completeRegistration({
    pending: approved,
    password: 'local-password-1',
  });
  assert.strictEqual(registered.gateState.kind, 'online-unlocked');
  assert.strictEqual(registered.gateState.activeRole, 'teacher');
  assert.strictEqual(savedSessions[0].token, 'registration-session-token');
  const exchangeRequest = requests[3];
  assert.deepStrictEqual(exchangeRequest.body, {
    challengeSecret: 'registration-secret',
    signature: 'exchange-signature',
    expectedRowVersion: 3,
  });
  const sealCall = bridgeCalls.find(call => call[0] === 'completeRegistration');
  assert.strictEqual(sealCall[1].sessionToken, 'registration-session-token');
  assert.strictEqual(sealCall[1].offlineLease.activeRole, 'teacher');
  assert.deepStrictEqual(sealCall[1].offlineLease, validLease);
  assert.ok(Date.parse(sealCall[1].offlineLease.expiresAt) - Date.parse(sealCall[1].offlineLease.issuedAt) <= OFFLINE_LEASE_MAX_MS);

  const daily = await client.unlock({
    baseUrl: 'https://identity.example/scheduling',
    password: 'local-password-1',
    online: true,
  });
  assert.strictEqual(daily.gateState.kind, 'online-unlocked');
  assert.strictEqual(savedSessions[1].token, 'daily-session-token');
  assert.deepStrictEqual(requests[4].body, {
    authorizationId: 'authorization-device-2',
    deviceId: 'device-2',
  });
  assert.deepStrictEqual(requests[5].body, {
    signature: 'session-signature',
    expectedRowVersion: 1,
  });
  assert.deepStrictEqual(
    bridgeCalls.find(call => call[0] === 'refreshOfflineLease')[1],
    { password: 'local-password-1', offlineLease: validLease }
  );

  const teacherSession = savedSessions[1];
  const elevated = await client.switchRole({
    baseUrl: 'https://identity.example/scheduling',
    currentSession: teacherSession,
    activeRole: 'super_admin',
    password: 'local-password-1',
  });
  assert.strictEqual(elevated.session.activeRole, 'super_admin');
  assert.deepStrictEqual(requests[6].body, {
    activeRole: 'super_admin',
    elevationIssuedAt: '2026-07-17T10:00:00.000Z',
    elevationSignature: 'elevation-signature',
  });
  assert.ok(events.includes('cache-cleared:canonical-human:teacher:teacher-self'));
  const unlockCallsAfterElevation = bridgeCalls.filter(call => call[0] === 'unlock');
  assert.strictEqual(unlockCallsAfterElevation.length, 2, 'daily unlock plus explicit elevation unlock');

  const downgraded = await client.switchRole({
    baseUrl: 'https://identity.example/scheduling',
    currentSession: elevated,
    activeRole: 'teacher',
  });
  assert.strictEqual(downgraded.session.activeRole, 'teacher');
  assert.deepStrictEqual(requests[7].body, { activeRole: 'teacher' });
  assert.strictEqual(
    bridgeCalls.filter(call => call[0] === 'unlock').length,
    2,
    'downgrade must not ask for or simulate elevation unlock'
  );

  await assert.rejects(
    client.switchRole({
      baseUrl: 'https://identity.example/scheduling',
      currentSession: { ...downgraded, offline: true },
      activeRole: 'super_admin',
      password: 'local-password-1',
    }),
    error => error.code === 'ONLINE_DESKTOP_SESSION_REQUIRED'
  );

  const resetBridgeCalls = [];
  const resetRequests = [];
  const resetLease = { ...validLease, credentialVersion: 2, id: 'offline-lease-after-reset' };
  const resetSession = {
    ...onlineSession.session,
    id: 'session-after-password-reset',
    credentialVersion: 2,
  };
  const resetDesktopIdentity = {
    status: async () => ({ state: 'sealed', sealed: true, unlocked: false, deviceId: 'device-2' }),
    beginPasswordReset: async () => {
      resetBridgeCalls.push(['beginPasswordReset']);
      return {
        deviceId: 'device-2',
        deviceName: '\u7b2c\u4e8c\u53f0\u7535\u8111',
        deviceKind: 'desktop-client',
        publicKey: 'RESET-PUBLIC-KEY',
        keyFingerprint: 'a'.repeat(64),
      };
    },
    completePasswordReset: async input => {
      resetBridgeCalls.push(['completePasswordReset', input]);
      return {
        ...unlockedVault,
        keyFingerprint: 'a'.repeat(64),
        credentialVersion: 2,
        offlineLease: input.offlineLease,
      };
    },
    signChallenge: async input => {
      resetBridgeCalls.push(['signChallenge', input]);
      return { purpose: 'exchange', deviceId: 'device-2', signature: 'password-reset-signature' };
    },
    lock: async () => {},
    unlock: async () => unlockedVault,
  };
  const resetResponses = [
    { success: true, data: { challenge: {
      id: 'password-reset-challenge', challengeSecret: 'password-reset-secret',
      status: 'pending_phone', rowVersion: 1, expiresAt: '2026-07-17T10:10:00.000Z',
    } } },
    { success: true, data: { challenge: {
      id: 'password-reset-challenge', purpose: 'password_reset',
      status: 'identity_verified_pending_approval', rowVersion: 2,
      expiresAt: '2026-07-17T10:10:00.000Z',
    } } },
    { success: true, data: { challenge: {
      id: 'password-reset-challenge', purpose: 'password_reset',
      status: 'approved_pending_exchange', rowVersion: 3,
      expiresAt: '2026-07-17T10:10:00.000Z',
    } } },
    { success: true, data: {
      authorization: {
        id: 'authorization-device-2', deviceId: 'device-2', deviceName: '\u7b2c\u4e8c\u53f0\u7535\u8111',
        deviceKind: 'desktop-client', userId: 'canonical-human',
        keyFingerprint: 'a'.repeat(64), status: 'active', credentialVersion: 2,
        lastPhoneVerifiedAt: '2026-07-17T10:00:00.000Z',
        phoneReverifyDueAt: '2026-08-16T10:00:00.000Z',
      },
      session: resetSession,
      token: 'password-reset-session-token',
      offlineLease: resetLease,
      profile: serverProfile,
    } },
  ];
  const resetClient = createDesktopIdentityClient({
    desktopIdentity: resetDesktopIdentity,
    fetchImpl: async (url, init = {}) => {
      resetRequests.push({ url, body: init.body ? JSON.parse(init.body) : null });
      const body = resetResponses.shift();
      return { ok: true, status: 200, json: async () => body };
    },
    now: () => new Date(at),
    sessionStore: { save: async value => value, clear: async () => {} },
  });
  const resetPending = await resetClient.beginPasswordReset({
    baseUrl: 'https://identity.example/scheduling',
  });
  assert.strictEqual(resetPending.challenge.purpose, 'password_reset');
  assert.deepStrictEqual(resetRequests[0].body, {
    deviceId: 'device-2',
    deviceName: '\u7b2c\u4e8c\u53f0\u7535\u8111',
    publicKey: 'RESET-PUBLIC-KEY',
    keyFingerprint: 'a'.repeat(64),
    purpose: 'password_reset',
  });
  const resetPhoneVerified = await resetClient.pollRegistration(resetPending);
  const resetApproved = await resetClient.pollRegistration(resetPhoneVerified);
  const resetResult = await resetClient.completeRegistration({
    pending: resetApproved,
    password: 'new-local-password',
  });
  assert.strictEqual(resetResult.gateState.kind, 'online-unlocked');
  assert.strictEqual(resetResult.vaultStatus.credentialVersion, 2);
  assert.strictEqual(resetBridgeCalls[0][0], 'beginPasswordReset');
  const resetSealCall = resetBridgeCalls.find(call => call[0] === 'completePasswordReset');
  assert.strictEqual(resetSealCall[1].password, 'new-local-password');
  assert.strictEqual(resetSealCall[1].authorization.deviceId, 'device-2');
  assert.strictEqual(resetSealCall[1].offlineLease.credentialVersion, 2);

  const singleUserSealCalls = [];
  const singleUserClient = createDesktopIdentityClient({
    desktopIdentity: {
      status: async () => unlockedVault,
      completeRegistration: async input => {
        singleUserSealCalls.push(input);
        return { ...unlockedVault, offlineLease: input.offlineLease };
      },
    },
    fetchImpl: async () => { throw new Error('single-user completion must not auto-sync'); },
    now: () => new Date(at),
    sessionStore: { save: async value => value, clear: async () => {} },
  });
  const pairedOffline = await singleUserClient.completeSingleUserPairing({
    password: 'paired-local-password',
    online: false,
    result: {
      authorization: { id: 'authorization-device-2' },
      profile: serverProfile,
      offlineLease: validLease,
    },
  });
  assert.strictEqual(pairedOffline.gateState.kind, 'offline-unlocked');
  assert.strictEqual(singleUserSealCalls.length, 1);
  assert.strictEqual(singleUserSealCalls[0].password, 'paired-local-password');
  assert.strictEqual(singleUserSealCalls[0].offlineLease.id, validLease.id);

  console.log('desktop identity client checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
