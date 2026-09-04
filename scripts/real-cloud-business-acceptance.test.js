'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  makeSessionToken,
  makeMiniappSessionToken,
  resolveRuntimeModules,
  runStage,
  runWithCleanup,
  runPublicAcceptance,
  runTeachingLoopAcceptance,
  loadRoleTeachingBindings,
  runRoleScopedTeachingAcceptance,
  verifyRoleScopedTeachingProjection,
  runMiniappLimitedWriteAcceptance,
  forceCleanup,
  forceMiniappAssetCleanup,
  createControlledAcceptanceSession,
  revokeControlledAcceptanceSession,
  verifyBusinessSuperAdmin,
  resolveOperatorIdentity,
  verifyCanonicalPhoneContact,
  createOnlineRegistrationRequest,
  runOnlineRegistrationAcceptance,
  revokeOnlineRegistrationAcceptance,
  pidOneEnvironmentMatches,
} = require('./real-cloud-business-acceptance');
const { createCloudDesktopRegistrationService } = require('../cloud-business-api/src/desktopRegistrationService');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

async function successfulAcceptance() {
  const calls = [];
  const createdAt = '2026-08-24T14:30:00.001Z';
  const updatedAt = '2026-08-24T14:30:00.101Z';
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body, authorization: options.headers?.Authorization });
    if (calls.length === 1) return response(201, { ok: true, institution: { id: 'codex-e2e-8.4.1-fixed', updatedAt: createdAt } });
    if (calls.length === 2) return response(200, { ok: true, projection: { institutions: [{ id: 'codex-e2e-8.4.1-fixed', updated_at: '2026-08-24T14:30:00.001+00:00' }] } });
    if (calls.length === 3) return response(200, { ok: true, institution: { id: 'codex-e2e-8.4.1-fixed', updatedAt } });
    if (calls.length === 4) return response(409, { ok: false, code: 'CLOUD_BUSINESS_INSTITUTION_CONFLICT' });
    if (calls.length === 5) return response(200, { ok: true, institution: { id: 'codex-e2e-8.4.1-fixed', updatedAt } });
    return response(200, { ok: true, projection: { institutions: [] } });
  };
  const result = await runPublicAcceptance({
    fetchImpl,
    sessionToken: 'payload.signature',
    baseUrl: 'https://physicsedu.xyz/cloud-business',
    version: '8.4.1',
    now: () => new Date('2026-08-24T14:30:00.000Z'),
    randomUUID: () => 'fixed',
    sleep: async () => {},
  });
  assert.deepStrictEqual(result, {
    ok: true,
    version: '8.4.1',
    createStatus: 201,
    readBack: true,
    updateStatus: 200,
    staleConflictStatus: 409,
    deleteStatus: 200,
    absenceConfirmed: true,
    cleanupConfirmed: true,
    markerSha256: crypto.createHash('sha256').update('codex-e2e-8.4.1-fixed').digest('hex'),
  });
  assert.strictEqual(calls.length, 6);
  assert.ok(calls.every(call => call.authorization === 'Bearer payload.signature'));
  assert.strictEqual(calls[3].body.expectedUpdatedAt, createdAt, 'the stale write must use the original baseline');
  assert.strictEqual(calls[4].body.expectedUpdatedAt, updatedAt, 'cleanup must use the latest observed timestamp');
  assert.ok(!JSON.stringify(result).includes('payload.signature'), 'acceptance evidence must never expose a bearer token');
}

async function cleanupOnFailure() {
  const calls = [];
  const createdAt = '2026-08-24T14:30:00.001Z';
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if (calls.length === 1) return response(201, { ok: true, institution: { id: 'codex-e2e-8.4.1-fixed', updatedAt: createdAt } });
    if (calls.length === 2) throw new Error('synthetic read failure');
    if (calls.length === 3) return response(200, { ok: true, projection: { institutions: [{ id: 'codex-e2e-8.4.1-fixed', updated_at: createdAt }] } });
    if (calls.length === 4) return response(200, { ok: true, institution: { id: 'codex-e2e-8.4.1-fixed', updatedAt: createdAt } });
    return response(200, { ok: true, projection: { institutions: [] } });
  };
  await assert.rejects(
    runPublicAcceptance({
      fetchImpl,
      sessionToken: 'payload.signature',
      baseUrl: 'https://physicsedu.xyz/cloud-business',
      version: '8.4.1',
      now: () => new Date('2026-08-24T14:30:00.000Z'),
      randomUUID: () => 'fixed',
      sleep: async () => {},
    }),
    /synthetic read failure/,
  );
  assert.strictEqual(calls[3].method, 'DELETE', 'a failure after create must still delete the disposable record');
  assert.strictEqual(calls[3].body.expectedUpdatedAt, createdAt);
  assert.strictEqual(calls[4].method, 'GET', 'cleanup must prove the disposable record is absent');
}

