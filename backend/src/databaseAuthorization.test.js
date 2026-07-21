const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { DatabaseService } = require('./database');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authorization-'));
const dbPath = path.join(workspace, 'scheduling.db');
const previous = { db: process.env.DB_PATH, read: process.env.READ_DB_PATH, env: process.env.NODE_ENV };
const legacy = new Database(dbPath);
legacy.exec(`CREATE TABLE users (
  id TEXT PRIMARY KEY, phone TEXT, name TEXT, nickname TEXT, role TEXT,
  status INTEGER DEFAULT 1, login_enabled INTEGER DEFAULT 0, student_id TEXT,
  linked_student_ids TEXT, deleted INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE teachers (
  id TEXT PRIMARY KEY, tenant_id TEXT DEFAULT 'default', name TEXT NOT NULL, phone TEXT, deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE students (
  id TEXT PRIMARY KEY, tenant_id TEXT DEFAULT 'default', name TEXT NOT NULL, phone TEXT,
  parent_phone TEXT, parent_phone_normalized TEXT, parent_relation TEXT,
  school TEXT, grade_year INTEGER, grade_current TEXT, source_type INTEGER DEFAULT 1,
  institution_id TEXT, is_institution_student INTEGER DEFAULT 0, parent_name TEXT,
  parent_wechat TEXT, student_source TEXT, balance_hours REAL DEFAULT 0,
  balance_money REAL DEFAULT 0, notes TEXT, deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`);
const insertLegacy = legacy.prepare(`INSERT INTO users
  (id, phone, name, role, status, login_enabled, deleted, created_at, updated_at)
  VALUES (?, ?, ?, ?, 1, 1, 0, ?, ?)`);
const oldNow = '2026-01-01T00:00:00.000Z';
[
  ['miniapp-admin-13732250653', '13732250653', 'fixed super admin', 'admin'],
  ['super-duplicate', '137-3225-0653', 'duplicate fixed phone', 'admin'],
  ['admin', '18257136756', 'regular admin', 'admin'],
  ['student', '13000000001', 'student', 'student'],
  ['teacher-unique', '13000000002', 'unique teacher', 'teacher'],
  ['teacher-none', '13000000003', 'missing teacher', 'teacher'],
  ['invited', '13000000004', 'invited', 'invited'],
  ['invitee', '13000000005', 'invitee', 'invitee'],
  ['unknown', '13000000006', 'unknown', 'owner'],
  ['review-admin', '13000000007', 'review admin', 'pending'],
  ['review-student', '13000000008', 'review student', 'pending'],
  ['review-teacher', '13000000009', 'review teacher', 'pending'],
  ['teacher-duplicate', '13000000010', 'duplicate teacher', 'pending'],
  ['teacher-empty', '', 'empty phone teacher', 'pending'],
].forEach(row => insertLegacy.run(...row, oldNow, oldNow));
legacy.prepare(`INSERT INTO students
  (id, name, phone, deleted, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`)
  .run('s-legacy-valid', 'legacy student', '13000000001', oldNow, oldNow);
legacy.prepare('UPDATE users SET student_id = ? WHERE id = ?').run('s-legacy-valid', 'student');
const insertLegacyTeacher = legacy.prepare(`INSERT INTO teachers
  (id, name, phone, deleted, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`);
insertLegacyTeacher.run('t-super-self', 'canonical super admin teacher profile', '13732250653', oldNow, oldNow);
insertLegacyTeacher.run('t-unique-old', 'unique legacy teacher', '13000000002', oldNow, oldNow);
insertLegacyTeacher.run('t-review', 'review teacher', '13000000009', oldNow, oldNow);
insertLegacyTeacher.run('t-duplicate-1', 'duplicate one', '13000000010', oldNow, oldNow);
insertLegacyTeacher.run('t-duplicate-2', 'duplicate two', '13000000010', oldNow, oldNow);
legacy.close();

process.env.DB_PATH = dbPath;
process.env.READ_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';

