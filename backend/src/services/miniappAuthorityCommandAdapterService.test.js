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
const { createAuthorityCommandInboxService } = require('./authorityCommandInboxService');

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
  db.pragma('foreign_keys = OFF');
  db.prepare(`INSERT INTO primary_host_epochs
    (id,generation,device_id,user_id,authorization_id,status,activation_reason,source_epoch_id,
     challenge_id,db_instance_digest,schema_version,store_id,db_authority_id,host_credential_hash,
     credential_version,row_version,created_at,updated_at,activated_at,retired_at)
    VALUES('epoch-1',3,'host-1','visitor-1','authorization-1','active','bootstrap',NULL,
      'challenge-1','digest-1',1,'store-1','authority-1','host-hash',1,1,?,?,?,NULL)`)
    .run(now, now, now);
  db.pragma('foreign_keys = ON');

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
  assert.strictEqual(first.envelope.hostEpochId, 'epoch-1');
  assert.deepStrictEqual(first.envelope.payload, {
    requestedRole: 'teacher',
    bindingHint: 'teacher-profile-optional',
  });
  assert.ok(/^[a-f0-9]{64}$/.test(first.envelope.payloadHash));
  assert.strictEqual(first.session.expiresAt, '2026-08-11T00:00:00.000Z');

  const grant = db.prepare('SELECT * FROM device_grants WHERE grant_id=?').get(first.session.grantId);
  assert.strictEqual(grant.user_id, 'visitor-1');
  assert.strictEqual(grant.host_generation, 3);
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

  const inbox = createAuthorityCommandInboxService({
    db,
    now: () => now,
    targetHostIdFor: () => 'host-1',
  });
  assert.deepStrictEqual(inbox.enqueue(first.envelope), {
    id: first.envelope.commandId,
    status: 'pending',
    replayed: false,
  });
  const replay = adapter.createRoleApplicationEnvelope({
    userId: 'visitor-1',
    sessionId: 'miniapp-session-1',
    authorityId: 'authority-1',
    requestedRole: 'teacher',
    bindingHint: 'teacher-profile-optional',
    idempotencyKey: 'miniapp-role-request-1',
  });
  assert.deepStrictEqual(inbox.enqueue(replay.envelope), {
    id: first.envelope.commandId,
    status: 'pending',
    replayed: true,
  });

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
