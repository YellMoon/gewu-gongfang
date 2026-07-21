const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const { DatabaseService } = require('../database');
const { createMiniappIdentityService } = require('./miniappIdentityService');

(async () => {
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-identity-service-'));
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};
process.env.DB_PATH = path.join(workspace, 'identity.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.NODE_ENV = 'production';

let database;
try {
  database = new DatabaseService();
  const db = database.db;
  const secret = 'identity-service-test-secret';
  let clock = new Date('2026-07-16T00:00:00.000Z');
  let sequence = 0;
  const identity = createMiniappIdentityService({
    db,
    jwtSecret: secret,
    now: () => clock,
    uuid: () => `identity-test-${++sequence}`,
  });
  const now = clock.toISOString();

  db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES ('formal-admin', '13800138001', '13800138001', 'Formal Admin', 'admin', 'admin',
      1, 1, 'approved', 3, 0, ?, ?)`
  ).run(now, now);
  db.prepare(`INSERT INTO teachers
    (id, name, phone, deleted, created_at, updated_at)
    VALUES ('teacher-formal-record', 'Formal Teacher', '13800138004', 0, ?, ?)`)
    .run(now, now);
  db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, teacher_id, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES ('formal-teacher', '13800138004', '13800138004', 'Formal Teacher', 'teacher', 'teacher',
      'teacher-formal-record', 1, 1, 'approved', 1, 0, ?, ?)`)
    .run(now, now);
  db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, deleted, disabled_at, created_at, updated_at)
    VALUES ('disabled-user', '13800138002', '13800138002', 'Disabled', 'pending', 'unrecognized',
      0, 0, 'pending', 2, 0, ?, ?, ?)`
  ).run(now, now, now);
  db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES ('pending-bind', '13800138003', '13800138003', 'Pending Bind', 'pending', 'unrecognized',
      1, 0, 'pending', 5, 0, ?, ?)`
  ).run(now, now);

  const formal = identity.loginWithVerifiedWechat({
    openid: 'wx-formal',
    phone: '13800138001',
    miniappVersion: '5.15.0',
    platform: 'ios',
  });
  assert.strictEqual(formal.user.role, 'admin');
  assert.strictEqual(formal.user.account_state, 'formal');
  assert.strictEqual(formal.user.membership, null);
  assert.strictEqual(formal.claims.token_use, 'miniapp-session');
  assert.strictEqual(formal.claims.iss, 'gewu-miniapp-auth');
  assert.strictEqual(formal.claims.aud, 'gewu-api');
  assert.strictEqual(formal.claims.auth_version, 4, 'first openid binding must revoke older sessions');
  assert.ok(!('phone' in formal.claims));
  assert.ok(!('openid' in formal.claims));
  assert.ok(!('loginEventId' in formal.claims));
  assert.ok(formal.loginEventId && formal.loginEventId.startsWith('identity-test-'));
  assert.deepStrictEqual(
    db.prepare(`SELECT user_id, phone_normalized, result_code, session_id
      FROM miniapp_login_events WHERE id=?`).get(formal.loginEventId),
    {
      user_id: 'formal-admin',
      phone_normalized: '13800138001',
      result_code: 'FORMAL_LOGIN_SUCCESS',
      session_id: formal.sessionId,
    },
    'the trusted caller must receive the exact fresh verified-phone event id'
  );
  assert.deepStrictEqual(identity.readIdentityForToken(formal.claims).id, 'formal-admin');
  assert.strictEqual(jwt.verify(formal.token, secret, {
    algorithms: ['HS256'],
    issuer: 'gewu-miniapp-auth',
    audience: 'gewu-api',
  }).sub, 'formal-admin');

  const formalTeacher = identity.loginWithVerifiedWechat({
    openid: 'wx-formal-teacher',
    phone: '13800138004',
  });
  assert.strictEqual(formalTeacher.user.role, 'teacher');
  assert.strictEqual(formalTeacher.user.teacher_id, 'teacher-formal-record');
  assert.strictEqual(formalTeacher.claims.token_use, 'miniapp-session');

  const unrecognized = identity.loginWithVerifiedWechat({
    openid: 'wx-new',
    phone: '13800138000',
    miniappVersion: '5.15.0',
    platform: 'android',
  });
  assert.strictEqual(unrecognized.user.role, 'student');
  assert.strictEqual(unrecognized.user.account_state, 'unrecognized');
  assert.strictEqual(unrecognized.user.token_use, 'unrecognized-student');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(unrecognized.user, 'membership'), false);
  assert.deepStrictEqual(unrecognized.user.capabilities, [
    'experience:read',
    'profile-application:read',
    'profile-application:submit',
    'sample-questions:view',
    'sample-paper-export',
  ]);
  assert.strictEqual(unrecognized.claims.token_use, 'unrecognized-student');
  assert.strictEqual(unrecognized.claims.iss, 'gewu-miniapp-auth');
  assert.strictEqual(unrecognized.claims.aud, 'gewu-miniapp-experience');
  assert.ok(!('phone' in unrecognized.claims));
  assert.ok(!('openid' in unrecognized.claims));
  const pending = db.prepare('SELECT * FROM users WHERE id=?').get(unrecognized.user.id);
  assert.deepStrictEqual(
    [pending.role, pending.identity_kind, pending.review_status, pending.login_enabled],
    ['pending', 'unrecognized', 'pending', 0],
  );

  const firstBinding = identity.loginWithVerifiedWechat({
    openid: 'wx-pending-bind',
    phone: '13800138003',
  });
  assert.strictEqual(firstBinding.claims.auth_version, 6);
  assert.strictEqual(db.prepare('SELECT wechat_openid FROM users WHERE id=?').get('pending-bind').wechat_openid, 'wx-pending-bind');

  assert.throws(
    () => identity.loginWithVerifiedWechat({ openid: 'wx-other', phone: '13800138000' }),
    error => error?.code === 'PHONE_WECHAT_BINDING_CONFLICT',
  );
  assert.throws(
    () => identity.loginWithVerifiedWechat({ openid: 'wx-new', phone: '13800138999' }),
    error => error?.code === 'OPENID_PHONE_BINDING_CONFLICT',
  );
  assert.throws(
    () => identity.loginWithVerifiedWechat({ openid: 'wx-disabled', phone: '13800138002' }),
    error => error?.code === 'MINIAPP_LOGIN_DISABLED',
  );

  const concurrent = await Promise.allSettled([
    Promise.resolve().then(() => identity.loginWithVerifiedWechat({ openid: 'wx-race-a', phone: '13800138888' })),
    Promise.resolve().then(() => identity.loginWithVerifiedWechat({ openid: 'wx-race-b', phone: '13800138888' })),
  ]);
  assert.deepStrictEqual(concurrent.map(item => item.status).sort(), ['fulfilled', 'rejected']);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM users WHERE phone_normalized=?').get('13800138888').count, 1);

  db.prepare('UPDATE users SET auth_version=auth_version+1 WHERE id=?').run(unrecognized.user.id);
  assert.throws(
    () => identity.readIdentityForToken(unrecognized.claims),
    error => error?.code === 'AUTH_VERSION_MISMATCH',
  );

  const mappingGuard = identity.loginWithVerifiedWechat({
    openid: 'wx-mapping-guard',
    phone: '13800137777',
  });
  db.prepare(`UPDATE users SET role='student', review_status='approved', login_enabled=1 WHERE id=?`)
    .run(mappingGuard.user.id);
  assert.throws(
    () => identity.readIdentityForToken(mappingGuard.claims),
    error => error?.code === 'UNRECOGNIZED_IDENTITY_NOT_ELIGIBLE',
    'an enabled formal-state flag must revoke an unrecognized token even when the business mapping is corrupt',
  );

  const events = db.prepare(`SELECT user_id, phone_normalized, result_code, session_id,
    miniapp_version, platform FROM miniapp_login_events ORDER BY created_at, rowid`).all();
  assert.ok(events.some(event => event.result_code === 'FORMAL_LOGIN_SUCCESS' && event.user_id === 'formal-admin'));
  assert.ok(events.some(event => event.result_code === 'UNRECOGNIZED_LOGIN_SUCCESS' && event.user_id === unrecognized.user.id));
  assert.ok(events.some(event => event.result_code === 'PHONE_WECHAT_BINDING_CONFLICT'));
  assert.ok(events.some(event => event.result_code === 'OPENID_PHONE_BINDING_CONFLICT'));
  assert.ok(events.some(event => event.result_code === 'MINIAPP_LOGIN_DISABLED'));
  assert.ok(events.filter(event => event.session_id).every(event => event.session_id.startsWith('identity-test-')));

  clock = new Date('2027-02-01T00:00:00.000Z');
  const expired = identity.expireLoginEvents();
  assert.ok(expired >= events.length, 'default retention should remove events older than 180 days');
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM miniapp_login_events').get().count, 0);

  assert.throws(
    () => identity.loginWithVerifiedWechat({ openid: '', phone: '13800138000' }),
    error => error?.code === 'VERIFIED_WECHAT_IDENTITY_REQUIRED',
  );
  console.log('miniapp identity service checks passed');
} finally {
  try { database?.close(); } catch (_error) { /* best-effort cleanup */ }
  if (previous.dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previous.readDbPath;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (_error) { /* Windows WAL handles */ }
}
})().catch(error => {
  console.error(error);
  process.exit(1);
});
