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
  assert.ok(source.includes('/api/desktop/online-registration')
    && source.includes("purpose: 'unified-online-registration'"),
  'registration must use the cloud verification ticket and device proof before saving an online session');

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
      refreshOfflineLease: async input => {
        resumeEvents.push({ action: 'refresh-offline-lease', input });
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
          activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-resume-1',
          expiresAt: '2026-08-25T11:00:00.000Z',
        },
        profile: {
          userId: 'user-resume-1', user: { id: 'user-resume-1', name: 'Resume User' },
          activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-resume-1',
        },
        offlineLease: resumedOfflineLease,
      } }) };
    },
  });
  const resumed = await resumeClient.resume({ baseUrl: 'https://cloud.test', online: true });
  assert.strictEqual(resumed.gateState.kind, 'online-unlocked');
  assert.strictEqual(resumedSessionStored.token, 'session-token-resume-1');
  assert.deepStrictEqual(
    resumeEvents.find(event => event.action === 'refresh-offline-lease').input,
    { offlineLease: resumedOfflineLease },
    'online resume must refresh the offline lease without an undefined legacy password',
  );
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
        return { ok: true, json: async () => ({ ok: true, pairingId: 'pairing-cloud-1', pairingSecret: 'pairing-secret-1', expiresAt: '2026-08-21T12:05:00.000Z' }) };
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
          sessionId: 'session-cloud-1', expiresAt: '2026-08-21T13:00:00.000Z', roles: ['teacher'], teacherId: 'teacher-cloud-1', studentId: null,
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
        return { ok: true, json: async () => ({ ok: true, questions: [{ id: 'question-cloud-1', content: 'Cloud question text' }] }) };
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
          expectedUpdatedAt: '2026-08-21T01:00:00.000Z', startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z',
          status: 2, roomDisplay: 'Cloud room', tuition: 120, teacherFee: 60, notes: 'cloud update',
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
  assert.strictEqual(unifiedPending.qrValue, 'gewu://desktop-pairing?pairingId=pairing-cloud-1&secret=pairing-secret-1');
  const unifiedVerified = await unifiedCloudClient.pollUnifiedOnlineRegistration(unifiedPending);
  const selfRegisteredTeacher = await unifiedCloudClient.registerTeacherForVerifiedRegistration({
    pending: unifiedVerified,
    name: 'Cloud Teacher',
    subject: 'Math',
  });
  assert.deepStrictEqual(selfRegisteredTeacher, {
    teacherId: 'teacher-cloud-1', updatedAt: '2026-08-21T12:00:00.000Z', replayed: false,
  });
  const unifiedCompleted = await unifiedCloudClient.completeUnifiedOnlineRegistration({
    pending: unifiedVerified,
    password: 'unified-local-password',
  });
  assert.deepStrictEqual(unifiedCloudRequests.map(entry => entry.url), [
    'https://cloud.test/api/desktop/pairing/start',
    'https://cloud.test/api/desktop/pairing/pairing-cloud-1?secret=pairing-secret-1',
    'https://cloud.test/api/desktop/teacher-self-registration',
    'https://cloud.test/api/desktop/online-registration',
    'https://cloud.test/api/desktop/session-context',
  ]);
  assert.deepStrictEqual(unifiedCloudRequests[0].body, {
    installationId: 'desktop-device-a1b2c3d4e5f60708', installationPublicKey: 'unified-public-key', idempotencyKey: 'unified-registration-1',
  });
  assert.deepStrictEqual(unifiedCloudRequests[2].body, {
    verificationToken: 'verification-token-1', name: 'Cloud Teacher', subject: 'Math',
  });
  assert.deepStrictEqual(unifiedCloudRequests[3].body, {
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
  });
  assert.deepStrictEqual(passwordVerificationRequests, [{
    url: 'https://cloud.test/api/desktop/password-verification',
    body: { loginType: 'phone', login: '13800138000', password: 'correct horse battery staple' },
  }]);
  assert.strictEqual(passwordClientStored, false, 'password verification must only produce an online registration pending state, never a local session or vault write');
  const enrollmentPending = await passwordVerificationClient.beginPasswordEnrollment({
    baseUrl: 'https://cloud.test', deviceName: 'Password enrollment desktop', idempotencyKey: 'password-enrollment-1',
    phoneCode: 'wechat-phone-proof', loginName: 'teacher.a', password: 'correct horse battery staple',
  });
  assert.strictEqual(enrollmentPending.status, 'verified');
  assert.strictEqual(enrollmentPending.verificationToken, 'password-enrollment-ticket');
  assert.strictEqual(enrollmentPending.deviceChallenge, 'cloud-password-enrollment-proof');
  assert.deepStrictEqual(passwordVerificationRequests.at(-1), {
    url: 'https://cloud.test/api/desktop/password-enrollment',
    body: { phoneCode: 'wechat-phone-proof', loginName: 'teacher.a', password: 'correct horse battery staple' },
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
  const cloudQuestions = await unifiedCloudClient.listCloudQuestions({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted,
  });
  assert.deepStrictEqual(cloudQuestions, [{ id: 'question-cloud-1', content: 'Cloud question text' }]);
  assert.strictEqual(unifiedCloudRequests.at(-1).url, 'https://cloud.test/api/desktop/question-bank/questions?limit=200');
  const updatedCloudSchedule = await unifiedCloudClient.updateCloudSchedule({
    baseUrl: 'https://cloud.test', currentSession: unifiedCompleted, scheduleId: 'schedule-cloud-1',
    expectedUpdatedAt: '2026-08-21T01:00:00.000Z', startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z',
    status: 2, roomDisplay: 'Cloud room', tuition: 120, teacherFee: 60, notes: 'cloud update',
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

  console.log('desktop identity client checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