async function teachingLoopCreatesReadsConflictsAndCleans() {
  const marker = 'codex-e2e-8.7.3-loop';
  const timestamps = new Map();
  const created = new Set();
  const calls = [];
  const singularByPath = {
    institutions: 'institution', schools: 'school', rooms: 'room', teachers: 'teacher',
    students: 'student', courses: 'course', schedules: 'schedule',
  };
  const tableByResource = {
    institutions: 'institutions', schools: 'schools', rooms: 'rooms', teachers: 'teachers',
    students: 'students', courses: 'courses', schedules: 'schedules',
  };
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body });
    if (path.endsWith('/desktop-projection')) {
      const projection = {};
      for (const [resource, table] of Object.entries(tableByResource)) {
        projection[table] = [...created]
          .filter(key => key.startsWith(`${resource}:`))
          .map(key => ({ id: key.slice(resource.length + 1), updated_at: timestamps.get(key) }));
      }
      return response(200, { ok: true, projection });
    }
    const match = path.match(/\/api\/business\/(institutions|schools|rooms|teachers|students|courses|schedules)(?:\/([^/]+))?$/);
    assert.ok(match, `unexpected path ${path}`);
    const resource = match[1];
    const id = decodeURIComponent(match[2] || body?.[`${resource.slice(0, -1)}Id`] || body?.studentId || body?.courseId || body?.scheduleId || '');
    const key = `${resource}:${id}`;
    const responseKey = singularByPath[resource];
    if (method === 'POST') {
      if (resource === 'courses') {
        assert.deepStrictEqual(body.data.pricings, [{ studentId: `${marker}-student`, tuition: 100, teacherFee: 60 }]);
        assert.strictEqual(Object.hasOwn(body.data, 'studentPricings'), false);
      }
      const updatedAt = `2026-08-27T04:40:${String(timestamps.size + 1).padStart(2, '0')}.000Z`;
      created.add(key); timestamps.set(key, updatedAt);
      return response(201, { ok: true, [responseKey]: { id, updatedAt } });
    }
    if (method === 'PUT' && resource === 'courses' && body.expectedUpdatedAt === timestamps.get(key)) {
      const updatedAt = '2026-08-27T04:41:00.000Z'; timestamps.set(key, updatedAt);
      timestamps.set(`schedules:${marker}-schedule`, '2026-08-27T04:41:00.100Z');
      return response(200, { ok: true, course: { id, updatedAt } });
    }
    if (method === 'PUT' && resource === 'courses') return response(409, { ok: false, code: 'CLOUD_BUSINESS_COURSE_CONFLICT' });
    if (method === 'DELETE') {
      assert.strictEqual(body.expectedUpdatedAt, timestamps.get(key), `delete must use latest ${resource} version`);
      created.delete(key);
      return response(200, { ok: true, [responseKey]: { id, updatedAt: timestamps.get(key) } });
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const result = await runTeachingLoopAcceptance({
    fetchImpl, sessionToken: 'payload.signature', baseUrl: 'https://physicsedu.xyz/cloud-business', version: '8.7.3', marker,
  });
  assert.deepStrictEqual(result, {
    teachingLoopCreated: 7,
    teachingLoopReadBack: true,
    teachingLoopCourseUpdateStatus: 200,
    teachingLoopCourseConflictStatus: 409,
    teachingLoopCleanupConfirmed: true,
  });
  assert.deepStrictEqual([...created], []);
  const deletes = calls.filter(call => call.method === 'DELETE').map(call => call.path);
  assert.deepStrictEqual(deletes.map(path => path.split('/').at(-2)), ['schedules', 'courses', 'students', 'teachers', 'rooms', 'schools', 'institutions']);
  assert.strictEqual(calls.filter(call => call.method === 'GET' && call.path.endsWith('/desktop-projection')).length, 3, 'course updates must refresh dependent schedule versions before cleanup');
}

function roleScopedTeachingProjectionRequiresExpectedVisibilityAndRedaction() {
  const courseId = 'codex-e2e-8.9.0-role-course';
  const scheduleId = 'codex-e2e-8.9.0-role-schedule';
  const projectionFor = (visible, fee) => ({
    courses: visible ? [{ id: courseId, price_teacher: fee, student_pricings: [{ student_id: 'student-1', teacher_fee: fee }] }] : [],
    schedules: visible ? [{ id: scheduleId, course_id: courseId, calculated_teacher_fee: fee, student_pricings: [{ student_id: 'student-1', teacher_fee: fee }] }] : [],
  });
  assert.deepStrictEqual(verifyRoleScopedTeachingProjection({
    courseId,
    scheduleId,
    projections: {
      visitor: null,
      teacher: projectionFor(true, 60),
      student: projectionFor(true, null),
      family: projectionFor(true, null),
    },
  }), {
    visitorExcluded: true,
    teacherReadBack: true,
    studentReadBack: true,
    familyReadBack: true,
    studentFeeRedacted: true,
    familyFeeRedacted: true,
  });
  assert.throws(() => verifyRoleScopedTeachingProjection({
    courseId,
    scheduleId,
    projections: {
      visitor: projectionFor(true, null),
      teacher: projectionFor(true, 60),
      student: projectionFor(true, null),
      family: projectionFor(true, null),
    },
  }), /REAL_CLOUD_ROLE_TEACHING_VISITOR_SCOPE_FAILED/);
}

async function roleTeachingBindingsRequireOneCoherentFixture() {
  const marker = 'e2e-role-test-da6c43760d5d46428fa699af38148bb7';
  const rows = [
    { accountId: `e2e-account-visitor-${marker}`, status: 'active', roles: [], profileType: null, profileId: null, relationship: null, updatedAt: '2026-08-30T01:00:00.000Z' },
    { accountId: `e2e-account-teacher-${marker}`, status: 'active', roles: ['teacher'], profileType: 'teacher', profileId: `e2e-teacher-${marker}`, relationship: null, updatedAt: '2026-08-30T01:00:01.000Z' },
    { accountId: `e2e-account-student-${marker}`, status: 'active', roles: ['student'], profileType: 'student', profileId: `e2e-student-${marker}`, relationship: 'student', updatedAt: '2026-08-30T01:00:02.000Z' },
    { accountId: `e2e-account-family-${marker}`, status: 'active', roles: ['family_member'], profileType: 'student', profileId: `e2e-student-${marker}`, relationship: 'guardian', updatedAt: '2026-08-30T01:00:03.000Z' },
  ];
  const calls = [];
  const bindings = await loadRoleTeachingBindings({
    async query(sql, values) {
      calls.push([sql, values]);
      if (sql.includes('FROM business.miniapp_cloud_accounts')) return { rows };
      return { rows: [{ teacherExists: true, studentExists: true }] };
    },
  }, 'default');
  assert.strictEqual(bindings.marker, marker);
  assert.strictEqual(bindings.roles.teacher.profileId, `e2e-teacher-${marker}`);
  assert.strictEqual(bindings.roles.student.profileId, `e2e-student-${marker}`);
  assert.strictEqual(bindings.roles.family.profileId, bindings.roles.student.profileId);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1][1], ['default', `e2e-teacher-${marker}`, `e2e-student-${marker}`]);
}

