const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');
const { resultHash: hashTaskResult } = require('./cloudRelayTaskService');
const { payloadHash } = require('./miniappApplicationService');
const { createMiniappIdentityService } = require('./miniappIdentityService');
const { createMiniappProvisioningReconciler } = require('./miniappProvisioningReconciler');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.ok(
  packageJson.scripts['test:miniapp-applications'].includes('miniappProvisioningReconciler.test.js'),
  'the provisioning reconciler regression must run in the main npm test chain',
);
const cloudRelaySource = fs.readFileSync('backend/src/routes/cloudRelay.js', 'utf8');
const applicationRouteSource = fs.readFileSync('backend/src/routes/miniappApplications.js', 'utf8');
const appSource = fs.readFileSync('backend/src/app.js', 'utf8');
const identitySource = fs.readFileSync('backend/src/services/miniappIdentityService.js', 'utf8');
assert.ok(!cloudRelaySource.includes('reconcileCompletedTask'),
  'the retired backend task route must not reconcile or approve cloud-owned identities');
assert.ok(!appSource.includes('createMiniappProvisioningReconciler'),
  'the retired backend must not reconcile cloud-owned identities during startup');
assert.ok(!cloudRelaySource.includes('createMiniappProvisioningReconciler'),
  'the retired backend task route must not instantiate a local identity reconciler');
assert.ok(!applicationRouteSource.includes('createMiniappProvisioningReconciler')
  && !applicationRouteSource.includes('reconcilePendingCompletedTasks'),
  'the retired backend application route must not reconcile cloud-owned identities on reads');