try {
  const service = new DatabaseService();
  assert.strictEqual(service.getSchemaStatus().schemaVersion, 3110);
  assert.strictEqual(service.getSchemaStatus().sqliteUserVersion, 3110);
  const columns = service.db.prepare('PRAGMA table_info(users)').all().map(row => row.name);
  ['teacher_id', 'review_status', 'reviewed_by', 'reviewed_at'].forEach(column => {
    assert.ok(columns.includes(column), `users should include ${column}`);
  });
  ['authorization_audit_log', 'sync_rejections', 'user_role_grants'].forEach(table => {
    assert.ok(service.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  });

  const now = '2026-07-11T12:00:00.000Z';
  assert.ok(service.db.prepare(
    "SELECT 1 FROM authorization_migrations WHERE name = 'legacy-users-v1'"
  ).get());

  const migrated = Object.fromEntries(service.db.prepare(
    'SELECT id, role, review_status, teacher_id FROM users'
  ).all().map(row => [row.id, row]));
  assert.deepStrictEqual(
    [migrated['miniapp-admin-13732250653'].role, migrated['miniapp-admin-13732250653'].review_status,
      migrated['miniapp-admin-13732250653'].teacher_id],
    ['super_admin', 'approved', 't-super-self'],
    'the canonical super administrator may also retain one unique teacher binding'
  );
  assert.deepStrictEqual(
    [migrated['super-duplicate'].role, migrated['super-duplicate'].review_status],
    ['pending', 'pending']
  );
  assert.strictEqual(
    service.db.prepare('SELECT phone FROM users WHERE id = ?').get('miniapp-admin-13732250653').phone,
    '13732250653'
  );
  const duplicateContext = service.getAuthorizationContextByUserId('super-duplicate');
  assert.strictEqual(duplicateContext.role, 'pending');
  assert.deepStrictEqual(duplicateContext.scope, { kind: 'none' });
  const canonicalContext = service.getAuthorizationContextByUserId('miniapp-admin-13732250653');
  assert.strictEqual(canonicalContext.role, 'super_admin');
  assert.deepStrictEqual(canonicalContext.scope, { kind: 'all' });
  assert.deepStrictEqual(
    service.db.prepare(
      'SELECT role, subject_type, subject_id, status FROM user_role_grants WHERE user_id=? ORDER BY role'
    ).all('miniapp-admin-13732250653'),
    [
      { role: 'super_admin', subject_type: null, subject_id: null, status: 'active' },
      { role: 'teacher', subject_type: 'teacher', subject_id: 't-super-self', status: 'active' },
    ],
    'the canonical human identity must persist both administrator and teacher grants'
  );
  assert.deepStrictEqual(
    service.db.prepare(
      'SELECT role, subject_type, subject_id FROM user_role_grants WHERE user_id=? ORDER BY role'
    ).all('teacher-unique'),
    [{ role: 'teacher', subject_type: 'teacher', subject_id: 't-unique-old' }]
  );
  assert.deepStrictEqual(
    service.db.prepare('SELECT role FROM user_role_grants WHERE user_id=?').all('super-duplicate'),
    [],
    'a non-canonical fixed-phone account must not receive a super-admin grant'
  );
  assert.deepStrictEqual([migrated.admin.role, migrated.admin.review_status], ['admin', 'approved']);
  assert.deepStrictEqual([migrated.student.role, migrated.student.review_status], ['student', 'approved']);
  assert.deepStrictEqual(
    [migrated['teacher-unique'].role, migrated['teacher-unique'].review_status, migrated['teacher-unique'].teacher_id],
    ['teacher', 'approved', 't-unique-old']
  );
  assert.deepStrictEqual(
    [migrated['teacher-none'].role, migrated['teacher-none'].review_status, migrated['teacher-none'].teacher_id],
    ['pending', 'pending', null]
  );
  ['invited', 'invitee', 'unknown'].forEach(id => {
    assert.strictEqual(migrated[id].role, 'pending');
    assert.strictEqual(migrated[id].review_status, 'pending');
  });

  assert.throws(
    () => service.reviewUser({ actorPhone: '18257136756', userId: 'review-admin', role: 'admin' }),
    error => error && error.code === 'SUPER_ADMIN_REQUIRED'
  );
  assert.strictEqual(service.reviewUser({ actorPhone: '13732250653', userId: 'review-admin', role: 'admin' }).role, 'admin');
  assert.strictEqual(service.reviewUser({ actorPhone: '13732250653', userId: 'review-student', role: 'student' }).role, 'student');
  const approvedTeacher = service.reviewUser({ actorPhone: '13732250653', userId: 'review-teacher', role: 'teacher' });
  assert.strictEqual(approvedTeacher.teacher_id, 't-review');
  assert.strictEqual(approvedTeacher.review_status, 'approved');

  for (const [userId, code] of [
    ['teacher-none', 'TEACHER_NOT_FOUND'],
    ['teacher-duplicate', 'TEACHER_PHONE_NOT_UNIQUE'],
    ['teacher-empty', 'TEACHER_NOT_FOUND'],
  ]) {
    assert.throws(
      () => service.reviewUser({ actorPhone: '13732250653', userId, role: 'teacher' }),
      error => error && error.code === code
    );
    const pending = service.db.prepare('SELECT role, review_status, teacher_id FROM users WHERE id = ?').get(userId);
    assert.deepStrictEqual([pending.role, pending.review_status, pending.teacher_id], ['pending', 'pending', null]);
  }
  assert.throws(
    () => service.reviewUser({ actorPhone: '13732250653', userId: 'miniapp-admin-13732250653', role: 'student' }),
    error => error && error.code === 'SUPER_ADMIN_IMMUTABLE'
  );
  assert.throws(
    () => service.disableAuthorizationUser({ actorPhone: '18257136756', userId: 'review-student' }),
    error => error && error.code === 'SUPER_ADMIN_REQUIRED'
  );
  const disabledAuthorizationUser = service.disableAuthorizationUser({ actorPhone: '13732250653', userId: 'review-student' });
  assert.deepStrictEqual([disabledAuthorizationUser.status, disabledAuthorizationUser.login_enabled], [0, 0]);
  assert.strictEqual(
    service.db.prepare("SELECT action FROM authorization_audit_log WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 1").get('review-student').action,
    'disable_user'
  );
  assert.throws(
    () => service.disableAuthorizationUser({ actorPhone: '13732250653', userId: 'missing-user' }),
    error => error && error.code === 'AUTHORIZATION_USER_NOT_FOUND'
  );
  assert.throws(
    () => service.disableAuthorizationUser({ actorPhone: '13732250653', userId: 'miniapp-admin-13732250653' }),
    error => error && error.code === 'SUPER_ADMIN_IMMUTABLE'
  );

  for (const assignment of [
    "status = 0",
    "review_status = 'pending'",
  ]) {
    service.db.prepare(`UPDATE users SET ${assignment} WHERE id = ?`).run('miniapp-admin-13732250653');
    assert.throws(
      () => service.reviewUser({ actorPhone: '13732250653', userId: 'review-admin', role: 'admin' }),
      error => error && error.code === 'SUPER_ADMIN_REQUIRED'
    );
    service.db.prepare(
      "UPDATE users SET status = 1, login_enabled = 1, review_status = 'approved' WHERE id = ?"
    ).run('miniapp-admin-13732250653');
  }

  assert.deepStrictEqual(
    service.listAuthorizationUsers({ status: 'approved', role: 'admin', search: 'review' }).items.map(row => row.id),
    ['review-admin']
  );
  const context = service.getAuthorizationContextByUserId('review-teacher', { id: 'device-1', name: 'test device' });
  assert.strictEqual(context.role, 'teacher');
  assert.strictEqual(context.teacherId, 't-review');
  assert.strictEqual(context.scope.kind, 'teacher');
  assert.deepStrictEqual(context.device, { id: 'device-1', name: 'test device', trusted: false });
  const untrustedContext = service.getAuthorizationContextByUserId('review-teacher', {
    id: 'device-2', name: 'caller device', trusted: true, isPrimaryHost: true, role: 'host',
  });
  assert.deepStrictEqual(untrustedContext.device, { id: 'device-2', name: 'caller device', trusted: false });

  const audits = service.db.prepare(
    'SELECT actor_phone, target_user_id, before_json, after_json FROM authorization_audit_log'
  ).all();
  assert.ok(audits.some(row => row.actor_phone === '13732250653' && row.target_user_id === 'review-teacher'));
  assert.ok(audits.every(row => JSON.parse(row.before_json) && JSON.parse(row.after_json)));
  const stringAudit = service.recordAuthorizationAudit({
    id: 'audit-json-string', action: 'json_test', before_json: '{"state":"before"}', after_json: '{"state":"after"}',
  });
  assert.deepStrictEqual(JSON.parse(stringAudit.before_json), { state: 'before' });
  assert.deepStrictEqual(JSON.parse(stringAudit.after_json), { state: 'after' });

  const rejection = service.recordSyncRejection({
    id: 'rejection-1', operationId: 'operation-1', actorUserId: 'review-teacher', actorTeacherId: 't-review',
    sourceDeviceId: 'device-1', tableName: 'schedules', recordId: 'schedule-1',
    reasonCode: 'TEACHER_SCOPE_DENIED', payload: { teacher_id: 'other-teacher' }, createdAt: now,
  });
  assert.strictEqual(rejection.reason_code, 'TEACHER_SCOPE_DENIED');
  const stored = service.db.prepare('SELECT * FROM sync_rejections WHERE id = ?').get('rejection-1');
  assert.deepStrictEqual(
    [stored.operation_id, stored.actor_user_id, stored.actor_teacher_id, stored.source_device_id,
      stored.table_name, stored.record_id, stored.reason_code, JSON.parse(stored.payload_json), stored.created_at],
    ['operation-1', 'review-teacher', 't-review', 'device-1', 'schedules', 'schedule-1',
      'TEACHER_SCOPE_DENIED', { teacher_id: 'other-teacher' }, now]
  );
  const stringRejection = service.recordSyncRejection({
    id: 'rejection-json-string', reasonCode: 'JSON_TEST', payload_json: '{"safe":true}',
  });
  assert.deepStrictEqual(JSON.parse(stringRejection.payload_json), { safe: true });

  service.db.prepare(
    "UPDATE users SET role = 'pending', review_status = 'rejected', teacher_id = NULL WHERE id = 'review-admin'"
  ).run();
  service.db.prepare(
    "UPDATE users SET role = 'teacher', review_status = 'rejected', teacher_id = 'manual-binding' WHERE id = 'review-teacher'"
  ).run();
  service.db.prepare(
    "UPDATE users SET role = 'pending', review_status = 'pending', status = 0, login_enabled = 0, teacher_id = NULL WHERE id = ?"
  ).run('miniapp-admin-13732250653');
  service.db.prepare(
    "DELETE FROM user_role_grants WHERE user_id = ? AND role = 'teacher'"
  ).run('miniapp-admin-13732250653');
  service.close();
  const restarted = new DatabaseService();
  const preserved = restarted.db.prepare(
    "SELECT role, review_status, teacher_id FROM users WHERE id = 'review-admin'"
  ).get();
  assert.deepStrictEqual(
    [preserved.role, preserved.review_status, preserved.teacher_id],
    ['pending', 'rejected', null],
    'restart must not re-run legacy authorization migration'
  );
  const preservedTeacher = restarted.db.prepare(
    "SELECT role, review_status, teacher_id FROM users WHERE id = 'review-teacher'"
  ).get();
  assert.deepStrictEqual(
    [preservedTeacher.role, preservedTeacher.review_status, preservedTeacher.teacher_id],
    ['teacher', 'rejected', 'manual-binding'],
    'restart must preserve a post-migration review decision and teacher binding'
  );
  const restoredCanonical = restarted.db.prepare(
    'SELECT role, review_status, status, login_enabled, deleted, teacher_id FROM users WHERE id = ?'
  ).get('miniapp-admin-13732250653');
  assert.deepStrictEqual(
    [restoredCanonical.role, restoredCanonical.review_status, restoredCanonical.status,
      restoredCanonical.login_enabled, restoredCanonical.deleted, restoredCanonical.teacher_id],
    ['super_admin', 'approved', 1, 1, 0, 't-super-self'],
    'restart must restore the canonical super-admin invariant without deleting its teacher identity'
  );
  assert.deepStrictEqual(
    restarted.db.prepare(
      "SELECT subject_id, status FROM user_role_grants WHERE user_id = ? AND role = 'teacher'"
    ).get('miniapp-admin-13732250653'),
    { subject_id: 't-super-self', status: 'active' },
    'an upgraded host must reconstruct the canonical teacher grant after the old build cleared teacher_id'
  );
  restarted.db.prepare("UPDATE users SET phone = '13000000999' WHERE id = ?")
    .run('miniapp-admin-13732250653');
  restarted.db.prepare("UPDATE users SET phone = ? WHERE id = 'admin'").run('13732250653');
  assert.throws(
    () => restarted.reviewUser({ actorPhone: '13732250653', userId: 'review-admin', role: 'admin' }),
    error => error && error.code === 'SUPER_ADMIN_IDENTITY_CONFLICT'
  );
  restarted.close();

  const legacyIdentityWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-legacy-super-'));
  process.env.DB_PATH = path.join(legacyIdentityWorkspace, 'scheduling.db');
  process.env.READ_DB_PATH = process.env.DB_PATH;
  const legacyIdentityDb = new Database(process.env.DB_PATH);
  legacyIdentityDb.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, phone TEXT, name TEXT, nickname TEXT, role TEXT,
    status INTEGER DEFAULT 1, login_enabled INTEGER DEFAULT 0, student_id TEXT,
    linked_student_ids TEXT, deleted INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  const insertLegacyIdentityUser = legacyIdentityDb.prepare(`INSERT INTO users
    (id, phone, name, role, status, login_enabled, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, 0, ?, ?)`);
  insertLegacyIdentityUser.run('legacy-super', '137 3225 0653', 'legacy super', 'admin', oldNow, oldNow);
  insertLegacyIdentityUser.run('legacy-review-target', '13000000111', 'legacy target', 'pending', oldNow, oldNow);
  legacyIdentityDb.close();

  const legacyIdentityService = new DatabaseService();
  const legacyIdentity = legacyIdentityService.db.prepare(
    'SELECT id, phone, role, review_status, status, login_enabled, is_super_admin_identity FROM users WHERE id = ?'
  ).get('legacy-super');
  assert.deepStrictEqual(
    [legacyIdentity.phone, legacyIdentity.role, legacyIdentity.review_status, legacyIdentity.status,
      legacyIdentity.login_enabled, legacyIdentity.is_super_admin_identity],
    ['13732250653', 'super_admin', 'approved', 1, 1, 1]
  );
  const legacyContext = legacyIdentityService.getAuthorizationContextByUserId('legacy-super');
  assert.strictEqual(legacyContext.role, 'super_admin');
  assert.deepStrictEqual(legacyContext.scope, { kind: 'all' });
  assert.strictEqual(legacyIdentityService.reviewUser({
    actorPhone: '13732250653', userId: 'legacy-review-target', role: 'student',
  }).role, 'student');
  assert.throws(
    () => legacyIdentityService.db.prepare(
      'UPDATE users SET is_super_admin_identity = 1 WHERE id = ?'
    ).run('legacy-review-target'),
    error => error && error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
  legacyIdentityService.close();

  const legacyRestarted = new DatabaseService();
  const legacyRestartedContext = legacyRestarted.getAuthorizationContextByUserId('legacy-super');
  assert.strictEqual(legacyRestartedContext.role, 'super_admin');
  assert.deepStrictEqual(legacyRestartedContext.scope, { kind: 'all' });
  assert.strictEqual(legacyRestarted.db.prepare(
    'SELECT COUNT(*) AS count FROM users WHERE is_super_admin_identity = 1'
  ).get().count, 1);
  legacyRestarted.close();

  function createFlagConflictDatabase(name, rows) {
    const conflictWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
    const conflictPath = path.join(conflictWorkspace, 'scheduling.db');
    const conflictDb = new Database(conflictPath);
    conflictDb.exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY, phone TEXT, name TEXT, nickname TEXT, role TEXT,
      status INTEGER DEFAULT 1, login_enabled INTEGER DEFAULT 1, student_id TEXT,
      linked_student_ids TEXT, teacher_id TEXT, review_status TEXT DEFAULT 'approved',
      reviewed_by TEXT, reviewed_at TEXT, is_super_admin_identity INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    const insert = conflictDb.prepare(`INSERT INTO users
      (id, phone, name, role, status, login_enabled, review_status, is_super_admin_identity,
       deleted, created_at, updated_at) VALUES (?, ?, ?, 'super_admin', 1, 1, 'approved', 1, 0, ?, ?)`);
    rows.forEach(row => insert.run(row.id, row.phone, row.id, oldNow, oldNow));
    conflictDb.close();
    return conflictPath;
  }

  process.env.DB_PATH = createFlagConflictDatabase('gewu-canonical-flag-conflict', [
    { id: 'miniapp-admin-13732250653', phone: '13732250653' },
    { id: 'canonical-duplicate', phone: '137-3225-0653' },
  ]);
  process.env.READ_DB_PATH = process.env.DB_PATH;
  const canonicalConflictService = new DatabaseService();
  assert.deepStrictEqual(
    canonicalConflictService.db.prepare(
      'SELECT id FROM users WHERE is_super_admin_identity = 1 ORDER BY id'
    ).all().map(row => row.id),
    ['miniapp-admin-13732250653']
  );
  assert.throws(
    () => canonicalConflictService.db.prepare(
      'UPDATE users SET is_super_admin_identity = 1 WHERE id = ?'
    ).run('canonical-duplicate'),
    error => error && error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
  canonicalConflictService.close();

  process.env.DB_PATH = createFlagConflictDatabase('gewu-ambiguous-flag-conflict', [
    { id: 'legacy-fixed-a', phone: '13732250653' },
    { id: 'legacy-fixed-b', phone: '137 3225 0653' },
  ]);
  process.env.READ_DB_PATH = process.env.DB_PATH;
  const ambiguousConflictService = new DatabaseService();
  const ambiguousRows = ambiguousConflictService.db.prepare(
    'SELECT role, review_status, login_enabled, is_super_admin_identity FROM users WHERE phone = ? ORDER BY id'
  ).all('13732250653');
  assert.strictEqual(ambiguousRows.length, 2);
  ambiguousRows.forEach(row => {
    assert.deepStrictEqual(
      [row.role, row.review_status, row.login_enabled, row.is_super_admin_identity],
      ['pending', 'pending', 0, 0]
    );
  });
  assert.throws(
    () => ambiguousConflictService.reviewUser({
      actorPhone: '13732250653', userId: 'legacy-fixed-a', role: 'admin',
    }),
    error => error && error.code === 'SUPER_ADMIN_IDENTITY_CONFLICT'
  );
  ambiguousConflictService.db.prepare(
    'UPDATE users SET is_super_admin_identity = 1 WHERE id = ?'
  ).run('legacy-fixed-a');
  assert.throws(
    () => ambiguousConflictService.db.prepare(
      'UPDATE users SET is_super_admin_identity = 1 WHERE id = ?'
    ).run('legacy-fixed-b'),
    error => error && error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
  ambiguousConflictService.close();
  console.log('database authorization checks passed');
} finally {
  if (previous.db === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previous.db;
  if (previous.read === undefined) delete process.env.READ_DB_PATH; else process.env.READ_DB_PATH = previous.read;
  if (previous.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.env;
}
