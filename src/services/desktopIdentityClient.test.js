const assert = require('assert');
require('./desktopQuestionPagination.test');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createUnifiedDesktopRegistrationCommand,
} = require('../../shared/vnext-pg17/unifiedDesktopRegistrationCommand');
const { createDesktopIdentityVault } = require('../../public/desktopIdentityVault');

function mockSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(String(value), 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8'),
  };
}

function signedOfflineLease(privateKey, input) {
  const lease = {
    v: 1,
    id: input.id,
    userId: input.userId,
    deviceId: input.deviceId,
    authorizationId: input.authorizationId,
    credentialVersion: input.credentialVersion,
    eligibleRoles: input.eligibleRoles,
    activeRole: input.activeRole,
    teacherId: input.teacherId ?? null,
    studentId: input.studentId ?? null,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    scope: input.activeRole === 'teacher'
      ? { kind: 'teacher', teacherId: input.teacherId }
      : { kind: input.activeRole },
  };
  return {
    ...lease,
    signature: crypto.sign(null, Buffer.from(JSON.stringify(lease), 'utf8'), privateKey).toString('base64url'),
  };
}

async function main() {
  const source = fs.readFileSync('src/services/desktopIdentityClient.mjs', 'utf8');
  const {
    canStartBusinessRuntime,
    createDesktopIdentityClient,
    isDesktopIdentityNetworkFailure,
    partitionKeyForIdentity,
    preferredActiveRole,
    resolveDesktopGateState,
  } = await import('./desktopIdentityClient.mjs');
  const { normalizeDesktopAuthorizationSession } = await import('./desktopAuthorizationSession.mjs');
  assert.ok(!source.includes('desktopSessionRelayClient'));
  assert.ok(!source.includes('exchangeDesktopSessionThroughRelay'));
  assert.ok(!source.includes('ensureHostSyncSession'));
  assert.strictEqual(preferredActiveRole(['admin']), null, 'retired ordinary-admin roles must never become an active desktop role');
  assert.strictEqual(preferredActiveRole(['parent']), null, 'family members bind to a student and do not become a separate desktop role');
  assert.strictEqual(preferredActiveRole(['visitor']), null, 'visitors must not become a desktop role');
  assert.strictEqual(preferredActiveRole(['student']), null, 'students must not become a role in the teacher desktop');

  assert.deepStrictEqual(resolveDesktopGateState({ vaultStatus: { state: 'empty' } }), {
    kind: 'registration-required',
  });
  assert.deepStrictEqual(resolveDesktopGateState({
    vaultStatus: { state: 'sealed', unlocked: false, deviceId: 'device-1' },
  }), { kind: 'locked', deviceId: 'device-1' });

  const currentAdminVault = {
    state: 'unlocked', unlocked: true,
    user: { id: 'scope-user-1' }, deviceId: 'scope-device-1', authorizationId: 'scope-admin-session-current',
    activeRole: 'super_admin', eligibleRoles: ['super_admin', 'teacher'], teacherId: null, studentId: null,
  };
  const currentAdminRenderer = {
    token: 'scope-admin-token', expiresAt: '2026-09-02T00:00:00.000Z',
    session: {
      id: 'scope-admin-session-current', userId: 'scope-user-1', deviceId: 'scope-device-1',
      activeRole: 'super_admin', eligibleRoles: ['teacher', 'super_admin'], teacherId: null, studentId: null,
      expiresAt: '2026-09-02T00:00:00.000Z',
    },
    profile: {
      userId: 'scope-user-1', activeRole: 'super_admin', eligibleRoles: ['super_admin', 'teacher'],
      teacherId: null, studentId: null,
    },
  };
  assert.strictEqual(resolveDesktopGateState({
    vaultStatus: currentAdminVault, online: true, onlineSession: currentAdminRenderer,
    now: new Date('2026-09-01T00:00:00.000Z'),
  }).kind, 'online-unlocked', 'eligible role order must not invalidate an otherwise identical cloud session');
  const staleSessionCases = [
    {
      name: 'authorization id',
      onlineSession: {
        ...currentAdminRenderer,
        session: { ...currentAdminRenderer.session, id: 'scope-teacher-session-old' },
      },
    },
    {
      name: 'active role',
      onlineSession: {
        ...currentAdminRenderer,
        session: {
          ...currentAdminRenderer.session, activeRole: 'teacher', teacherId: 'scope-teacher-1', studentId: null,
        },
        profile: {
          ...currentAdminRenderer.profile, activeRole: 'teacher', teacherId: 'scope-teacher-1', studentId: null,
        },
      },
    },
    {
      name: 'eligible roles',
      onlineSession: {
        ...currentAdminRenderer,
        session: { ...currentAdminRenderer.session, eligibleRoles: ['super_admin'] },
      },
    },
    {
      name: 'admin scope',
      onlineSession: {
        ...currentAdminRenderer,
        session: { ...currentAdminRenderer.session, teacherId: 'scope-teacher-stale' },
      },
    },
  ];
  for (const scenario of staleSessionCases) {
    assert.strictEqual(resolveDesktopGateState({
      vaultStatus: currentAdminVault, online: true, onlineSession: scenario.onlineSession,
      now: new Date('2026-09-01T00:00:00.000Z'),
    }).kind, 'online-authentication-required', `renderer session with stale ${scenario.name} must be rejected`);
  }
  const currentTeacherVault = {
    ...currentAdminVault, authorizationId: 'scope-teacher-session-current', activeRole: 'teacher',
    teacherId: 'scope-teacher-current', studentId: null,
  };
  const currentTeacherRenderer = {
    ...currentAdminRenderer,
    session: {
      ...currentAdminRenderer.session, id: 'scope-teacher-session-current', activeRole: 'teacher',
      teacherId: 'scope-teacher-old', studentId: null,
    },
    profile: {
      ...currentAdminRenderer.profile, activeRole: 'teacher', teacherId: 'scope-teacher-old', studentId: null,
    },
  };
  assert.strictEqual(resolveDesktopGateState({
    vaultStatus: currentTeacherVault, online: true, onlineSession: currentTeacherRenderer,
    now: new Date('2026-09-01T00:00:00.000Z'),
  }).kind, 'online-authentication-required', 'teacher sessions must match the vault teacher scope exactly');

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
  assert.throws(
    () => partitionKeyForIdentity({ userId: 'student-only', activeRole: 'student', studentId: 'student-1' }),
    error => error.code === 'DESKTOP_IDENTITY_PARTITION_INVALID',
    'student identities must never create a teacher-desktop data partition',
  );

  const client = createDesktopIdentityClient({
    desktopIdentity: { status: async () => ({ state: 'empty' }) },
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: true }) }),
  });
  assert.strictEqual(typeof client.completeSingleUserPairing, 'undefined');
  assert.ok(!/single[_-]?user|singleUser/i.test(source), 'identity client must contain no retired architecture path');
  assert.ok(source.includes('/api/desktop/online-registration')
    && source.includes("purpose: 'unified-online-registration'"),
  'registration must use the cloud verification ticket and device proof before saving an online session');
  assert.strictEqual(
    isDesktopIdentityNetworkFailure(Object.assign(new Error('service unavailable'), {
      code: 'CLOUD_ONLINE_IDENTITY_UNAVAILABLE',
    })),
    true,
    'a cloud 503 during cold-start session recovery must allow a still-valid offline lease fallback',
  );
  assert.strictEqual(
    isDesktopIdentityNetworkFailure(Object.assign(new Error('device revoked'), {
      code: 'DESKTOP_DEVICE_NOT_ACTIVE',
    })),
    false,
    'an explicit device revocation must never be mistaken for a network outage',
  );
  assert.strictEqual(
    isDesktopIdentityNetworkFailure(Object.assign(new Error('authorization revoked'), {
      code: 'VNEXT_DESKTOP_AUTHORIZATION_INVALID',
    })),
    false,
    'the stable cloud authorization-revoked code must never be treated as an outage',
  );
  let insecurePasswordRequests = 0;
  const insecurePasswordClient = createDesktopIdentityClient({
    desktopIdentity: {
      status: async () => ({ state: 'empty' }),
      beginUnifiedOnlineRegistration: async () => { throw new Error('must not create a local key'); },
    },
    fetchImpl: async () => { insecurePasswordRequests += 1; throw new Error('must not send credentials'); },
  });
  await assert.rejects(
    () => insecurePasswordClient.beginPasswordVerification({
      baseUrl: 'http://identity.example.test',
      idempotencyKey: 'insecure-password-login',
      loginType: 'account_name',
      login: 'fixture-user',
      password: 'fixture-password',
    }),
    error => error.code === 'DESKTOP_IDENTITY_INSECURE_BASE_URL',
    'password credentials must never be sent over cleartext HTTP to a remote host',
  );
  assert.strictEqual(insecurePasswordRequests, 0);

  const resumedOfflineLease = { id: 'lease-resume-1' };
  const resumeEvents = [];
  let resumedSessionStored = null;
  const resumedVaultStatus = {
    state: 'unlocked', unlocked: true,
    user: { id: 'user-resume-1', name: 'Resume User' },
    deviceId: 'device-resume-1', authorizationId: 'authorization-resume-1', credentialVersion: 1,
    activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-resume-1',
  };
  const resumeClient = createDesktopIdentityClient({
    now: () => new Date('2026-08-25T10:00:00.000Z'),
    desktopIdentity: {
      status: async () => ({ state: 'sealed' }),
      resume: async () => resumedVaultStatus,
      signChallenge: async input => {
        resumeEvents.push({ action: 'sign', input });
        return { signature: 'resume-signature-1' };
      },
      acceptIssuedSession: async input => {
        resumeEvents.push({ action: 'accept-issued-session', input });
        return {
          ...resumedVaultStatus,
          authorizationId: input.session.id,
          activeRole: input.session.activeRole,
          eligibleRoles: input.session.eligibleRoles,
          teacherId: input.session.teacherId ?? null,
          studentId: input.session.studentId ?? null,
          offlineLease: input.offlineLease,
        };
      },
    },
    sessionStore: {
      save: async value => { resumedSessionStored = value; },
      clear: async () => {},
    },
    fetchImpl: async (url, options = {}) => {
      resumeEvents.push({ action: 'request', url, body: options.body ? JSON.parse(options.body) : null });
      if (url.endsWith('/api/desktop-identity/session/challenges/start')) {
        return { ok: true, json: async () => ({ success: true, data: { challenge: {
          id: 'session-challenge-resume-1', authorizationId: 'authorization-resume-1',
          credentialVersion: 1, nonce: 'resume-nonce-1', nonceIssuedAt: '2026-08-25T10:00:00.000Z', rowVersion: 1,
        } } }) };
      }
      return { ok: true, json: async () => ({ success: true, data: {
        token: 'session-token-resume-1',
        session: {
          id: 'session-resume-1', userId: 'user-resume-1', deviceId: 'device-resume-1',
          activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-resume-session', studentId: null,
          expiresAt: '2026-08-25T11:00:00.000Z',
        },
        profile: {
          userId: 'user-resume-1', user: { id: 'user-resume-1', name: 'Resume User' },
          activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-resume-profile-stale',
          studentId: 'student-resume-profile-stale',
        },
        offlineLease: resumedOfflineLease,
      } }) };
    },
  });
  const resumed = await resumeClient.resume({ baseUrl: 'https://cloud.test', online: true });
  assert.strictEqual(resumed.gateState.kind, 'online-unlocked');
  assert.strictEqual(resumedSessionStored.token, 'session-token-resume-1');
  assert.strictEqual(resumedSessionStored.profile.teacherId, 'teacher-resume-session',
    'online recovery must prefer the new session scope over a stale returned profile scope');
  assert.strictEqual(resumedSessionStored.profile.studentId, null,
    'online recovery must clear the non-active student scope');
  const resumedIssuedAcceptance = resumeEvents.find(event => event.action === 'accept-issued-session').input;
  assert.deepStrictEqual(resumedIssuedAcceptance.session, resumed.session);
  assert.strictEqual(resumedIssuedAcceptance.profile.activeRole, 'teacher');
  assert.deepStrictEqual(resumedIssuedAcceptance.profile.eligibleRoles, ['teacher']);
  assert.strictEqual(resumedIssuedAcceptance.profile.teacherId, 'teacher-resume-session');
  assert.strictEqual(resumedIssuedAcceptance.profile.studentId, null,
    'the real vault must receive the normalized session scope rather than stale raw profile fields');
  assert.deepStrictEqual(resumedIssuedAcceptance.offlineLease, resumedOfflineLease,
    'online resume must atomically accept the cloud-issued session, profile, and signed lease');
  assert.deepStrictEqual(
    resumeEvents.filter(event => event.action === 'request').map(event => event.url),
    [
      'https://cloud.test/api/desktop-identity/session/challenges/start',
      'https://cloud.test/api/desktop-identity/session/challenges/session-challenge-resume-1/exchange',
    ],
  );

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
          activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-cloud-1', offlineLease: null,
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
        return { ok: true, json: async () => ({ ok: true, pairingId: 'pairing-cloud-1', pairingSecret: 'pairing-secret-1', expiresAt: '2026-08-21T12:05:00.000Z', qrImageDataUrl: 'data:image/png;base64,cHJvZHVjdGlvbi1xci1jb2Rl' }) };
      }
      if (url === 'https://cloud.test/api/desktop/pairing/pairing-cloud-1?secret=pairing-secret-1') {
        return { ok: true, json: async () => ({ ok: true, status: 'verified', verificationToken: 'verification-token-1', deviceChallenge: 'cloud-device-proof-1' }) };
      }
      if (url === 'https://cloud.test/api/desktop/teacher-self-registration') {
        assert.strictEqual(options.method, 'POST');
        assert.deepStrictEqual(JSON.parse(options.body), {
          verificationToken: 'verification-token-1', name: 'Cloud Teacher', subject: 'Math',
        });
        return { ok: true, json: async () => ({ ok: true, teacherId: 'teacher-cloud-1', updatedAt: '2026-08-21T12:00:00.000Z', replayed: false }) };
      }
      if (url === 'https://cloud.test/api/desktop/verified-access') {
        assert.strictEqual(options.method, 'POST');
        assert.deepStrictEqual(JSON.parse(options.body), { verificationToken: 'verification-token-1' });
        return { ok: true, json: async () => ({ ok: true, access: 'teacher_registration_required', roles: [], teacherId: null }) };
      }
      if (url === 'https://cloud.test/api/desktop/online-registration') {
        return { ok: true, json: async () => ({ ok: true, receiptId: 'receipt-cloud-1', sessionId: 'session-cloud-1', replayed: false, sessionToken: 'session-token-cloud-1', offlineLease: {
          id: 'cloud-lease-1', userId: 'account-cloud-1', deviceId: 'desktop-device-a1b2c3d4e5f60708', authorizationId: 'session-cloud-1',
          credentialVersion: 1, eligibleRoles: ['teacher'], activeRole: 'teacher', teacherId: 'teacher-cloud-1', studentId: null,
          issuedAt: '2026-08-21T12:00:00.000Z', expiresAt: '2026-08-21T13:00:00.000Z', scope: { kind: 'teacher', teacherId: 'teacher-cloud-1' }, signature: 'cloud-lease-signature-1',
        } }) };
      }
      if (url === 'https://cloud.test/api/desktop/session-context') {
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        return { ok: true, json: async () => ({ ok: true,
          authorityId: 'authority-cloud-1', accountId: 'account-cloud-1',
          deviceId: 'desktop-device-a1b2c3d4e5f60708', installationId: 'desktop-device-a1b2c3d4e5f60708',
          sessionId: 'session-cloud-1', expiresAt: '2026-08-21T13:00:00.000Z', rowVersion: 1, activeRole: 'teacher', roles: ['teacher'], teacherId: 'teacher-cloud-1', studentId: null,
        }) };
      }
      if (url === 'https://cloud.test/api/business/schedules') {
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        if (options.method === 'POST') {
          assert.deepStrictEqual(JSON.parse(options.body), {
            scheduleId: 'schedule-cloud-new-1',
            data: {
              courseId: 'course-cloud-1', startAt: '2026-08-23T01:00:00.000Z', endAt: '2026-08-23T02:00:00.000Z',
              recurringRule: null, status: 1, roomDisplay: 'Cloud room', serviceType: 1,
              tuition: 120, teacherFee: 60, notes: null,
              pricings: [{ studentId: 'student-cloud-1', attendanceStatus: 1, tuition: 120, teacherFee: 60 }],
            },
          });
          return { ok: true, json: async () => ({ ok: true, schedule: { id: 'schedule-cloud-new-1', updatedAt: '2026-08-23T00:00:00.000Z' } }) };
        }
        return { ok: true, json: async () => ({ ok: true, schedules: [{ id: 'schedule-cloud-1', courseId: 'course-cloud-1' }] }) };
      }
      if (url === 'https://cloud.test/api/business/desktop-projection') {
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        return { ok: true, json: async () => ({ ok: true, projection: { students: [], student_contacts: [], teachers: [], courses: [], schedules: [], institutions: [], schools: [], rooms: [], grades: [], payments: [], consumptions: [], assetRecords: [], assetCategories: [], taxonomy_systems: [], taxonomy_nodes: [] } }) };
      }
      if (url === 'https://cloud.test/api/desktop/question-bank/questions?limit=200') {
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        return { ok: true, json: async () => ({ ok: true, nextCursor: null, questions: [{ id: 'question-cloud-1', content: 'Cloud question text', version: 4 }] }) };
      }
      if (url === `https://cloud.test/api/desktop/question-bank/assets/${'a'.repeat(64)}/delivery`) {
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        return { ok: true, json: async () => ({ ok: true, delivery: { deliveryId: 'question_asset_delivery_12345678', status: 'ready', mimeType: 'image/png' } }) };
      }
      if (url === 'https://cloud.test/api/desktop/question-bank/asset-deliveries/question_asset_delivery_12345678/download') {
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        return { ok: true, arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer };
      }
      if (url === 'https://cloud.test/api/business/schedules/schedule-cloud-1') {
        if (options.method === 'DELETE') {
          assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
          assert.deepStrictEqual(JSON.parse(options.body), { expectedUpdatedAt: '2026-08-22T00:00:00.000Z' });
          return { ok: true, json: async () => ({ ok: true, schedule: { id: 'schedule-cloud-1', updatedAt: '2026-08-22T00:01:00.000Z' } }) };
        }
        assert.strictEqual(options.method, 'PUT');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        assert.deepStrictEqual(JSON.parse(options.body), {
          expectedUpdatedAt: '2026-08-21T01:00:00.000Z', courseId: 'course-cloud-2',
          startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z',
          recurringRule: '{"frequency":"weekly"}', status: 2, roomDisplay: 'Cloud room', serviceType: 2,
          tuition: 120, teacherFee: 60, notes: 'cloud update',
          pricings: [{ studentId: 'student-cloud-1', attendanceStatus: 4, tuition: 80, teacherFee: 40 }],
        });
        return { ok: true, json: async () => ({ ok: true, schedule: { id: 'schedule-cloud-1', updatedAt: '2026-08-22T00:00:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/institutions') {
        assert.strictEqual(options.method, 'POST');
        return { ok: true, json: async () => ({ ok: true, institution: { id: 'institution-cloud-1', updatedAt: '2026-08-24T04:00:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/institutions/institution-cloud-1') {
        return { ok: true, json: async () => ({ ok: true, institution: { id: 'institution-cloud-1', updatedAt: options.method === 'PUT' ? '2026-08-24T04:01:00.000Z' : '2026-08-24T04:02:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/schools') {
        assert.strictEqual(options.method, 'POST');
        return { ok: true, json: async () => ({ ok: true, school: { id: 'school-cloud-1', updatedAt: '2026-08-24T04:00:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/schools/school-cloud-1') {
        return { ok: true, json: async () => ({ ok: true, school: { id: 'school-cloud-1', updatedAt: options.method === 'PUT' ? '2026-08-24T04:01:00.000Z' : '2026-08-24T04:02:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/students/student-cloud-1') {
        if (options.method === 'DELETE') {
          assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
          assert.deepStrictEqual(JSON.parse(options.body), { expectedUpdatedAt: '2026-08-23T00:04:00.000Z' });
          return { ok: true, json: async () => ({ ok: true, student: { id: 'student-cloud-1', updatedAt: '2026-08-23T00:05:00.000Z' } }) };
        }
        assert.strictEqual(options.method, 'PUT');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        assert.deepStrictEqual(JSON.parse(options.body), {
          expectedUpdatedAt: '2026-08-22T00:00:00.000Z', name: 'Student cloud updated', school: 'Cloud school',
          gradeYear: 2024, gradeCurrent: 'Grade two', institutionId: null, parentName: 'Cloud parent', notes: 'cloud student update', sourceType: 1, studentSource: 'Referral',
        });
        return { ok: true, json: async () => ({ ok: true, student: { id: 'student-cloud-1', updatedAt: '2026-08-23T00:02:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/students') {
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        assert.deepStrictEqual(JSON.parse(options.body), {
          studentId: 'student-cloud-new-1', name: 'New student', school: null, gradeYear: 2025,
          gradeCurrent: null, institutionId: null, parentName: null, notes: null, sourceType: 1,
          studentSource: 'Referral', contacts: [{ slot: 1, relationship: 'student', phone: '13800138001', wechat: null }],
        });
        return { ok: true, json: async () => ({ ok: true, student: { id: 'student-cloud-new-1', updatedAt: '2026-08-23T00:04:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/teachers') {
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        assert.deepStrictEqual(JSON.parse(options.body), { teacherId: 'teacher-cloud-1', name: 'New teacher', phone: '13800138002', subject: 'math', hourlyRate: 100, notes: null });
        return { ok: true, json: async () => ({ ok: true, teacher: { id: 'teacher-cloud-1', updatedAt: '2026-08-23T00:06:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/rooms') {
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        assert.deepStrictEqual(JSON.parse(options.body), { roomId: 'room-cloud-1', name: 'Cloud room', address: 'Cloud address' });
        return { ok: true, json: async () => ({ ok: true, room: { id: 'room-cloud-1', updatedAt: '2026-08-23T00:09:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/courses') {
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        assert.deepStrictEqual(JSON.parse(options.body), { courseId: 'course-cloud-1', data: { name: 'Course cloud', year: 2026, semester: 'spring', displayName: 'Course cloud', type: 1, sourceType: 1, institutionId: null, priceTuition: 100, priceTeacher: 50, billingUnit: 1, teacherFeeMode: 1, roomId: 'room-cloud-1', roomName: 'ignored', teacherId: 'teacher-cloud-1', teacherName: 'ignored', active: true, defaultDurationMinutes: 60, notes: null, pricings: [{ studentId: 'student-cloud-1', tuition: 100, teacherFee: 50 }] } });
        return { ok: true, json: async () => ({ ok: true, course: { id: 'course-cloud-1', updatedAt: '2026-08-23T00:12:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/courses/course-cloud-1') {
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        if (options.method === 'DELETE') {
          assert.deepStrictEqual(JSON.parse(options.body), { expectedUpdatedAt: '2026-08-23T00:13:00.000Z' });
          return { ok: true, json: async () => ({ ok: true, course: { id: 'course-cloud-1', updatedAt: '2026-08-23T00:14:00.000Z' } }) };
        }
        assert.strictEqual(options.method, 'PUT');
        assert.deepStrictEqual(JSON.parse(options.body), { expectedUpdatedAt: '2026-08-23T00:12:00.000Z', name: 'Course cloud updated', year: 2026, semester: 'autumn', displayName: 'Course cloud updated', type: 1, sourceType: 1, institutionId: null, priceTuition: 80, priceTeacher: 40, billingUnit: 1, teacherFeeMode: 1, roomId: 'room-cloud-1', roomName: 'ignored', teacherId: 'teacher-cloud-1', teacherName: 'ignored', active: false, defaultDurationMinutes: 60, notes: 'note', pricings: [] });
        return { ok: true, json: async () => ({ ok: true, course: { id: 'course-cloud-1', updatedAt: '2026-08-23T00:13:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/rooms/room-cloud-1') {
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        if (options.method === 'DELETE') {
          assert.deepStrictEqual(JSON.parse(options.body), { expectedUpdatedAt: '2026-08-23T00:10:00.000Z' });
          return { ok: true, json: async () => ({ ok: true, room: { id: 'room-cloud-1', updatedAt: '2026-08-23T00:11:00.000Z' } }) };
        }
        assert.strictEqual(options.method, 'PUT');
        assert.deepStrictEqual(JSON.parse(options.body), { expectedUpdatedAt: '2026-08-23T00:09:00.000Z', name: 'Updated room', address: null });
        return { ok: true, json: async () => ({ ok: true, room: { id: 'room-cloud-1', updatedAt: '2026-08-23T00:10:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/teachers/teacher-cloud-1') {
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        if (options.method === 'DELETE') {
          assert.deepStrictEqual(JSON.parse(options.body), { expectedUpdatedAt: '2026-08-23T00:07:00.000Z' });
          return { ok: true, json: async () => ({ ok: true, teacher: { id: 'teacher-cloud-1', updatedAt: '2026-08-23T00:08:00.000Z' } }) };
        }
        assert.strictEqual(options.method, 'PUT');
        assert.deepStrictEqual(JSON.parse(options.body), { expectedUpdatedAt: '2026-08-23T00:06:00.000Z', name: 'Updated teacher', phone: null, subject: 'physics', hourlyRate: null, notes: 'note' });
        return { ok: true, json: async () => ({ ok: true, teacher: { id: 'teacher-cloud-1', updatedAt: '2026-08-23T00:07:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/students/student-cloud-1/record') {
        assert.strictEqual(options.method, 'PUT');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        assert.deepStrictEqual(JSON.parse(options.body), {
          expectedUpdatedAt: '2026-08-23T00:02:00.000Z', name: 'Student record', school: null,
          gradeYear: null, gradeCurrent: null, institutionId: null, parentName: null, notes: null,
          sourceType: 1, studentSource: 'Referral', contacts: [{ slot: 1, relationship: 'student', phone: '13800138000', wechat: null, expectedUpdatedAt: null }],
        });
        return { ok: true, json: async () => ({ ok: true, student: { id: 'student-cloud-1', updatedAt: '2026-08-23T00:03:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/schedules/schedule-cloud-1/students/student-cloud-1') {
        assert.strictEqual(options.method, 'PUT');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        assert.deepStrictEqual(JSON.parse(options.body), {
          expectedUpdatedAt: '2026-08-22T00:00:00.000Z', attendanceStatus: 4, tuition: 80, teacherFee: 40,
        });
        return { ok: true, json: async () => ({ ok: true, schedule: { id: 'schedule-cloud-1', updatedAt: '2026-08-22T00:01:00.000Z' } }) };
      }
      if (url === 'https://cloud.test/api/business/students/student-cloud-1/contacts/2') {
        assert.strictEqual(options.method, 'PUT');
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        assert.deepStrictEqual(JSON.parse(options.body), { expectedUpdatedAt: null, relationship: 'guardian', phone: null, wechat: 'guardian-handle' });
        return { ok: true, json: async () => ({ ok: true, contact: { id: 'student-contact-student-cloud-1-2', studentId: 'student-cloud-1', slot: 2, relationship: 'guardian', phone: null, wechat: 'guardian-handle', status: 'active', updatedAt: '2026-08-23T00:00:00.000Z' } }) };
      }
      const supplemental = /^https:\/\/cloud\.test\/api\/business\/(payments|consumptions|grades|personal-asset-categories|personal-asset-records)(?:\/([^/]+))?$/.exec(url);
      if (supplemental) {
        const settings = {
          payments: ['payment', 'paymentId'], consumptions: ['consumption', 'consumptionId'], grades: ['grade', 'gradeId'],
          'personal-asset-categories': ['category', 'categoryId'], 'personal-asset-records': ['record', 'recordId'],
        }[supplemental[1]];
        const body = JSON.parse(options.body); const id = supplemental[2] || body[settings[1]];
        assert.strictEqual(options.headers.Authorization, 'Bearer session-token-cloud-1');
        return { ok: true, json: async () => ({ ok: true, [settings[0]]: { id, updatedAt: '2026-08-24T07:00:00.000Z' } }) };
      }
      throw new Error(`unexpected unified cloud request ${url}`);
    },
  });
  const unifiedPending = await unifiedCloudClient.beginUnifiedOnlineRegistration({
    baseUrl: 'https://cloud.test', deviceName: 'Unified cloud desktop', idempotencyKey: 'unified-registration-1',
  });
  assert.strictEqual(unifiedPending.status, 'awaiting_online_verification',
    'a newly rendered WeChat code must start the desktop gate polling without a manual refresh');
  assert.strictEqual(unifiedPending.qrImageDataUrl, 'data:image/png;base64,cHJvZHVjdGlvbi1xci1jb2Rl');
  assert.strictEqual(unifiedPending.qrValue, undefined);
  const unifiedVerified = await unifiedCloudClient.pollUnifiedOnlineRegistration(unifiedPending);
  assert.deepStrictEqual(unifiedVerified.desktopAccess, { access: 'teacher_registration_required', roles: [], teacherId: null });
  await assert.rejects(
    () => unifiedCloudClient.completeUnifiedOnlineRegistration({ pending: unifiedVerified }),
    error => error.code === 'DESKTOP_TEACHER_REGISTRATION_REQUIRED',
    'a verified visitor or student must not silently register a desktop device before becoming a teacher',
  );
  const selfRegisteredTeacher = await unifiedCloudClient.registerTeacherForVerifiedRegistration({
    pending: unifiedVerified,
    name: 'Cloud Teacher',
    subject: 'Math',
  });
  assert.deepStrictEqual(selfRegisteredTeacher, {
    teacherId: 'teacher-cloud-1', updatedAt: '2026-08-21T12:00:00.000Z', replayed: false,
    desktopAccess: { access: 'allowed', roles: ['teacher'], teacherId: 'teacher-cloud-1' },
  });
  const unifiedCompleted = await unifiedCloudClient.completeUnifiedOnlineRegistration({
    pending: { ...unifiedVerified, desktopAccess: selfRegisteredTeacher.desktopAccess },
    password: 'unified-local-password',
  });
  assert.strictEqual(unifiedCompleted.session.rowVersion, 1, 'cloud session row version is required for signed role elevation');
  assert.deepStrictEqual(unifiedCloudRequests.map(entry => entry.url), [
    'https://cloud.test/api/desktop/pairing/start',
    'https://cloud.test/api/desktop/pairing/pairing-cloud-1?secret=pairing-secret-1',
    'https://cloud.test/api/desktop/verified-access',
    'https://cloud.test/api/desktop/teacher-self-registration',
    'https://cloud.test/api/desktop/online-registration',
    'https://cloud.test/api/desktop/session-context',
  ]);
  assert.deepStrictEqual(unifiedCloudRequests[0].body, {
    installationId: 'desktop-device-a1b2c3d4e5f60708', installationPublicKey: 'unified-public-key', idempotencyKey: 'unified-registration-1',
  });
  assert.deepStrictEqual(unifiedCloudRequests[2].body, { verificationToken: 'verification-token-1' });
  assert.deepStrictEqual(unifiedCloudRequests[3].body, {
    verificationToken: 'verification-token-1', name: 'Cloud Teacher', subject: 'Math',
  });
  assert.deepStrictEqual(unifiedCloudRequests[4].body, {
    verificationToken: 'verification-token-1', installationId: 'desktop-device-a1b2c3d4e5f60708',
    installationPublicKey: 'unified-public-key', deviceProof: 'unified-device-proof', idempotencyKey: 'unified-registration-1',
  });
  assert.deepStrictEqual(unifiedCloudSealed.offlineLease, {
    id: 'cloud-lease-1', userId: 'account-cloud-1', deviceId: 'desktop-device-a1b2c3d4e5f60708', authorizationId: 'session-cloud-1',
    credentialVersion: 1, eligibleRoles: ['teacher'], activeRole: 'teacher', teacherId: 'teacher-cloud-1', studentId: null,
    issuedAt: '2026-08-21T12:00:00.000Z', expiresAt: '2026-08-21T13:00:00.000Z', scope: { kind: 'teacher', teacherId: 'teacher-cloud-1' }, signature: 'cloud-lease-signature-1',
  }, 'a new unified registration seals only the cloud-issued, device-bound offline lease');
  assert.strictEqual(unifiedCloudSealed.authorization.userId, 'account-cloud-1');
  assert.deepStrictEqual(unifiedCloudSealed.profile.eligibleRoles, ['teacher']);
  assert.strictEqual(unifiedCloudSealed.profile.activeRole, 'teacher',
    'a verified teacher account must register silently without a super-admin role');
  assert.strictEqual(unifiedCloudSealed.profile.teacherId, 'teacher-cloud-1',
    'a teacher lease must carry the cloud-resolved teacher subject rather than inventing one locally');
  assert.deepStrictEqual(unifiedCloudEvents, ['sign:unified-online-registration', 'seal-unified-cloud-vault', 'save-unified-cloud-session']);
  assert.strictEqual(unifiedCloudStored.token, 'session-token-cloud-1');
  assert.strictEqual(unifiedCompleted.gateState.kind, 'online-unlocked');
  assert.strictEqual(unifiedCompleted.profile.user.name, '\u6211\u7684\u8d26\u53f7',
    'the desktop shell must use natural Chinese when the cloud session has no display name');

  const recoveryRequests = [];
  let passwordRegistrationPending = false;
  let passwordClientStored = false;
  const passwordVerificationRequests = [];
  const passwordVerificationClient = createDesktopIdentityClient({
    desktopIdentity: {
      status: async () => ({ state: passwordRegistrationPending ? 'unified_online_registration_pending' : 'empty' }),
      beginUnifiedOnlineRegistration: async () => {
        passwordRegistrationPending = true;
        return {
          deviceId: 'desktop-device-password-1', deviceName: 'Password cloud desktop', deviceKind: 'desktop-client',
          publicKey: 'password-public-key', keyFingerprint: 'b'.repeat(64),
        };
      },
    },
    sessionStore: { save: async () => { passwordClientStored = true; }, clear: async () => {} },
    fetchImpl: async (url, options) => {
      passwordVerificationRequests.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith('/api/desktop/verified-access')) {
        const verificationToken = JSON.parse(options.body).verificationToken;
        return verificationToken === 'password-verification-ticket'
          ? { ok: true, json: async () => ({ ok: true, access: 'allowed', roles: ['teacher'], teacherId: 'teacher-password-1' }) }
          : { ok: true, json: async () => ({ ok: true, access: 'teacher_registration_required', roles: [], teacherId: null }) };
      }
      if (url.endsWith('/api/desktop/password-enrollment-from-verification')) {
        return { ok: true, json: async () => ({ ok: true, verificationToken: 'already-verified-ticket', deviceChallenge: 'existing-device-proof' }) };
      }
      if (url.endsWith('/api/desktop/password-enrollment')) {
        return { ok: true, json: async () => ({ ok: true, verificationToken: 'password-enrollment-ticket', deviceChallenge: 'cloud-password-enrollment-proof' }) };
      }
      return { ok: true, json: async () => ({ ok: true, verificationToken: 'password-verification-ticket', deviceChallenge: 'cloud-password-device-proof' }) };
    },
  });
  const passwordPending = await passwordVerificationClient.beginPasswordVerification({
    baseUrl: 'https://cloud.test', deviceName: 'Password cloud desktop', idempotencyKey: 'password-registration-1',
    loginType: 'phone', login: '13800138000', password: 'correct horse battery staple',
  });
  assert.strictEqual((await passwordVerificationClient.status()).state, 'unified_online_registration_pending');
  assert.deepStrictEqual(passwordPending, {
    baseUrl: 'https://cloud.test',
    publicIdentity: {
      deviceId: 'desktop-device-password-1', deviceName: 'Password cloud desktop', deviceKind: 'desktop-client',
      publicKey: 'password-public-key', keyFingerprint: 'b'.repeat(64),
    },
    idempotencyKey: 'password-registration-1', status: 'verified',
    verificationToken: 'password-verification-ticket', deviceChallenge: 'cloud-password-device-proof',
    desktopAccess: { access: 'allowed', roles: ['teacher'], teacherId: 'teacher-password-1' },
  });
  assert.deepStrictEqual(passwordVerificationRequests, [
    { url: 'https://cloud.test/api/desktop/password-verification', body: { loginType: 'phone', login: '13800138000', password: 'correct horse battery staple' } },
    { url: 'https://cloud.test/api/desktop/verified-access', body: { verificationToken: 'password-verification-ticket' } },
  ]);
  assert.strictEqual(passwordClientStored, false, 'password verification must only produce an online registration pending state, never a local session or vault write');
  const enrollmentPending = await passwordVerificationClient.beginPasswordEnrollment({
    baseUrl: 'https://cloud.test', deviceName: 'Password enrollment desktop', idempotencyKey: 'password-enrollment-1',
    phoneCode: 'wechat-phone-proof', loginName: 'teacher.a', password: 'correct horse battery staple',
  });
  assert.strictEqual(enrollmentPending.status, 'verified');
  assert.strictEqual(enrollmentPending.verificationToken, 'password-enrollment-ticket');
  assert.strictEqual(enrollmentPending.deviceChallenge, 'cloud-password-enrollment-proof');
  assert.deepStrictEqual(enrollmentPending.desktopAccess, { access: 'teacher_registration_required', roles: [], teacherId: null });
  assert.deepStrictEqual(passwordVerificationRequests.at(-2), {
    url: 'https://cloud.test/api/desktop/password-enrollment',
    body: { phoneCode: 'wechat-phone-proof', loginName: 'teacher.a', password: 'correct horse battery staple' },
  });
  assert.deepStrictEqual(passwordVerificationRequests.at(-1), {
    url: 'https://cloud.test/api/desktop/verified-access', body: { verificationToken: 'password-enrollment-ticket' },
  });
  assert.strictEqual(passwordClientStored, false, 'password enrollment must also stop before any local vault or session persistence');
  const ticketEnrollmentPending = await passwordVerificationClient.enrollPasswordForVerifiedRegistration({
    pending: {
      baseUrl: 'https://cloud.test', idempotencyKey: 'ticket-registration-1', status: 'verified',
      verificationToken: 'already-verified-ticket', deviceChallenge: 'existing-device-proof',
      pairingId: 'pairing-verified-1', publicIdentity: enrollmentPending.publicIdentity,
    },
    loginName: 'teacher.ticket', password: 'ticket scoped correct password',
  });
  assert.strictEqual(ticketEnrollmentPending.cloudPasswordEnrolled, true);
  assert.strictEqual(ticketEnrollmentPending.verificationToken, 'already-verified-ticket', 'ticket enrollment must keep the existing short-lived registration ticket');
  assert.deepStrictEqual(passwordVerificationRequests.at(-1), {
    url: 'https://cloud.test/api/desktop/password-enrollment-from-verification',
    body: { verificationToken: 'already-verified-ticket', loginName: 'teacher.ticket', password: 'ticket scoped correct password' },
  });
  assert.strictEqual(passwordClientStored, false, 'ticket-scoped password enrollment must not persist a local vault or session');
  const cloudSchedules = await unifiedCloudClient.listCloudSchedules({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted,
  });
  assert.deepStrictEqual(cloudSchedules, [{ id: 'schedule-cloud-1', courseId: 'course-cloud-1' }]);
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/schedules');
  const cloudProjection = await unifiedCloudClient.listCloudBusinessProjection({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted,
  });
  assert.deepStrictEqual(cloudProjection, { students: [], student_contacts: [], teachers: [], courses: [], schedules: [], institutions: [], schools: [], rooms: [], grades: [], payments: [], consumptions: [], assetRecords: [], assetCategories: [], taxonomy_systems: [], taxonomy_nodes: [] });
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/desktop-projection');
  assert.deepStrictEqual(await unifiedCloudClient.createCloudPayment({ baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, paymentId: 'payment-cloud-1', studentId: 'student-cloud-1', amount: 800, paymentType: 1, paymentDate: '2026-08-24', paymentMethod: 'wechat', notes: null }), { id: 'payment-cloud-1', updatedAt: '2026-08-24T07:00:00.000Z' });
  assert.deepStrictEqual(await unifiedCloudClient.updateCloudPersonalAssetRecord({ baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, recordId: 'asset-cloud-1', expectedUpdatedAt: '2026-08-24T06:00:00.000Z', date: '2026-08-24', type: 'expense', categoryId: 'cat-cloud-1', categoryName: 'books', amount: 60, studentId: null, studentName: null, note: '' }), { id: 'asset-cloud-1', updatedAt: '2026-08-24T07:00:00.000Z' });
  assert.deepStrictEqual(await unifiedCloudClient.updateCloudGrade({ baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, gradeId: 'grade-cloud-1', expectedUpdatedAt: '2026-08-24T06:00:00.000Z', studentId: 'student-cloud-1', subject: 'physics', score: 95, examDate: '2026-08-24', notes: 'updated' }), { id: 'grade-cloud-1', updatedAt: '2026-08-24T07:00:00.000Z' });
  assert.deepStrictEqual(await unifiedCloudClient.updateCloudPersonalAssetCategory({ baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, categoryId: 'cat-cloud-1', expectedUpdatedAt: '2026-08-24T06:00:00.000Z', name: 'books', type: 'expense', color: '#654321' }), { id: 'cat-cloud-1', updatedAt: '2026-08-24T07:00:00.000Z' });
  const cloudQuestions = await unifiedCloudClient.listCloudQuestions({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted,
  });
  assert.deepStrictEqual(cloudQuestions, [{ id: 'question-cloud-1', content: 'Cloud question text', version: 4 }]);
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/desktop/question-bank/questions?limit=200');
  const cloudQuestionAsset = await unifiedCloudClient.readCloudQuestionAsset({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, assetKey: 'a'.repeat(64),
  });
  assert.strictEqual(cloudQuestionAsset, 'data:image/png;base64,iVBORw==');
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/desktop/question-bank/asset-deliveries/question_asset_delivery_12345678/download');
  const updatedCloudSchedule = await unifiedCloudClient.updateCloudSchedule({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, scheduleId: 'schedule-cloud-1',
    expectedUpdatedAt: '2026-08-21T01:00:00.000Z', courseId: 'course-cloud-2',
    startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z', recurringRule: '{"frequency":"weekly"}',
    status: 2, roomDisplay: 'Cloud room', serviceType: 2, tuition: 120, teacherFee: 60, notes: 'cloud update',
    pricings: [{ studentId: 'student-cloud-1', attendanceStatus: 4, tuition: 80, teacherFee: 40 }],
  });
  assert.deepStrictEqual(updatedCloudSchedule, { id: 'schedule-cloud-1', updatedAt: '2026-08-22T00:00:00.000Z' });
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/schedules/schedule-cloud-1');
  const createdCloudSchedule = await unifiedCloudClient.createCloudSchedule({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, scheduleId: 'schedule-cloud-new-1', courseId: 'course-cloud-1',
    startAt: '2026-08-23T01:00:00.000Z', endAt: '2026-08-23T02:00:00.000Z', recurringRule: null,
    status: 1, roomDisplay: 'Cloud room', serviceType: 1, tuition: 120, teacherFee: 60, notes: null,
    pricings: [{ studentId: 'student-cloud-1', attendanceStatus: 1, tuition: 120, teacherFee: 60 }],
  });
  assert.deepStrictEqual(createdCloudSchedule, { id: 'schedule-cloud-new-1', updatedAt: '2026-08-23T00:00:00.000Z' });
  const deletedCloudSchedule = await unifiedCloudClient.deleteCloudSchedule({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, scheduleId: 'schedule-cloud-1', expectedUpdatedAt: '2026-08-22T00:00:00.000Z',
  });
  assert.deepStrictEqual(deletedCloudSchedule, { id: 'schedule-cloud-1', updatedAt: '2026-08-22T00:01:00.000Z' });
  assert.deepStrictEqual(await unifiedCloudClient.createCloudInstitution({ baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, institutionId: 'institution-cloud-1', name: 'Institution', contactPerson: null, contactPhone: null, revenueShare: 30, notes: null }), { id: 'institution-cloud-1', updatedAt: '2026-08-24T04:00:00.000Z' });
  assert.deepStrictEqual(await unifiedCloudClient.updateCloudInstitution({ baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, institutionId: 'institution-cloud-1', expectedUpdatedAt: '2026-08-24T04:00:00.000Z', name: 'Institution', contactPerson: null, contactPhone: null, revenueShare: 30, notes: null }), { id: 'institution-cloud-1', updatedAt: '2026-08-24T04:01:00.000Z' });
  assert.deepStrictEqual(await unifiedCloudClient.deleteCloudInstitution({ baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, institutionId: 'institution-cloud-1', expectedUpdatedAt: '2026-08-24T04:01:00.000Z' }), { id: 'institution-cloud-1', updatedAt: '2026-08-24T04:02:00.000Z' });
  assert.deepStrictEqual(await unifiedCloudClient.createCloudSchool({ baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, schoolId: 'school-cloud-1', name: 'School', count: 3 }), { id: 'school-cloud-1', updatedAt: '2026-08-24T04:00:00.000Z' });
  assert.deepStrictEqual(await unifiedCloudClient.updateCloudSchool({ baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, schoolId: 'school-cloud-1', expectedUpdatedAt: '2026-08-24T04:00:00.000Z', name: 'School', count: 3 }), { id: 'school-cloud-1', updatedAt: '2026-08-24T04:01:00.000Z' });
  assert.deepStrictEqual(await unifiedCloudClient.deleteCloudSchool({ baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, schoolId: 'school-cloud-1', expectedUpdatedAt: '2026-08-24T04:01:00.000Z' }), { id: 'school-cloud-1', updatedAt: '2026-08-24T04:02:00.000Z' });
  const updatedCloudStudent = await unifiedCloudClient.updateCloudStudent({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, studentId: 'student-cloud-1',
    expectedUpdatedAt: '2026-08-22T00:00:00.000Z', name: 'Student cloud updated', school: 'Cloud school',
    gradeYear: 2024, gradeCurrent: 'Grade two', institutionId: null, parentName: 'Cloud parent', notes: 'cloud student update', sourceType: 1, studentSource: 'Referral',
  });
  assert.deepStrictEqual(updatedCloudStudent, { id: 'student-cloud-1', updatedAt: '2026-08-23T00:02:00.000Z' });
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/students/student-cloud-1');
  const createdCloudTeacher = await unifiedCloudClient.createCloudTeacher({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, teacherId: 'teacher-cloud-1',
    name: 'New teacher', phone: '13800138002', subject: 'math', hourlyRate: 100, notes: null,
  });
  assert.deepStrictEqual(createdCloudTeacher, { id: 'teacher-cloud-1', updatedAt: '2026-08-23T00:06:00.000Z' });
  const createdCloudRoom = await unifiedCloudClient.createCloudRoom({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, roomId: 'room-cloud-1', name: 'Cloud room', address: 'Cloud address',
  });
  assert.deepStrictEqual(createdCloudRoom, { id: 'room-cloud-1', updatedAt: '2026-08-23T00:09:00.000Z' });
  const updatedCloudRoom = await unifiedCloudClient.updateCloudRoom({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, roomId: 'room-cloud-1', expectedUpdatedAt: '2026-08-23T00:09:00.000Z', name: 'Updated room', address: null,
  });
  assert.deepStrictEqual(updatedCloudRoom, { id: 'room-cloud-1', updatedAt: '2026-08-23T00:10:00.000Z' });
  const deletedCloudRoom = await unifiedCloudClient.deleteCloudRoom({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, roomId: 'room-cloud-1', expectedUpdatedAt: '2026-08-23T00:10:00.000Z',
  });
  assert.deepStrictEqual(deletedCloudRoom, { id: 'room-cloud-1', updatedAt: '2026-08-23T00:11:00.000Z' });
  const createdCloudCourse = await unifiedCloudClient.createCloudCourse({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, courseId: 'course-cloud-1', name: 'Course cloud', year: 2026, semester: 'spring', displayName: 'Course cloud', type: 1, sourceType: 1, institutionId: null, priceTuition: 100, priceTeacher: 50, billingUnit: 1, teacherFeeMode: 1, roomId: 'room-cloud-1', roomName: 'ignored', teacherId: 'teacher-cloud-1', teacherName: 'ignored', active: true, defaultDurationMinutes: 60, notes: null, pricings: [{ studentId: 'student-cloud-1', tuition: 100, teacherFee: 50 }],
  });
  assert.deepStrictEqual(createdCloudCourse, { id: 'course-cloud-1', updatedAt: '2026-08-23T00:12:00.000Z' });
  const updatedCloudCourse = await unifiedCloudClient.updateCloudCourse({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, courseId: 'course-cloud-1', expectedUpdatedAt: '2026-08-23T00:12:00.000Z', name: 'Course cloud updated', year: 2026, semester: 'autumn', displayName: 'Course cloud updated', type: 1, sourceType: 1, institutionId: null, priceTuition: 80, priceTeacher: 40, billingUnit: 1, teacherFeeMode: 1, roomId: 'room-cloud-1', roomName: 'ignored', teacherId: 'teacher-cloud-1', teacherName: 'ignored', active: false, defaultDurationMinutes: 60, notes: 'note', pricings: [],
  });
  assert.deepStrictEqual(updatedCloudCourse, { id: 'course-cloud-1', updatedAt: '2026-08-23T00:13:00.000Z' });
  const deletedCloudCourse = await unifiedCloudClient.deleteCloudCourse({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, courseId: 'course-cloud-1', expectedUpdatedAt: '2026-08-23T00:13:00.000Z',
  });
  assert.deepStrictEqual(deletedCloudCourse, { id: 'course-cloud-1', updatedAt: '2026-08-23T00:14:00.000Z' });
  const updatedCloudTeacher = await unifiedCloudClient.updateCloudTeacher({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, teacherId: 'teacher-cloud-1', expectedUpdatedAt: '2026-08-23T00:06:00.000Z',
    name: 'Updated teacher', phone: null, subject: 'physics', hourlyRate: null, notes: 'note',
  });
  assert.deepStrictEqual(updatedCloudTeacher, { id: 'teacher-cloud-1', updatedAt: '2026-08-23T00:07:00.000Z' });
  const deletedCloudTeacher = await unifiedCloudClient.deleteCloudTeacher({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, teacherId: 'teacher-cloud-1', expectedUpdatedAt: '2026-08-23T00:07:00.000Z',
  });
  assert.deepStrictEqual(deletedCloudTeacher, { id: 'teacher-cloud-1', updatedAt: '2026-08-23T00:08:00.000Z' });
  const updatedCloudStudentRecord = await unifiedCloudClient.updateCloudStudentRecord({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, studentId: 'student-cloud-1',
    expectedUpdatedAt: '2026-08-23T00:02:00.000Z', name: 'Student record', school: null, gradeYear: null,
    gradeCurrent: null, institutionId: null, parentName: null, notes: null, sourceType: 1, studentSource: 'Referral',
    contacts: [{ slot: 1, relationship: 'student', phone: '13800138000', wechat: null, expectedUpdatedAt: null }],
  });
  assert.deepStrictEqual(updatedCloudStudentRecord, { id: 'student-cloud-1', updatedAt: '2026-08-23T00:03:00.000Z' });
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/students/student-cloud-1/record');
  const createdCloudStudent = await unifiedCloudClient.createCloudStudentRecord({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, studentId: 'student-cloud-new-1',
    name: 'New student', school: null, gradeYear: 2025, gradeCurrent: null, institutionId: null,
    parentName: null, notes: null, sourceType: 1, studentSource: 'Referral',
    contacts: [{ slot: 1, relationship: 'student', phone: '13800138001', wechat: null }],
  });
  assert.deepStrictEqual(createdCloudStudent, { id: 'student-cloud-new-1', updatedAt: '2026-08-23T00:04:00.000Z' });
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/students');
  const deletedCloudStudent = await unifiedCloudClient.deleteCloudStudent({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, studentId: 'student-cloud-1', expectedUpdatedAt: '2026-08-23T00:04:00.000Z',
  });
  assert.deepStrictEqual(deletedCloudStudent, { id: 'student-cloud-1', updatedAt: '2026-08-23T00:05:00.000Z' });
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/students/student-cloud-1');
  const updatedCloudStudentOverride = await unifiedCloudClient.updateCloudScheduleStudentOverride({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, scheduleId: 'schedule-cloud-1', studentId: 'student-cloud-1',
    expectedUpdatedAt: '2026-08-22T00:00:00.000Z', attendanceStatus: 4, tuition: 80, teacherFee: 40,
  });
  assert.deepStrictEqual(updatedCloudStudentOverride, { id: 'schedule-cloud-1', updatedAt: '2026-08-22T00:01:00.000Z' });
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/schedules/schedule-cloud-1/students/student-cloud-1');
  const updatedStudentContact = await unifiedCloudClient.upsertCloudStudentContact({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, studentId: 'student-cloud-1', contactSlot: 2,
    expectedUpdatedAt: null, relationship: 'guardian', phone: null, wechat: 'guardian-handle',
  });
  assert.deepStrictEqual(updatedStudentContact, { id: 'student-contact-student-cloud-1-2', studentId: 'student-cloud-1', slot: 2, relationship: 'guardian', phone: null, wechat: 'guardian-handle', status: 'active', updatedAt: '2026-08-23T00:00:00.000Z' });
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/business/students/student-cloud-1/contacts/2');

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

  const roleSwitchEvents = [];
  const roleSwitchClient = createDesktopIdentityClient({
    desktopIdentity: {
      status: async () => ({ state: 'unlocked' }),
      acceptIssuedSession: async input => {
        roleSwitchEvents.push(['issued', input]);
        return { state: 'unlocked', authorizationId: input.session.id, activeRole: input.session.activeRole };
      },
    },
    sessionStore: {
      save: async value => { roleSwitchEvents.push(['save', value]); },
      clear: async () => {},
    },
    clearRoleCache: async partition => { roleSwitchEvents.push(['clear', partition]); },
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, data: {
      token: 'teacher-token-after-role-switch',
      session: {
        id: 'teacher-session-after-role-switch', userId: 'role-user-1', deviceId: 'role-device-1',
        activeRole: 'teacher', eligibleRoles: ['super_admin', 'teacher'], teacherId: 'role-teacher-1',
        expiresAt: '2026-09-01T12:00:00.000Z', rowVersion: 1,
      },
      profile: {
        userId: 'role-user-1', activeRole: 'teacher', eligibleRoles: ['super_admin', 'teacher'], teacherId: 'role-teacher-1',
      },
      offlineLease: { id: 'teacher-lease-after-role-switch' },
    } }) }),
  });
  await roleSwitchClient.switchRole({
    baseUrl: 'https://cloud.test',
    currentSession: {
      token: 'admin-token-before-role-switch', offline: false,
      session: {
        id: 'admin-session-before-role-switch', userId: 'role-user-1', deviceId: 'role-device-1',
        activeRole: 'super_admin', eligibleRoles: ['super_admin', 'teacher'], teacherId: 'role-teacher-1', rowVersion: 7,
      },
      profile: { userId: 'role-user-1', activeRole: 'super_admin', eligibleRoles: ['super_admin', 'teacher'], teacherId: 'role-teacher-1' },
    },
    activeRole: 'teacher',
  });
  assert.strictEqual(roleSwitchEvents[1][0], 'issued');
  assert.deepStrictEqual(roleSwitchEvents[1][1].session, roleSwitchEvents[2][1].session);
  assert.strictEqual(roleSwitchEvents[1][1].profile.activeRole, 'teacher');
  assert.deepStrictEqual(roleSwitchEvents[1][1].offlineLease, { id: 'teacher-lease-after-role-switch' },
    'a cloud role switch must atomically replace the session identity and role-bound lease before persistence');
  assert.strictEqual(roleSwitchEvents[2][0], 'save');

  let adminSwitchStored = null;
  let passiveResumeCalls = 0;
  const adminSwitchClient = createDesktopIdentityClient({
    desktopIdentity: {
      status: async () => ({ state: 'unlocked' }),
      resume: async () => { passiveResumeCalls += 1; return { state: 'unlocked' }; },
      signChallenge: async () => ({
        elevationIssuedAt: '2026-09-01T10:15:00.000Z',
        signature: 'admin-elevation-signature',
      }),
      acceptIssuedSession: async input => ({
        state: 'unlocked', authorizationId: input.session.id, activeRole: input.session.activeRole,
      }),
    },
    sessionStore: { save: async value => { adminSwitchStored = value; }, clear: async () => {} },
    clearRoleCache: async () => {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, data: {
      token: 'admin-token-after-role-switch',
      session: {
        id: 'admin-session-after-role-switch', userId: 'role-user-1', deviceId: 'role-device-1',
        activeRole: 'super_admin', eligibleRoles: ['super_admin', 'teacher'],
        teacherId: null, studentId: null, expiresAt: '2026-09-01T12:15:00.000Z', rowVersion: 8,
      },
      profile: {
        userId: 'role-user-1', user: { id: 'role-user-1', name: 'Fresh Cloud Profile' },
        activeRole: 'super_admin', eligibleRoles: ['super_admin', 'teacher'], teacherId: null, studentId: null,
      },
      offlineLease: { id: 'admin-lease-after-role-switch' },
    } }) }),
  });
  const switchedAdminSession = await adminSwitchClient.switchRole({
    baseUrl: 'https://cloud.test',
    currentSession: {
      token: 'teacher-token-before-admin-switch', offline: false,
      session: {
        id: 'teacher-session-before-admin-switch', userId: 'role-user-1', deviceId: 'role-device-1',
        activeRole: 'teacher', eligibleRoles: ['super_admin', 'teacher'],
        teacherId: 'role-teacher-1', studentId: null, rowVersion: 7,
      },
      profile: {
        userId: 'role-user-1', user: { id: 'role-user-1', name: 'Stale Teacher Profile' },
        activeRole: 'teacher', eligibleRoles: ['super_admin', 'teacher'],
        teacherId: 'role-teacher-1', studentId: 'stale-student-scope',
      },
    },
    activeRole: 'super_admin',
  });
  assert.strictEqual(switchedAdminSession.profile.user.name, 'Fresh Cloud Profile',
    'role exchange must build the renderer profile from exchanged.profile instead of the old fallback');
  assert.strictEqual(switchedAdminSession.profile.teacherId, null);
  assert.strictEqual(switchedAdminSession.profile.studentId, null);
  assert.strictEqual(adminSwitchStored.profile.teacherId, null);
  assert.strictEqual(adminSwitchStored.profile.studentId, null);
  assert.strictEqual(passiveResumeCalls, 0,
    'privileged role elevation must not renew user-presence freshness through passive vault resume');
  const adminAuthorization = normalizeDesktopAuthorizationSession(adminSwitchStored);
  assert.strictEqual(adminAuthorization.authContext.teacherId, null);
  assert.strictEqual(adminAuthorization.authContext.studentId, null);

  const integrationWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-issued-session-'));
  const leaseKeys = crypto.generateKeyPairSync('ed25519');
  let integrationClock = new Date('2026-09-01T10:00:00.000Z');
  const integrationVault = createDesktopIdentityVault({
    filePath: path.join(integrationWorkspace, 'identity.bin'),
    safeStorage: mockSafeStorage(),
    offlineLeasePublicKey: leaseKeys.publicKey,
    now: () => new Date(integrationClock),
  });
  const integrationIdentity = integrationVault.beginUnifiedOnlineRegistration({ deviceName: 'Issued session test' });
  const baseLeaseInput = {
    userId: 'issued-user-1', deviceId: integrationIdentity.deviceId, credentialVersion: 1,
    eligibleRoles: ['super_admin', 'teacher'], activeRole: 'teacher', teacherId: 'issued-teacher-1',
    issuedAt: '2026-09-01T10:00:00.000Z', expiresAt: '2026-09-01T11:00:00.000Z',
  };
  integrationVault.completeRegistration({
    authorization: {
      id: 'issued-session-old', deviceId: integrationIdentity.deviceId,
      deviceName: integrationIdentity.deviceName, deviceKind: integrationIdentity.deviceKind,
      userId: 'issued-user-1', keyFingerprint: integrationIdentity.keyFingerprint,
      status: 'active', authorizationSource: 'wechat_phone', credentialVersion: 1,
      lastPhoneVerifiedAt: '2026-09-01T10:00:00.000Z', phoneReverifyDueAt: '2026-09-01T11:00:00.000Z',
    },
    profile: {
      userId: 'issued-user-1', user: { id: 'issued-user-1', name: 'Issued User' },
      eligibleRoles: ['super_admin', 'teacher'], activeRole: 'teacher', teacherId: 'issued-teacher-1', studentId: null,
    },
    offlineLease: signedOfflineLease(leaseKeys.privateKey, {
      ...baseLeaseInput, id: 'issued-lease-old', authorizationId: 'issued-session-old',
    }),
  });
  integrationVault.lock();
  integrationClock = new Date('2026-09-01T10:00:01.000Z');
  const renewedSession = {
    id: 'issued-session-renewed', userId: 'issued-user-1', deviceId: integrationIdentity.deviceId,
    activeRole: 'teacher', eligibleRoles: ['super_admin', 'teacher'], teacherId: 'issued-teacher-1', studentId: null,
    expiresAt: '2026-09-01T12:00:00.000Z', rowVersion: 1,
  };
  const renewedProfile = {
    userId: 'issued-user-1', user: { id: 'issued-user-1', name: 'Unsigned replacement name' },
    activeRole: 'teacher', eligibleRoles: ['super_admin', 'teacher'], teacherId: 'stale-teacher-scope', studentId: 'stale-student-scope',
  };
  const renewedLease = signedOfflineLease(leaseKeys.privateKey, {
    ...baseLeaseInput, id: 'issued-lease-renewed', authorizationId: renewedSession.id,
    issuedAt: integrationClock.toISOString(), expiresAt: renewedSession.expiresAt,
  });
  let integrationStored = null;
  const integrationClient = createDesktopIdentityClient({
    desktopIdentity: integrationVault,
    now: () => new Date(integrationClock),
    sessionStore: {
      save: async value => { integrationStored = value; },
      clear: async () => {},
    },
    fetchImpl: async url => {
      if (url.endsWith('/api/desktop-identity/session/challenges/start')) {
        return { ok: true, json: async () => ({ success: true, data: { challenge: {
          id: 'issued-challenge-1', authorizationId: 'issued-session-old', credentialVersion: 1,
          nonce: 'issued-nonce-1', nonceIssuedAt: integrationClock.toISOString(), rowVersion: 1,
        } } }) };
      }
      return { ok: true, json: async () => ({ success: true, data: {
        token: 'issued-token-renewed', session: renewedSession, profile: renewedProfile, offlineLease: renewedLease,
      } }) };
    },
  });
  const integratedResume = await integrationClient.resume({ baseUrl: 'https://cloud.test', online: true });
  assert.strictEqual(integrationVault.status().authorizationId, renewedSession.id);
  assert.strictEqual(integrationVault.status().offlineLease.id, renewedLease.id);
  assert.strictEqual(integrationVault.status().user.name, 'Issued User',
    'unsigned display fields must not replace the locally verified identity');
  assert.strictEqual(integrationStored.session.id, renewedSession.id);
  assert.strictEqual(integratedResume.gateState.kind, 'online-unlocked');

  integrationClock = new Date('2026-09-01T10:05:00.000Z');
  const switchedSession = {
    ...renewedSession, id: 'issued-session-admin', activeRole: 'super_admin', teacherId: null,
    expiresAt: '2026-09-01T12:05:00.000Z', rowVersion: 1,
  };
  const switchedProfile = {
    ...renewedProfile, activeRole: 'super_admin', teacherId: null,
  };
  const switchedLease = signedOfflineLease(leaseKeys.privateKey, {
    ...baseLeaseInput, id: 'issued-lease-admin', authorizationId: switchedSession.id,
    activeRole: 'super_admin', teacherId: null, expiresAt: switchedSession.expiresAt,
    issuedAt: integrationClock.toISOString(),
  });
  const roleIntegrationClient = createDesktopIdentityClient({
    desktopIdentity: integrationVault,
    now: () => new Date(integrationClock),
    sessionStore: { save: async value => { integrationStored = value; }, clear: async () => {} },
    clearRoleCache: async () => {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, data: {
      token: 'issued-token-admin', session: switchedSession, profile: switchedProfile, offlineLease: switchedLease,
    } }) }),
  });
  await assert.rejects(
    () => roleIntegrationClient.switchRole({ baseUrl: 'https://cloud.test', currentSession: integratedResume, activeRole: 'super_admin' }),
    error => error.code === 'DESKTOP_IDENTITY_RECENT_UNLOCK_REQUIRED',
    'a passive cold-start resume must not count as recent interactive authentication for administrator elevation',
  );
  assert.strictEqual(integrationVault.status().authorizationId, renewedSession.id);
  assert.strictEqual(integrationVault.status().activeRole, 'teacher');

  console.log('desktop identity client checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
