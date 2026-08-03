const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');
const { createMiniappApplicationService } = require('./miniappApplicationService');
const {
  canReviewApplications,
  canReviewUsers,
  effectiveCapabilities,
} = require('./authorizationPolicy');
const { createV2Task } = require('./cloudRelayTaskService');
const { createMiniappApplicationReviewService } = require('./miniappApplicationReviewService');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-application-review-'));
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};
process.env.DB_PATH = path.join(workspace, 'review.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.NODE_ENV = 'production';

let database;
try {
  database = new DatabaseService();
  const db = database.db;
  const now = '2026-09-01T02:00:00.000Z';
  const insertUser = db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, is_super_admin_identity, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?, 0, ?, ?)`);
  insertUser.run('review-admin', '13800138290', '13800138290', 'Review Admin', 'admin', 'admin', 1, 'approved', 0, now, now);
  db.prepare(`UPDATE users SET role='super_admin', identity_kind='super_admin', status=1,
    login_enabled=1, review_status='approved', is_super_admin_identity=1, deleted=0,
    updated_at=? WHERE id='miniapp-admin-13732250653'`).run(now);
  insertUser.run('review-teacher-actor', '13800138291', '13800138291', 'Teacher Actor', 'teacher', 'teacher', 1, 'approved', 0, now, now);
  for (const [id, phone] of [
    ['review-student', '13800138200'],
    ['review-parent', '13800138201'],
    ['review-teacher', '13800138202'],
    ['review-old-host', '13800138203'],
    ['review-offline-host', '13800138204'],
    ['review-reject', '13800138205'],
  ]) {
    insertUser.run(id, phone, phone, id, 'pending', 'unrecognized', 0, 'pending', 0, now, now);
  }

  const insertHeartbeat = db.prepare(`INSERT INTO host_heartbeats
    (id, host_device_id, status, base_url, lan_urls, capabilities, created_at, updated_at)
    VALUES (?, ?, ?, '', '[]', ?, ?, ?)`);
  insertHeartbeat.run('host-authority', 'host-authority', 'online', '["identity-provisioning-v1"]', now, now);
  insertHeartbeat.run('host-old', 'host-old', 'online', '[]', now, now);
  insertHeartbeat.run('host-offline', 'host-offline', 'offline', '["identity-provisioning-v1"]', now, now);

  let sequence = 0;
  const applications = createMiniappApplicationService({
    db,
    now: () => new Date(now),
    uuid: () => `review-application-${++sequence}`,
  });
  const student = applications.submit({
    applicantUserId: 'review-student',
    verifiedPhone: '13800138200',
    applicationType: 'student',
    payload: {
      studentName: '\u5f20\u540c\u5b66',
      studentPhone: '13800138200',
      school: '\u5b81\u6ce2\u4e2d\u5b66',
      currentGrade: '\u9ad8\u4e00',
      parentRelation: '\u5988\u5988',
      parentPhone: '13800138201',
      applicantAgeConfirmation: true,
    },
    idempotencyKey: 'review-student-1',
  }).application;
  const submitTeacher = (applicantUserId, phone, key) => applications.submit({
    applicantUserId,
    verifiedPhone: phone,
    applicationType: 'teacher',
    payload: { name: 'Applicant Teacher', phone, subject: '\u7269\u7406' },
    idempotencyKey: key,
  }).application;
  const teacher = submitTeacher('review-teacher', '13800138202', 'review-teacher-1');
  const oldHostApplication = submitTeacher('review-old-host', '13800138203', 'review-old-host-1');
  const offlineHostApplication = submitTeacher('review-offline-host', '13800138204', 'review-offline-host-1');
  const rejectedApplication = submitTeacher('review-reject', '13800138205', 'review-reject-1');

  const normalAdmin = db.prepare("SELECT * FROM users WHERE id='review-admin'").get();
  const superAdmin = db.prepare("SELECT * FROM users WHERE id='miniapp-admin-13732250653'").get();
  const teacherActor = db.prepare("SELECT * FROM users WHERE id='review-teacher-actor'").get();
  assert.strictEqual(canReviewApplications(normalAdmin), false);
  assert.strictEqual(canReviewApplications(superAdmin), true);
  assert.strictEqual(canReviewApplications(teacherActor), false);
  assert.strictEqual(canReviewUsers(normalAdmin), false);
  assert.ok(!effectiveCapabilities(normalAdmin).includes('applications:review'));
  assert.ok(!effectiveCapabilities(normalAdmin).includes('users:review'));

  assert.throws(
    () => createV2Task(db, {
      taskType: 'identity-provisioning',
      payload: {},
      createdBy: 'forged-public-caller',
      targetHostDeviceId: 'host-authority',
      idempotencyKey: 'forged-internal-task',
    }),
    error => error?.code === 'INTERNAL_TASK_TYPE_FORBIDDEN',
  );

  const createReview = targetHostDeviceId => createMiniappApplicationReviewService({
    db,
    targetHostDeviceId,
    hostHeartbeatTtlMs: 5 * 60 * 1000,
    now: () => new Date(now),
    uuid: prefix => `${prefix || 'review'}-${++sequence}`,
  });
  const review = createReview('host-authority');
  const membershipCountBefore = db.prepare('SELECT COUNT(*) count FROM account_memberships').get().count;
  const decision = review.approve({
    actor: superAdmin,
    applicationId: student.id,
    expectedRevision: student.revision,
    tenantId: 'default',
  });
  assert.strictEqual(decision.application.status, 'provisioning');
  assert.strictEqual(decision.task.task_type, 'identity-provisioning');
  assert.strictEqual(decision.task.target_host_device_id, 'host-authority');
  assert.strictEqual(decision.task.idempotency_key, `identity-provisioning:${student.id}:${student.revision}`);
  assert.match(decision.task.request_hash, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(Object.keys(decision.task.payload).sort(), [
    'applicationId', 'applicationType', 'payload', 'reviewedBy', 'revision', 'tenantId',
  ]);
  assert.strictEqual(decision.task.payload.applicationId, student.id);
  assert.strictEqual(decision.task.payload.payload.gradeYear, 2026);
  assert.ok(!('openid' in decision.task.payload));
  assert.ok(!('wechatOpenid' in decision.task.payload));
  assert.ok(!('token' in decision.task.payload));
  assert.ok(!('code' in decision.task.payload));
  assert.ok(!JSON.stringify(decision.task.payload).includes('hourly_rate'));
  assert.strictEqual(decision.application.hostTaskId, decision.task.id);

  const untouched = db.prepare(`SELECT role, identity_kind, review_status, login_enabled,
    student_id, teacher_id, auth_version FROM users WHERE id='review-student'`).get();
  assert.deepStrictEqual(untouched, {
    role: 'pending',
    identity_kind: 'unrecognized',
    review_status: 'pending',
    login_enabled: 0,
    student_id: null,
    teacher_id: null,
    auth_version: 1,
  });
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM account_memberships').get().count, membershipCountBefore);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM students').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM teachers').get().count, 0);
  const approvalAudit = db.prepare(`SELECT action, before_json, after_json FROM authorization_audit_log
    WHERE target_user_id=? ORDER BY rowid DESC LIMIT 1`).get('review-student');
  assert.strictEqual(approvalAudit.action, 'approve_miniapp_application');
  assert.ok(!approvalAudit.before_json.includes('13800138200'));
  assert.ok(!approvalAudit.after_json.includes('\u5f20\u540c\u5b66'));

  const replayed = review.approve({
    actor: superAdmin,
    applicationId: student.id,
    expectedRevision: student.revision,
    tenantId: 'default',
  });
  assert.strictEqual(replayed.replayed, true);
  assert.strictEqual(replayed.task.id, decision.task.id);

  assert.throws(
    () => createReview('host-old').approve({
      actor: superAdmin,
      applicationId: oldHostApplication.id,
      expectedRevision: oldHostApplication.revision,
    }),
    error => error?.code === 'IDENTITY_PROVISIONING_UNSUPPORTED',
  );
  assert.deepStrictEqual(
    db.prepare('SELECT status, host_task_id FROM miniapp_role_applications WHERE id=?').get(oldHostApplication.id),
    { status: 'submitted', host_task_id: null },
  );
  assert.throws(
    () => createReview('host-offline').approve({
      actor: superAdmin,
      applicationId: offlineHostApplication.id,
      expectedRevision: offlineHostApplication.revision,
    }),
    error => error?.code === 'TARGET_HOST_OFFLINE',
  );
  assert.strictEqual(
    db.prepare('SELECT status FROM miniapp_role_applications WHERE id=?').get(offlineHostApplication.id).status,
    'submitted',
  );

  const rejection = review.reject({
    actor: superAdmin,
    applicationId: rejectedApplication.id,
    expectedRevision: rejectedApplication.revision,
    reason: '  Please correct the submitted name.  ',
  });
  assert.strictEqual(rejection.application.status, 'rejected');
  assert.strictEqual(rejection.application.rejectionReason, 'Please correct the submitted name.');
  assert.strictEqual(db.prepare("SELECT login_enabled FROM users WHERE id='review-reject'").get().login_enabled, 0);
  const rejectionRevisionTwo = submitTeacher('review-reject', '13800138205', 'review-reject-2');
  assert.strictEqual(rejectionRevisionTwo.revision, 2);
  assert.throws(
    () => review.approve({
      actor: superAdmin,
      applicationId: rejectedApplication.id,
      expectedRevision: rejectedApplication.revision,
    }),
    error => error?.code === 'APPLICATION_REVISION_STALE',
  );
  assert.throws(
    () => review.approve({ actor: teacherActor, applicationId: teacher.id, expectedRevision: teacher.revision }),
    error => error?.code === 'APPLICATION_REVIEW_FORBIDDEN',
  );

  db.prepare(`INSERT INTO miniapp_role_applications
    (id, applicant_user_id, application_type, status, revision, payload_json, payload_hash,
     idempotency_key, verified_phone_normalized, applicant_identity_kind, submitted_at, created_at, updated_at)
    VALUES ('self-review-app', 'review-admin', 'teacher', 'submitted', 1,
      '{"name":"Self","phone":"13800138290"}', 'self-hash', 'self-key', '13800138290', 'teacher', ?, ?, ?)`)
    .run(now, now, now);
  assert.throws(
    () => review.approve({ actor: normalAdmin, applicationId: 'self-review-app', expectedRevision: 1 }),
    error => error?.code === 'APPLICATION_REVIEW_FORBIDDEN',
  );

  const teacherDecision = review.approve({
    actor: superAdmin,
    applicationId: teacher.id,
    expectedRevision: teacher.revision,
  });
  db.prepare("UPDATE miniapp_tasks SET status='failed', phase='failed', error_code='TEACHER_PROFILE_CONFLICT' WHERE id=?")
    .run(teacherDecision.task.id);
  db.prepare("UPDATE miniapp_role_applications SET status='manual_resolution_required' WHERE id=?")
    .run(teacher.id);
  assert.throws(
    () => review.retry({ actor: normalAdmin, applicationId: teacher.id, expectedRevision: teacher.revision }),
    error => error?.code === 'APPLICATION_REVIEW_FORBIDDEN',
  );
  const retried = review.retry({ actor: superAdmin, applicationId: teacher.id, expectedRevision: teacher.revision });
  assert.strictEqual(retried.application.status, 'provisioning');
  assert.strictEqual(retried.task.status, 'pending_host');
  assert.strictEqual(retried.task.id, teacherDecision.task.id);

  const adminList = review.list({ actor: superAdmin, status: 'provisioning' });
  assert.ok(adminList.items.some(item => item.id === student.id));
  assert.ok(adminList.items.every(item => !('payload_json' in item)));
  assert.ok(!JSON.stringify(adminList).includes('wechat_openid'));
  assert.ok(!JSON.stringify(adminList).includes('wechat_unionid'));

  console.log('miniapp application review service checks passed');
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
