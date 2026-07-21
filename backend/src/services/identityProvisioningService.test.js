const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');
const { createIdentityProvisioningService } = require('./identityProvisioningService');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.ok(
  packageJson.scripts['test:miniapp-applications'].includes('identityProvisioningService.test.js'),
  'the identity provisioning regression must run in the main npm test chain',
);

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-identity-provisioning-'));
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};
process.env.DB_PATH = path.join(workspace, 'provisioning.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.NODE_ENV = 'production';

let database;
try {
  database = new DatabaseService();
  const db = database.db;
  const now = '2026-09-01T02:00:00.000Z';
  let sequence = 0;
  const provisioner = createIdentityProvisioningService({
    db,
    now: () => new Date(now),
    uuid: prefix => `${prefix || 'provision'}-${++sequence}`,
  });

  function studentTask(applicationId, studentPhone, parentPhone, overrides = {}) {
    return {
      applicationId,
      revision: overrides.revision || 1,
      applicationType: 'student',
      reviewedBy: 'review-admin',
      tenantId: overrides.tenantId || 'default',
      requestHash: overrides.requestHash || 'a'.repeat(64),
      payload: {
        studentName: overrides.studentName || '\u5f20\u540c\u5b66',
        studentPhone,
        school: overrides.school || '\u5b81\u6ce2\u4e2d\u5b66',
        currentGrade: overrides.currentGrade || '\u9ad8\u4e00',
        gradeYear: overrides.gradeYear || 2026,
        parentRelation: overrides.parentRelation || '\u5988\u5988',
        parentPhone,
        ...(overrides.parentName !== undefined ? { parentName: overrides.parentName } : {}),
        ...(overrides.parentWechat !== undefined ? { parentWechat: overrides.parentWechat } : {}),
        ...(overrides.studentSource !== undefined ? { studentSource: overrides.studentSource } : {}),
        ...(overrides.notes !== undefined ? { notes: overrides.notes } : {}),
        guardianConfirmation: false,
        applicantAgeConfirmation: true,
      },
    };
  }

  function teacherTask(applicationId, phone, overrides = {}) {
    return {
      applicationId,
      revision: overrides.revision || 1,
      applicationType: 'teacher',
      reviewedBy: 'review-admin',
      tenantId: overrides.tenantId || 'default',
      requestHash: overrides.requestHash || 'b'.repeat(64),
      payload: {
        name: overrides.name || '\u674e\u8001\u5e08',
        phone,
        ...(overrides.subject !== undefined ? { subject: overrides.subject } : { subject: '\u7269\u7406' }),
        ...(overrides.notes !== undefined ? { notes: overrides.notes } : {}),
      },
    };
  }

  const firstInput = studentTask('student-create', '13800138300', '13800138301', {
    parentName: '\u5f20\u5988\u5988',
    parentWechat: 'parent-wx',
    studentSource: 'public-application',
    notes: 'verified note',
  });
  const first = provisioner.provision(firstInput);
  const replay = provisioner.provision(firstInput);
  assert.deepStrictEqual(replay, first);
  const restartedProvisioner = createIdentityProvisioningService({
    db,
    now: () => new Date(now),
    uuid: () => { throw new Error('receipt replay must not allocate another entity'); },
  });
  assert.deepStrictEqual(restartedProvisioner.provision(firstInput), first);
  assert.deepStrictEqual(Object.keys(first).sort(), ['entityId', 'entityType', 'receiptId', 'resultHash']);
  assert.strictEqual(first.entityType, 'student');
  assert.match(first.resultHash, /^[a-f0-9]{64}$/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM students').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM identity_provisioning_receipts').get().count, 1);
  const createdStudent = db.prepare('SELECT * FROM students WHERE id=?').get(first.entityId);
  assert.deepStrictEqual({
    name: createdStudent.name,
    phone: createdStudent.phone,
    parentPhone: createdStudent.parent_phone,
    parentPhoneNormalized: createdStudent.parent_phone_normalized,
    parentRelation: createdStudent.parent_relation,
    school: createdStudent.school,
    gradeYear: createdStudent.grade_year,
    gradeCurrent: createdStudent.grade_current,
    parentName: createdStudent.parent_name,
    parentWechat: createdStudent.parent_wechat,
    studentSource: createdStudent.student_source,
    notes: createdStudent.notes,
    balanceHours: createdStudent.balance_hours,
    balanceMoney: createdStudent.balance_money,
  }, {
    name: '\u5f20\u540c\u5b66',
    phone: '13800138300',
    parentPhone: '13800138301',
    parentPhoneNormalized: '13800138301',
    parentRelation: '\u5988\u5988',
    school: '\u5b81\u6ce2\u4e2d\u5b66',
    gradeYear: 2026,
    gradeCurrent: '\u9ad8\u4e00',
    parentName: '\u5f20\u5988\u5988',
    parentWechat: 'parent-wx',
    studentSource: 'public-application',
    notes: 'verified note',
    balanceHours: 0,
    balanceMoney: 0,
  });
  assert.deepStrictEqual(
    db.prepare('SELECT name, count FROM schools WHERE deleted=0').all(),
    [{ name: '\u5b81\u6ce2\u4e2d\u5b66', count: 1 }],
  );

  db.prepare(`INSERT INTO students
    (id, tenant_id, name, phone, parent_phone, parent_phone_normalized, parent_relation,
     school, grade_year, grade_current, parent_name, parent_wechat, student_source, notes,
     deleted, created_at, updated_at)
    VALUES ('student-sparse', 'default', ?, '13800138310', NULL, NULL, NULL,
      NULL, NULL, NULL, 'Existing Parent', NULL, NULL, NULL, 0, ?, ?)`)
    .run('\u738b\u540c\u5b66', now, now);
  const sparse = provisioner.provision(studentTask('student-bind-sparse', '13800138310', '13800138311', {
    requestHash: 'c'.repeat(64),
    studentName: '\u738b\u540c\u5b66',
    parentName: 'Incoming Parent',
    parentWechat: 'filled-wechat',
    school: '\u6148\u6eaa\u4e2d\u5b66',
  }));
  assert.strictEqual(sparse.entityId, 'student-sparse');
  const sparseRow = db.prepare("SELECT * FROM students WHERE id='student-sparse'").get();
  assert.strictEqual(sparseRow.parent_phone, '13800138311');
  assert.strictEqual(sparseRow.parent_phone_normalized, '13800138311');
  assert.strictEqual(sparseRow.parent_relation, '\u5988\u5988');
  assert.strictEqual(sparseRow.school, '\u6148\u6eaa\u4e2d\u5b66');
  assert.strictEqual(sparseRow.grade_year, 2026);
  assert.strictEqual(sparseRow.parent_name, 'Existing Parent', 'non-empty optional fields must not be overwritten');
  assert.strictEqual(sparseRow.parent_wechat, 'filled-wechat');
  assert.strictEqual(db.prepare("SELECT count FROM schools WHERE name=?").get('\u6148\u6eaa\u4e2d\u5b66').count, 1);

  db.prepare(`INSERT INTO students
    (id, name, phone, parent_phone, parent_phone_normalized, parent_relation, school,
     grade_year, deleted, created_at, updated_at)
    VALUES ('student-cross-parent', 'Cross Parent', '13800138320', '13800138321',
      '13800138321', ?, 'School', 2026, 0, ?, ?)`)
    .run('\u5988\u5988', now, now);
  let crossError;
  try {
    provisioner.provision(studentTask('student-cross', '13800138321', '13800138322', {
      requestHash: 'd'.repeat(64),
    }));
  } catch (error) { crossError = error; }
  assert.strictEqual(crossError?.code, 'STUDENT_PHONE_CROSS_OCCUPIED');
  assert.ok(!('existingProfile' in crossError));
  assert.ok(!JSON.stringify(crossError).includes('Cross Parent'));

  db.prepare(`INSERT INTO students
    (id, name, phone, parent_phone, parent_phone_normalized, parent_relation, school,
     grade_year, deleted, created_at, updated_at)
    VALUES ('student-stale-parent-normalized', 'Stale Parent Phone', '13800138370',
      '13800138371', '13800138372', ?, 'School', 2026, 0, ?, ?)`)
    .run('\u5988\u5988', now, now);
  const studentCountBeforeStaleConflict = db.prepare('SELECT COUNT(*) count FROM students').get().count;
  assert.throws(
    () => provisioner.provision(studentTask('student-stale-parent-normalized-app', '13800138373', '13800138371', {
      requestHash: '7'.repeat(64),
    })),
    error => error?.code === 'STUDENT_PROFILE_CONFLICT',
  );
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) count FROM students').get().count,
    studentCountBeforeStaleConflict,
    'an inconsistent stored normalized parent phone must never create a duplicate student',
  );

  db.prepare(`INSERT INTO students
    (id, name, phone, parent_phone, parent_phone_normalized, parent_relation, school,
     grade_year, deleted, created_at, updated_at)
    VALUES ('student-multi-a', 'Multi A', '13800138330', NULL, NULL, NULL, NULL, NULL, 0, ?, ?),
           ('student-multi-b', 'Multi B', NULL, '13800138331', '13800138331', NULL, NULL, NULL, 0, ?, ?)`)
    .run(now, now, now, now);
  assert.throws(
    () => provisioner.provision(studentTask('student-multiple', '13800138330', '13800138331', {
      requestHash: 'e'.repeat(64),
    })),
    error => error?.code === 'STUDENT_PROFILE_CONFLICT',
  );

  db.prepare(`INSERT INTO students
    (id, name, phone, parent_phone, parent_phone_normalized, parent_relation, school,
     grade_year, deleted, created_at, updated_at)
    VALUES ('student-name-conflict', 'Different Name', '13800138340', '13800138341',
      '13800138341', ?, ?, 2026, 0, ?, ?)`)
    .run('\u5988\u5988', '\u5b81\u6ce2\u4e2d\u5b66', now, now);
  assert.throws(
    () => provisioner.provision(studentTask('student-name-conflict-app', '13800138340', '13800138341', {
      requestHash: 'f'.repeat(64),
    })),
    error => error?.code === 'STUDENT_PROFILE_CONFLICT',
  );
  db.prepare(`INSERT INTO students
    (id, name, phone, parent_phone, parent_phone_normalized, parent_relation, school,
     grade_year, deleted, created_at, updated_at)
    VALUES ('student-relation-conflict', ?, '13800138342', '13800138343',
      '13800138343', ?, ?, 2026, 0, ?, ?)`).run(
    '\u8d75\u540c\u5b66',
    '\u7238\u7238',
    '\u5b81\u6ce2\u4e2d\u5b66',
    now,
    now,
  );
  assert.throws(
    () => provisioner.provision(studentTask('student-relation-conflict-app', '13800138342', '13800138343', {
      requestHash: '0'.repeat(64),
      studentName: '\u8d75\u540c\u5b66',
      parentRelation: '\u5988\u5988',
    })),
    error => error?.code === 'STUDENT_PROFILE_CONFLICT',
  );
  db.prepare(`INSERT INTO teachers
    (id, name, phone, deleted, created_at, updated_at)
    VALUES ('teacher-occupies-student-phone', 'Occupied Teacher', '13800138360', 0, ?, ?)`)
    .run(now, now);
  assert.throws(
    () => provisioner.provision(studentTask('student-teacher-phone-conflict', '13800138360', '13800138361', {
      requestHash: '9'.repeat(64),
    })),
    error => error?.code === 'STUDENT_PHONE_CROSS_OCCUPIED',
  );
  assert.throws(
    () => provisioner.provision(studentTask('student-grade-tamper', '13800138350', '13800138351', {
      requestHash: '1'.repeat(64),
      gradeYear: 2025,
    })),
    error => error?.code === 'GRADE_YEAR_MISMATCH',
  );

  const teacher = provisioner.provision(teacherTask('teacher-create', '13800138400', {
    requestHash: '2'.repeat(64),
    notes: 'teacher note',
  }));
  assert.deepStrictEqual(Object.keys(teacher).sort(), ['entityId', 'entityType', 'receiptId', 'resultHash']);
  assert.strictEqual(teacher.entityType, 'teacher');
  const createdTeacher = db.prepare('SELECT * FROM teachers WHERE id=?').get(teacher.entityId);
  assert.strictEqual(createdTeacher.hourly_rate, null);
  assert.strictEqual(createdTeacher.subject, '\u7269\u7406');
  assert.strictEqual(createdTeacher.notes, 'teacher note');
  assert.deepStrictEqual(provisioner.provision(teacherTask('teacher-create', '13800138400', {
    requestHash: '2'.repeat(64), notes: 'teacher note',
  })), teacher);

  db.prepare(`INSERT INTO teachers
    (id, name, phone, subject, hourly_rate, notes, deleted, created_at, updated_at)
    VALUES ('teacher-sparse', ?, '13800138410', NULL, 600, NULL, 0, ?, ?)`)
    .run('\u9648\u8001\u5e08', now, now);
  const teacherSparse = provisioner.provision(teacherTask('teacher-bind-sparse', '13800138410', {
    requestHash: '3'.repeat(64),
    name: '\u9648\u8001\u5e08',
    subject: '\u5316\u5b66',
    notes: 'fill note',
  }));
  assert.strictEqual(teacherSparse.entityId, 'teacher-sparse');
  assert.deepStrictEqual(
    db.prepare("SELECT subject, hourly_rate, notes FROM teachers WHERE id='teacher-sparse'").get(),
    { subject: '\u5316\u5b66', hourly_rate: 600, notes: 'fill note' },
  );
  assert.throws(
    () => provisioner.provision(teacherTask('teacher-name-conflict', '13800138410', {
      requestHash: '4'.repeat(64),
      name: 'Different Teacher',
    })),
    error => error?.code === 'TEACHER_PROFILE_CONFLICT',
  );
  db.prepare(`INSERT INTO teachers
    (id, name, phone, deleted, created_at, updated_at)
    VALUES ('teacher-multi', ?, '13800138410', 0, ?, ?)`)
    .run('\u9648\u8001\u5e08', now, now);
  assert.throws(
    () => provisioner.provision(teacherTask('teacher-multiple', '13800138410', {
      requestHash: '5'.repeat(64),
      name: '\u9648\u8001\u5e08',
    })),
    error => error?.code === 'TEACHER_PROFILE_CONFLICT',
  );
  assert.throws(
    () => provisioner.provision(teacherTask('teacher-student-phone-conflict', '13800138320', {
      requestHash: '8'.repeat(64),
    })),
    error => error?.code === 'TEACHER_PROFILE_CONFLICT',
  );

  assert.throws(
    () => provisioner.provision({ ...firstInput, requestHash: '6'.repeat(64) }),
    error => error?.code === 'APPLICATION_REVISION_HASH_CONFLICT',
  );
  assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM students WHERE phone='13800138300'").get().count, 1);
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) count FROM identity_provisioning_receipts WHERE application_id='student-create'").get().count,
    1,
  );

  console.log('identity provisioning service checks passed');
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
