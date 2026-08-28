'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { authorityHttpSigningPayload } = require('../shared/authorityHttpAuth');
const { createSignedAuthorityProjection } = require('../shared/authorityProjectionProtocol');
const { resolveActingScope } = require('../backend/src/services/authorityAccessService');
const { projectAuthorityData } = require('../backend/src/services/authorityProjectionService');
const { createAuthorityProjectionStoreService } = require('../backend/src/services/authorityProjectionStoreService');
const { createAuthorityCommandPolicy } = require('../backend/src/services/authorityCommandRegistry');
const { createAuthorityCloudEpochService } = require('../backend/src/services/authorityCloudEpochService');
const { projectionCacheEntries } = require('../miniapp/src/utils/authorityProjectionCache');
const {
  deriveAccess,
  permissionIdentityKey,
} = require('../miniapp/src/utils/miniappAuthorizationRuntime');

const ROLE_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'visitor', role: 'visitor', userId: 'user-visitor', subjectId: null }),
  Object.freeze({ id: 'student-bound', role: 'student', userId: 'user-student', subjectId: 'student-1' }),
  Object.freeze({ id: 'student-unbound', role: 'student', userId: 'user-student-unbound', subjectId: null }),
  Object.freeze({ id: 'teacher-bound', role: 'teacher', userId: 'user-teacher', subjectId: 'teacher-1' }),
  Object.freeze({ id: 'teacher-unbound', role: 'teacher', userId: 'user-teacher-unbound', subjectId: null }),
  Object.freeze({ id: 'super-admin', role: 'super_admin', userId: 'user-super-admin', subjectId: null }),
]);
const SUBJECT_BUSINESS_COLLECTIONS = Object.freeze([
  'schedules', 'courses', 'students', 'grades', 'payments', 'consumptions',
  'teachers', 'rooms', 'institutions',
]);
const AUTHORITY_ID = 'authority-role-matrix';
const CREATED_AT = '2026-07-30T00:00:00.000Z';
const TEMP_ROOT_PATTERN = /^gewu-authority-role-matrix-[A-Za-z0-9]+$/;
const TEMP_ROOT_MARKER = '.gewu-isolated-authority-role-matrix';

function matrixError(code, detail = '') {
  return Object.assign(new Error(`${code}${detail ? `:${detail}` : ''}`), { code });
}

function removeDisposableRoot(tempRoot) {
  const resolved = path.resolve(tempRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir())) {
    throw matrixError('ROLE_MATRIX_TEMP_PARENT_REQUIRED');
  }
  if (!TEMP_ROOT_PATTERN.test(path.basename(resolved))) {
    throw matrixError('ROLE_MATRIX_TEMP_ROOT_REQUIRED');
  }
  if (!fs.existsSync(path.join(resolved, TEMP_ROOT_MARKER))) {
    throw matrixError('ROLE_MATRIX_TEMP_MARKER_REQUIRED');
  }
  // SAFE_RECURSIVE_DELETE_OK: exact OS temp child, strict basename, and run-owned marker verified above.
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  if (fs.existsSync(resolved)) throw matrixError('ROLE_MATRIX_TEMP_CLEANUP_FAILED');
}

function assertNoLeak(value, forbidden, role, surface) {
  const serialized = JSON.stringify(value);
  for (const marker of forbidden) {
    if (serialized.includes(marker)) {
      throw matrixError('ROLE_MATRIX_CROSS_SCOPE_LEAK', `${role}:${surface}:${marker}`);
    }
  }
}

