const assert = require('assert');
const fs = require('fs');
const {
  createUnifiedDesktopRegistrationCommand,
} = require('../../shared/vnext-pg17/unifiedDesktopRegistrationCommand');

async function main() {
  const source = fs.readFileSync('src/services/desktopIdentityClient.mjs', 'utf8');
  const {
    canStartBusinessRuntime,
    createDesktopIdentityClient,
    partitionKeyForIdentity,
    resolveDesktopGateState,
  } = await import('./desktopIdentityClient.mjs');
  assert.ok(!source.includes('desktopSessionRelayClient'));
  assert.ok(!source.includes('exchangeDesktopSessionThroughRelay'));
  assert.ok(!source.includes('ensureHostSyncSession'));

  assert.deepStrictEqual(resolveDesktopGateState({ vaultStatus: { state: 'empty' } }), {
    kind: 'registration-required',
  });
  assert.deepStrictEqual(resolveDesktopGateState({
    vaultStatus: { state: 'sealed', unlocked: false, deviceId: 'device-1' },
  }), { kind: 'locked', deviceId: 'device-1' });

  const offlineLease = {
    userId: 'user-1',
    deviceId: 'device-1',
    authorizationId: 'authorization-1',
    activeRole: 'teacher',
    teacherId: 'teacher-1',
    eligibleRoles: ['teacher'],
    credentialVersion: 1,
    issuedAt: '2026-07-28T00:00:00.000Z',
    expiresAt: '2026-08-01T00:00:00.000Z',
  };
  const offline = resolveDesktopGateState({
    vaultStatus: {
      state: 'unlocked', unlocked: true, offlineLease,
      user: { id: 'user-1' }, deviceId: 'device-1', authorizationId: 'authorization-1',
      credentialVersion: 1, activeRole: 'teacher', teacherId: 'teacher-1', eligibleRoles: ['teacher'],
    },
    online: false,
    now: new Date('2026-07-29T00:00:00.000Z'),
  });
  assert.strictEqual(offline.kind, 'offline-unlocked');
  assert.strictEqual(offline.partitionKey, 'user-1:teacher:teacher-1');
  assert.strictEqual(canStartBusinessRuntime({ gateState: offline }), true);
  assert.strictEqual(canStartBusinessRuntime({ gateState: { kind: 'registration-required' } }), false);
  assert.strictEqual(
    partitionKeyForIdentity({ userId: 'unbound-teacher', activeRole: 'teacher', teacherId: null }),
    'unbound-teacher:teacher:unbound',
    'a role may exist before a local teacher profile is bound',
  );
  assert.strictEqual(
    partitionKeyForIdentity({ userId: 'unbound-student', activeRole: 'student', studentId: null }),
    'unbound-student:student:unbound',
    'a role may exist before a local student profile is bound',
  );

  const client = createDesktopIdentityClient({
    desktopIdentity: { status: async () => ({ state: 'empty' }) },
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: true }) }),
  });
  assert.strictEqual(typeof client.completeSingleUserPairing, 'undefined');
  assert.ok(!/single[_-]?user|singleUser/i.test(source), 'identity client must contain no retired architecture path');
  assert.ok(source.includes('/activation/exchange') && source.includes('/finalize')
    && source.includes("purpose: 'activation-finalize'"),
  'registration must seal locally and submit a device-key activation receipt before saving an online session');

  const unifiedCloudRequests = [];
  const unifiedCloudEvents = [];
  let unifiedCloudSealed = null;
  let unifiedCloudStored = null;
  const unifiedCloudClient = createDesktopIdentityClient({
    now: () => new Date('2026-08-21T12:00:00.000Z'),
    desktopIdentity: {
      status: async () => ({ state: 'empty' }),
      beginUnifiedOnlineRegistration: async () => ({
        deviceId: 'desktop-device-a1b2c3d4e5f60708',
        deviceName: 'Unified cloud desktop',
        deviceKind: 'desktop-client',
        publicKey: 'unified-public-key',
        keyFingerprint: 'a'.repeat(64),
      }),
      signChallenge: async input => {
        unifiedCloudEvents.push(`sign:${input.purpose}`);
        assert.deepStrictEqual(input, {
          purpose: 'unified-online-registration',
          challenge: 'cloud-device-proof-1',
        });
        return { signature: 'unified-device-proof' };
      },
      completeRegistration: async input => {
        unifiedCloudEvents.push('seal-unified-cloud-vault');
        unifiedCloudSealed = input;
        return {
          state: 'unlocked', unlocked: true,
          user: { id: 'account-cloud-1' },
          deviceId: 'desktop-device-a1b2c3d4e5f60708',
          authorizationId: 'session-cloud-1', credentialVersion: 1,
          activeRole: 'super_admin', eligibleRoles: ['super_admin'], offlineLease: null,
        };
      },
    },
    sessionStore: {
      save: async value => { unifiedCloudEvents.push('save-unified-cloud-session'); unifiedCloudStored = value; },
      clear: async () => {},
    },
    fetchImpl: async (url, options = {}) => {
      unifiedCloudRequests.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
      if (url === 'https://cloud.test/api/desktop/pairing/start') {
        return { ok: true, json: async () => ({ ok: true, pairingId: 'pairing-cloud-1', pairingSecret: 'pairing-secret-1', expiresAt: '2026-08-21T12:05:00.000Z' }) };
      }
      if (url === 'https://cloud.test/api/desktop/pairing/pairing-cloud-1?secret=pairing-secret-1') {
        return { ok: true, json: async () => ({ ok: true, status: 'verified', verificationToken: 'verification-token-1', deviceChallenge: 'cloud-device-proof-1' }) };
      }
      if (url === 'https://cloud.test/api/desktop/online-registration') {
        return { ok: true, json: async () => ({ ok: true, receiptId: 'receipt-cloud-1', sessionId: 'session-cloud-1', replayed: false, sessionToken: 'session-token-cloud-1' }) };
      }
      if (url === 'https://cloud.test/api/desktop/session-context') {
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        return { ok: true, json: async () => ({ ok: true,
          authorityId: 'authority-cloud-1', accountId: 'account-cloud-1',
          deviceId: 'desktop-device-a1b2c3d4e5f60708', installationId: 'desktop-device-a1b2c3d4e5f60708',
          sessionId: 'session-cloud-1', expiresAt: '2026-08-21T13:00:00.000Z', roles: ['super_admin'],
        }) };
      }
      if (url === 'https://cloud.test/api/business/schedules') {
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        return { ok: true, json: async () => ({ ok: true, schedules: [{ id: 'schedule-cloud-1', courseId: 'course-cloud-1' }] }) };
      }
      if (url === 'https://cloud.test/api/business/schedules/schedule-cloud-1') {
        assert.strictEqual(options.method, 'PUT');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        assert.deepStrictEqual(JSON.parse(options.body), {
          expectedUpdatedAt: '2026-08-21T01:00:00.000Z', startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z',
          status: 2, roomDisplay: 'Cloud room', tuition: 120, teacherFee: 60, notes: 'cloud update',
        });
        return { ok: true, json: async () => ({ ok: true, schedule: { id: 'schedule-cloud-1', updatedAt: '2026-08-22T00:00:00.000Z' } }) };
      }
      throw new Error(`unexpected unified cloud request ${url}`);
    },
  });
  const unifiedPending = await unifiedCloudClient.beginUnifiedOnlineRegistration({
    baseUrl: 'https://cloud.test', deviceName: 'Unified cloud desktop', idempotencyKey: 'unified-registration-1',
  });
  assert.strictEqual(unifiedPending.qrValue, 'gewu://desktop-pairing?pairingId=pairing-cloud-1&secret=pairing-secret-1');
  const unifiedVerified = await unifiedCloudClient.pollUnifiedOnlineRegistration(unifiedPending);
  const unifiedCompleted = await unifiedCloudClient.completeUnifiedOnlineRegistration({
    pending: unifiedVerified,
    password: 'unified-local-password',
  });
  assert.deepStrictEqual(unifiedCloudRequests.map(entry => entry.url), [
    'https://cloud.test/api/desktop/pairing/start',
    'https://cloud.test/api/desktop/pairing/pairing-cloud-1?secret=pairing-secret-1',
    'https://cloud.test/api/desktop/online-registration',
    'https://cloud.test/api/desktop/session-context',
  ]);
  assert.deepStrictEqual(unifiedCloudRequests[0].body, {
    installationId: 'desktop-device-a1b2c3d4e5f60708', installationPublicKey: 'unified-public-key', idempotencyKey: 'unified-registration-1',
  });
  assert.deepStrictEqual(unifiedCloudRequests[2].body, {
    verificationToken: 'verification-token-1', installationId: 'desktop-device-a1b2c3d4e5f60708',
    installationPublicKey: 'unified-public-key', deviceProof: 'unified-device-proof', idempotencyKey: 'unified-registration-1',
  });
  assert.strictEqual(unifiedCloudSealed.offlineLease, null, 'a new unified registration never manufactures an offline lease');
  assert.strictEqual(unifiedCloudSealed.authorization.userId, 'account-cloud-1');
  assert.deepStrictEqual(unifiedCloudSealed.profile.eligibleRoles, ['super_admin']);
  assert.deepStrictEqual(unifiedCloudEvents, ['sign:unified-online-registration', 'seal-unified-cloud-vault', 'save-unified-cloud-session']);
  assert.strictEqual(unifiedCloudStored.token, 'session-token-cloud-1');
  assert.strictEqual(unifiedCompleted.gateState.kind, 'online-unlocked');
  const cloudSchedules = await unifiedCloudClient.listCloudSchedules({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted,
  });
  assert.deepStrictEqual(cloudSchedules, [{ id: 'schedule-cloud-1', courseId: 'course-cloud-1' }]);
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/schedules');
  const updatedCloudSchedule = await unifiedCloudClient.updateCloudSchedule({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, scheduleId: 'schedule-cloud-1',
    expectedUpdatedAt: '2026-08-21T01:00:00.000Z', startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z',
    status: 2, roomDisplay: 'Cloud room', tuition: 120, teacherFee: 60, notes: 'cloud update',
  });
  assert.deepStrictEqual(updatedCloudSchedule, { id: 'schedule-cloud-1', updatedAt: '2026-08-22T00:00:00.000Z' });
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/schedules/schedule-cloud-1');

  const registrationRequests = [];
  const registrationEvents = [];
  const finalizedLease = { id: 'lease-after-finalize', expiresAt: '2026-08-11T00:00:00.000Z' };
  const registrationClient = createDesktopIdentityClient({
    desktopIdentity: {
      status: async () => ({ state: 'empty' }),
      signChallenge: async input => {
        registrationEvents.push(`sign:${input.purpose}`);
        return { signature: input.purpose === 'activation-finalize' ? 'finalize-signature' : 'exchange-signature' };
      },
      completeRegistration: async input => {
        registrationEvents.push('seal-local-vault');
        assert.strictEqual(input.offlineLease, null, 'the unfinalized activation may not be persisted as an offline lease');
        assert.strictEqual(input.authorization.status, 'active', 'the local encrypted package contains the post-finalization authorization view');
        assert.deepStrictEqual(input.authorityContext, {
          userId: 'user-activation',
          deviceId: 'device-activation',
          authorityId: 'authority-activation',
          hostEpochId: 'epoch-activation',
          hostGeneration: 3,
          hostPublicKey: 'activation-host-public-key',
          grant: { id: 'grant-activation', version: 1 },
          lease: {
            id: 'authority-lease-activation',
            activeRole: 'teacher',
            issuedAt: '2026-07-28T00:00:00.000Z',
            expiresAt: '2026-08-11T00:00:00.000Z',
          },
        });
      },
      refreshOfflineLease: async input => {
        registrationEvents.push('refresh-lease');
        assert.deepStrictEqual(input.offlineLease, finalizedLease);
        return {
          state: 'unlocked', unlocked: true, user: { id: 'user-activation' },
          deviceId: 'device-activation', authorizationId: 'authorization-activation',
          credentialVersion: 1, activeRole: 'teacher', teacherId: 'teacher-activation', eligibleRoles: ['teacher'],
          offlineLease: input.offlineLease,
        };
      },
    },
    sessionStore: {
      save: async value => registrationEvents.push(`save-session:${value.token}`),
      clear: async () => {},
    },
    fetchImpl: async (url, options) => {
      registrationRequests.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith('/activation/exchange')) {
        return { ok: true, json: async () => ({ success: true, data: {
          activation: { id: 'activation-1', packageHash: 'package-hash-1', status: 'activation_pending' },
          activationPackage: {
            userId: 'user-activation',
            deviceId: 'device-activation',
            authorityId: 'authority-activation',
            hostEpochId: 'epoch-activation',
            hostGeneration: 3,
            hostPublicKey: 'activation-host-public-key',
            grant: { id: 'grant-activation', version: 1 },
            lease: {
              id: 'authority-lease-activation',
              activeRole: 'teacher',
              issuedAt: '2026-07-28T00:00:00.000Z',
              expiresAt: '2026-08-11T00:00:00.000Z',
            },
            authorization: { id: 'authorization-activation', status: 'active', credentialVersion: 1 },
            profile: { userId: 'user-activation', user: { id: 'user-activation', name: 'Activation user' }, activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-activation' },
          },
        } }) };
      }
      if (url.endsWith('/activations/activation-1/finalize')) {
        assert.deepStrictEqual(registrationEvents, ['sign:exchange', 'seal-local-vault', 'sign:activation-finalize'],
          'the server activation may be finalized only after the local vault is sealed and the device signs its receipt');
        return { ok: true, json: async () => ({ success: true, data: {
          token: 'online-token-after-finalize',
          authorization: { id: 'authorization-activation', status: 'active', credentialVersion: 1 },
          session: { id: 'session-activation', userId: 'user-activation', deviceId: 'device-activation', expiresAt: '2026-07-29T12:00:00.000Z' },
          offlineLease: finalizedLease,
          profile: { userId: 'user-activation', user: { id: 'user-activation', name: 'Activation user' }, activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-activation' },
        } }) };
      }
      throw new Error(`unexpected registration request ${url}`);
    },
  });
  const completedRegistration = await registrationClient.completeRegistration({
    pending: {
      baseUrl: 'http://identity.test', challengeSecret: 'challenge-secret',
      challenge: { id: 'challenge-activation', status: 'approved_pending_exchange', rowVersion: 4, purpose: 'register' },
    },
    password: 'test-password',
  });
  assert.deepStrictEqual(registrationRequests.map(request => request.url), [
    'http://identity.test/api/desktop-identity/challenges/challenge-activation/activation/exchange',
    'http://identity.test/api/desktop-identity/activations/activation-1/finalize',
  ]);
  assert.deepStrictEqual(registrationRequests[1].body, { signature: 'finalize-signature' });
  assert.strictEqual(completedRegistration.token, 'online-token-after-finalize');
  assert.deepStrictEqual(registrationEvents, [
    'sign:exchange', 'seal-local-vault', 'sign:activation-finalize', 'refresh-lease', 'save-session:online-token-after-finalize',
  ]);

  const bootstrapRequests = [];
  const bootstrapEvents = [];
  const bootstrapClient = createDesktopIdentityClient({
    desktopIdentity: {
      status: async () => ({ state: 'empty' }),
      signChallenge: async () => ({ signature: 'bootstrap-exchange-signature' }),
      completeRegistration: async input => {
        bootstrapEvents.push('seal-bootstrap-vault');
        assert.strictEqual(input.authorityContext, undefined,
          'the pre-epoch bootstrap identity must not manufacture an authority context');
        return {
          state: 'unlocked', unlocked: true, user: { id: 'bootstrap-admin' },
          deviceId: 'bootstrap-host', authorizationId: 'bootstrap-authorization',
          credentialVersion: 1, activeRole: 'super_admin', eligibleRoles: ['super_admin'],
          offlineLease: input.offlineLease,
        };
      },
    },
    sessionStore: {
      save: async value => bootstrapEvents.push(`save-bootstrap-session:${value.token}`),
      clear: async () => {},
    },
    fetchImpl: async (url, options) => {
      bootstrapRequests.push({ url, body: JSON.parse(options.body) });
      assert.ok(url.endsWith('/exchange'), 'a pre-epoch primary host must use the approved-device exchange only');
      assert.ok(!url.includes('/activation/exchange'), 'a pre-epoch primary host must not require a nonexistent authority epoch');
      return { ok: true, json: async () => ({ success: true, data: {
        token: 'bootstrap-session-token',
        authorization: { id: 'bootstrap-authorization', userId: 'bootstrap-admin', deviceId: 'bootstrap-host', status: 'active', credentialVersion: 1 },
        session: { id: 'bootstrap-session', userId: 'bootstrap-admin', deviceId: 'bootstrap-host', activeRole: 'super_admin', eligibleRoles: ['super_admin'], expiresAt: '2026-07-29T12:00:00.000Z' },
        offlineLease: { id: 'bootstrap-lease', userId: 'bootstrap-admin', deviceId: 'bootstrap-host', authorizationId: 'bootstrap-authorization', credentialVersion: 1, activeRole: 'super_admin', eligibleRoles: ['super_admin'], issuedAt: '2026-07-28T00:00:00.000Z', expiresAt: '2026-08-11T00:00:00.000Z', scope: { kind: 'all' } },
        profile: { userId: 'bootstrap-admin', user: { id: 'bootstrap-admin', name: 'Bootstrap admin' }, activeRole: 'super_admin', eligibleRoles: ['super_admin'] },
      } }) };
    },
  });
  const bootstrapResult = await bootstrapClient.completeRegistration({
    pending: {
      baseUrl: 'http://identity.test', challengeSecret: 'bootstrap-secret', bootstrapHostEnrollment: true,
      publicIdentity: { deviceKind: 'primary-host' },
      challenge: { id: 'bootstrap-challenge', status: 'approved_pending_exchange', rowVersion: 2, purpose: 'register' },
    },
    password: 'test-password',
  });
  assert.deepStrictEqual(bootstrapRequests.map(request => request.url), [
    'http://identity.test/api/desktop-identity/challenges/bootstrap-challenge/exchange',
  ]);
  assert.deepStrictEqual(bootstrapEvents, ['seal-bootstrap-vault', 'save-bootstrap-session:bootstrap-session-token']);
  assert.strictEqual(bootstrapResult.token, 'bootstrap-session-token');

  let passwordResetRequest = null;
  const primaryHostResetClient = createDesktopIdentityClient({
    desktopIdentity: {
      status: async () => ({ state: 'sealed' }),
      beginPasswordReset: async () => ({
        deviceId: 'primary-host-device',
        deviceName: 'Primary host',
        deviceKind: 'primary-host',
        publicKey: 'primary-host-next-public-key',
        keyFingerprint: 'a'.repeat(64),
      }),
    },
    fetchImpl: async (_url, options) => {
      passwordResetRequest = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ success: true, data: { challenge: { id: 'challenge-primary-host-reset', challengeSecret: 'test-secret' } } }),
      };
    },
  });
  await primaryHostResetClient.beginPasswordReset({ baseUrl: 'http://127.0.0.1:41235' });
  assert.strictEqual(
    passwordResetRequest.deviceKind,
    'primary-host',
    'a primary-host password reset must preserve its registered device kind'
  );

  let unifiedRegistrationRequest = null;
  let unexpectedNetworkCalls = 0;
  const unifiedRegistrationClient = createDesktopIdentityClient({
    desktopIdentity: { status: async () => ({ state: 'empty' }) },
    fetchImpl: async () => {
      unexpectedNetworkCalls += 1;
      throw new Error('the synthetic command bridge must not invent a network route');
    },
    onlineRegistrationCommand: createUnifiedDesktopRegistrationCommand({
      invoke: async request => {
        unifiedRegistrationRequest = request;
        return Object.freeze({
          receiptId: 'registration-receipt-1',
          sessionId: 'registration-session-1',
          replayed: false,
        });
      },
    }),
  });
  assert.deepStrictEqual(
    await unifiedRegistrationClient.registerUnifiedDesktopOnline({
      assertionId: 'verified-assertion-1',
      idempotencyKey: 'desktop-registration-1',
    }),
    {
      receiptId: 'registration-receipt-1',
      sessionId: 'registration-session-1',
      replayed: false,
    },
    'the existing desktop identity client must be able to trigger the new registration command',
  );
  assert.deepStrictEqual(unifiedRegistrationRequest, {
    assertionId: 'verified-assertion-1',
    idempotencyKey: 'desktop-registration-1',
  });
  assert.strictEqual(unexpectedNetworkCalls, 0,
    'the command bridge must remain transport-injected until a reviewed cloud endpoint exists');

  console.log('desktop identity client checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
