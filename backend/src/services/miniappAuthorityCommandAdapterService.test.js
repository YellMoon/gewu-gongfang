const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');
const { createMiniappAuthorityCommandAdapterService } = require('./miniappAuthorityCommandAdapterService');
const {
  createAuthorityCommandAuthorizationService,
} = require('./authorityCommandAuthorizationService');
const { createAuthorityCommandPolicy } = require('./authorityCommandRegistry');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-authority-adapter-'));
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
};
process.env.DB_PATH = path.join(workspace, 'authority.db');
process.env.READ_DB_PATH = process.env.DB_PATH;

let database;
try {
  database = new DatabaseService();
  const db = database.db;
  const now = '2026-07-28T00:00:00.000Z';
  db.prepare(`INSERT INTO users
    (id,phone,phone_normalized,name,role,identity_kind,status,login_enabled,review_status,
     auth_version,deleted,created_at,updated_at)
    VALUES('visitor-1','13800138000','13800138000','Visitor','visitor','visitor',
      1,1,'approved',1,0,?,?)`).run(now, now);
  db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
    VALUES('visitor-1','authority-1','active',?,?)`).run(now, now);
  db.prepare(`INSERT INTO users
    (id,phone,phone_normalized,name,role,identity_kind,status,login_enabled,review_status,
     auth_version,deleted,created_at,updated_at)
    VALUES('student-1','13800138001','13800138001','Student','student','student',
      1,1,'approved',1,0,?,?)`).run(now, now);
  db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
    VALUES('student-1','authority-1','active',?,?)`).run(now, now);
  db.prepare(`INSERT INTO authority_role_bindings
    (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,created_at,updated_at)
    VALUES('binding-student-1','authority-1','student-1','student','student','student-profile-1',
      'active',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO users
    (id,phone,phone_normalized,name,role,identity_kind,status,login_enabled,review_status,
     auth_version,deleted,created_at,updated_at)
    VALUES('admin-1','13800138002','13800138002','Admin','admin','admin',
      1,1,'approved',1,0,?,?)`).run(now, now);
  db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
    VALUES('admin-1','authority-1','active',?,?)`).run(now, now);
  db.prepare(`INSERT INTO authority_role_bindings
    (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,created_at,updated_at)
    VALUES('binding-admin-1','authority-1','admin-1','admin',NULL,NULL,'active',1,?,?)`).run(now, now);
  let sequence = 0;
  const adapter = createMiniappAuthorityCommandAdapterService({
    db,
    now: () => now,
    createId: prefix => `${prefix}-${++sequence}`,
  });
  const first = adapter.createRoleApplicationEnvelope({
    userId: 'visitor-1',
    sessionId: 'miniapp-session-1',
    authorityId: 'authority-1',
    requestedRole: 'teacher',
    bindingHint: 'teacher-profile-optional',
    idempotencyKey: 'miniapp-role-request-1',
  });

  assert.strictEqual(first.envelope.protocol, 'gewu.authority-command.v1');
  assert.strictEqual(first.envelope.type, 'role-application.submit.v1');
  assert.deepStrictEqual(first.envelope.actor, {
    userId: 'visitor-1',
    deviceId: first.session.deviceId,
    role: 'visitor',
  });
  assert.strictEqual(first.envelope.authorityId, 'authority-1');
  assert.strictEqual(first.envelope.hostEpochId, first.session.hostEpochId);
  assert.deepStrictEqual(first.envelope.payload, {
    requestedRole: 'teacher',
    bindingHint: 'teacher-profile-optional',
  });
  assert.ok(/^[a-f0-9]{64}$/.test(first.envelope.payloadHash));
  assert.strictEqual(first.session.expiresAt, '2026-08-11T00:00:00.000Z');

  const grant = db.prepare('SELECT * FROM device_grants WHERE grant_id=?').get(first.session.grantId);
  assert.strictEqual(grant.user_id, 'visitor-1');
  assert.strictEqual(grant.host_generation, 1);
  assert.strictEqual(grant.status, 'active');
  assert.strictEqual(grant.public_key, 'miniapp-jwt-adapter:v1');
  const lease = db.prepare('SELECT * FROM device_leases WHERE lease_id=?').get(first.session.leaseId);
  assert.strictEqual(lease.active_role, 'visitor');
  assert.strictEqual(lease.status, 'active');

  const authorization = createAuthorityCommandAuthorizationService({
    db,
    now: () => new Date(now),
    commandPolicy: createAuthorityCommandPolicy(),
  });
  assert.strictEqual(authorization.authorize(first.envelope).scope.kind, 'visitor');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM primary_host_epochs').get().count, 0,
    'miniapp commands must receive a cloud epoch without a primary-host row');

  const formal = adapter.createRoleApplicationEnvelope({
    userId: 'student-1',
    sessionId: 'miniapp-formal-session-1',
    authorityId: 'authority-1',
    activeRole: 'student',
    requestedRole: 'teacher',
    idempotencyKey: 'miniapp-formal-role-request-1',
  });
  assert.strictEqual(formal.envelope.actor.role, 'student');
  assert.strictEqual(
    db.prepare('SELECT active_role FROM device_leases WHERE lease_id=?').get(formal.session.leaseId).active_role,
    'student',
  );
  assert.strictEqual(authorization.authorize(formal.envelope).scope.kind, 'student');

  assert.throws(
    () => adapter.createRoleApplicationEnvelope({
      userId: 'student-1',
      sessionId: 'miniapp-formal-session-wrong-scope',
      authorityId: 'authority-1',
      activeRole: 'teacher',
      requestedRole: 'student',
      idempotencyKey: 'miniapp-formal-role-request-wrong-scope',
    }),
    error => error?.code === 'MINIAPP_AUTHORITY_SCOPE_INVALID',
  );
  assert.throws(
    () => adapter.createRoleApplicationEnvelope({
      userId: 'admin-1',
      sessionId: 'miniapp-admin-session-1',
      authorityId: 'authority-1',
      activeRole: 'admin',
      requestedRole: 'student',
      idempotencyKey: 'miniapp-admin-role-request-1',
    }),
    error => error?.code === 'MINIAPP_ROLE_APPLICATION_SESSION_FORBIDDEN',
  );

  assert.throws(
    () => adapter.createRoleApplicationEnvelope({
      userId: 'visitor-1',
      sessionId: 'miniapp-session-1',
      authorityId: 'authority-1',
      requestedRole: 'admin',
      idempotencyKey: 'miniapp-role-request-admin',
    }),
    error => error?.code === 'MINIAPP_ROLE_APPLICATION_FORBIDDEN',
  );
  assert.throws(
    () => adapter.createRoleApplicationEnvelope({
      userId: 'visitor-1',
      sessionId: 'miniapp-session-1',
      authorityId: 'other-authority',
      requestedRole: 'student',
      idempotencyKey: 'miniapp-role-request-other',
    }),
    error => error?.code === 'MINIAPP_AUTHORITY_ACCOUNT_INACTIVE',
  );

  console.log('miniapp authority command adapter tests passed');
} finally {
  try { database?.close(); } catch (_error) { /* best-effort cleanup */ }
  if (previous.dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previous.readDbPath;
  fs.rmSync(workspace, { recursive: true, force: true });
}