function fixtureData() {
  return {
    questionPreviews: Array.from({ length: 12 }, (_, index) => ({
      id: `preview-${index + 1}`,
      stemPreview: `preview ${index + 1}`,
      answer: 'preview-secret-answer',
    })),
    schedules: [
      {
        id: 'schedule-student-1',
        studentIds: ['student-1'],
        studentPricings: { 'student-1': 100 },
        teacherId: 'teacher-1',
        calculatedTeacherFee: 50,
      },
      {
        id: 'schedule-student-2',
        studentIds: ['student-2'],
        studentPricings: { 'student-2': 999 },
        teacherId: 'teacher-2',
        calculatedTeacherFee: 900,
      },
    ],
    courses: [
      {
        id: 'course-teacher-1',
        studentIds: ['student-1'],
        teacherId: 'teacher-1',
        tuition: 100,
        lessonPay: 50,
      },
      {
        id: 'course-teacher-2',
        studentIds: ['student-2'],
        teacherId: 'teacher-2',
        tuition: 999,
        lessonPay: 900,
      },
    ],
    assets: [
      {
        id: 'asset-student-owner',
        ownerUserId: 'user-student',
        maskedIdentifier: '****1111',
        accountNumber: 'full-account-student-secret',
      },
      {
        id: 'asset-peer-owner',
        ownerUserId: 'user-peer',
        maskedIdentifier: '****2222',
        accountNumber: 'full-account-peer-secret',
      },
    ],
    students: [
      { id: 'student-1', name: 'Student One' },
      { id: 'student-2', name: 'Student Two' },
    ],
    grades: [
      { id: 'grade-1', student_id: 'student-1', score: 95 },
      { id: 'grade-2', student_id: 'student-2', score: 20 },
    ],
    payments: [
      { id: 'payment-1', student_id: 'student-1', amount: 100 },
      { id: 'payment-2', student_id: 'student-2', amount: 999 },
    ],
    consumptions: [
      { id: 'consumption-1', student_id: 'student-1', schedule_id: 'schedule-student-1' },
      { id: 'consumption-2', student_id: 'student-2', schedule_id: 'schedule-student-2' },
    ],
    teachers: [{ id: 'teacher-1' }, { id: 'teacher-2' }],
    rooms: [{ id: 'room-all' }],
    institutions: [{ id: 'institution-all' }],
    questions: [{ id: 'question-full', answer: 'full-question-secret' }],
    taxonomySystems: [{ id: 'knowledge' }],
    taxonomyNodes: [{ id: 'node-1', system_id: 'knowledge' }],
    assetRecords: [
      { id: 'record-student-owner', ownerUserId: 'user-student', amount: 1 },
      { id: 'record-peer-owner', ownerUserId: 'user-peer', amount: 999 },
    ],
    assetCategories: [
      { id: 'category-student-owner', ownerUserId: 'user-student' },
      { id: 'category-peer-owner', ownerUserId: 'user-peer' },
    ],
    roleApplications: [{
      applicationId: 'role-application-secret',
      authorityId: AUTHORITY_ID,
      userId: 'user-visitor',
      requestedRole: 'student',
      status: 'pending',
    }],
    roleGrants: [{
      bindingId: 'role-grant-secret',
      authorityId: AUTHORITY_ID,
      userId: 'user-super',
      role: 'super_admin',
      status: 'active',
      grantVersion: 1,
    }],
  };
}

function roleFixture(scenario) {
  const { id, role, userId, subjectId } = scenario;
  const grant = role === 'visitor' ? null : {
    role,
    bindingId: subjectId || '',
    status: 'active',
    authorityId: AUTHORITY_ID,
  };
  const scope = resolveActingScope({
    userId,
    actingRole: role,
    grants: grant ? [grant] : [],
  });
  return Object.freeze({
    scenarioId: id,
    role,
    userId,
    subjectId,
    subjectBound: ['student', 'teacher'].includes(role) ? Boolean(subjectId) : null,
    deviceId: `device-${id}`,
    leaseId: `lease-${id}`,
    scope,
    keyPair: crypto.generateKeyPairSync('ed25519'),
  });
}