async function roleScopedTeachingCreatesReadsAndCleans() {
  const marker = 'codex-e2e-8.9.0-roleloop';
  const fixtureMarker = 'e2e-role-test-da6c43760d5d46428fa699af38148bb7';
  const bindings = {
    marker: fixtureMarker,
    roles: {
      visitor: { accountId: `e2e-account-visitor-${fixtureMarker}`, profileId: null },
      teacher: { accountId: `e2e-account-teacher-${fixtureMarker}`, profileId: `e2e-teacher-${fixtureMarker}` },
      student: { accountId: `e2e-account-student-${fixtureMarker}`, profileId: `e2e-student-${fixtureMarker}` },
      family: { accountId: `e2e-account-family-${fixtureMarker}`, profileId: `e2e-student-${fixtureMarker}` },
    },
  };
  const created = new Map();
  const calls = [];
  const singularByResource = { institutions: 'institution', schools: 'school', rooms: 'room', courses: 'course', schedules: 'schedule' };
  const tableByResource = { institutions: 'institutions', schools: 'schools', rooms: 'rooms', courses: 'courses', schedules: 'schedules' };
  const roleFromToken = authorization => {
    const encoded = String(authorization || '').replace(/^Bearer /, '').split('.')[0];
    const accountId = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).accountId;
    return Object.entries(bindings.roles).find(([, value]) => value.accountId === accountId)?.[0] || null;
  };
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body, authorization: options.headers?.Authorization });
    if (path.endsWith('/miniapp-projection')) {
      const role = roleFromToken(options.headers?.Authorization);
      if (role === 'visitor') return response(403, { ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const fee = role === 'teacher' ? 60 : null;
      return response(200, { ok: true, projection: {
        courses: [{ id: `${marker}-role-course`, price_teacher: fee, student_pricings: [{ student_id: bindings.roles.student.profileId, teacher_fee: fee }] }],
        schedules: [{ id: `${marker}-role-schedule`, course_id: `${marker}-role-course`, calculated_teacher_fee: fee, student_pricings: [{ student_id: bindings.roles.student.profileId, teacher_fee: fee }] }],
      } });
    }
    if (path.endsWith('/desktop-projection')) {
      const projection = {};
      for (const [resource, table] of Object.entries(tableByResource)) {
        projection[table] = [...created.entries()].filter(([key]) => key.startsWith(`${resource}:`)).map(([key, updatedAt]) => ({ id: key.slice(resource.length + 1), updated_at: updatedAt }));
      }
      return response(200, { ok: true, projection });
    }
    const match = path.match(/\/api\/business\/(institutions|schools|rooms|courses|schedules)(?:\/([^/]+))?$/);
    assert.ok(match, `unexpected path ${path}`);
    const resource = match[1];
    const id = decodeURIComponent(match[2] || body?.[`${resource.slice(0, -1)}Id`] || body?.courseId || body?.scheduleId || '');
    const key = `${resource}:${id}`;
    const responseKey = singularByResource[resource];
    if (method === 'POST') {
      if (resource === 'courses') {
        assert.strictEqual(body.data.teacherId, bindings.roles.teacher.profileId);
        assert.deepStrictEqual(body.data.pricings, [{ studentId: bindings.roles.student.profileId, tuition: 100, teacherFee: 60 }]);
      }
      const updatedAt = `2026-08-31T01:00:${String(created.size + 1).padStart(2, '0')}.000Z`;
      created.set(key, updatedAt);
      return response(201, { ok: true, [responseKey]: { id, updatedAt } });
    }
    if (method === 'DELETE') {
      assert.strictEqual(body.expectedUpdatedAt, created.get(key));
      created.delete(key);
      return response(200, { ok: true, [responseKey]: { id, updatedAt: body.expectedUpdatedAt } });
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const result = await runRoleScopedTeachingAcceptance({
    fetchImpl,
    sessionToken: 'payload.signature',
    miniappTicketSecret: 'miniapp-ticket-secret-for-real-role-tests',
    bindings,
    baseUrl: 'https://physicsedu.xyz/cloud-business',
    version: '8.9.0',
    marker,
  });
  assert.deepStrictEqual(result, {
    roleTeachingCreated: 5,
    roleTeachingDesktopReadBack: true,
    roleTeachingVisitorStatus: 403,
    roleTeachingVisitorExcluded: true,
    roleTeachingTeacherReadBack: true,
    roleTeachingStudentReadBack: true,
    roleTeachingFamilyReadBack: true,
    roleTeachingStudentFeeRedacted: true,
    roleTeachingFamilyFeeRedacted: true,
    roleTeachingCleanupConfirmed: true,
  });
  assert.deepStrictEqual([...created], []);
  assert.deepStrictEqual(calls.filter(call => call.method === 'DELETE').map(call => call.path.split('/').at(-2)), ['schedules', 'courses', 'rooms', 'schools', 'institutions']);
}

async function forceCleanupQualifiesTheFunctionOutputColumn() {
  const appCalls = [];
  const writerCalls = [];
  const ownerCalls = [];
  const appPool = {
    async query(sql) {
      appCalls.push(sql);
      if (sql.includes('SELECT id,to_char') && sql.includes('business.teachers')) {
        return { rows: [{ id: 'codex-e2e-8.7.4-clean-teacher', updatedAt: '2030-01-01T00:00:00.000Z' }] };
      }
      if (sql.includes('SELECT id,to_char')) return { rows: [] };
      return { rows: [{ count: 0 }] };
    },
  };
  const writerPool = {
    async query(sql, values) {
      writerCalls.push([sql, values]);
      return { rows: [{ id: 'codex-e2e-8.7.4-clean-teacher' }] };
    },
    async connect() {
      return {
        async query(sql, values) { ownerCalls.push([sql, values]); return { rows: [] }; },
        release() {},
      };
    },
  };
  assert.strictEqual(await forceCleanup(appPool, writerPool, 'default', 'codex-e2e-8.7.4-clean'), true);
  assert.strictEqual(writerCalls.length, 1);
  assert.match(writerCalls[0][0], /SELECT removed\.id AS id FROM business\.vnext_soft_delete_teacher\([^)]*\) AS removed/);
  assert.deepStrictEqual(writerCalls[0][1], ['default', 'codex-e2e-8.7.4-clean-teacher', '2030-01-01T00:00:00.000Z']);
  assert.deepStrictEqual(ownerCalls.filter(([sql]) => sql === 'SET LOCAL ROLE vnext_pg17_business_owner').length, 2);
  assert.match(ownerCalls.find(([sql]) => sql.includes('business.schedule_student_overrides'))[0], /DELETE FROM business\.schedule_student_overrides WHERE tenant_id=\$1 AND \(schedule_id=\$2 OR schedule_id LIKE \$3\)/);
  assert.match(ownerCalls.find(([sql]) => sql.includes('business.course_student_pricings'))[0], /DELETE FROM business\.course_student_pricings WHERE tenant_id=\$1 AND \(course_id=\$2 OR course_id LIKE \$3\)/);
  assert.ok(appCalls.some(sql => sql.includes('business.institutions')));
}

function tokenIsBoundAndOpaque() {
  const token = makeSessionToken('x'.repeat(32), {
    authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1',
    sessionId: 'session-1', expiresAt: '2026-08-24T15:00:00.000Z',
  });
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.deepStrictEqual(payload, {
    v: 1,
    authorityId: 'authority-1',
    accountId: 'account-1',
    deviceId: 'device-1',
    installationId: 'installation-1',
    sessionId: 'session-1',
    expiresAt: Date.parse('2026-08-24T15:00:00.000Z'),
  });
}

async function miniappLimitedWriteIsRealReplayedReadableAndCleaned() {
  const token = makeMiniappSessionToken('m'.repeat(32), 'canonical-admin', new Date('2026-08-25T00:00:00.000Z'));
  const ticket = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.deepStrictEqual(ticket, {
    v: 1,
    kind: 'miniapp-cloud',
    accountId: 'canonical-admin',
    expiresAt: Date.parse('2026-08-25T00:10:00.000Z'),
  });

  let cleaned = false;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, authorization: options.headers?.Authorization, idempotencyKey: options.headers?.['x-idempotency-key'] });
    if (path.endsWith('/miniapp-personal-assets/import')) {
      const replayed = calls.filter(call => call.path.endsWith('/miniapp-personal-assets/import')).length > 1;
      return response(replayed ? 200 : 202, {
        ok: true,
        receipt: { importId: 'asset_import_12345678', recordCount: 1, createdAt: '2026-08-25T00:00:00.000Z', replayed },
      });
    }
    return response(200, {
      ok: true,
      projection: { assetRecords: cleaned ? [] : [{ id: 'asset_record_12345678', category_name: 'codex-e2e-asset-8.4.1-fixed', note: 'controlled temporary miniapp acceptance' }] },
    });
  };
  const result = await runMiniappLimitedWriteAcceptance({
    fetchImpl,
    sessionToken: token,
    accountId: 'canonical-admin',
    baseUrl: 'https://physicsedu.xyz/cloud-business',
    version: '8.4.1',
    marker: 'codex-e2e-8.4.1-fixed',
    cleanup: async fixture => {
      assert.deepStrictEqual(fixture, {
        accountId: 'canonical-admin',
        importId: 'asset_import_12345678',
        idempotencyKey: 'asset-import-codex-e2e-8.4.1-fixed',
        categoryName: 'codex-e2e-asset-8.4.1-fixed',
      });
      cleaned = true;
      return true;
    },
  });
  assert.deepStrictEqual(result, {
    miniappAssetImportStatus: 202,
    miniappAssetReplayStatus: 200,
    miniappAssetReadBack: true,
    miniappAssetCleanupConfirmed: true,
  });
  assert.strictEqual(calls.length, 4);
  assert.ok(calls.every(call => call.authorization === `Bearer ${token}`));
  assert.ok(calls.slice(0, 2).every(call => call.idempotencyKey === 'asset-import-codex-e2e-8.4.1-fixed'));
  assert.ok(!JSON.stringify(result).includes(token));
}

