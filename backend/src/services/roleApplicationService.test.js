const assert = require('assert');
const Database = require('better-sqlite3');
const { createRoleApplicationService } = require('./roleApplicationService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE authority_accounts (
    user_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
`);
const now = '2026-07-28T08:00:00.000Z';
for (const userId of ['user-1', 'user-2', 'super-1']) {
  db.prepare(`INSERT INTO authority_accounts
    (user_id,authority_id,status,created_at,updated_at) VALUES(?,?,?,?,?)`)
    .run(userId, 'authority-1', 'active', now, now);
}

let sequence = 0;
const service = createRoleApplicationService({
  db,
  now: () => now,
  createId: prefix => `${prefix}-${++sequence}`,
});

const pending = service.submit({
  authorityId: 'authority-1',
  userId: 'user-1',
  requestedRole: 'teacher',
});
assert.equal(pending.status, 'pending');
assert.equal(pending.bindingHint, null);
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

const approved = service.approve({
  actor: { userId: 'super-1', roles: ['super_admin'] },
  applicationId: pending.applicationId,
});
assert.equal(approved.application.status, 'approved');
assert.equal(approved.grant.role, 'teacher');
assert.equal(approved.grant.subjectId, null, 'profile binding is optional');
assert.equal(
  db.prepare("SELECT COUNT(*) AS count FROM authority_role_bindings WHERE user_id='user-1' AND status='active'").get().count,
  1
);

const rejectedPending = service.submit({
  authorityId: 'authority-1',
  userId: 'user-2',
  requestedRole: 'student',
  bindingHint: 'student-2',
});
const rejected = service.reject({
  actor: { userId: 'super-1', roles: ['super_admin'] },
  applicationId: rejectedPending.applicationId,
});
assert.equal(rejected.status, 'rejected');
assert.equal(
  db.prepare("SELECT COUNT(*) AS count FROM authority_role_bindings WHERE user_id='user-2'").get().count,
  0
);

console.log('roleApplicationService tests passed');