function miniappRuntimeFor(fixture) {
  const capabilities = {
    visitor: ['projection:read', 'role-application:read', 'role-application:submit', 'question-preview:read'],
    student: ['question-bank:view'],
    teacher: ['business:teacher-scope', 'question-bank:view', 'question-bank:edit'],
    super_admin: ['users:review', 'business:all', 'question-bank:view', 'question-bank:edit'],
  }[fixture.role];
  const user = {
    id: fixture.userId,
    role: fixture.role,
    user_type: fixture.role,
    authority_id: AUTHORITY_ID,
    token_use: fixture.role === 'visitor' ? 'miniapp-visitor' : 'miniapp-cloud',
    teacher_id: fixture.role === 'teacher' ? fixture.subjectId || undefined : undefined,
    student_id: fixture.role === 'student' ? fixture.subjectId || undefined : undefined,
    ...(['student', 'teacher'].includes(fixture.role) ? {
      account_state: 'formal',
      subject_binding: fixture.subjectBound ? 'bound' : 'unbound',
    } : {}),
    ...(fixture.role === 'visitor' ? {
      identity_kind: 'visitor',
      account_state: 'visitor',
      capabilities,
    } : {}),
  };
  return {
    identity: user,
    access: deriveAccess(user, {
      status: 'loaded',
      identityKey: permissionIdentityKey(user),
      capabilities,
    }),
  };
}