async function miniappCleanupUsesTheBusinessRoleAndVerifiesAbsence() {
  const statements = [];
  const client = {
    query: async (text, values) => {
      statements.push([text, values]);
      if (text.includes('SELECT import_id AS')) return { rows: [{ importId: 'asset_import_12345678' }] };
      return { rows: [] };
    },
    release: () => { statements.push(['RELEASE']); },
  };
  const appPool = {
    connect: async () => client,
    query: async (text, values) => {
      statements.push([text, values]);
      return { rows: [{ imports: 0, records: 0, categories: 0 }] };
    },
  };
  const fixture = {
    accountId: 'canonical-admin',
    importId: 'asset_import_12345678',
    idempotencyKey: 'asset-import-codex-e2e-8.4.1-fixed',
    categoryName: 'codex-e2e-asset-8.4.1-fixed',
  };
  assert.strictEqual(await forceMiniappAssetCleanup(appPool, null, 'default', fixture), true);
  const sql = statements.map(([text]) => text).join('\n');
  assert.ok(sql.includes('BEGIN') && sql.includes('COMMIT'));
  assert.ok(sql.includes('DELETE FROM business.personal_asset_records'));
  assert.ok(sql.includes('DELETE FROM business.personal_asset_imports'));
  assert.ok(sql.includes('DELETE FROM business.personal_asset_categories'));
  assert.ok(!sql.includes('SET LOCAL ROLE'), 'the app role already owns the limited-write tables and must perform cleanup');
}

