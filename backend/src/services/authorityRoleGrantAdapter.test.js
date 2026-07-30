const assert = require('assert');
const Database = require('better-sqlite3');
const {
  listCanonicalAuthorityRoleGrants,
  resolveCanonicalAuthorityRoleContext,
} = require('./authorityRoleGrantAdapter');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE authority_accounts (
    user_id TEXT NOT NULL,
    authority_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (authority_id, user_id)
  );
  CREATE TABLE authority_role_bindings (
    binding_id TEXT PRIMARY KEY,
    authority_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    subject_type TEXT,
    subject_id TEXT,
    status TEXT NOT NULL,
    grant_version INTEGER NOT NULL,
    granted_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT
  );
`);

const now = '2026-07-30T10:00:00.000Z';
db.prepare(`INSERT INTO authority_accounts
  (user_id,authority_id,status,created_at,updated_at) VALUES(?,?,?,?,?)`)
  .run('immutable-user-1', 'authority-1', 'active', now, now);

const visitor = resolveCanonicalAuthorityRoleContext(db, {
  authorityId: 'authority-1',
  userId: 'immutable-user-1',
});
assert.deepStrictEqual(visitor, {
  authorityId: 'authority-1',
  userId: 'immutable-user-1',
  accountStatus: 'active',
  roles: ['visitor'],
  grants: [],
}, 'visitor must be a derived role when the active authority account has no formal grant');

db.prepare(`INSERT INTO authority_role_bindings
  (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,granted_by,created_at,updated_at,revoked_at)
  VALUES(?,?,?,?,?,?,?,1,?,?,?,NULL)`)
  .run('teacher-grant', 'authority-1', 'immutable-user-1', 'teacher', 'teacher', 'teacher-profile-1', 'active', 'host-super-1', now, now);
db.prepare(`INSERT INTO authority_role_bindings
  (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,granted_by,created_at,updated_at,revoked_at)
  VALUES(?,?,?,?,?,?,?,1,?,?,?,NULL)`)
  .run('student-grant', 'authority-1', 'immutable-user-1', 'student', 'student', 'student-profile-1', 'active', 'host-super-1', now, now);
db.prepare(`INSERT INTO authority_role_bindings
  (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,granted_by,created_at,updated_at,revoked_at)
  VALUES(?,?,?,?,?,?,?,1,?,?,?,NULL)`)
  .run('legacy-grant', 'authority-1', 'immutable-user-1', 'admin', null, null, 'revoked', 'host-super-1', now, now);

const grants = listCanonicalAuthorityRoleGrants(db, {
  authorityId: 'authority-1',
  userId: 'immutable-user-1',
});
assert.deepStrictEqual(
  grants.map(grant => [grant.role, grant.subjectId]),
  [['teacher', 'teacher-profile-1'], ['student', 'student-profile-1']],
  'canonical authority grants must be additive and must not read revoked or legacy grants'
);
assert.deepStrictEqual(
  resolveCanonicalAuthorityRoleContext(db, { authorityId: 'authority-1', userId: 'immutable-user-1' }).roles,
  ['teacher', 'student'],
  'a formal grant must replace derived visitor without changing the immutable user id'
);
assert.throws(
  () => resolveCanonicalAuthorityRoleContext(db, { authorityId: 'authority-1', userId: '' }),
  error => error.code === 'AUTHORITY_ROLE_USER_REQUIRED'
);

const duplicateDb = new Database(':memory:');
duplicateDb.exec(`
  CREATE TABLE authority_accounts (
    user_id TEXT NOT NULL, authority_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE authority_role_bindings (
    binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL,
    grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, revoked_at TEXT
  );
  INSERT INTO authority_accounts VALUES ('duplicate-user','authority-1','active','2026-07-30T10:00:00.000Z','2026-07-30T10:00:00.000Z');
  INSERT INTO authority_role_bindings VALUES
    ('duplicate-1','authority-1','duplicate-user','teacher','teacher','teacher-1','active',1,NULL,'2026-07-30T10:00:00.000Z','2026-07-30T10:00:00.000Z',NULL),
    ('duplicate-2','authority-1','duplicate-user','teacher','teacher','teacher-2','active',1,NULL,'2026-07-30T10:00:00.000Z','2026-07-30T10:00:00.000Z',NULL);
`);
assert.throws(
  () => resolveCanonicalAuthorityRoleContext(duplicateDb, { authorityId: 'authority-1', userId: 'duplicate-user' }),
  error => error.code === 'AUTHORITY_ROLE_BINDING_DUPLICATE',
  'canonical role resolution must never silently choose between duplicate active bindings',
);
duplicateDb.close();

console.log('authorityRoleGrantAdapter tests passed');
