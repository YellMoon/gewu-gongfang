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
const insertLegacyTeacher = legacy.prepare(`INSERT INTO teachers
  (id, name, phone, deleted, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`);
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
  const columns = service.db.prepare('PRAGMA table_info(users)').all().map(row => row.name);
  ['teacher_id', 'review_status', 'reviewed_by', 'reviewed_at'].forEach(column => {
    assert.ok(columns.includes(column), `users should include ${column}`);
  });
  ['authorization_audit_log', 'sync_rejections'].forEach(table => {
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
    [migrated['miniapp-admin-13732250653'].role, migrated['miniapp-admin-13732250653'].review_status],
    ['super_admin', 'approved']
  );
  assert.deepStrictEqual(
    [migrated['super-duplicate'].role, migrated['super-duplicate'].review_status],
    ['pending', 'pending']
  );
  assert.strictEqual(
    service.db.prepare('SELECT phone FROM users WHERE id = ?').get('miniapp-admin-13732250653').phone,
    '13732250653'
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
    service.listAuthorizationUsers({ status: 'approved', role: 'admin', search: 'review' }).map(row => row.id),
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
  restarted.db.prepare("UPDATE users SET phone = '13000000999' WHERE id = ?")
    .run('miniapp-admin-13732250653');
  restarted.db.prepare("UPDATE users SET phone = ? WHERE id = 'admin'").run('13732250653');
  assert.throws(
    () => restarted.reviewUser({ actorPhone: '13732250653', userId: 'review-admin', role: 'admin' }),
    error => error && error.code === 'SUPER_ADMIN_IDENTITY_CONFLICT'
  );
  restarted.close();
  console.log('database authorization checks passed');
} finally {
  if (previous.db === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previous.db;
  if (previous.read === undefined) delete process.env.READ_DB_PATH; else process.env.READ_DB_PATH = previous.read;
  if (previous.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.env;
}
