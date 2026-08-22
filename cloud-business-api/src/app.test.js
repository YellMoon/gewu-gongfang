'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path, { method = 'GET', body, headers = {} } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let responseBody;
    try {
      responseBody = await response.json();
    } catch (_) {
      responseBody = null;
    }
    return { status: response.status, body: responseBody };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const healthy = await request(createCloudBusinessApp({
    query: async () => ({ rows: [{ ok: 1 }] }),
    releaseVersion: '8.0.6-test',
  }), '/api/health');
  assert.strictEqual(healthy.status, 200);
  assert.strictEqual(healthy.body.ok, true);
  assert.strictEqual(healthy.body.database, 'postgresql');
  assert.strictEqual(healthy.body.businessAuthority, 'cloud');
  assert.strictEqual(healthy.body.version, '8.0.6-test');
  assert.ok(Number.isFinite(Date.parse(healthy.body.time)), 'health responses must carry an observable server timestamp');

  const unavailable = await request(createCloudBusinessApp({ query: async () => { throw new Error('database unavailable'); } }), '/api/health');
  assert.strictEqual(unavailable.status, 503);
  assert.deepStrictEqual(unavailable.body, { ok: false, database: 'unavailable' });

  const calls = [];
  const identity = {
    begin: async input => { calls.push(['begin', input]); return { verificationToken: 'ticket-1' }; },
    register: async input => { calls.push(['register', input]); return { receiptId: 'receipt-1', sessionId: 'session-1', replayed: false, sessionToken: 'eyJ2IjoxfQ.signature', offlineLease: { id: 'lease-1' } }; },
    sessionContext: async input => {
      calls.push(['sessionContext', input]);
      return { authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'install-1', sessionId: 'session-1', expiresAt: '2026-08-21T13:00:00.000Z', roles: ['super_admin'], teacherId: null, studentId: null };
    },
  };
  const verification = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity }), '/api/desktop/online-verification', { method: 'POST', body: { phoneCode: 'provider-code' } });
  assert.strictEqual(verification.status, 200);
  assert.deepStrictEqual(verification.body, { ok: true, verificationToken: 'ticket-1' });
  const passwordCalls = [];
  const desktopPasswordAuthentication = {
    enroll: async input => { passwordCalls.push(['enroll', input]); return { verificationToken: 'password-enrollment-ticket', deviceChallenge: 'password-enrollment-challenge' }; },
    verify: async input => { passwordCalls.push(['verify', input]); return { verificationToken: 'password-verification-ticket', deviceChallenge: 'password-verification-challenge' }; },
  };
  const passwordEnrollment = await request(createCloudBusinessApp({
    query: async () => ({ rows: [] }), desktopRegistration: identity, desktopPasswordAuthentication,
  }), '/api/desktop/password-enrollment', {
    method: 'POST', body: { phoneCode: 'provider-code', loginName: 'teacher.a', password: 'correct password' },
  });
  assert.strictEqual(passwordEnrollment.status, 200);
  assert.deepStrictEqual(passwordEnrollment.body, { ok: true, verificationToken: 'password-enrollment-ticket', deviceChallenge: 'password-enrollment-challenge' });
  const passwordVerification = await request(createCloudBusinessApp({
    query: async () => ({ rows: [] }), desktopRegistration: identity, desktopPasswordAuthentication,
  }), '/api/desktop/password-verification', {
    method: 'POST', body: { loginType: 'account_name', login: 'teacher.a', password: 'correct password' },
  });
  assert.strictEqual(passwordVerification.status, 200);
  assert.deepStrictEqual(passwordVerification.body, { ok: true, verificationToken: 'password-verification-ticket', deviceChallenge: 'password-verification-challenge' });
  assert.deepStrictEqual(passwordCalls, [
    ['enroll', { phoneCode: 'provider-code', loginName: 'teacher.a', password: 'correct password' }],
    ['verify', { loginType: 'account_name', login: 'teacher.a', password: 'correct password' }],
  ]);
  const registration = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity }), '/api/desktop/online-registration', { method: 'POST', body: { verificationToken: 'ticket-1', installationId: 'install-1', installationPublicKey: 'public-key', deviceProof: 'proof', idempotencyKey: 'retry-1' } });
  assert.strictEqual(registration.status, 200);
  assert.deepStrictEqual(registration.body, { ok: true, receiptId: 'receipt-1', sessionId: 'session-1', replayed: false, sessionToken: 'eyJ2IjoxfQ.signature', offlineLease: { id: 'lease-1' } });
  const sessionContext = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity }), '/api/desktop/session-context', { headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' } });
  assert.strictEqual(sessionContext.status, 200);
  assert.deepStrictEqual(sessionContext.body, { ok: true, authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'install-1', sessionId: 'session-1', expiresAt: '2026-08-21T13:00:00.000Z', roles: ['super_admin'], teacherId: null, studentId: null });
  const miniappIdentity = {
    login: async input => {
      assert.deepStrictEqual(input, { loginCode: 'miniapp-login-proof', phoneCode: 'miniapp-proof' });
      return { token: 'miniapp-ticket.signature', identity: { accountId: 'miniapp-account-1', status: 'active', roles: ['super_admin'] } };
    },
    context: async input => {
      if (input.token !== 'miniapp-ticket.signature') throw Object.assign(new Error('rejected'), { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
      return { accountId: 'miniapp-account-1', status: 'active', roles: ['super_admin'] };
    },
    pendingAccounts: async input => {
      if (input.token !== 'miniapp-ticket.signature') throw Object.assign(new Error('rejected'), { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
      return [{ accountId: 'miniapp-account-pending', status: 'pending_authorization', createdAt: '2026-08-22T08:00:00.000Z' }];
    },
    assignRole: async input => {
      if (input.token !== 'miniapp-ticket.signature' || input.accountId !== 'miniapp-account-pending' || input.role !== 'teacher' || input.profileId !== 'teacher-1' || input.studentRelationship !== null) throw Object.assign(new Error('rejected'), { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
      return { accountId: input.accountId, status: 'active', roles: ['teacher'], profile: { type: 'teacher', id: input.profileId } };
    },
  };
  const miniappLogin = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), miniappCloudAccount: miniappIdentity }), '/api/miniapp/cloud-login', { method: 'POST', body: { loginCode: 'miniapp-login-proof', phoneCode: 'miniapp-proof' } });
  assert.strictEqual(miniappLogin.status, 200);
  assert.deepStrictEqual(miniappLogin.body, { ok: true, token: 'miniapp-ticket.signature', identity: { accountId: 'miniapp-account-1', status: 'active', roles: ['super_admin'] } });
  const pendingAccounts = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), miniappCloudAccount: miniappIdentity }), '/api/miniapp/cloud-accounts', { headers: { authorization: 'Bearer miniapp-ticket.signature' } });
  assert.strictEqual(pendingAccounts.status, 200);
  assert.deepStrictEqual(pendingAccounts.body, { ok: true, accounts: [{ accountId: 'miniapp-account-pending', status: 'pending_authorization', createdAt: '2026-08-22T08:00:00.000Z' }] });
  const profileQueries = [];
  const teacherProfiles = await request(createCloudBusinessApp({
    query: async (text, values) => { profileQueries.push([text, values]); return { rows: [{ id: 'teacher-1', name: 'Teacher One' }] }; }, miniappCloudAccount: miniappIdentity, businessTenantId: 'default',
  }), '/api/miniapp/business-profiles?type=teacher', { headers: { authorization: 'Bearer miniapp-ticket.signature' } });
  assert.strictEqual(teacherProfiles.status, 200);
  assert.deepStrictEqual(teacherProfiles.body, { ok: true, profiles: [{ id: 'teacher-1', name: 'Teacher One' }] });
  assert.deepStrictEqual(profileQueries[0][1], ['default']);
  assert.ok(profileQueries[0][0].includes('FROM business.teachers') && profileQueries[0][0].includes('legacy_deleted=false'), 'profile choices must come from active migrated profiles only');
  const assignedAccount = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), miniappCloudAccount: miniappIdentity }), '/api/miniapp/cloud-accounts/miniapp-account-pending/role', {
    method: 'PUT', headers: { authorization: 'Bearer miniapp-ticket.signature' }, body: { role: 'teacher', profileId: 'teacher-1', studentRelationship: null },
  });
  assert.strictEqual(assignedAccount.status, 200);
  assert.deepStrictEqual(assignedAccount.body, { ok: true, account: { accountId: 'miniapp-account-pending', status: 'active', roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-1' } } });
  const miniappBusiness = await request(createCloudBusinessApp({
    query: async () => ({ rows: [] }), miniappCloudAccount: miniappIdentity, businessTenantId: 'default',
  }), '/api/business/schedules', { headers: { authorization: 'Bearer miniapp-ticket.signature' } });
  assert.strictEqual(miniappBusiness.status, 200);
  const scopedQueries = [];
  const teacherIdentity = {
    ...miniappIdentity,
    context: async input => {
      if (input.token !== 'teacher-ticket.signature') throw Object.assign(new Error('rejected'), { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
      return { accountId: 'teacher-account', status: 'active', roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-1' } };
    },
  };
  const teacherSchedules = await request(createCloudBusinessApp({
    query: async (text, values) => { scopedQueries.push([text, values]); return { rows: [] }; }, miniappCloudAccount: teacherIdentity, businessTenantId: 'default',
  }), '/api/business/schedules', { headers: { authorization: 'Bearer teacher-ticket.signature' } });
  assert.strictEqual(teacherSchedules.status, 200);
  assert.deepStrictEqual(scopedQueries[0][1], ['default', 'teacher', 'teacher-1']);
  assert.ok(scopedQueries[0][0].includes('c.teacher_id=$3'), 'a teacher schedule query must bind the assigned teacher profile');
  const studentIdentity = {
    ...miniappIdentity,
    context: async input => {
      if (input.token !== 'student-ticket.signature') throw Object.assign(new Error('rejected'), { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
      return { accountId: 'student-account', status: 'active', roles: ['student'], profile: { type: 'student', id: 'student-1' } };
    },
  };
  const studentSchedules = await request(createCloudBusinessApp({
    query: async (text, values) => { scopedQueries.push([text, values]); return { rows: [] }; }, miniappCloudAccount: studentIdentity, businessTenantId: 'default',
  }), '/api/business/schedules', { headers: { authorization: 'Bearer student-ticket.signature' } });
  assert.strictEqual(studentSchedules.status, 200);
  assert.deepStrictEqual(scopedQueries[1][1], ['default', 'student', 'student-1']);
  assert.ok(scopedQueries[1][0].includes('course_student_pricings'), 'a student schedule query must use the assigned student profile, not a client-provided identifier');
  const legacyBusiness = await request(createCloudBusinessApp({
    query: async () => ({ rows: [] }), miniappCloudAccount: miniappIdentity, businessTenantId: 'default',
  }), '/api/business/schedules', { headers: { authorization: 'Bearer old.jwt.token' } });
  assert.strictEqual(legacyBusiness.status, 403);
  const businessQueries = [];
  const scheduleList = await request(createCloudBusinessApp({
    query: async (text, values) => {
      businessQueries.push([text, values]);
      return { rows: [{ id: 'schedule-1', courseId: 'course-1', courseName: '\\u6570\\u5b66', startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z', status: 1, roomDisplay: 'A101', tuition: '100', teacherFee: '50' }] };
    },
    desktopRegistration: identity,
    businessTenantId: 'default',
  }), '/api/business/schedules', { headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' } });
  assert.strictEqual(scheduleList.status, 200);
  assert.deepStrictEqual(scheduleList.body, {
    ok: true,
    schedules: [{ id: 'schedule-1', courseId: 'course-1', courseName: '\\u6570\\u5b66', startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z', status: 1, roomDisplay: 'A101', tuition: '100', teacherFee: '50' }],
  });
  assert.strictEqual(businessQueries.length, 1);
  assert.deepStrictEqual(businessQueries[0][1], ['default', 'super_admin', null]);
  assert.ok(businessQueries[0][0].startsWith('SELECT s.id AS "id", s.course_id AS "courseId"'));
  const projectionQueries = [];
  const desktopProjection = await request(createCloudBusinessApp({
    query: async (text, values) => {
      projectionQueries.push([text, values]);
      return { rows: [{ projection: { students: [], teachers: [], courses: [], schedules: [], institutions: [], schools: [], rooms: [] } }] };
    },
    desktopRegistration: identity,
    businessTenantId: 'default',
  }), '/api/business/desktop-projection', { headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' } });
  assert.strictEqual(desktopProjection.status, 200);
  assert.deepStrictEqual(desktopProjection.body, {
    ok: true, projection: { students: [], teachers: [], courses: [], schedules: [], institutions: [], schools: [], rooms: [] },
  });
  assert.deepStrictEqual(projectionQueries[0][1], ['default']);
  assert.ok(projectionQueries[0][0].includes('business.students') && projectionQueries[0][0].includes('business.schedules'));
  const businessWrites = [];
  const scheduleUpdate = await request(createCloudBusinessApp({
    query: async () => ({ rows: [] }),
    businessScheduleUpdate: async input => {
      businessWrites.push(input);
      return { id: 'schedule-1', updatedAt: '2026-08-22T01:05:00.000Z' };
    },
    desktopRegistration: identity,
    businessTenantId: 'default',
  }), '/api/business/schedules/schedule-1', {
    method: 'PUT',
    headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' },
    body: {
      expectedUpdatedAt: '2026-08-22T01:00:00.000Z',
      startAt: '2026-08-23T01:00:00.000Z',
      endAt: '2026-08-23T02:00:00.000Z',
      status: 1,
      roomDisplay: 'A102',
      tuition: 120,
      teacherFee: 60,
      notes: null,
    },
  });
  assert.strictEqual(scheduleUpdate.status, 200);
  assert.deepStrictEqual(scheduleUpdate.body, { ok: true, schedule: { id: 'schedule-1', updatedAt: '2026-08-22T01:05:00.000Z' } });
  assert.strictEqual(businessWrites.length, 1);
  assert.deepStrictEqual(businessWrites[0], {
    tenantId: 'default', scheduleId: 'schedule-1', expectedUpdatedAt: '2026-08-22T01:00:00.000Z',
    startAt: '2026-08-23T01:00:00.000Z', endAt: '2026-08-23T02:00:00.000Z', status: 1,
    roomDisplay: 'A102', tuition: 120, teacherFee: 60, notes: null,
  });
  const studentOverrideWrites = [];
  const studentOverride = await request(createCloudBusinessApp({
    query: async () => ({ rows: [] }),
    businessScheduleStudentOverride: async input => {
      studentOverrideWrites.push(input);
      return { id: 'schedule-1', updatedAt: '2026-08-22T01:06:00.000Z' };
    },
    desktopRegistration: identity,
    businessTenantId: 'default',
  }), '/api/business/schedules/schedule-1/students/student-1', {
    method: 'PUT',
    headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' },
    body: {
      expectedUpdatedAt: '2026-08-22T01:05:00.000Z',
      attendanceStatus: 1,
      tuition: 120,
      teacherFee: 60,
    },
  });
  assert.strictEqual(studentOverride.status, 200);
  assert.deepStrictEqual(studentOverride.body, { ok: true, schedule: { id: 'schedule-1', updatedAt: '2026-08-22T01:06:00.000Z' } });
  assert.deepStrictEqual(studentOverrideWrites, [{
    tenantId: 'default', scheduleId: 'schedule-1', studentId: 'student-1',
    expectedUpdatedAt: '2026-08-22T01:05:00.000Z', attendanceStatus: 1, tuition: 120, teacherFee: 60,
  }]);
  let deniedBusinessQuery = false;
  const deniedScheduleList = await request(createCloudBusinessApp({
    query: async () => { deniedBusinessQuery = true; return { rows: [] }; },
    desktopRegistration: { ...identity, sessionContext: async () => ({ authorityId: 'authority-1', accountId: 'account-2', roles: ['visitor'] }) },
    businessTenantId: 'default',
  }), '/api/business/schedules', { headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' } });
  assert.strictEqual(deniedScheduleList.status, 403);
  assert.deepStrictEqual(deniedScheduleList.body, { ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
  assert.strictEqual(deniedBusinessQuery, false);
  const missingSessionToken = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity }), '/api/desktop/session-context');
  assert.strictEqual(missingSessionToken.status, 403);
  assert.deepStrictEqual(missingSessionToken.body, { ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
  assert.deepStrictEqual(calls, [
    ['begin', { phoneCode: 'provider-code' }],
    ['register', { verificationToken: 'ticket-1', installationId: 'install-1', installationPublicKey: 'public-key', deviceProof: 'proof', idempotencyKey: 'retry-1' }],
   ['sessionContext', { sessionToken: 'eyJ2IjoxfQ.signature' }],
   ['sessionContext', { sessionToken: 'eyJ2IjoxfQ.signature' }],
   ['sessionContext', { sessionToken: 'eyJ2IjoxfQ.signature' }],
   ['sessionContext', { sessionToken: 'eyJ2IjoxfQ.signature' }],
    ['sessionContext', { sessionToken: 'eyJ2IjoxfQ.signature' }],
 ]);
  const denied = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: { begin: async () => { throw Object.assign(new Error('no'), { code: 'CLOUD_ONLINE_IDENTITY_REJECTED' }); }, register: async () => null } }), '/api/desktop/online-verification', { method: 'POST', body: { phoneCode: 'bad' } });
  assert.strictEqual(denied.status, 403);
  assert.deepStrictEqual(denied.body, { ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
  const invalid = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: { begin: async () => { throw Object.assign(new Error('bad input'), { code: 'CLOUD_ONLINE_IDENTITY_INVALID' }); }, register: async () => null } }), '/api/desktop/online-verification', { method: 'POST', body: {} });
  assert.strictEqual(invalid.status, 400);
  assert.deepStrictEqual(invalid.body, { ok: false, code: 'CLOUD_ONLINE_IDENTITY_INPUT_INVALID' });

  const pairingCalls = [];
  const pairing = {
    start: input => { pairingCalls.push(['start', input]); return { pairingId: 'pair-1', pairingSecret: 'secret-1', expiresAt: '2026-08-21T12:05:00.000Z' }; },
    confirm: async input => { pairingCalls.push(['confirm', input]); return { status: 'verified' }; },
    read: input => { pairingCalls.push(['read', input]); return { status: 'verified', verificationToken: 'ticket-1' }; },
  };
  const pairedApp = createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity, desktopPairing: pairing });
  const pairingStart = await request(pairedApp, '/api/desktop/pairing/start', { method: 'POST', body: { installationId: 'install-1', installationPublicKey: 'public-key', idempotencyKey: 'retry-1' } });
  assert.strictEqual(pairingStart.status, 200);
  assert.deepStrictEqual(pairingStart.body, { ok: true, pairingId: 'pair-1', pairingSecret: 'secret-1', expiresAt: '2026-08-21T12:05:00.000Z' });
  const pairingConfirm = await request(pairedApp, '/api/desktop/pairing/confirm', { method: 'POST', body: { pairingId: 'pair-1', pairingSecret: 'secret-1', phoneCode: 'provider-code' } });
  assert.strictEqual(pairingConfirm.status, 200);
  assert.deepStrictEqual(pairingConfirm.body, { ok: true, status: 'verified' });
  const pairingRead = await request(pairedApp, '/api/desktop/pairing/pair-1?secret=secret-1');
  assert.strictEqual(pairingRead.status, 200);
  assert.deepStrictEqual(pairingRead.body, { ok: true, status: 'verified', verificationToken: 'ticket-1' });
  assert.deepStrictEqual(pairingCalls, [
    ['start', { installationId: 'install-1', installationPublicKey: 'public-key', idempotencyKey: 'retry-1' }],
    ['confirm', { pairingId: 'pair-1', pairingSecret: 'secret-1', phoneCode: 'provider-code' }],
    ['read', { pairingId: 'pair-1', pairingSecret: 'secret-1' }],
  ]);

  const questionCalls = [];
  const questionAuthority = {
    async list(input) {
      questionCalls.push(input);
      return [{ id: 'question-list-1', subject: 'physics', type: 'single_choice', difficulty: 3, status: 'draft', content: 'Cloud text', options: [], answer: null, analysis: null, rich_content: null, knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: [], has_formula: false, version: 1 }];
    },
    async create(input) {
      questionCalls.push(input);
      return { id: input.question.id, status: 'draft', version: 1, contentHash: 'a'.repeat(64) };
    },
    async submitDesktopDraft(input) {
      questionCalls.push(input);
      return {
        commandId: input.command.commandId, payloadHash: input.command.payloadHash, status: 'committed',
        result: { id: 'question-3', status: 'draft', version: 1, contentHash: 'b'.repeat(64) },
        resultHash: 'c'.repeat(64),
      };
    },
  };
  const questionApp = createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity, questionAuthority, businessTenantId: 'default' });
  const listedQuestions = await request(questionApp, '/api/desktop/question-bank/questions?limit=200', { headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' } });
  assert.strictEqual(listedQuestions.status, 200);
  assert.deepStrictEqual(listedQuestions.body, { ok: true, questions: [{ id: 'question-list-1', subject: 'physics', type: 'single_choice', difficulty: 3, status: 'draft', content: 'Cloud text', options: [], answer: null, analysis: null, rich_content: null, knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: [], has_formula: false, version: 1 }] });
  assert.deepStrictEqual(questionCalls, [{
    tenantId: 'default', actor: { authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'install-1', sessionId: 'session-1', expiresAt: '2026-08-21T13:00:00.000Z', roles: ['super_admin'], teacherId: null, studentId: null }, limit: 200,
  }]);
  const createdQuestion = await request(questionApp, '/api/desktop/question-bank/questions', {
    method: 'POST', headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' }, body: {
      id: 'question-1', subject: 'physics', questionType: 'single_choice', difficulty: 3,
      stem: 'Question text', answer: null, explanation: null, options: [], richContent: null, taxonomy: {}, hasFormula: false,
    },
  });
  assert.strictEqual(createdQuestion.status, 200);
  assert.deepStrictEqual(createdQuestion.body, { ok: true, question: { id: 'question-1', status: 'draft', version: 1, contentHash: 'a'.repeat(64) } });
  assert.deepStrictEqual(questionCalls[1], {
    tenantId: 'default',
    actor: { authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'install-1', sessionId: 'session-1', expiresAt: '2026-08-21T13:00:00.000Z', roles: ['super_admin'], teacherId: null, studentId: null },
    question: { id: 'question-1', subject: 'physics', questionType: 'single_choice', difficulty: 3, stem: 'Question text', answer: null, explanation: null, options: [], richContent: null, taxonomy: {}, hasFormula: false },
  });
  const submittedQuestionDraft = await request(questionApp, '/api/desktop/question-bank/commands', {
    method: 'POST', headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' }, body: {
      commandId: 'question-command-1', payloadHash: 'd'.repeat(64), type: 'question.create.v1',
      payload: { record: { id: 'question-3', subject: 'physics' } },
    },
  });
  assert.strictEqual(submittedQuestionDraft.status, 200);
  assert.deepStrictEqual(submittedQuestionDraft.body, {
    ok: true,
    receipt: {
      commandId: 'question-command-1', payloadHash: 'd'.repeat(64), status: 'committed',
      result: { id: 'question-3', status: 'draft', version: 1, contentHash: 'b'.repeat(64) },
      resultHash: 'c'.repeat(64),
    },
  });
  assert.deepStrictEqual(questionCalls[2], {
    tenantId: 'default',
    actor: { authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'install-1', sessionId: 'session-1', expiresAt: '2026-08-21T13:00:00.000Z', roles: ['super_admin'], teacherId: null, studentId: null },
    command: {
      commandId: 'question-command-1', payloadHash: 'd'.repeat(64), type: 'question.create.v1',
      payload: { record: { id: 'question-3', subject: 'physics' } },
    },
  });
  const miniappCannotCreateQuestion = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), miniappCloudAccount: miniappIdentity, questionAuthority, businessTenantId: 'default' }), '/api/desktop/question-bank/questions', {
    method: 'POST', headers: { authorization: 'Bearer miniapp-ticket.signature' }, body: {
      id: 'question-2', subject: 'physics', questionType: 'single_choice', difficulty: 3,
      stem: 'Denied text', answer: null, explanation: null, options: [], richContent: null, taxonomy: {}, hasFormula: false,
    },
  });
  assert.strictEqual(miniappCannotCreateQuestion.status, 403);
  assert.deepStrictEqual(miniappCannotCreateQuestion.body, { ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
  const miniappCannotSubmitQuestionCommand = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), miniappCloudAccount: miniappIdentity, questionAuthority, businessTenantId: 'default' }), '/api/desktop/question-bank/commands', {
    method: 'POST', headers: { authorization: 'Bearer miniapp-ticket.signature' }, body: {
      commandId: 'question-command-denied', payloadHash: 'd'.repeat(64), type: 'question.create.v1',
      payload: { record: { id: 'question-denied', subject: 'physics' } },
    },
  });
  assert.strictEqual(miniappCannotSubmitQuestionCommand.status, 403);
  assert.deepStrictEqual(miniappCannotSubmitQuestionCommand.body, { ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });

  const encryptedRelayCalls = [];
  const encryptedRelayApp = createCloudBusinessApp({
    query: async () => ({ rows: [] }), desktopRegistration: identity, businessTenantId: 'default',
    storageAgentKeyFingerprint: 'e'.repeat(64),
    storageAgentPublicKey: 'agent-public-key-base64url',
    encryptedStorageRelay: {
      async create(input) {
        encryptedRelayCalls.push(input);
        return { taskId: input.taskId, assetId: input.assetId, expiresAt: input.expiresAt };
      },
    },
  });
  const encryptedRelayKey = await request(encryptedRelayApp, '/api/desktop/question-bank/assets/relay-key', {
    method: 'GET', headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' },
  });
  assert.strictEqual(encryptedRelayKey.status, 200);
  assert.deepStrictEqual(encryptedRelayKey.body, { ok: true, agentPublicKey: 'agent-public-key-base64url', agentKeyFingerprint: 'e'.repeat(64) });
  const encryptedRelayCreated = await request(encryptedRelayApp, '/api/desktop/question-bank/assets/relay', {
    method: 'POST', headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' }, body: {
      questionId: 'question-1', assetId: 'asset_1', taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1,
      assetType: 'image', fileName: 'diagram.png', mimeType: 'image/png', agentKeyFingerprint: 'e'.repeat(64),
      envelope: { version: 'x25519-aes-256-gcm-v1' }, ciphertextBase64: Buffer.from('ciphertext').toString('base64url'),
      expiresAt: '2026-08-23T01:05:00.000Z',
    },
  });
  assert.strictEqual(encryptedRelayCreated.status, 200);
  assert.deepStrictEqual(encryptedRelayCreated.body, { ok: true, relay: { taskId: 'task_12345678', assetId: 'asset_1', expiresAt: '2026-08-23T01:05:00.000Z' } });
  assert.strictEqual(encryptedRelayCalls.length, 1);
  assert.strictEqual(encryptedRelayCalls[0].actorAccountId, 'account-1');
  assert.deepStrictEqual(encryptedRelayCalls[0].ciphertext, Buffer.from('ciphertext'));

  const storageCalls = [];
  const storageAgent = {
    lease: async input => {
      storageCalls.push(['lease', input]);
      if (input.token !== 'storage-agent-test-token') throw Object.assign(new Error('rejected'), { code: 'STORAGE_AGENT_REJECTED' });
      return { taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1, expectedSha256: 'a'.repeat(64), expectedBytes: 3, mediaType: 'image/png', leaseToken: 'lease-token-test-value', leaseExpiresAt: '2026-08-22T00:05:00.000Z' };
    },
    download: async input => {
      storageCalls.push(['download', input]);
      if (input.token !== 'storage-agent-test-token') throw Object.assign(new Error('rejected'), { code: 'STORAGE_AGENT_REJECTED' });
      return { envelope: { version: 'x25519-aes-256-gcm-v1' }, ciphertext: Buffer.from('relay-ciphertext') };
    },
    complete: async input => {
      storageCalls.push(['complete', input]);
      if (input.token !== 'storage-agent-test-token') throw Object.assign(new Error('rejected'), { code: 'STORAGE_AGENT_REJECTED' });
      return { taskId: input.taskId, state: 'verified', verifiedAt: '2026-08-22T00:00:00.000Z' };
    },
  };
  const storageApp = createCloudBusinessApp({ query: async () => ({ rows: [] }), storageAgent });
  const leasedStorageTask = await request(storageApp, '/api/storage-agent/lease', {
    method: 'POST', headers: { 'x-gewu-storage-agent-token': 'storage-agent-test-token' }, body: { agentId: 'storage-agent-1' },
  });
  assert.strictEqual(leasedStorageTask.status, 200);
  assert.deepStrictEqual(leasedStorageTask.body, { ok: true, task: { taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1, expectedSha256: 'a'.repeat(64), expectedBytes: 3, mediaType: 'image/png', leaseToken: 'lease-token-test-value', leaseExpiresAt: '2026-08-22T00:05:00.000Z' } });
  const downloadedStorageRelay = await request(storageApp, '/api/storage-agent/tasks/task_12345678/download', {
    method: 'POST', headers: { 'x-gewu-storage-agent-token': 'storage-agent-test-token' }, body: { agentId: 'storage-agent-1', leaseToken: 'lease-token-test-value' },
  });
  assert.strictEqual(downloadedStorageRelay.status, 200);
  assert.deepStrictEqual(downloadedStorageRelay.body, { ok: true, relay: { envelope: { version: 'x25519-aes-256-gcm-v1' }, ciphertextBase64: Buffer.from('relay-ciphertext').toString('base64url') } });
  const completedStorageTask = await request(storageApp, '/api/storage-agent/tasks/task_12345678/complete', {
    method: 'POST', headers: { 'x-gewu-storage-agent-token': 'storage-agent-test-token' },
    body: { agentId: 'storage-agent-1', leaseToken: 'lease-token-test-value', observedSha256: 'a'.repeat(64), observedBytes: 3 },
  });
  assert.strictEqual(completedStorageTask.status, 200);
  assert.deepStrictEqual(completedStorageTask.body, { ok: true, receipt: { taskId: 'task_12345678', state: 'verified', verifiedAt: '2026-08-22T00:00:00.000Z' } });
  const rejectedStorageTask = await request(storageApp, '/api/storage-agent/lease', {
    method: 'POST', headers: { 'x-gewu-storage-agent-token': 'wrong-token' }, body: { agentId: 'storage-agent-1' },
  });
  assert.strictEqual(rejectedStorageTask.status, 403);
  assert.deepStrictEqual(rejectedStorageTask.body, { ok: false, code: 'CLOUD_STORAGE_AGENT_REJECTED' });
  assert.deepStrictEqual(storageCalls, [
    ['lease', { agentId: 'storage-agent-1', token: 'storage-agent-test-token' }],
    ['download', { agentId: 'storage-agent-1', token: 'storage-agent-test-token', taskId: 'task_12345678', leaseToken: 'lease-token-test-value' }],
    ['complete', { agentId: 'storage-agent-1', token: 'storage-agent-test-token', taskId: 'task_12345678', leaseToken: 'lease-token-test-value', observedSha256: 'a'.repeat(64), observedBytes: 3 }],
    ['lease', { agentId: 'storage-agent-1', token: 'wrong-token' }],
  ]);

  const paperCalls = [];
  const paperApp = createCloudBusinessApp({
    query: async () => ({ rows: [] }), desktopRegistration: identity, businessTenantId: 'default',
    paperExportTasks: {
      create: async input => {
        paperCalls.push(input);
        return { taskId: 'paper_task_1', status: 'queued', phase: 'queued', progress: 0, requestHash: 'a'.repeat(64), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', replayed: false };
      },
      read: async () => ({ taskId: 'paper_task_1', status: 'queued', phase: 'queued', progress: 0, requestHash: 'a'.repeat(64), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', replayed: false }),
      cancel: async () => ({ taskId: 'paper_task_1', status: 'cancelled', phase: 'cancelled', progress: 0, requestHash: 'a'.repeat(64), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', replayed: false }),
    },
  });
  const paperTask = await request(paperApp, '/api/desktop/paper-export-tasks', {
    method: 'POST', headers: { authorization: 'Bearer eyJ2IjoxfQ.signature', 'x-idempotency-key': 'paper-request-1' },
    body: { taskType: 'paper-export-pdf', request: { questionIds: ['q1'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native' } },
  });
  assert.strictEqual(paperTask.status, 202);
  assert.strictEqual(paperTask.body.task.taskId, 'paper_task_1');
  assert.strictEqual(paperCalls.length, 1);
  assert.strictEqual(paperCalls[0].tenantId, 'default');
  assert.strictEqual(paperCalls[0].actor.accountId, 'account-1');
  console.log('cloud business API health checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
