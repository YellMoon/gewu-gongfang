const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');
const {
  ACTIVE_APPLICATION_STATUSES,
  createMiniappApplicationService,
  gradeYearFor,
  validateStudentApplication,
  validateTeacherApplication,
} = require('./miniappApplicationService');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-application-service-'));
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};
process.env.DB_PATH = path.join(workspace, 'applications.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.NODE_ENV = 'production';

let database;
try {
  assert.deepStrictEqual(ACTIVE_APPLICATION_STATUSES, ['submitted', 'provisioning', 'manual_resolution_required']);
  assert.strictEqual(gradeYearFor('\u9ad8\u4e00', new Date('2026-09-01T00:00:00+08:00')), 2026);
  assert.strictEqual(gradeYearFor('\u9ad8\u4e09', new Date('2026-07-31T00:00:00+08:00')), 2023);
  assert.strictEqual(gradeYearFor('\u9ad8\u590d', new Date('2026-07-31T00:00:00+08:00')), 2022);

  assert.throws(
    () => validateStudentApplication({
      studentName: '\u5f20\u540c\u5b66',
      studentPhone: '13800138000',
      school: '\u5b81\u6ce2\u4e2d\u5b66',
      currentGrade: '\u9ad8\u4e00',
      parentRelation: '\u5988\u5988',
      parentPhone: '13800138000',
      verifiedPhone: '13800138000',
      applicantAgeConfirmation: true,
    }),
    error => error?.code === 'STUDENT_PARENT_PHONE_MUST_DIFFER',
  );
  assert.throws(
    () => validateStudentApplication({
      studentName: '\u5f20\u540c\u5b66', studentPhone: '13800138000', school: '\u5b81\u6ce2\u4e2d\u5b66',
      currentGrade: '\u9ad8\u4e00', parentRelation: '\u5988\u5988', parentPhone: '13800138001',
      verifiedPhone: '13800138000', applicantAgeConfirmation: false,
    }),
    error => error?.code === 'STUDENT_AGE_CONFIRMATION_REQUIRED',
  );
  const parentValidated = validateStudentApplication({
    studentName: '  \u5f20\u540c\u5b66  ', studentPhone: '13800138000', school: '  \u5b81\u6ce2\u4e2d\u5b66 ',
    currentGrade: '\u9ad8\u4e8c', parentRelation: '\u5988\u5988', parentPhone: '13800138001',
    verifiedPhone: '13800138001', guardianConfirmation: true, notes: '  plain note  ',
  }, { now: new Date('2026-10-01T00:00:00+08:00') });
  assert.strictEqual(parentValidated.applicantIdentityKind, 'parent');
  assert.strictEqual(parentValidated.payload.studentName, '\u5f20\u540c\u5b66');
  assert.strictEqual(parentValidated.payload.school, '\u5b81\u6ce2\u4e2d\u5b66');
  assert.strictEqual(parentValidated.payload.gradeYear, 2025);
  assert.strictEqual(parentValidated.payload.notes, 'plain note');
  assert.throws(
    () => validateStudentApplication({
      ...parentValidated.payload,
      verifiedPhone: '13800138001',
      guardianConfirmation: true,
      student_id: 'forbidden',
    }),
    error => error?.code === 'APPLICATION_FIELD_FORBIDDEN',
  );
  assert.throws(
    () => validateTeacherApplication({
      name: '\u674e\u8001\u5e08', phone: '13800138002', verifiedPhone: '13800138002', hourly_rate: 500,
    }),
    error => error?.code === 'APPLICATION_FIELD_FORBIDDEN',
  );
  assert.throws(
    () => validateTeacherApplication({
      name: '\u674e\u8001\u5e08', phone: '13800138002', verifiedPhone: '13800138003',
    }),
    error => error?.code === 'TEACHER_PHONE_MUST_MATCH_VERIFIED_PHONE',
  );

  database = new DatabaseService();
  const db = database.db;
  const now = '2026-09-01T02:00:00.000Z';
  const insertPending = db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 'unrecognized', 1, 0, 'pending', 1, 0, ?, ?)`);
  insertPending.run('applicant-student', '13800138000', '13800138000', 'Student Applicant', now, now);
  insertPending.run('applicant-parent', '13800138001', '13800138001', 'Parent Applicant', now, now);
  insertPending.run('applicant-teacher', '13800138002', '13800138002', 'Teacher Applicant', now, now);
  insertPending.run('applicant-other', '13800138003', '13800138003', 'Other Applicant', now, now);
  insertPending.run('applicant-business-conflict', '13800138004', '13800138004', 'Conflict Applicant', now, now);
  db.prepare(`INSERT INTO teachers (id, name, phone, deleted, created_at, updated_at)
    VALUES ('existing-teacher', 'Existing Teacher', '13800138004', 0, ?, ?)`)
    .run(now, now);

  let sequence = 0;
  const applications = createMiniappApplicationService({
    db,
    now: () => new Date(now),
    uuid: () => `application-test-${++sequence}`,
  });
  const studentPayload = {
    studentName: '\u5f20\u540c\u5b66',
    studentPhone: '13800138000',
    school: '\u5b81\u6ce2\u4e2d\u5b66',
    currentGrade: '\u9ad8\u4e00',
    parentRelation: '\u5988\u5988',
    parentPhone: '13800138001',
    applicantAgeConfirmation: true,
  };
  const created = applications.submit({
    applicantUserId: 'applicant-student',
    verifiedPhone: '13800138000',
    applicationType: 'student',
    payload: studentPayload,
    idempotencyKey: 'student-revision-1',
  });
  assert.strictEqual(created.created, true);
  assert.strictEqual(created.application.revision, 1);
  assert.strictEqual(created.application.applicantIdentityKind, 'student');
  assert.strictEqual(created.application.status, 'submitted');
  assert.ok(!('payload_json' in created.application));

  const replayed = applications.submit({
    applicantUserId: 'applicant-student',
    verifiedPhone: '13800138000',
    applicationType: 'student',
    payload: studentPayload,
    idempotencyKey: 'student-revision-1',
  });
  assert.strictEqual(replayed.replayed, true);
  assert.strictEqual(replayed.application.id, created.application.id);
  assert.throws(
    () => applications.submit({
      applicantUserId: 'applicant-student', verifiedPhone: '13800138000', applicationType: 'student',
      payload: { ...studentPayload, notes: 'changed' }, idempotencyKey: 'student-revision-1',
    }),
    error => error?.code === 'IDEMPOTENCY_KEY_REUSED',
  );
  assert.throws(
    () => applications.submit({
      applicantUserId: 'applicant-student', verifiedPhone: '13800138000', applicationType: 'student',
      payload: studentPayload, idempotencyKey: 'student-revision-1-second-key',
    }),
    error => error?.code === 'ACTIVE_APPLICATION_EXISTS',
  );

  let crossApplicantError;
  try {
    applications.submit({
      applicantUserId: 'applicant-parent',
      verifiedPhone: '13800138001',
      applicationType: 'student',
      payload: { ...studentPayload, applicantAgeConfirmation: undefined, guardianConfirmation: true },
      idempotencyKey: 'parent-duplicate-pair',
    });
  } catch (error) {
    crossApplicantError = error;
  }
  assert.strictEqual(crossApplicantError?.code, 'ACTIVE_APPLICATION_EXISTS');
  assert.ok(!('application' in crossApplicantError), 'cross-applicant conflicts must not disclose another payload');

  db.prepare("UPDATE miniapp_role_applications SET status='rejected', rejection_reason='fix fields' WHERE id=?")
    .run(created.application.id);
  const revisionTwo = applications.submit({
    applicantUserId: 'applicant-student',
    verifiedPhone: '13800138000',
    applicationType: 'student',
    payload: { ...studentPayload, notes: 'revision two' },
    idempotencyKey: 'student-revision-2',
  });
  assert.strictEqual(revisionTwo.application.revision, 2);
  db.prepare("UPDATE miniapp_role_applications SET status='provisioning' WHERE id=?").run(revisionTwo.application.id);
  assert.throws(
    () => applications.withdraw({ applicantUserId: 'applicant-student', applicationId: revisionTwo.application.id }),
    error => error?.code === 'APPLICATION_WITHDRAW_NOT_ALLOWED',
  );

  const teacher = applications.submit({
    applicantUserId: 'applicant-teacher',
    verifiedPhone: '13800138002',
    applicationType: 'teacher',
    payload: { name: '  \u674e\u8001\u5e08 ', phone: '13800138002', subject: ' \u7269\u7406 ', notes: ' note ' },
    idempotencyKey: 'teacher-revision-1',
  });
  assert.deepStrictEqual(teacher.application.payload, {
    name: '\u674e\u8001\u5e08', phone: '13800138002', subject: '\u7269\u7406', notes: 'note',
  });
  assert.ok(!('hourly_rate' in teacher.application.payload));
  assert.strictEqual(applications.getMine('applicant-parent').state, 'not_submitted');
  assert.strictEqual(applications.getMine('applicant-teacher').application.id, teacher.application.id);
  assert.throws(
    () => applications.submit({
      applicantUserId: 'applicant-other', verifiedPhone: '13800138003', applicationType: 'admin',
      payload: {}, idempotencyKey: 'admin-forbidden',
    }),
    error => error?.code === 'APPLICATION_TYPE_NOT_ALLOWED',
  );
  assert.throws(
    () => applications.submit({
      applicantUserId: 'applicant-business-conflict',
      verifiedPhone: '13800138004',
      applicationType: 'teacher',
      payload: { name: 'Conflict Teacher', phone: '13800138004' },
      idempotencyKey: 'recognized-business-phone',
    }),
    error => error?.code === 'PHONE_ALREADY_RECOGNIZED',
  );

  console.log('miniapp application service checks passed');
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