assert.ok(identitySource.includes('account_memberships'), 'formal identity checks must accept reconciled membership mappings');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-provisioning-reconciler-'));
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};
process.env.DB_PATH = path.join(workspace, 'reconciler.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.NODE_ENV = 'production';

let database;
try {
  database = new DatabaseService();
  const db = database.db;
  const now = '2026-09-02T02:00:00.000Z';
  const authorityId = 'authority-provisioning-test';
  db.prepare(`INSERT INTO authority_metadata(key,value,updated_at)
    VALUES('database_authority_id',?,?)`).run(authorityId, now);
  let sequence = 0;
  const uuid = prefix => `${prefix || 'reconcile'}-${++sequence}`;
  const reconciler = createMiniappProvisioningReconciler({
    db,
    now: () => new Date(now),
    uuid,
  });

  function insertPendingUser({ id, phone, openid = null, name = 'Experience', authVersion = 1 }) {
    db.prepare(`INSERT INTO users
      (id, wechat_openid, phone, phone_normalized, name, role, identity_kind, status,
       login_enabled, review_status, auth_version, deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 'unrecognized', 1, 0, 'pending', ?, 0, ?, ?)`)
      .run(id, openid, phone, phone, name, authVersion, now, now);
  }

  function hostReceipt(entityId, entityType, receiptId) {
    const minimal = { entityId, entityType, receiptId };
    return {
      ...minimal,
      resultHash: crypto.createHash('sha256').update(JSON.stringify(minimal), 'utf8').digest('hex'),
    };
  }

  function insertProvisioning({
    applicationId,
    taskId,
    applicantUserId,
    applicationType,
    applicantIdentityKind,
    payload,
    result,
    requestHash,
  }) {
    const taskPayload = {
      applicationId,
      revision: 1,
      applicationType,
      payload,
      reviewedBy: 'review-admin',
      tenantId: 'default',
    };
    db.prepare(`INSERT INTO miniapp_role_applications
      (id, applicant_user_id, application_type, status, revision, payload_json, payload_hash,
       idempotency_key, verified_phone_normalized, student_phone_normalized,
       parent_phone_normalized, applicant_identity_kind, host_task_id, reviewed_by,
       reviewed_at, submitted_at, created_at, updated_at)
      VALUES
      (@id, @applicantUserId, @applicationType, 'provisioning', 1, @payloadJson, @payloadHash,
       @idempotencyKey, @verifiedPhone, @studentPhone, @parentPhone, @identityKind, @taskId,
       'review-admin', @now, @now, @now, @now)`).run({
      id: applicationId,
      applicantUserId,
      applicationType,
      payloadJson: JSON.stringify(payload),
      payloadHash: payloadHash(applicationType, payload),
      idempotencyKey: `application:${applicationId}`,
      verifiedPhone: applicationType === 'student'
        ? (applicantIdentityKind === 'parent' ? payload.parentPhone : payload.studentPhone)
        : payload.phone,
      studentPhone: applicationType === 'student' ? payload.studentPhone : null,
      parentPhone: applicationType === 'student' ? payload.parentPhone : null,
      identityKind: applicantIdentityKind,
      taskId,
      now,
    });
    db.prepare(`INSERT INTO miniapp_tasks
      (id, task_type, status, payload, result_payload, created_by, created_at, updated_at,
       protocol_version, idempotency_key, request_hash, target_host_device_id,
       selection_context, phase, progress, row_version, completion_operation_id,
       completion_result_hash)
      VALUES
      (?, 'identity-provisioning', 'completed', ?, ?, 'internal:miniapp-application-review',
       ?, ?, 2, ?, ?, 'host-authority', ?, 'completed', 100, 3, ?, ?)`)
      .run(
        taskId,
        JSON.stringify(taskPayload),
        JSON.stringify(result),
        now,
        now,
        `identity-provisioning:${applicationId}:1`,
        requestHash,
        JSON.stringify({ tenantId: 'default', actorRole: 'admin', allowDraft: false }),
        `host-task:${taskId}`,
        hashTaskResult(result),
      );
  }

  insertPendingUser({
    id: 'student-parent-applicant',
    phone: '13800138501',
    openid: 'wx-parent',
    name: 'Experience Parent',
    authVersion: 5,
  });
  db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
    VALUES('student-parent-applicant',?,'active',?,?)`).run(authorityId, now, now);
  const studentPayload = {
    studentName: '\u5f20\u540c\u5b66',
    studentPhone: '13800138500',
    school: '\u5b81\u6ce2\u4e2d\u5b66',
    currentGrade: '\u9ad8\u4e00',
    gradeYear: 2026,
    parentRelation: '\u5988\u5988',
    parentPhone: '13800138501',
    parentName: '\u5f20\u5988\u5988',
    guardianConfirmation: true,
    applicantAgeConfirmation: false,
  };
  const studentResult = hostReceipt('host-student-1', 'student', 'host-receipt-student-1');
  insertProvisioning({
    applicationId: 'student-application',
    taskId: 'student-task',
    applicantUserId: 'student-parent-applicant',
    applicationType: 'student',
    applicantIdentityKind: 'parent',
    payload: studentPayload,
    result: studentResult,
    requestHash: 'a'.repeat(64),
  });

  let identitySequence = 0;
  const identity = createMiniappIdentityService({
    db,
    jwtSecret: 'reconciler-test-secret',
    now: () => new Date(now),
    uuid: () => `identity-session-${++identitySequence}`,
  });
  const oldParentLogin = identity.loginWithVerifiedWechat({
    openid: 'wx-parent',
    phone: '13800138501',
  });
  assert.strictEqual(oldParentLogin.user.account_state, 'visitor');

  const studentReconciliation = reconciler.reconcileCompletedTask('student-task');
  assert.deepStrictEqual({
    status: studentReconciliation.status,
    applicationId: studentReconciliation.applicationId,
    taskId: studentReconciliation.taskId,
    entityId: studentReconciliation.entityId,
    entityType: studentReconciliation.entityType,
    replayed: studentReconciliation.replayed,
  }, {
    status: 'approved',
    applicationId: 'student-application',
    taskId: 'student-task',
    entityId: 'host-student-1',
    entityType: 'student',
    replayed: false,
  });
  const studentIdentities = db.prepare(`SELECT id, wechat_openid, phone_normalized, role,
    identity_kind, student_id, teacher_id, review_status, login_enabled, auth_version
    FROM users WHERE student_id=? ORDER BY identity_kind`).all('host-student-1');
  assert.deepStrictEqual(studentIdentities.map(row => row.identity_kind), ['parent', 'student']);
  assert.deepStrictEqual(studentIdentities.map(row => row.role), ['student', 'student']);
  assert.strictEqual(new Set(studentIdentities.map(row => row.student_id)).size, 1);
  assert.deepStrictEqual(studentIdentities.map(row => row.phone_normalized).sort(), ['13800138500', '13800138501']);
  assert.strictEqual(studentIdentities.find(row => row.identity_kind === 'parent').id, 'student-parent-applicant');
  assert.strictEqual(studentIdentities.find(row => row.identity_kind === 'parent').wechat_openid, 'wx-parent');
  assert.strictEqual(studentIdentities.find(row => row.identity_kind === 'student').wechat_openid, null);
  assert.ok(studentIdentities.every(row => row.teacher_id === null));
  assert.ok(studentIdentities.every(row => row.review_status === 'approved' && row.login_enabled === 1));
  assert.strictEqual(studentIdentities.find(row => row.identity_kind === 'parent').auth_version, 6);
  assert.deepStrictEqual(
    db.prepare(`SELECT users.identity_kind, accounts.authority_id, accounts.status
      FROM users
      INNER JOIN authority_accounts accounts ON accounts.user_id=users.id
      WHERE users.student_id=? ORDER BY users.identity_kind`).all('host-student-1'),
    [
      { identity_kind: 'parent', authority_id: authorityId, status: 'active' },
      { identity_kind: 'student', authority_id: authorityId, status: 'active' },
    ],
    'student and parent identities must both receive active canonical authority accounts',
  );
  assert.deepStrictEqual(
    db.prepare(`SELECT users.identity_kind, bindings.authority_id, bindings.role,
        bindings.subject_type, bindings.subject_id, bindings.status, bindings.grant_version
      FROM users
      INNER JOIN authority_role_bindings bindings ON bindings.user_id=users.id
      WHERE users.student_id=? AND bindings.status='active'
      ORDER BY users.identity_kind, bindings.binding_id`).all('host-student-1'),
    [
      {
        identity_kind: 'parent',
        authority_id: authorityId,
        role: 'student',
        subject_type: 'student',
        subject_id: 'host-student-1',
        status: 'active',
        grant_version: 1,
      },
      {
        identity_kind: 'student',
        authority_id: authorityId,
        role: 'student',
        subject_type: 'student',
        subject_id: 'host-student-1',
        status: 'active',
        grant_version: 1,
      },
    ],
    'student and parent identities must both receive canonical student bindings scoped to the host entity',
  );
  assert.deepStrictEqual(
    db.prepare(`SELECT status, host_entity_id FROM miniapp_role_applications
      WHERE id='student-application'`).get(),
    { status: 'approved', host_entity_id: 'host-student-1' },
  );
  assert.deepStrictEqual(
    db.prepare(`SELECT subject_type, subject_id, status, source FROM account_memberships
      WHERE subject_type='student' AND subject_id='host-student-1'`).get(),
    { subject_type: 'student', subject_id: 'host-student-1', status: 'active', source: 'admin_approval' },
  );
  assert.throws(
    () => identity.readIdentityForToken(oldParentLogin.claims),
    error => error?.code === 'AUTH_VERSION_MISMATCH',
  );
  const formalParent = identity.loginWithVerifiedWechat({ openid: 'wx-parent', phone: '13800138501' });
  assert.strictEqual(formalParent.user.account_state, 'formal');
  assert.strictEqual(formalParent.user.role, 'student');
  assert.strictEqual(formalParent.user.student_id, 'host-student-1');
  const formalParentTokenUser = identity.readIdentityForToken(formalParent.claims);
  const formalParentLoginEvent = db.prepare(`SELECT identity_kind FROM miniapp_login_events
    WHERE id=?`).get(formalParent.loginEventId);
  assert.deepStrictEqual(
    {
      responseIdentityKind: formalParent.user.identity_kind,
      claimIdentityKind: formalParent.claims.identity_kind,
      tokenUserIdentityKind: formalParentTokenUser.identity_kind,
      loginEventIdentityKind: formalParentLoginEvent.identity_kind,
    },
    {
      responseIdentityKind: 'parent',
      claimIdentityKind: 'parent',
      tokenUserIdentityKind: 'parent',
      loginEventIdentityKind: 'parent',
    },
    'parent login response, JWT, token projection and audit event must retain the parent identity kind',
  );
  assert.strictEqual(
    identity.readIdentityForToken({ ...formalParent.claims, identity_kind: 'student' }).identity_kind,
    'parent',
    'already-issued parent JWTs with the legacy student identity claim remain valid without changing student scope',
  );
  assert.strictEqual(formalParent.user.is_member, true);
  assert.strictEqual(formalParent.user.membership_status, 'active');
  const formalStudent = identity.loginWithVerifiedWechat({ openid: 'wx-student', phone: '13800138500' });
  assert.strictEqual(formalStudent.user.account_state, 'formal');
  assert.strictEqual(formalStudent.user.identity_kind, 'student');
  assert.strictEqual(formalStudent.user.student_id, 'host-student-1');

  const versionsBeforeReplay = db.prepare(`SELECT id, auth_version FROM users
    WHERE student_id='host-student-1' ORDER BY id`).all();
  const canonicalRowsBeforeReplay = {
    accounts: db.prepare(`SELECT COUNT(*) count FROM authority_accounts
      WHERE authority_id=? AND user_id IN (
        SELECT id FROM users WHERE student_id='host-student-1'
      )`).get(authorityId).count,
    bindings: db.prepare(`SELECT COUNT(*) count FROM authority_role_bindings
      WHERE authority_id=? AND role='student' AND status='active' AND user_id IN (
        SELECT id FROM users WHERE student_id='host-student-1'
      )`).get(authorityId).count,
  };
  const replay = reconciler.reconcileCompletedTask('student-task');
  assert.strictEqual(replay.status, 'approved');
  assert.strictEqual(replay.replayed, true);
  assert.deepStrictEqual(
    db.prepare(`SELECT id, auth_version FROM users WHERE student_id='host-student-1' ORDER BY id`).all(),
    versionsBeforeReplay,
  );
  assert.strictEqual(db.prepare(`SELECT COUNT(*) count FROM account_memberships
    WHERE subject_type='student' AND subject_id='host-student-1'`).get().count, 1);
  assert.deepStrictEqual({
    accounts: db.prepare(`SELECT COUNT(*) count FROM authority_accounts
      WHERE authority_id=? AND user_id IN (
        SELECT id FROM users WHERE student_id='host-student-1'
      )`).get(authorityId).count,
    bindings: db.prepare(`SELECT COUNT(*) count FROM authority_role_bindings
      WHERE authority_id=? AND role='student' AND status='active' AND user_id IN (
        SELECT id FROM users WHERE student_id='host-student-1'
      )`).get(authorityId).count,
  }, canonicalRowsBeforeReplay, 'approved-task replay must not duplicate canonical authority rows');
  assert.strictEqual(db.prepare(`SELECT COUNT(*) count FROM authorization_audit_log
    WHERE action='application_provisioning_reconciled' AND target_user_id='student-parent-applicant'`).get().count, 1);

  insertPendingUser({
    id: 'teacher-applicant',
    phone: '13800138510',
    openid: 'wx-teacher',
    name: 'Experience Teacher',
    authVersion: 2,
  });
  const teacherPayload = {
    name: '\u674e\u8001\u5e08',
    phone: '13800138510',
    subject: '\u7269\u7406',
  };
  insertProvisioning({
    applicationId: 'teacher-application',
    taskId: 'teacher-task',
    applicantUserId: 'teacher-applicant',
    applicationType: 'teacher',
    applicantIdentityKind: 'teacher',
    payload: teacherPayload,
    result: hostReceipt('host-teacher-1', 'teacher', 'host-receipt-teacher-1'),
    requestHash: 'b'.repeat(64),
  });
  const scanned = createMiniappProvisioningReconciler({
    db,
    now: () => new Date(now),
    uuid,
  }).reconcilePendingCompletedTasks();
  assert.deepStrictEqual(scanned.map(item => [item.taskId, item.status]), [['teacher-task', 'approved']]);
  assert.deepStrictEqual(
    db.prepare(`SELECT role, identity_kind, student_id, teacher_id, review_status, login_enabled
      FROM users WHERE id='teacher-applicant'`).get(),
    {
      role: 'teacher',
      identity_kind: 'teacher',
      student_id: null,
      teacher_id: 'host-teacher-1',
      review_status: 'approved',
      login_enabled: 1,
    },
  );
  assert.deepStrictEqual(
    db.prepare(`SELECT subject_type, subject_id, status, source FROM account_memberships
      WHERE subject_type='teacher' AND subject_id='host-teacher-1'`).get(),
    { subject_type: 'teacher', subject_id: 'host-teacher-1', status: 'active', source: 'admin_approval' },
  );
  assert.deepStrictEqual(
    db.prepare(`SELECT accounts.authority_id, accounts.status, bindings.role,
        bindings.subject_type, bindings.subject_id, bindings.status AS binding_status,
        bindings.grant_version
      FROM authority_accounts accounts
      INNER JOIN authority_role_bindings bindings
        ON bindings.authority_id=accounts.authority_id AND bindings.user_id=accounts.user_id
      WHERE accounts.user_id='teacher-applicant' AND bindings.status='active'`).get(),
    {
      authority_id: authorityId,
      status: 'active',
      role: 'teacher',
      subject_type: 'teacher',
      subject_id: 'host-teacher-1',
      binding_status: 'active',
      grant_version: 1,
    },
    'teacher provisioning must create an active canonical account and host-scoped teacher binding',
  );
  const formalTeacher = identity.loginWithVerifiedWechat({ openid: 'wx-teacher', phone: '13800138510' });
  assert.strictEqual(formalTeacher.user.account_state, 'formal');
  assert.strictEqual(formalTeacher.user.role, 'teacher');
  assert.strictEqual(formalTeacher.user.teacher_id, 'host-teacher-1');
  assert.strictEqual(formalTeacher.user.is_member, true);

  insertPendingUser({
    id: 'conflict-applicant',
    phone: '13800138521',
    openid: 'wx-conflict-parent',
    authVersion: 4,
  });
  db.prepare(`INSERT INTO users
    (id, wechat_openid, phone, phone_normalized, name, role, identity_kind, status,
     login_enabled, review_status, auth_version, deleted, created_at, updated_at)
    VALUES ('conflicting-formal-owner', 'wx-conflicting-owner', '13800138520', '13800138520',
      'Existing Admin', 'admin', 'admin', 1, 1, 'approved', 9, 0, ?, ?)`).run(now, now);
  insertProvisioning({
    applicationId: 'conflict-application',
    taskId: 'conflict-task',
    applicantUserId: 'conflict-applicant',
    applicationType: 'student',
    applicantIdentityKind: 'parent',
    payload: {
      ...studentPayload,
      studentPhone: '13800138520',
      parentPhone: '13800138521',
    },
    result: hostReceipt('host-student-conflict', 'student', 'host-receipt-conflict'),
    requestHash: 'c'.repeat(64),
  });
  const conflictResult = reconciler.reconcileCompletedTask('conflict-task');
  assert.deepStrictEqual({ status: conflictResult.status, code: conflictResult.code }, {
    status: 'manual_resolution_required',
    code: 'IDENTITY_PHONE_CONFLICT',
  });
  assert.deepStrictEqual(
    db.prepare(`SELECT role, identity_kind, student_id, review_status, login_enabled, auth_version
      FROM users WHERE id='conflict-applicant'`).get(),
    {
      role: 'pending',
      identity_kind: 'unrecognized',
      student_id: null,
      review_status: 'pending',
      login_enabled: 0,
      auth_version: 4,
    },
  );
  assert.strictEqual(db.prepare(`SELECT COUNT(*) count FROM users
    WHERE student_id='host-student-conflict'`).get().count, 0);
  assert.strictEqual(db.prepare(`SELECT COUNT(*) count FROM account_memberships
    WHERE subject_id='host-student-conflict'`).get().count, 0);
  assert.deepStrictEqual(
    db.prepare(`SELECT status, host_entity_id FROM miniapp_role_applications
      WHERE id='conflict-application'`).get(),
    { status: 'manual_resolution_required', host_entity_id: null },
  );

  insertPendingUser({
    id: 'type-mismatch-applicant',
    phone: '13800138530',
    openid: 'wx-type-mismatch',
  });
  insertProvisioning({
    applicationId: 'type-mismatch-application',
    taskId: 'type-mismatch-task',
    applicantUserId: 'type-mismatch-applicant',
    applicationType: 'teacher',
    applicantIdentityKind: 'teacher',
    payload: { ...teacherPayload, phone: '13800138530' },
    result: hostReceipt('wrong-student-entity', 'student', 'host-receipt-type-mismatch'),
    requestHash: 'd'.repeat(64),
  });
  const mismatchResult = reconciler.reconcileCompletedTask('type-mismatch-task');
  assert.deepStrictEqual({ status: mismatchResult.status, code: mismatchResult.code }, {
    status: 'manual_resolution_required',
    code: 'PROVISIONING_RESULT_TYPE_MISMATCH',
  });
  assert.strictEqual(
    db.prepare(`SELECT status FROM miniapp_role_applications
      WHERE id='type-mismatch-application'`).get().status,
    'manual_resolution_required',
  );
  assert.strictEqual(db.prepare(`SELECT COUNT(*) count FROM account_memberships
    WHERE subject_id='wrong-student-entity'`).get().count, 0);

  db.prepare("DELETE FROM authority_metadata WHERE key='database_authority_id'").run();
  insertPendingUser({
    id: 'missing-authority-applicant',
    phone: '13800138540',
    openid: 'wx-missing-authority',
  });
  insertProvisioning({
    applicationId: 'missing-authority-application',
    taskId: 'missing-authority-task',
    applicantUserId: 'missing-authority-applicant',
    applicationType: 'teacher',
    applicantIdentityKind: 'teacher',
    payload: { ...teacherPayload, phone: '13800138540' },
    result: hostReceipt('host-teacher-missing-authority', 'teacher', 'host-receipt-missing-authority'),
    requestHash: 'e'.repeat(64),
  });
  const missingAuthorityResult = reconciler.reconcileCompletedTask('missing-authority-task');
  assert.deepStrictEqual({ status: missingAuthorityResult.status, code: missingAuthorityResult.code }, {
    status: 'manual_resolution_required',
    code: 'PROVISIONING_AUTHORITY_UNAVAILABLE',
  });
  assert.deepStrictEqual(
    db.prepare(`SELECT role, identity_kind, teacher_id, review_status, login_enabled
      FROM users WHERE id='missing-authority-applicant'`).get(),
    {
      role: 'pending',
      identity_kind: 'unrecognized',
      teacher_id: null,
      review_status: 'pending',
      login_enabled: 0,
    },
    'missing authority resolution must roll back legacy compatibility projection changes',
  );
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) count FROM authority_accounts WHERE user_id='missing-authority-applicant'").get().count,
    0,
  );

  db.pragma('foreign_keys = OFF');
  db.prepare(`INSERT INTO primary_host_epochs
    (id,generation,device_id,user_id,authorization_id,status,activation_reason,source_epoch_id,
     challenge_id,db_instance_digest,schema_version,store_id,db_authority_id,
     host_credential_hash,host_public_key,credential_version,row_version,
     created_at,updated_at,activated_at,retired_at)
    VALUES('fallback-epoch',1,'fallback-host','epoch-owner','fallback-authorization','active',
      'bootstrap',NULL,'fallback-challenge','digest',3122,'fallback-store',
      'authority-from-epoch','credential-hash',NULL,1,1,?,?,?,NULL)`).run(now, now, now);
  db.pragma('foreign_keys = ON');
  insertPendingUser({
    id: 'epoch-authority-applicant',
    phone: '13800138541',
    openid: 'wx-epoch-authority',
  });
  insertProvisioning({
    applicationId: 'epoch-authority-application',
    taskId: 'epoch-authority-task',
    applicantUserId: 'epoch-authority-applicant',
    applicationType: 'teacher',
    applicantIdentityKind: 'teacher',
    payload: { ...teacherPayload, phone: '13800138541' },
    result: hostReceipt('host-teacher-epoch-authority', 'teacher', 'host-receipt-epoch-authority'),
    requestHash: 'f'.repeat(64),
  });
  assert.strictEqual(reconciler.reconcileCompletedTask('epoch-authority-task').status, 'approved');
  assert.deepStrictEqual(
    db.prepare(`SELECT accounts.authority_id, bindings.role, bindings.subject_type, bindings.subject_id
      FROM authority_accounts accounts
      INNER JOIN authority_role_bindings bindings
        ON bindings.authority_id=accounts.authority_id AND bindings.user_id=accounts.user_id
      WHERE accounts.user_id='epoch-authority-applicant' AND bindings.status='active'`).get(),
    {
      authority_id: 'authority-from-epoch',
      role: 'teacher',
      subject_type: 'teacher',
      subject_id: 'host-teacher-epoch-authority',
    },
    'a unique active host epoch is the final fail-closed authority source',
  );

  db.prepare(`INSERT INTO authority_metadata(key,value,updated_at)
    VALUES('database_authority_id',?,?)`).run(authorityId, now);
  insertPendingUser({
    id: 'conflicting-authority-applicant',
    phone: '13800138542',
    openid: 'wx-conflicting-authority',
  });
  db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
    VALUES('conflicting-authority-applicant','other-authority','active',?,?)`).run(now, now);
  insertProvisioning({
    applicationId: 'conflicting-authority-application',
    taskId: 'conflicting-authority-task',
    applicantUserId: 'conflicting-authority-applicant',
    applicationType: 'teacher',
    applicantIdentityKind: 'teacher',
    payload: { ...teacherPayload, phone: '13800138542' },
    result: hostReceipt('host-teacher-conflicting-authority', 'teacher', 'host-receipt-conflicting-authority'),
    requestHash: '1'.repeat(64),
  });
  const conflictingAuthorityResult = reconciler.reconcileCompletedTask('conflicting-authority-task');
  assert.deepStrictEqual({ status: conflictingAuthorityResult.status, code: conflictingAuthorityResult.code }, {
    status: 'manual_resolution_required',
    code: 'PROVISIONING_AUTHORITY_CONFLICT',
  });
  assert.deepStrictEqual(
    db.prepare(`SELECT authority_id,status FROM authority_accounts
      WHERE user_id='conflicting-authority-applicant'`).get(),
    { authority_id: 'other-authority', status: 'active' },
    'authority conflicts must not rewrite an existing account',
  );
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) count FROM authority_role_bindings WHERE user_id='conflicting-authority-applicant'").get().count,
    0,
  );

  console.log('miniapp provisioning reconciler checks passed');
} finally {
  try { database?.close(); } catch (_error) { /* best-effort cleanup */ }
  if (previous.dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previous.readDbPath;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (_error) { /* Windows WAL handles */ }
}