function serverEnvironmentComparisonDoesNotExposeTheSecret() {
  const secret = 'sensitive-value';
  const read = () => Buffer.from(`A=1\0CLOUD_IDENTITY_TICKET_SECRET=${secret}\0B=2\0`, 'utf8');
  assert.strictEqual(pidOneEnvironmentMatches('CLOUD_IDENTITY_TICKET_SECRET', secret, read), true);
  assert.strictEqual(pidOneEnvironmentMatches('CLOUD_IDENTITY_TICKET_SECRET', 'different', read), false);
}

async function tokenIsAcceptedByDesktopSessionContract() {
  const secret = 'x'.repeat(32);
  const now = new Date('2026-08-24T15:00:00.000Z');
  const session = {
    authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1',
    sessionId: 'acceptance-session-1', expiresAt: '2026-08-24T15:10:00.000Z',
  };
  const service = createCloudDesktopRegistrationService({
    now: () => new Date(now),
    randomId: prefix => `${prefix}-fixed`,
    phoneVerifier: async () => '13700000000',
    lookupAccount: async () => ({ authorityId: session.authorityId, accountId: session.accountId, phoneHmac: null }),
    ticketSecret: secret,
    leasePrivateKey: crypto.generateKeyPairSync('ed25519').privateKey,
    issueAssertion: async () => {},
    register: async () => null,
    readSessionContext: async input => ({ ...input, rowVersion: 1, roles: ['super_admin'], teacherId: null, studentId: null }),
  });
  assert.deepStrictEqual(
    await service.sessionContext({ sessionToken: makeSessionToken(secret, session) }),
    { ...session, rowVersion: 1, roles: ['super_admin'], teacherId: null, studentId: null, activeRole: 'super_admin' },
  );
}

function runtimeLayoutIsExplicit() {
  assert.deepStrictEqual(
    resolveRuntimeModules('C:/repo/scripts', candidate => candidate.includes('/cloud-business-api/')),
    {
      packagePath: 'C:/repo/cloud-business-api/package.json',
      pgPath: 'C:/repo/cloud-business-api/node_modules/pg',
    },
  );
  assert.deepStrictEqual(
    resolveRuntimeModules('/app', candidate => candidate === '/app/package.json' || candidate === '/app/node_modules/pg'),
    { packagePath: '/app/package.json', pgPath: '/app/node_modules/pg' },
  );
  assert.deepStrictEqual(
    resolveRuntimeModules('/app', candidate => candidate === '/app/package.json' || candidate === '/app/node_modules/pg'
      || candidate === '/cloud-business-api/package.json' || candidate === '/cloud-business-api/node_modules/pg'),
    { packagePath: '/app/package.json', pgPath: '/app/node_modules/pg' },
    'the acceptance script must prefer the running container image over a stale sibling mount',
  );
}

async function stageAndCleanupErrorsStayDiagnosable() {
  await assert.rejects(
    runStage('REAL_CLOUD_ACCEPTANCE_SESSION_LOOKUP_FAILED', async () => { throw Object.assign(new Error('denied'), { code: '42501' }); }),
    error => error.code === 'REAL_CLOUD_ACCEPTANCE_SESSION_LOOKUP_FAILED' && error.details.databaseCode === '42501',
  );
  const calls = [];
  await assert.rejects(
    runWithCleanup(
      async () => { calls.push('work'); throw Object.assign(new Error('primary'), { code: 'PRIMARY' }); },
      async () => { calls.push('cleanup'); throw Object.assign(new Error('cleanup'), { code: 'CLEANUP' }); },
    ),
    error => error.code === 'PRIMARY',
  );
  assert.deepStrictEqual(calls, ['work', 'cleanup']);
}

