const assert = require('assert');
const Database = require('better-sqlite3');
const {
  assertActiveRole,
  ensureCompatibilityRoleGrants,
  listUserRoleGrants,
  roleContextForUser,
  resolveUserRoleContext,
} = require('./userRoleGrantService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      phone TEXT,
      role TEXT,
      status INTEGER NOT NULL DEFAULT 1,
      login_enabled INTEGER NOT NULL DEFAULT 1,
      review_status TEXT NOT NULL DEFAULT 'approved',
      deleted INTEGER NOT NULL DEFAULT 0,
      is_super_admin_identity INTEGER NOT NULL DEFAULT 0,
      teacher_id TEXT,
      student_id TEXT
    );
    CREATE TABLE teachers (
      id TEXT PRIMARY KEY,
      phone TEXT,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE user_role_grants (
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      subject_type TEXT,
      subject_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL,
      granted_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revoked_at TEXT,
      PRIMARY KEY (user_id, role)
    );
    CREATE UNIQUE INDEX idx_test_teacher_subject
      ON user_role_grants(subject_id)
      WHERE role = 'teacher' AND status = 'active';
  `);
  return db;
}

const now = '2026-07-17T00:00:00.000Z';
const canonicalId = 'miniapp-admin-13732250653';
const db = createDb();
db.prepare('INSERT INTO teachers (id, phone, deleted) VALUES (?, ?, 0)')
  .run('teacher-self', '13732250653');
db.prepare(`INSERT INTO users
  (id, phone, role, status, login_enabled, review_status, deleted,
   is_super_admin_identity, teacher_id)
  VALUES (?, ?, 'super_admin', 1, 1, 'approved', 0, 1, ?)`)
  .run(canonicalId, '13732250653', 'teacher-self');

assert.deepStrictEqual(
  ensureCompatibilityRoleGrants(db, { now }),
  { inserted: 2, reactivated: 0, unchanged: 0 }
);
assert.deepStrictEqual(
  ensureCompatibilityRoleGrants(db, { now }),
  { inserted: 0, reactivated: 0, unchanged: 2 },
  'compatibility migration must be idempotent'
);

const grants = listUserRoleGrants(db, canonicalId);
assert.deepStrictEqual(grants.map(function (grant) { return grant.role; }), ['super_admin', 'teacher']);
assert.strictEqual(
  grants.find(function (grant) { return grant.role === 'teacher'; }).subject_id,
  'teacher-self'
);
assert.deepStrictEqual(resolveUserRoleContext(db, canonicalId), {
  userId: canonicalId,
  activeRole: 'teacher',
  eligibleRoles: ['super_admin', 'teacher'],
  teacherId: 'teacher-self',
  studentId: null,
});
assert.deepStrictEqual(assertActiveRole(db, db.prepare('SELECT * FROM users WHERE id=?').get(canonicalId)), {
  activeRole: 'teacher',
  eligibleRoles: ['super_admin', 'teacher'],
  teacherId: 'teacher-self',
  studentId: null,
});
assert.ok(Object.isFrozen(assertActiveRole(
  db,
  db.prepare('SELECT * FROM users WHERE id=?').get(canonicalId),
  'super_admin'
)));
assert.deepStrictEqual(roleContextForUser(db, canonicalId), resolveUserRoleContext(db, canonicalId));
assert.deepStrictEqual(resolveUserRoleContext(db, canonicalId, 'super_admin'), {
  userId: canonicalId,
  activeRole: 'super_admin',
  eligibleRoles: ['super_admin', 'teacher'],
  teacherId: null,
  studentId: null,
});
assert.throws(
  function () { resolveUserRoleContext(db, canonicalId, 'student'); },
  function (error) { return error && error.code === 'ACTIVE_ROLE_NOT_GRANTED'; }
);

db.prepare(`INSERT INTO users
  (id, phone, role, status, login_enabled, review_status, deleted, student_id)
  VALUES ('review-demo:sample', '13000000000', 'student', 1, 1, 'approved', 0, NULL)`).run();
assert.deepStrictEqual(
  ensureCompatibilityRoleGrants(db, { now }),
  { inserted: 0, reactivated: 0, unchanged: 2 },
  'synthetic review-demo identities must not receive formal role grants'
);
assert.deepStrictEqual(listUserRoleGrants(db, 'review-demo:sample'), []);

db.prepare(`INSERT INTO users
  (id, phone, role, status, login_enabled, review_status, deleted, teacher_id)
  VALUES ('invalid-teacher', '13000000001', 'teacher', 1, 1, 'approved', 0, 'missing')`).run();
assert.throws(
  function () { ensureCompatibilityRoleGrants(db, { now }); },
  function (error) { return error && error.code === 'TEACHER_ROLE_SUBJECT_INVALID'; },
  'a teacher grant must reference an existing active teacher profile'
);
db.prepare("UPDATE users SET role='pending', review_status='pending', login_enabled=0 WHERE id='invalid-teacher'").run();

db.prepare(`INSERT INTO users
  (id, phone, role, status, login_enabled, review_status, deleted, teacher_id)
  VALUES ('other-teacher-user', '13000000002', 'teacher', 1, 1, 'approved', 0, 'teacher-self')`).run();
assert.throws(
  function () { ensureCompatibilityRoleGrants(db, { now }); },
  function (error) { return error && error.code === 'TEACHER_ROLE_SUBJECT_CONFLICT'; },
  'one teacher business profile cannot be granted to two human identities'
);
db.prepare("UPDATE users SET role='pending', review_status='pending', login_enabled=0 WHERE id='other-teacher-user'").run();
db.prepare(`UPDATE user_role_grants
  SET status='revoked', revoked_at=?, updated_at=?
  WHERE user_id=? AND role='teacher'`).run(now, now, canonicalId);
assert.deepStrictEqual(
  ensureCompatibilityRoleGrants(db, { now }),
  { inserted: 0, reactivated: 0, unchanged: 2 },
  'compatibility startup must preserve an explicit role revocation'
);
assert.deepStrictEqual(
  db.prepare('SELECT status, revoked_at FROM user_role_grants WHERE user_id=? AND role=?')
    .get(canonicalId, 'teacher'),
  { status: 'revoked', revoked_at: now }
);

db.close();
console.log('user role grant service tests passed');
