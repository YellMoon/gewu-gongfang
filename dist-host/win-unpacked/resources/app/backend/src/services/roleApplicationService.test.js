const assert = require('assert');
const Database = require('better-sqlite3');
const { createRoleApplicationService } = require('./roleApplicationService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE students (id TEXT PRIMARY KEY, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE teachers (id TEXT PRIMARY KEY, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE authority_accounts (
    user_id TEXT NOT NULL, authority_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (authority_id, user_id)
  );
  CREATE TABLE authority_role_applications (
    application_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    requested_role TEXT NOT NULL, binding_hint TEXT, status TEXT NOT NULL,
    reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_authority_role_applications_pending
    ON authority_role_applications(authority_id,user_id,requested_role)
    WHERE status='pending';
  CREATE TABLE authority_role_bindings (
    binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL,
    grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE UNIQUE INDEX idx_authority_role_bindings_active
    ON authority_role_bindings(authority_id,user_id,role) WHERE status='active';
  CREATE TABLE authorization_audit_log (
    id TEXT PRIMARY KEY, actor_user_id TEXT, actor_phone TEXT, target_user_id TEXT, action TEXT NOT NULL,
    before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
  );
`);
const now = '2026-07-28T08:00:00.000Z';
for (const userId of ['user-1', 'user-2', 'user-3', 'super-1', 'admin-1']) {
  db.prepare('INSERT INTO users(id,name) VALUES(?,?)').run(userId, `User ${userId}`);
  db.prepare(`INSERT INTO authority_accounts
    (user_id,authority_id,status,created_at,updated_at) VALUES(?,?,?,?,?)`)
    .run(userId, 'authority-1', 'active', now, now);
}
for (const studentId of ['student-1', 'student-2']) {
  db.prepare('INSERT INTO students(id,deleted) VALUES(?,0)').run(studentId);
}
for (const teacherId of ['teacher-1', 'teacher-2']) {
  db.prepare('INSERT INTO teachers(id,deleted) VALUES(?,0)').run(teacherId);
}

let sequence = 0;
const service = createRoleApplicationService({
  db,
  now: () => now,
  createId: prefix => `${prefix}-${++sequence}`,
});

const businessSubjectCountsBefore = {
  students: db.prepare('SELECT COUNT(*) AS count FROM students').get().count,
  teachers: db.prepare('SELECT COUNT(*) AS count FROM teachers').get().count,
};
const unboundPending = service.submit({
  authorityId: 'authority-1',
  userId: 'user-3',
  requestedRole: 'teacher',
});
assert.equal(unboundPending.status, 'pending');
assert.equal(unboundPending.bindingHint, null);
const unboundApproved = service.approve({
  actor: { userId: 'super-1', roles: ['super_admin'], authorityId: 'authority-1', isAuthorityHost: true },
  applicationId: unboundPending.applicationId,
});
assert.equal(unboundApproved.grant.role, 'teacher');
assert.equal(unboundApproved.grant.subjectType, null);
assert.equal(unboundApproved.grant.subjectId, null);
assert.deepStrictEqual({
  students: db.prepare('SELECT COUNT(*) AS count FROM students').get().count,
  teachers: db.prepare('SELECT COUNT(*) AS count FROM teachers').get().count,
}, businessSubjectCountsBefore, 'approving an unbound account role must not create a local business subject');
assert.throws(
  () => service.submit({
    authorityId: 'authority-1', userId: 'user-1', requestedRole: 'teacher', bindingHint: 'teacher-missing',
  }),
  error => error.code === 'ROLE_APPLICATION_BINDING_PROFILE_NOT_FOUND',
  'a binding hint cannot name a missing teacher profile'
);

const immutableUsersBefore = db.prepare('SELECT id FROM users ORDER BY id').all();
const pending = service.submit({
  authorityId: 'authority-1',
  userId: 'user-1',
  requestedRole: 'teacher',
  bindingHint: 'teacher-1',
});
assert.equal(pending.status, 'pending');
assert.equal(pending.bindingHint, 'teacher-1');
assert.deepStrictEqual(
  db.prepare('SELECT id FROM users ORDER BY id').all(),
  immutableUsersBefore,
  'role applications must never replace or mutate the immutable user id'
);
assert.throws(
  () => service.submit({ authorityId: 'authority-1', userId: 'user-1', requestedRole: 'admin' }),
  error => error.code === 'ROLE_APPLICATION_FORBIDDEN'
);
assert.throws(
  () => service.approve({
    actor: { userId: 'user-2', roles: ['admin'] },
    applicationId: pending.applicationId,
  }),
  error => error.code === 'ROLE_APPLICATION_REVIEW_FORBIDDEN'
);
assert.throws(
  () => service.approve({
    actor: { userId: 'super-1', roles: ['super_admin'] },
    applicationId: pending.applicationId,
  }),
  error => error.code === 'ROLE_APPLICATION_HOST_REVIEW_REQUIRED',
  'super admin approval must originate from the authority host runtime'
);

const approved = service.approve({
  actor: { userId: 'super-1', roles: ['super_admin'], authorityId: 'authority-1', isAuthorityHost: true },
  applicationId: pending.applicationId,
});
assert.equal(approved.application.status, 'approved');
assert.equal(approved.grant.role, 'teacher');
assert.equal(approved.grant.subjectId, 'teacher-1', 'approved formal grant retains the reviewed teacher profile');
assert.equal(
  db.prepare("SELECT COUNT(*) AS count FROM authority_role_bindings WHERE user_id='user-1' AND status='active'").get().count,
  1
);

assert.throws(
  () => service.submit({
    authorityId: 'authority-1', userId: 'user-2', requestedRole: 'teacher', bindingHint: 'teacher-1',
  }),
  error => error.code === 'ROLE_APPLICATION_BINDING_ALREADY_CLAIMED',
  'one active authority role/profile binding cannot be claimed by two user ids'
);

const studentPending = service.submit({
  authorityId: 'authority-1',
  userId: 'user-1',
  requestedRole: 'student',
  bindingHint: 'student-1',
});
const studentApproved = service.approve({
  actor: { userId: 'super-1', roles: ['super_admin'], authorityId: 'authority-1', isAuthorityHost: true },
  applicationId: studentPending.applicationId,
});
assert.equal(studentApproved.grant.subjectId, 'student-1');
assert.deepStrictEqual(
  db.prepare("SELECT role FROM authority_role_bindings WHERE authority_id='authority-1' AND user_id='user-1' AND status='active' ORDER BY role").all(),
  [{ role: 'student' }, { role: 'teacher' }],
  'one immutable user id may hold additive student and teacher grants'
);

const rejectedPending = service.submit({
  authorityId: 'authority-1',
  userId: 'user-2',
  requestedRole: 'student',
  bindingHint: 'student-2',
});
const rejected = service.reject({
  actor: { userId: 'super-1', roles: ['super_admin'], authorityId: 'authority-1', isAuthorityHost: true },
  applicationId: rejectedPending.applicationId,
});
assert.equal(rejected.status, 'rejected');
assert.equal(
  db.prepare("SELECT COUNT(*) AS count FROM authority_role_bindings WHERE user_id='user-2'").get().count,
  0
);

assert.throws(
  () => service.grantAdmin({
    actor: { userId: 'super-1', roles: ['super_admin'] },
    authorityId: 'authority-1',
    userId: 'admin-1',
  }),
  error => error.code === 'ROLE_ADMIN_HOST_GRANT_REQUIRED',
  'admin grant cannot be issued outside the authority host'
);
const adminGrant = service.grantAdmin({
  actor: { userId: 'super-1', roles: ['super_admin'], authorityId: 'authority-1', isAuthorityHost: true },
  authorityId: 'authority-1',
  userId: 'admin-1',
});
assert.equal(adminGrant.role, 'admin');
assert.equal(adminGrant.subjectId, null);
assert.deepStrictEqual(
  db.prepare(`SELECT actor_user_id,target_user_id,action,after_json
    FROM authorization_audit_log WHERE action='authority_role_admin_granted'`).get(),
  {
    actor_user_id: 'super-1',
    target_user_id: 'admin-1',
    action: 'authority_role_admin_granted',
    after_json: JSON.stringify({ authorityId: 'authority-1', role: 'admin', bindingId: adminGrant.bindingId }),
  },
  'a host-superadmin direct grant must leave a durable audit record',
);
assert.equal(
  service.grantAdmin({
    actor: { userId: 'super-1', roles: ['super_admin'], authorityId: 'authority-1', isAuthorityHost: true },
    authorityId: 'authority-1',
    userId: 'admin-1',
  }).bindingId,
  adminGrant.bindingId,
  'host-superadmin direct admin grant is idempotent'
);

console.log('roleApplicationService tests passed');
