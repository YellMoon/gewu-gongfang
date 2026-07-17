const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');
const { createDesktopSessionService } = require('./desktopSessionService');
const { issueRelayAssertion, resolveRelaySessionActorContext, verifyRelayAssertion } = require('./relayAssertionService');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-sync-scope-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
let db = new DatabaseService();
try {
  const now = '2026-07-11T00:00:00.000Z';
  db.db.prepare('INSERT INTO teachers (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('t1','T1',now,now);
  db.db.prepare('INSERT INTO teachers (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('t2','T2',now,now);
  db.db.prepare('INSERT INTO courses (id,name,display_name,type,source_type,teacher_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('c1','C1','C1',1,1,'t1',now,now);
  db.db.prepare('INSERT INTO courses (id,name,display_name,type,source_type,teacher_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('c2','C2','C2',1,1,'t2',now,now);
  const dualRoleTeacherAuthz = { kind:'teacher', role:'teacher', activeRole:'teacher',
    eligibleRoles:['super_admin','teacher'], userId:'u1', teacherId:'t1', deviceId:'d1' };
  const scoped = db.getScopedChangeQueueSince(0, { tenantId:'default', deviceId:'server', clientId:'d1',
    authz:dualRoleTeacherAuthz });
  assert(scoped.changes.some(x => x.table === 'courses' && x.data.id === 'c1'));
  assert(!scoped.changes.some(x => x.table === 'courses' && x.data.id === 'c2'));
  const elevatedScoped = db.getScopedChangeQueueSince(0, { tenantId:'default', deviceId:'server', clientId:'d1-admin',
    authz:{ ...dualRoleTeacherAuthz, kind:'admin', role:'super_admin', activeRole:'super_admin', teacherId:null } });
  assert(elevatedScoped.changes.some(x => x.table === 'courses' && x.data.id === 'c2'));
  assert.throws(() => db.getScopedChangeQueueSince(0, { tenantId:'default' }), e => e.code === 'AUTHORIZATION_CONTEXT_REQUIRED');
  assert.throws(() => db.applySyncChanges([{ id:'no-auth', table:'courses', action:'update', data:{id:'c1',name:'pwned'}, updatedAt:now }],
    { tenantId:'default', deviceId:'d1' }), e => e.code === 'AUTHORIZATION_CONTEXT_REQUIRED');
  assert.strictEqual(db.db.prepare('SELECT name FROM courses WHERE id=?').get('c1').name, 'C1');

  db.registerSyncDevice('d1');
  const issued = db.issueSyncAuthorization('d1', { actorUserId:'u1', actorTeacherId:'t1' });
  assert.strictEqual(db.verifySyncAuthorization('d1', issued.token, { actorUserId:'u2', actorTeacherId:'t1' }), false);
  assert.ok(db.verifySyncAuthorization('d1', issued.token, { actorUserId:'u1', actorTeacherId:'t1' }));
  assert.strictEqual(db.verifySyncAuthorization('d1', issued.token, { actorUserId:'u1', actorTeacherId:'t1' }), false,
    'one-time token must be consumed atomically');

  const denied = db.applySyncChanges([{ id:'evil', table:'courses', action:'update', data:{id:'c2',teacher_id:'t2'}, updatedAt:now }],
    { tenantId:'default', deviceId:'d1', authz:dualRoleTeacherAuthz });
  assert.strictEqual(denied.applied, 0);
  assert.strictEqual(db.db.prepare('SELECT name FROM courses WHERE id=?').get('c2').name, 'C2');
  assert.strictEqual(db.db.prepare('SELECT reason_code FROM sync_rejections WHERE operation_id=?').get('evil').reason_code, 'TEACHER_SCOPE_VIOLATION');
  const applied = db.applySyncChanges([{ id:'good', table:'courses', action:'update', data:{id:'c1',teacher_id:'t1',name:'C1 updated'}, updatedAt:'2026-07-12T00:00:00.000Z' }],
    { tenantId:'default', deviceId:'d1', authz:{kind:'teacher',userId:'u1',teacherId:'t1',deviceId:'d1'} });
  assert.strictEqual(applied.applied, 1);
  assert.deepStrictEqual(db.db.prepare('SELECT updated_by_user_id, source_device_id, source_operation_id FROM sync_record_provenance WHERE table_name=? AND record_id=?').get('courses','c1'),
    { updated_by_user_id:'u1', source_device_id:'d1', source_operation_id:'good' });

  db.db.prepare(`INSERT INTO users (id,phone,name,role,status,login_enabled,teacher_id,review_status,deleted,created_at,updated_at)
    VALUES ('relay-u1','13000009999','Relay Teacher','teacher',1,1,'t1','approved',0,?,?)`).run(now,now);
  db.db.prepare(`INSERT INTO user_role_grants
    (user_id,role,subject_type,subject_id,status,source,created_at,updated_at)
    VALUES ('relay-u1','teacher','teacher','t1','active','test',?,?)`).run(now,now);
  db.db.prepare(`INSERT INTO desktop_device_authorizations
    (id,device_id,device_name,device_kind,user_id,public_key,key_fingerprint,status,
     source_challenge_id,last_phone_verified_at,phone_reverify_due_at,credential_version,row_version,created_at,updated_at)
    VALUES ('relay-auth-1','relay-d1','Relay PC','desktop-client','relay-u1','test-public-key',?,'active',
      'relay-challenge-1',?,'2026-08-11T00:00:00.000Z',3,1,?,?)`)
    .run('b'.repeat(64),now,now,now);
  db.registerSyncDevice('relay-d1', { ownerUserId:'relay-u1' });
  const relaySessions = createDesktopSessionService({
    db: db.db, jwtSecret: 'relay-session-secret', now: () => new Date(now), uuid: () => 'relay-session-1',
  });
  const relaySession = relaySessions.issueSession({ userId:'relay-u1', deviceId:'relay-d1' });
  const relayToken = db.issueSyncAuthorization('relay-d1', { actorUserId:'relay-u1', actorTeacherId:'t1' });
  assert.deepStrictEqual(db.consumeSyncAuthorizationContext('relay-d1', relayToken.token, 'relay-u1'),
    { kind:'teacher', role:'teacher', userId:'relay-u1', teacherId:'t1', studentId:null, deviceId:'relay-d1',
      userApproved:true, deviceTrusted:false, deviceActive:true, deviceOwnerUserId:'relay-u1' });
  const wrongDeviceToken = db.issueSyncAuthorization('relay-d1', { actorUserId:'relay-u1', actorTeacherId:'t1' });
  assert.strictEqual(db.consumeSyncAuthorizationContext('forged-device', wrongDeviceToken.token, 'relay-u1'), false);
  const revokedToken = db.issueSyncAuthorization('relay-d1', { actorUserId:'relay-u1', actorTeacherId:'t1' });
  db.db.prepare("UPDATE users SET review_status='pending' WHERE id='relay-u1'").run();
  assert.strictEqual(db.consumeSyncAuthorizationContext('relay-d1', revokedToken.token, 'relay-u1'), false,
    'queued relay changes must be rejected after actor revocation');
  db.db.prepare("UPDATE users SET review_status='approved', teacher_id='t1' WHERE id='relay-u1'").run();
  const reboundToken = db.issueSyncAuthorization('relay-d1', { actorUserId:'relay-u1', actorTeacherId:'t1' });
  db.db.prepare("UPDATE users SET teacher_id='t2' WHERE id='relay-u1'").run();
  assert.strictEqual(db.consumeSyncAuthorizationContext('relay-d1', reboundToken.token, 'relay-u1'), false,
    'teacher binding changes must invalidate queued relay authorization');
  db.db.prepare("UPDATE users SET teacher_id='t1' WHERE id='relay-u1'").run();
  const relayClaims = verifyRelayAssertion(issueRelayAssertion({
    taskId:'task-real', actorUserId:'relay-u1', deviceId:'relay-d1', sessionId:relaySession.session.id,
    activeRole:'teacher', teacherId:'t1', authVersion:1, credentialVersion:3,
    issuedAt:Date.parse(now), expiresAt:Date.parse(relaySession.session.expiresAt), nonce:'relay-nonce-1',
  }, 'shared'), 'shared', { now:Date.parse(now)+1000 });
  assert.ok(db.consumeRelayAuthorizationNonce(relayClaims));
  assert.strictEqual(db.consumeRelayAuthorizationNonce(relayClaims), false, 'relay nonce replay must fail CAS/unique consumption');
  assert.strictEqual(resolveRelaySessionActorContext(db, relayClaims, { now:Date.parse(now)+1000 }).teacherId,'t1');
  assert.throws(() => resolveRelaySessionActorContext(db, { ...relayClaims, teacherId:'t2' }, { now:Date.parse(now)+1000 }),
    error => error.code === 'RELAY_SESSION_ROLE_MISMATCH');
  db.db.prepare("UPDATE desktop_device_authorizations SET credential_version=4 WHERE device_id='relay-d1'").run();
  assert.throws(() => resolveRelaySessionActorContext(db, relayClaims, { now:Date.parse(now)+1000 }),
    error => error.code === 'RELAY_SESSION_CREDENTIAL_VERSION_MISMATCH');
  db.db.prepare("UPDATE desktop_device_authorizations SET credential_version=3 WHERE device_id='relay-d1'").run();
  db.db.prepare("UPDATE desktop_sessions SET status='revoked' WHERE sid='relay-session-1'").run();
  assert.throws(() => resolveRelaySessionActorContext(db, relayClaims, { now:Date.parse(now)+1000 }),
    error => error.code === 'RELAY_SESSION_NOT_ACTIVE');
  db.db.prepare("UPDATE desktop_sessions SET status='active' WHERE sid='relay-session-1'").run();
  assert.strictEqual(db.resolveSyncActorContext('relay-d1','relay-u1').teacherId, 't1');
  db.registerSyncDevice('other-owner-device', { ownerUserId:'other-user' });
  assert.strictEqual(db.resolveSyncActorContext('other-owner-device','relay-u1'), false, 'cross-owner device must fail');
  assert.strictEqual(db.resolveOrProvisionRelayActorContext('remote-first-device','relay-u1','gateway-pairing-1'),false,
    'removed V1 pairing approvals must never provision a host sync device');
  assert.strictEqual(db.db.prepare("SELECT owner_user_id FROM sync_devices WHERE id='remote-first-device'").get(),undefined);
  assert.strictEqual(db.resolveOrProvisionRelayActorContext('other-owner-device','relay-u1','gateway-pairing-2'),false,
    'owner conflict must not rebind an existing host device');

  const first = db.getScopedChangeQueueSince(0, { tenantId:'default', deviceId:'server', clientId:'d1',
    authz:{ kind:'teacher', userId:'u1', teacherId:'t1', deviceId:'d1' } });
  assert(first.changes.some(x => x.table === 'courses' && x.data.id === 'c1'));
  db.close();
  db = new DatabaseService();
  db.db.prepare(`INSERT INTO sync_delivery_scope (tenant_id,actor_user_id,device_id,table_name,record_id,last_visible_at)
    VALUES ('other','u1','d1','courses','same-id-other-tenant',?)`).run(now);
  db.db.prepare('UPDATE courses SET teacher_id=?, updated_at=? WHERE id=?').run('t2','2026-07-13T00:00:00.000Z','c1');
  const second = db.getScopedChangeQueueSince('2026-07-12T12:00:00.000Z', { tenantId:'default', deviceId:'server', clientId:'d1',
    authz:{ kind:'teacher', userId:'u1', teacherId:'t1', deviceId:'d1' } });
  assert(second.changes.some(x => x.table === 'courses' && x.data.id === 'c1' && x.action === 'delete' && x.data.deleted === 1),
    'relationship transfer must emit a minimal tombstone to a prior recipient');
  assert(!second.changes.some(x => x.table === 'courses' && x.data.id === 'c2' && x.action === 'delete'),
    'records never delivered to this actor/device must not leak through tombstones');
  assert(!second.changes.some(x => x.data.id === 'same-id-other-tenant'), 'delivery ledger must not cross tenant boundaries');
  assert.ok(db.db.prepare("SELECT 1 FROM sync_delivery_scope WHERE tenant_id='other' AND record_id='same-id-other-tenant'").get(),
    'pulling default tenant must not delete another tenant ledger row');
  db.db.exec(`DROP TABLE sync_delivery_scope;
    CREATE TABLE sync_delivery_scope (actor_user_id TEXT NOT NULL,device_id TEXT NOT NULL,table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,last_visible_at TEXT NOT NULL,PRIMARY KEY(actor_user_id,device_id,table_name,record_id));
    INSERT INTO sync_delivery_scope VALUES ('legacy-u','legacy-d','courses','legacy-r','2026-01-01T00:00:00.000Z');`);
  db.close();
  db = new DatabaseService();
  assert.ok(db.db.prepare("SELECT 1 FROM sync_delivery_scope WHERE tenant_id='default' AND actor_user_id='legacy-u'").get(),
    'legacy delivery ledger rows must migrate to default tenant without loss');
  console.log('sync scope integration tests passed');
} finally { db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
