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
const { projectionCacheEntries } = require('../miniapp/src/utils/authorityProjectionCache');
const {
  deriveAccess,
  permissionIdentityKey,
} = require('../miniapp/src/utils/miniappAuthorizationRuntime');

const ROLES = Object.freeze(['visitor', 'student', 'teacher', 'admin', 'super_admin']);
const AUTHORITY_ID = 'authority-role-matrix';
const EPOCH_ID = 'epoch-role-matrix';
const CREATED_AT = '2026-07-30T00:00:00.000Z';

function matrixError(code, detail = '') {
  return Object.assign(new Error(`${code}${detail ? `:${detail}` : ''}`), { code });
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

function roleFixture(role) {
  const userId = `user-${role.replace('_', '-')}`;
  const grant = role === 'visitor' ? null : {
    role,
    bindingId: role === 'student' ? 'student-1' : (role === 'teacher' ? 'teacher-1' : ''),
    status: 'active',
    authorityId: AUTHORITY_ID,
  };
  const scope = resolveActingScope({
    userId,
    actingRole: role,
    grants: grant ? [grant] : [],
  });
  return Object.freeze({
    role,
    userId,
    deviceId: `device-${role.replace('_', '-')}`,
    leaseId: `lease-${role.replace('_', '-')}`,
    scope,
    keyPair: crypto.generateKeyPairSync('ed25519'),
  });
}

function miniappAccessFor(fixture) {
  const capabilities = {
    visitor: ['projection:read', 'role-application:read', 'role-application:submit', 'question-preview:read'],
    student: ['question-bank:view'],
    teacher: ['business:teacher-scope', 'question-bank:view', 'question-bank:edit'],
    admin: ['business:all', 'question-bank:view', 'question-bank:edit'],
    super_admin: ['users:review', 'business:all', 'question-bank:view', 'question-bank:edit'],
  }[fixture.role];
  const user = {
    id: fixture.userId,
    role: fixture.role,
    user_type: fixture.role,
    authority_id: AUTHORITY_ID,
    teacher_id: fixture.role === 'teacher' ? 'teacher-1' : undefined,
    student_id: fixture.role === 'student' ? 'student-1' : undefined,
    ...(fixture.role === 'visitor' ? {
      identity_kind: 'visitor',
      account_state: 'visitor',
      token_use: 'miniapp-visitor',
      capabilities,
    } : {}),
  };
  return deriveAccess(user, {
    status: 'loaded',
    identityKey: permissionIdentityKey(user),
    capabilities,
  });
}

function assertRoleProjection(role, projection, desktopCache, miniappCache, miniappAccess) {
  const payload = projection.payload;
  assert.strictEqual(projection.role, role);
  assert.strictEqual(desktopCache.authorityCacheMetadata.role, role);
  assert.strictEqual(miniappAccess.role, role);
  assert.strictEqual(miniappAccess.canReviewUsers, role === 'super_admin');
  if (role === 'visitor') {
    assert.strictEqual(miniappAccess.experienceOnly, true);
    assert.deepStrictEqual(miniappAccess.modules, ['question-bank', 'settings']);
  } else {
    assert.strictEqual(miniappAccess.experienceOnly, false);
    assert.ok(miniappAccess.modules.length > 0, `${role}:MINIAPP_MODULE_SCOPE_REQUIRED`);
  }
  if (role === 'visitor') {
    assert.strictEqual(payload.questionPreviews.length, 10);
    assert.strictEqual(payload.courses.length, 0);
    assertNoLeak([payload, desktopCache, miniappCache], [
      'preview-secret-answer', 'full-question-secret', 'role-application-secret',
      'role-grant-secret', 'student-1', 'student-2',
    ], role, 'all');
    return;
  }
  if (role === 'student') {
    assert.deepStrictEqual(payload.students.map(row => row.id), ['student-1']);
    assert.deepStrictEqual(payload.payments.map(row => row.id), ['payment-1']);
    assertNoLeak([payload, desktopCache, miniappCache], [
      'student-2', 'payment-2', 'record-peer-owner', 'full-account-student-secret',
      'full-account-peer-secret', 'role-application-secret', 'role-grant-secret',
    ], role, 'all');
    return;
  }
  if (role === 'teacher') {
    assert.deepStrictEqual(payload.courses.map(row => row.id), ['course-teacher-1']);
    assert.deepStrictEqual(payload.payments, []);
    assertNoLeak([payload, desktopCache, miniappCache], [
      'course-teacher-2', 'payment-1', 'payment-2', 'full-account-peer-secret',
      'role-application-secret', 'role-grant-secret',
    ], role, 'all');
    return;
  }
  if (role === 'admin') {
    assert.strictEqual(payload.courses.length, 2);
    assert.strictEqual(payload.questions.length, 1);
    assert.strictEqual(payload.roleApplications, undefined);
    assert.strictEqual(payload.roleGrants, undefined);
    assertNoLeak([payload, desktopCache, miniappCache], [
      'full-account-student-secret', 'full-account-peer-secret',
      'role-application-secret', 'role-grant-secret',
    ], role, 'all');
    return;
  }
  assert.strictEqual(role, 'super_admin');
  assert.strictEqual(payload.roleApplications[0].applicationId, 'role-application-secret');
  assert.strictEqual(payload.roleGrants[0].bindingId, 'role-grant-secret');
  assertNoLeak([payload, desktopCache, miniappCache], [
    'full-account-student-secret', 'full-account-peer-secret',
  ], role, 'all');
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-role-matrix-'));
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = path.join(tempRoot, 'authority-role-matrix.db');
  process.env.READ_DB_PATH = process.env.DB_PATH;
  process.env.JWT_SECRET = 'isolated-role-matrix-secret';
  const { DatabaseService } = require('../backend/src/database');
  const database = new DatabaseService();
  const fixtures = ROLES.map(roleFixture);
  const hostKeyPair = crypto.generateKeyPairSync('ed25519');
  database.db.pragma('foreign_keys = OFF');
  database.db.prepare(`INSERT INTO primary_host_epochs
    (id,generation,device_id,user_id,authorization_id,status,activation_reason,source_epoch_id,
     challenge_id,db_instance_digest,schema_version,store_id,db_authority_id,host_credential_hash,
     credential_version,row_version,created_at,updated_at,activated_at,retired_at)
    VALUES(?,1,'host-role-matrix','user-super','authorization-role-matrix','active','bootstrap',NULL,
     'challenge-role-matrix','digest-role-matrix',1,'store-role-matrix',?,'credential-hash-role-matrix',
     1,1,?,?,?,NULL)`)
    .run(EPOCH_ID, AUTHORITY_ID, CREATED_AT, CREATED_AT, CREATED_AT);
  const insertGrant = database.db.prepare(`INSERT INTO device_grants
    (grant_id,authority_id,device_id,user_id,public_key,host_generation,status,grant_version,created_at,updated_at)
    VALUES(?,?,?,?,?,1,'active',1,?,?)`);
  const insertLease = database.db.prepare(`INSERT INTO device_leases
    (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,issued_at,expires_at)
    VALUES(?,?,?,?,?,?,1,'active',?,'2099-01-01T00:00:00.000Z')`);
  const insertRoleBinding = database.db.prepare(`INSERT INTO authority_role_bindings
    (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'active',1,?,?)`);
  for (const fixture of fixtures) {
    const grantId = `grant-${fixture.role.replace('_', '-')}`;
    const publicKey = fixture.keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    insertGrant.run(
      grantId, AUTHORITY_ID, fixture.deviceId, fixture.userId, publicKey, CREATED_AT, CREATED_AT,
    );
    insertLease.run(
      fixture.leaseId, grantId, AUTHORITY_ID, fixture.deviceId, fixture.userId, fixture.role, CREATED_AT,
    );
    if (fixture.role !== 'visitor') {
      insertRoleBinding.run(
        `binding-${fixture.role.replace('_', '-')}`,
        AUTHORITY_ID,
        fixture.userId,
        fixture.role,
        fixture.role === 'student' ? 'student' : (fixture.role === 'teacher' ? 'teacher' : null),
        fixture.role === 'student' ? 'student-1' : (fixture.role === 'teacher' ? 'teacher-1' : null),
        CREATED_AT,
        CREATED_AT,
      );
    }
  }
  database.db.pragma('foreign_keys = ON');
  const store = createAuthorityProjectionStoreService({ db: database.db });
  const source = fixtureData();
  let sourceVersion = 1;
  for (const fixture of fixtures) {
    store.publish(createSignedAuthorityProjection({
      authorityId: AUTHORITY_ID,
      hostEpochId: EPOCH_ID,
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
      const miniappAccess = miniappAccessFor(fixture);
      assertRoleProjection(fixture.role, projection, desktopCache, miniappCache, miniappAccess);
      results.push({
        role: fixture.role,
        api: true,
        desktop: true,
        miniapp: true,
        miniappAccess: true,
        sourceVersion: projection.sourceVersion,
      });
    }
    console.log(JSON.stringify({
      success: true,
      matrix: results,
      isolatedRoot: tempRoot,
      preserved: true,
    }));
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