function assertRoleProjection(fixture, projection, desktopCache, miniappCache, miniappRuntime) {
  const { role } = fixture;
  const payload = projection.payload;
  const { identity: miniappIdentity, access: miniappAccess } = miniappRuntime;
  assert.strictEqual(projection.role, role);
  assert.strictEqual(desktopCache.authorityCacheMetadata.role, role);
  assert.strictEqual(miniappAccess.role, role);
  assert.strictEqual(Object.hasOwn(miniappAccess, 'canReviewUsers'), false,
    `${role}:MINIAPP_MUST_NOT_EXPOSE_ROLE_REVIEW_CAPABILITY`);
  if (role === 'visitor') {
    assert.strictEqual(miniappAccess.experienceOnly, true);
    assert.deepStrictEqual(miniappAccess.modules, ['scheduling', 'question-bank', 'settings']);
  } else {
    assert.strictEqual(miniappAccess.experienceOnly, false);
    assert.ok(miniappAccess.modules.length > 0, `${role}:MINIAPP_MODULE_SCOPE_REQUIRED`);
  }
  if (['student', 'teacher'].includes(role)) {
    const identitySubjectId = role === 'student'
      ? miniappIdentity.student_id
      : miniappIdentity.teacher_id;
    assert.strictEqual(identitySubjectId || null, fixture.subjectId,
      `${fixture.scenarioId}:MINIAPP_MUST_NOT_SYNTHESIZE_SUBJECT`);
    assert.strictEqual(miniappIdentity.subject_binding, fixture.subjectBound ? 'bound' : 'unbound');
    if (!fixture.subjectBound) {
      assert.strictEqual(payload.questionPreviews.length, 10,
        `${fixture.scenarioId}:LIMITED_QUESTION_PREVIEW_REQUIRED`);
      for (const collection of SUBJECT_BUSINESS_COLLECTIONS) {
        assert.deepStrictEqual(payload[collection], [],
          `${fixture.scenarioId}:API_BUSINESS_DATA_MUST_FAIL_CLOSED:${collection}`);
        assert.deepStrictEqual(desktopCache[collection], [],
          `${fixture.scenarioId}:DESKTOP_BUSINESS_DATA_MUST_FAIL_CLOSED:${collection}`);
        assert.deepStrictEqual(miniappCache[collection], [],
          `${fixture.scenarioId}:MINIAPP_BUSINESS_DATA_MUST_FAIL_CLOSED:${collection}`);
      }
      assertNoLeak([payload, desktopCache, miniappCache, miniappIdentity], [
        'student-1', 'student-2', 'teacher-1', 'teacher-2',
        'payment-1', 'payment-2', 'course-teacher-1', 'course-teacher-2',
        'role-application-secret', 'role-grant-secret',
      ], fixture.scenarioId, 'all');
      return { businessDataFailClosed: true };
    }
  }
  if (role === 'visitor') {
    assert.strictEqual(payload.questionPreviews.length, 10);
    assert.strictEqual(payload.courses.length, 0);
    assertNoLeak([payload, desktopCache, miniappCache], [
      'preview-secret-answer', 'full-question-secret', 'role-application-secret',
      'role-grant-secret', 'student-1', 'student-2',
    ], role, 'all');
    return { businessDataFailClosed: true };
  }
  if (role === 'student') {
    assert.deepStrictEqual(payload.students.map(row => row.id), ['student-1']);
    assert.deepStrictEqual(payload.payments.map(row => row.id), ['payment-1']);
    assertNoLeak([payload, desktopCache, miniappCache], [
      'student-2', 'payment-2', 'record-peer-owner', 'full-account-student-secret',
      'full-account-peer-secret', 'role-application-secret', 'role-grant-secret',
    ], role, 'all');
    return { businessDataFailClosed: false };
  }
  if (role === 'teacher') {
    assert.deepStrictEqual(payload.courses.map(row => row.id), ['course-teacher-1']);
    assert.deepStrictEqual(payload.payments, []);
    assertNoLeak([payload, desktopCache, miniappCache], [
      'course-teacher-2', 'payment-1', 'payment-2', 'full-account-peer-secret',
      'role-application-secret', 'role-grant-secret',
    ], role, 'all');
    return { businessDataFailClosed: false };
  }
  assert.strictEqual(role, 'super_admin');
  assert.strictEqual(payload.roleApplications[0].applicationId, 'role-application-secret');
  assert.strictEqual(payload.roleGrants[0].bindingId, 'role-grant-secret');
  assertNoLeak([payload, desktopCache, miniappCache], [
    'full-account-student-secret', 'full-account-peer-secret',
  ], role, 'all');
  return { businessDataFailClosed: false };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-role-matrix-'));
  fs.writeFileSync(path.join(tempRoot, TEMP_ROOT_MARKER), `${process.pid}\n`, 'utf8');
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = path.join(tempRoot, 'authority-role-matrix.db');
  process.env.READ_DB_PATH = process.env.DB_PATH;
  process.env.JWT_SECRET = 'isolated-role-matrix-secret';
  const { DatabaseService } = require('../backend/src/database');
  const database = new DatabaseService();
  const fixtures = ROLE_SCENARIOS.map(roleFixture);
  const hostKeyPair = crypto.generateKeyPairSync('ed25519');
  database.db.pragma('foreign_keys = OFF');
  const insertGrant = database.db.prepare(`INSERT INTO device_grants
    (grant_id,authority_id,device_id,user_id,public_key,host_generation,status,grant_version,created_at,updated_at)
    VALUES(?,?,?,?,?,1,'active',1,?,?)`);
  const insertLease = database.db.prepare(`INSERT INTO device_leases
    (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,issued_at,expires_at)
    VALUES(?,?,?,?,?,?,1,'active',?,'2099-01-01T00:00:00.000Z')`);
  const insertRoleBinding = database.db.prepare(`INSERT INTO authority_role_bindings
    (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'active',1,?,?)`);
  const insertAuthorityAccount = database.db.prepare(`INSERT INTO authority_accounts
    (user_id,authority_id,status,created_at,updated_at)
    VALUES(?,?,'active',?,?)`);
  for (const fixture of fixtures) {
    const grantId = `grant-${fixture.scenarioId}`;
    const publicKey = fixture.keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    insertGrant.run(
      grantId, AUTHORITY_ID, fixture.deviceId, fixture.userId, publicKey, CREATED_AT, CREATED_AT,
    );
    insertLease.run(
      fixture.leaseId, grantId, AUTHORITY_ID, fixture.deviceId, fixture.userId, fixture.role, CREATED_AT,
    );
    insertAuthorityAccount.run(fixture.userId, AUTHORITY_ID, CREATED_AT, CREATED_AT);
    if (fixture.role !== 'visitor') {
      insertRoleBinding.run(
        `binding-${fixture.scenarioId}`,
        AUTHORITY_ID,
        fixture.userId,
        fixture.role,
        fixture.subjectId ? fixture.role : null,
        fixture.subjectId,
        CREATED_AT,
        CREATED_AT,
      );
    }
  }
  database.db.pragma('foreign_keys = ON');
  const cloudEpoch = createAuthorityCloudEpochService({
    db: database.db,
    now: () => CREATED_AT,
  }).ensure(AUTHORITY_ID);
  const store = createAuthorityProjectionStoreService({ db: database.db });
  const source = fixtureData();
  let sourceVersion = 1;
  for (const fixture of fixtures) {
    store.publish(createSignedAuthorityProjection({
      authorityId: AUTHORITY_ID,
      hostEpochId: cloudEpoch.id,
      userId: fixture.userId,
      role: fixture.role,
      sourceVersion: sourceVersion++,
      generatedAt: CREATED_AT,
      payload: projectAuthorityData(fixture.scope, source),
      privateKey: hostKeyPair.privateKey,
    }));
  }
  const databaseModule = require('../backend/src/database');
  databaseModule.getInstance = () => database;
  delete require.cache[require.resolve('../backend/src/app')];
  const { createApp } = require('../backend/src/app');
  const { buildAuthorityBackedBrowserCache } = await import('../src/services/authorityProjectionCacheAdapter.mjs');
  const server = createApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  const commandPolicy = createAuthorityCommandPolicy();
  assert.strictEqual(commandPolicy({
    type: 'role-application.submit.v1', scope: { kind: 'admin', userId: 'user-admin' },
  }), false, 'ADMIN_SELF_APPLICATION_MUST_BE_FORBIDDEN');
  assert.strictEqual(commandPolicy({
    type: 'role-application.review.v1', scope: { kind: 'admin', userId: 'user-admin' },
  }), false, 'ADMIN_ROLE_REVIEW_MUST_BE_FORBIDDEN');
  assert.strictEqual(commandPolicy({
    type: 'role-application.review.v1', scope: { kind: 'super_admin', userId: 'user-super-admin' },
  }), true, 'SUPER_ADMIN_ROLE_REVIEW_MUST_BE_ALLOWED');
  let completed = false;
  try {
    for (const fixture of fixtures) {
      const actor = {
        userId: fixture.userId,
        deviceId: fixture.deviceId,
        role: fixture.role,
      };
      const requestPath = '/api/authority/projections/current';
      const signature = crypto.sign(null, Buffer.from(authorityHttpSigningPayload({
        method: 'GET',
        path: requestPath,
        actor,
        body: null,
      }), 'utf8'), fixture.keyPair.privateKey).toString('base64');
      const response = await fetch(`${baseUrl}${requestPath}`, {
        headers: {
          'x-gewu-authority-user-id': actor.userId,
          'x-gewu-authority-device-id': actor.deviceId,
          'x-gewu-authority-role': actor.role,
          'x-gewu-device-signature': signature,
          'x-gewu-authority-id': AUTHORITY_ID,
          'x-gewu-authority-lease-id': fixture.leaseId,
          'x-gewu-authority-grant-version': '1',
        },
      });
      const body = await response.json();
      assert.strictEqual(response.status, 200, `${fixture.role}:${JSON.stringify(body)}`);
      const projection = body.projection;
      const desktopCache = buildAuthorityBackedBrowserCache({
        projection,
        outbox: [],
        localOnly: {},
      });
      const miniappCache = Object.fromEntries(projectionCacheEntries(projection.payload));
      const miniappRuntime = miniappRuntimeFor(fixture);
      const assertion = assertRoleProjection(
        fixture, projection, desktopCache, miniappCache, miniappRuntime,
      );
      results.push({
        scenario: fixture.scenarioId,
        role: fixture.role,
        subjectBound: fixture.subjectBound,
        api: true,
        desktop: true,
        miniapp: true,
        miniappAccess: true,
        businessDataFailClosed: assertion.businessDataFailClosed,
        sourceVersion: projection.sourceVersion,
      });
    }
    completed = true;
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
    if (completed) removeDisposableRoot(tempRoot);
    else console.error(`[role-matrix] preserved failed isolated root: ${tempRoot}`);
  }
  console.log(JSON.stringify({
    success: true,
    matrix: results,
    roleApplicationPolicy: {
      retiredAdminSelfApplicationForbidden: true,
      retiredAdminReviewForbidden: true,
      superAdminReviewAllowed: true,
    },
    isolatedRoot: tempRoot,
    isolatedDataRemoved: true,
  }));
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