async function controlledSessionIsShortLivedAndRevoked() {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push([text, values]);
      if (text.includes('SELECT l.authority_id')) return { rows: [{
        authority_id: 'authority-1', account_id: 'account-1', device_id: 'device-1', installation_id: 'installation-1', link_id: 'link-1',
        auth_version: 1, access_version: 1, revocation_version: 1, device_credential_version: 1, device_risk_version: 1,
        installation_credential_version: 1, link_auth_version: 1, link_access_version: 1, link_row_version: 1,
      }] };
      if (text.includes('INSERT INTO vnext_control_plane.vnext_sessions')) {
        return { rows: [{
          authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1',
          sessionId: 'acceptance-session-fixed-id', expiresAt: new Date('2026-08-24T15:10:00.000Z'),
        }] };
      }
      if (text.includes('UPDATE vnext_control_plane.vnext_sessions')) return { rows: [{ status: 'revoked' }] };
      return { rows: [] };
    },
    release() { calls.push(['RELEASE']); },
  };
  const pool = { async connect() { return client; } };
  const session = await createControlledAcceptanceSession(pool, ['account-1'], () => 'fixed-id');
  assert.strictEqual(session.sessionId, 'acceptance-session-fixed-id');
  assert.strictEqual(session.expiresAt, '2026-08-24T15:10:00.000Z');
  const sessionInsert = calls.find(call => String(call[0]).includes('INSERT INTO'))[0];
  assert.match(sessionInsert, /interval '10 minutes'/);
  assert.match(sessionInsert, /date_trunc\('milliseconds',transaction_timestamp\(\)\)/,
    'the disposable session timestamp must round-trip through the millisecond desktop ticket without losing equality');
  assert.ok(calls.some(call => call[0] === 'SET LOCAL ROLE vnext_pg17_owner'));
  assert.strictEqual(await revokeControlledAcceptanceSession(pool, session), true);
  assert.match(calls.find(call => String(call[0]).includes('UPDATE vnext_control_plane'))[0], /status='revoked'/);
  assert.strictEqual(calls.filter(call => call[0] === 'COMMIT').length, 2);
}

async function canonicalPhoneMappingMustAlreadyBeActiveAndIsNeverMutated() {
  const calls = [];
  const pool = { async query(text, values) { calls.push([text, values]); return { rows: [{ accountId: 'canonical-admin' }] }; } };
  assert.strictEqual(await verifyBusinessSuperAdmin(pool, { accountId: 'canonical-admin', phoneHmac: 'c'.repeat(64) }), true);
  assert.match(calls[0][0], /SELECT ac\.account_id AS "accountId"/);
  assert.doesNotMatch(calls[0][0], /INSERT|UPDATE|DELETE/);
  assert.deepStrictEqual(calls[0][1], ['canonical-admin', 'c'.repeat(64)]);

  await assert.rejects(
    verifyBusinessSuperAdmin({ async query() { return { rows: [] }; } }, { accountId: 'canonical-admin', phoneHmac: 'c'.repeat(64) }),
    error => error.code === 'REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_FAILED',
  );
}

function operatorIdentityIsResolvedWithoutPhonePlaintext() {
  assert.deepStrictEqual(resolveOperatorIdentity(JSON.stringify([
    { phoneHmac: 'd'.repeat(64), authorityId: 'authority-1', accountId: 'canonical-admin' },
  ]), 'canonical-admin'), { authorityId: 'authority-1', accountId: 'canonical-admin', phoneHmac: 'd'.repeat(64) });
  assert.throws(() => resolveOperatorIdentity('[]', 'canonical-admin'), error => error.code === 'REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_INVALID');
}

async function onlineRegistrationIsRealAndTokenFreeInEvidence() {
  const runtimeModules = resolveRuntimeModules(__dirname, candidate => candidate.includes('/cloud-business-api/'));
  const ticketSecret = 'registration-acceptance-secret'.repeat(2);
  const identity = { authorityId: 'authority-1', accountId: 'canonical-admin', phoneHmac: 'd'.repeat(64) };
  const fixture = createOnlineRegistrationRequest(runtimeModules, ticketSecret, identity, () => 'fixed-registration');
  assert.match(fixture.body.installationId, /^acceptance-registration-/);
  assert.strictEqual(
    crypto.verify(null, Buffer.from(fixture.deviceChallenge, 'utf8'), crypto.createPublicKey(fixture.body.installationPublicKey), Buffer.from(fixture.body.deviceProof, 'base64url')),
    true,
  );

  const calls = [];
  const sessionExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body, authorization: options.headers?.Authorization || null });
    if (path.endsWith('/api/desktop/online-registration')) {
      const deviceId = `desktop-device-${crypto.createHash('sha256').update(crypto.createPublicKey(body.installationPublicKey).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32)}`;
      const session = {
        authorityId: identity.authorityId,
        accountId: identity.accountId,
        deviceId,
        installationId: body.installationId,
        sessionId: 'session-online-fixed',
        expiresAt: sessionExpiresAt,
      };
      return response(200, {
        ok: true,
        receiptId: 'receipt-online-fixed',
        sessionId: session.sessionId,
        replayed: false,
        sessionToken: makeSessionToken(ticketSecret, session),
        offlineLease: { id: 'offline-lease-session-online-fixed', signature: 'signed' },
      });
    }
    const registrationBody = calls[0].body;
    const deviceId = `desktop-device-${crypto.createHash('sha256').update(crypto.createPublicKey(registrationBody.installationPublicKey).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32)}`;
    return response(200, { ok: true, ...identity, deviceId, installationId: registrationBody.installationId, sessionId: 'session-online-fixed', expiresAt: sessionExpiresAt, roles: ['super_admin'], teacherId: null, studentId: null });
  };
  const accepted = await runOnlineRegistrationAcceptance({
    fetchImpl,
    runtimeModules,
    ticketSecret,
    identity,
    baseUrl: 'https://physicsedu.xyz/cloud-business',
    randomUUID: () => 'fixed-registration',
  });
  assert.strictEqual(calls[0].path, '/cloud-business/api/desktop/online-registration');
  assert.strictEqual(calls[0].authorization, null, 'registration must use the verification ticket, not an existing session');
  assert.strictEqual(calls[1].authorization, `Bearer ${accepted.sessionToken}`);
  assert.strictEqual(accepted.evidence.onlineRegistrationStatus, 200);
  assert.strictEqual(accepted.evidence.onlineSessionContextStatus, 200);
  assert.ok(!JSON.stringify(accepted.evidence).includes(accepted.sessionToken));
}

