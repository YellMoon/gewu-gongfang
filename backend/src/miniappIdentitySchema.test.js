const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('./database');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-identity-schema-'));
const dbPath = path.join(workspace, 'legacy.db');
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};

process.env.DB_PATH = dbPath;
process.env.READ_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';

let service;
try {
  service = new DatabaseService();
  const columns = table => new Set(service.db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  const users = columns('users');
  const students = columns('students');

  for (const column of ['identity_kind', 'auth_version', 'disabled_at']) {
    assert.ok(users.has(column), `users should include ${column}`);
  }
  for (const column of ['parent_phone', 'parent_phone_normalized', 'parent_relation']) {
    assert.ok(students.has(column), `students should include ${column}`);
  }

  for (const table of [
    'miniapp_login_events',
    'miniapp_role_applications',
    'account_memberships',
    'identity_provisioning_receipts',
    'desktop_identity_challenges',
    'desktop_device_authorizations',
  ]) {
    assert.ok(
      service.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
      `${table} should exist`,
    );
  }

  const parentPhoneStudent = service.createStudent({
    name: 'Parent phone CRUD',
    phone: '13000000010',
    parent_phone: '13000000011',
    parent_phone_normalized: '13000000011',
    parent_relation: 'mother',
  });
  assert.deepStrictEqual({
    parentPhone: parentPhoneStudent.parent_phone,
    parentPhoneNormalized: parentPhoneStudent.parent_phone_normalized,
    parentRelation: parentPhoneStudent.parent_relation,
  }, {
    parentPhone: '13000000011',
    parentPhoneNormalized: '13000000011',
    parentRelation: 'mother',
  });
  const updatedParentPhoneStudent = service.updateStudent(parentPhoneStudent.id, {
    parent_phone: '13000000012',
    parent_phone_normalized: '13000000012',
    parent_relation: 'father',
  });
  assert.deepStrictEqual({
    parentPhone: updatedParentPhoneStudent.parent_phone,
    parentPhoneNormalized: updatedParentPhoneStudent.parent_phone_normalized,
    parentRelation: updatedParentPhoneStudent.parent_relation,
  }, {
    parentPhone: '13000000012',
    parentPhoneNormalized: '13000000012',
    parentRelation: 'father',
  });

  const heartbeatColumns = columns('host_heartbeats');
  assert.ok(heartbeatColumns.has('capabilities'), 'host_heartbeats should include capabilities');
  for (const index of [
    'idx_miniapp_login_events_user_created',
    'idx_miniapp_applications_active_user',
    'idx_memberships_status_subject',
    'idx_identity_receipts_request',
    'idx_desktop_identity_active_short_code',
    'idx_desktop_identity_active_device',
    'idx_desktop_identity_active_key_fingerprint',
    'idx_desktop_device_authorizations_user_status',
  ]) {
    assert.ok(
      service.db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(index),
      `${index} should exist`,
    );
  }

  const now = '2026-07-16T00:00:00.000Z';
  service.db.prepare(`INSERT INTO students
    (id, name, phone, deleted, created_at, updated_at)
    VALUES ('student-1', '学生一', '13000000001', 0, ?, ?)`
  ).run(now, now);
  service.db.prepare(`INSERT INTO teachers
    (id, name, phone, deleted, created_at, updated_at)
    VALUES ('teacher-1', '老师一', '13000000002', 0, ?, ?)`
  ).run(now, now);
  const insertUser = service.db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, status, login_enabled, student_id, teacher_id,
     review_status, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, 'approved', 0, ?, ?)`);
  insertUser.run('approved-student', '13000000001', '13000000001', '学生身份', 'student', 'student-1', null, now, now);
  insertUser.run('approved-teacher', '13000000002', '13000000002', '老师身份', 'teacher', null, 'teacher-1', now, now);
  insertUser.run('approved-admin', '13000000003', '13000000003', '管理员身份', 'admin', null, null, now, now);
  insertUser.run('broken-student', '13000000004', '13000000004', '缺映射学生', 'student', null, null, now, now);
  insertUser.run('broken-teacher', '13000000005', '13000000005', '缺映射老师', 'teacher', null, null, now, now);
  insertUser.run('review-demo:sample', '13000000006', '13000000006', '旧审核体验', 'student', null, null, now, now);

  service.close();
  service = new DatabaseService();

  const memberships = service.db.prepare(`SELECT subject_type, subject_id, status, source
    FROM account_memberships WHERE subject_id IN ('student-1', 'teacher-1', 'approved-admin')
    ORDER BY subject_type, subject_id`).all();
  assert.deepStrictEqual(memberships, [
    { subject_type: 'student', subject_id: 'student-1', status: 'active', source: 'existing_approval' },
    { subject_type: 'teacher', subject_id: 'teacher-1', status: 'active', source: 'existing_approval' },
    { subject_type: 'user', subject_id: 'approved-admin', status: 'active', source: 'existing_approval' },
  ]);
  for (const id of ['broken-student', 'broken-teacher']) {
    const user = service.db.prepare('SELECT review_status, login_enabled, auth_version FROM users WHERE id=?').get(id);
    assert.deepStrictEqual(user, { review_status: 'manual_resolution_required', login_enabled: 0, auth_version: 2 });
  }
  assert.deepStrictEqual(
    service.db.prepare('SELECT review_status, login_enabled, auth_version FROM users WHERE id=?').get('review-demo:sample'),
    { review_status: 'approved', login_enabled: 1, auth_version: 1 },
    'synthetic review-demo users must be excluded from membership migration',
  );
  console.log('miniapp identity schema migration checks passed');
} finally {
  try { service?.close(); } catch (_error) { /* best-effort test cleanup */ }
  if (previous.dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previous.readDbPath;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (_error) { /* Windows may release WAL handles asynchronously */ }
}