async function onlineRegistrationFixtureIsRevoked() {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push([text, values]);
      if (text.includes('SELECT authority_id')) return { rows: [{ authority_id: 'authority-1', account_id: 'canonical-admin', device_id: `desktop-device-${'a'.repeat(32)}`, installation_id: 'acceptance-registration-fixed', link_id: 'link-fixed', session_id: 'session-online-fixed', status: 'active' }] };
      return { rows: [{ status: 'revoked' }] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  assert.strictEqual(await revokeOnlineRegistrationAcceptance(pool, {
    sessionId: 'session-online-fixed', installationId: 'acceptance-registration-fixed', deviceId: `desktop-device-${'a'.repeat(32)}`,
  }), true);
  assert.ok(calls.some(([text]) => text.includes('vnext_account_device_links')));
  assert.ok(calls.some(([text]) => text.includes('vnext_device_installations')));
  assert.ok(calls.some(([text]) => text.includes('vnext_trusted_devices')));
}

async function preparedOnlineRegistrationCleanupIsSafeBeforePersistence() {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push([text, values]);
      if (text.includes('SELECT authority_id')) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  assert.strictEqual(await revokeOnlineRegistrationAcceptance(pool, {
    sessionId: null, installationId: 'acceptance-registration-fixed', deviceId: `desktop-device-${'a'.repeat(32)}`,
  }), true);
  const selectCall = calls.find(([text]) => text.includes('SELECT authority_id'));
  assert.deepStrictEqual(selectCall[1], ['acceptance-registration-fixed', `desktop-device-${'a'.repeat(32)}`, null]);
  assert.ok(!calls.some(([text]) => text.includes(' SET status=')), 'an unpersisted registration must be a cleanup no-op');
}

async function preparedOnlineRegistrationCleanupRevokesPersistedSessionWithoutReceiptId() {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push([text, values]);
      if (text.includes('SELECT authority_id')) return { rows: [{
        authority_id: 'authority-1', account_id: 'canonical-admin', device_id: `desktop-device-${'a'.repeat(32)}`,
        installation_id: 'acceptance-registration-fixed', link_id: 'link-fixed', session_id: 'actual-session-fixed', status: 'active',
      }] };
      return { rows: [{ status: 'revoked' }] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  assert.strictEqual(await revokeOnlineRegistrationAcceptance(pool, {
    sessionId: null, installationId: 'acceptance-registration-fixed', deviceId: `desktop-device-${'a'.repeat(32)}`,
  }), true);
  const sessionUpdate = calls.find(([text]) => text.includes('UPDATE vnext_control_plane.vnext_sessions'));
  assert.deepStrictEqual(sessionUpdate[1], ['actual-session-fixed']);
  assert.strictEqual(calls.filter(([text]) => text.includes(' SET status=')).length, 4);
}

async function onlineRegistrationCleanupHandleSurvivesContextFailure() {
  const runtimeModules = resolveRuntimeModules(__dirname, candidate => candidate.includes('/cloud-business-api/'));
  const ticketSecret = 'registration-cleanup-secret'.repeat(2);
  const identity = { authorityId: 'authority-1', accountId: 'canonical-admin', phoneHmac: 'd'.repeat(64) };
  const sessionExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  let cleanupFixture = null;
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/api/desktop/online-registration')) {
      const body = JSON.parse(options.body);
      const deviceId = `desktop-device-${crypto.createHash('sha256').update(crypto.createPublicKey(body.installationPublicKey).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32)}`;
      return response(200, {
        ok: true,
        receiptId: 'receipt-cleanup-fixed',
        sessionId: 'session-cleanup-fixed',
        replayed: false,
        sessionToken: makeSessionToken(ticketSecret, {
          ...identity,
          deviceId,
          installationId: body.installationId,
          sessionId: 'session-cleanup-fixed',
          expiresAt: sessionExpiresAt,
        }),
        offlineLease: { id: 'offline-lease-session-cleanup-fixed', signature: 'signed' },
      });
    }
    return response(503, { ok: false, code: 'CONTEXT_UNAVAILABLE' });
  };

  await assert.rejects(
    runOnlineRegistrationAcceptance({
      fetchImpl,
      runtimeModules,
      ticketSecret,
      identity,
      baseUrl: 'https://physicsedu.xyz/cloud-business',
      randomUUID: () => 'fixed-cleanup',
      onRegistrationPersisted: fixture => { cleanupFixture = fixture; },
    }),
    error => error.code === 'REAL_CLOUD_ACCEPTANCE_ONLINE_REGISTRATION_CONTEXT_FAILED',
  );
  assert.deepStrictEqual(cleanupFixture, {
    sessionId: 'session-cleanup-fixed',
    installationId: 'acceptance-registration-fixed-cleanup',
    deviceId: cleanupFixture.deviceId,
  });
  assert.match(cleanupFixture.deviceId, /^desktop-device-[0-9a-f]{32}$/u);
}

async function onlineRegistrationCleanupHandlePrecedesPayloadValidation() {
  const runtimeModules = resolveRuntimeModules(__dirname, candidate => candidate.includes('/cloud-business-api/'));
  const ticketSecret = 'registration-malformed-secret'.repeat(2);
  const identity = { authorityId: 'authority-1', accountId: 'canonical-admin', phoneHmac: 'd'.repeat(64) };
  let cleanupFixture = null;

  await assert.rejects(
    runOnlineRegistrationAcceptance({
      fetchImpl: async () => response(200, { ok: true, receiptId: 'receipt-without-session' }),
      runtimeModules,
      ticketSecret,
      identity,
      baseUrl: 'https://physicsedu.xyz/cloud-business',
      randomUUID: () => 'fixed-malformed',
      onRegistrationPrepared: fixture => { cleanupFixture = fixture; },
    }),
    error => error.code === 'REAL_CLOUD_ACCEPTANCE_ONLINE_REGISTRATION_FAILED',
  );
  assert.deepStrictEqual(cleanupFixture, {
    sessionId: null,
    installationId: 'acceptance-registration-fixed-malformed',
    deviceId: cleanupFixture.deviceId,
  });
  assert.match(cleanupFixture.deviceId, /^desktop-device-[0-9a-f]{32}$/u);
}

async function unverifiedReceiptSessionIdNeverReplacesPreparedCleanupHandle() {
  const runtimeModules = resolveRuntimeModules(__dirname, candidate => candidate.includes('/cloud-business-api/'));
  const ticketSecret = 'registration-wrong-session-secret'.repeat(2);
  const identity = { authorityId: 'authority-1', accountId: 'canonical-admin', phoneHmac: 'd'.repeat(64) };
  let preparedFixture = null;
  let persistedFixture = null;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await assert.rejects(
    runOnlineRegistrationAcceptance({
      fetchImpl: async (_url, options = {}) => {
        const body = JSON.parse(options.body);
        const deviceId = `desktop-device-${crypto.createHash('sha256').update(crypto.createPublicKey(body.installationPublicKey).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32)}`;
        return response(200, {
          ok: true,
          receiptId: 'receipt-wrong-session',
          sessionId: 'wrong-session-fixed',
          replayed: false,
          sessionToken: makeSessionToken(ticketSecret, {
            ...identity, deviceId, installationId: body.installationId, sessionId: 'actual-session-fixed', expiresAt,
          }),
          offlineLease: { id: 'offline-lease-wrong-session', signature: 'signed' },
        });
      },
      runtimeModules,
      ticketSecret,
      identity,
      baseUrl: 'https://physicsedu.xyz/cloud-business',
      randomUUID: () => 'fixed-wrong-session',
      onRegistrationPrepared: fixture => { preparedFixture = fixture; },
      onRegistrationPersisted: fixture => { persistedFixture = fixture; },
    }),
    error => error.code === 'REAL_CLOUD_ACCEPTANCE_ONLINE_REGISTRATION_TOKEN_INVALID',
  );
  assert.strictEqual(preparedFixture.sessionId, null);
  assert.strictEqual(persistedFixture, null, 'an unverified receipt session must never replace the prepared cleanup handle');
}

async function operatorPhoneMustAlreadyBeCanonicalAndIsNeverMutated() {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push([text, values]);
      if (text.includes('SELECT account_id FROM vnext_control_plane.vnext_verified_contacts')) return { rows: [{ account_id: 'canonical-admin' }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  assert.strictEqual(await verifyCanonicalPhoneContact(pool, { accountId: 'canonical-admin', phoneHmac: 'e'.repeat(64) }), true);
  const sql = calls.map(([text]) => text).join('\n');
  assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE/);
  assert.ok(calls.every(([, values]) => !Array.isArray(values) || values.every(value => !String(value).includes('13732250653'))));
  assert.deepStrictEqual(calls.find(([text]) => text.includes('SELECT account_id'))[1], ['e'.repeat(64)]);

  const missingClient = {
    async query(text) {
      if (text.includes('SELECT account_id FROM vnext_control_plane.vnext_verified_contacts')) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    verifyCanonicalPhoneContact({ async connect() { return missingClient; } }, { accountId: 'canonical-admin', phoneHmac: 'e'.repeat(64) }),
    error => error.code === 'REAL_CLOUD_ACCEPTANCE_ADMIN_CONTACT_FAILED',
  );
}

Promise.resolve()
  .then(tokenIsBoundAndOpaque)
  .then(miniappLimitedWriteIsRealReplayedReadableAndCleaned)
  .then(miniappCleanupUsesTheBusinessRoleAndVerifiesAbsence)
  .then(serverEnvironmentComparisonDoesNotExposeTheSecret)
  .then(tokenIsAcceptedByDesktopSessionContract)
  .then(runtimeLayoutIsExplicit)
  .then(stageAndCleanupErrorsStayDiagnosable)
  .then(controlledSessionIsShortLivedAndRevoked)
  .then(canonicalPhoneMappingMustAlreadyBeActiveAndIsNeverMutated)
  .then(operatorIdentityIsResolvedWithoutPhonePlaintext)
  .then(operatorPhoneMustAlreadyBeCanonicalAndIsNeverMutated)
  .then(onlineRegistrationIsRealAndTokenFreeInEvidence)
  .then(onlineRegistrationCleanupHandlePrecedesPayloadValidation)
  .then(unverifiedReceiptSessionIdNeverReplacesPreparedCleanupHandle)
  .then(onlineRegistrationCleanupHandleSurvivesContextFailure)
  .then(onlineRegistrationFixtureIsRevoked)
  .then(preparedOnlineRegistrationCleanupIsSafeBeforePersistence)
  .then(preparedOnlineRegistrationCleanupRevokesPersistedSessionWithoutReceiptId)
  .then(successfulAcceptance)
  .then(cleanupOnFailure)
  .then(teachingLoopCreatesReadsConflictsAndCleans)
  .then(roleScopedTeachingProjectionRequiresExpectedVisibilityAndRedaction)
  .then(roleTeachingBindingsRequireOneCoherentFixture)
  .then(roleScopedTeachingCreatesReadsAndCleans)
  .then(forceCleanupQualifiesTheFunctionOutputColumn)
  .then(() => console.log('real cloud business acceptance checks passed'));
