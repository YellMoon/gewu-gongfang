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
  db.prepare(`INSERT INTO authority_metadata(key,value,updated_at)
    VALUES('database_authority_id','authority-miniapp-test',?)`).run(now);

  db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES ('formal-admin', '13800138001', '13800138001', 'Formal Super Admin', 'super_admin', 'super_admin',
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
  db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES ('manual-existing', '13800138005', '13800138005', 'Manual Super Admin', 'super_admin', 'super_admin',
      1, 1, 'approved', 7, 0, ?, ?)`
  ).run(now, now);
  db.prepare(`INSERT INTO authority_accounts
    (user_id, authority_id, status, created_at, updated_at) VALUES
    ('formal-admin', 'authority-miniapp-test', 'active', ?, ?),
    ('formal-teacher', 'authority-miniapp-test', 'active', ?, ?),
    ('manual-existing', 'authority-miniapp-test', 'active', ?, ?)`)
    .run(now, now, now, now, now, now);
  db.prepare(`INSERT INTO authority_role_bindings
    (binding_id, authority_id, user_id, role, subject_type, subject_id, status,
     grant_version, granted_by, created_at, updated_at) VALUES
    ('binding-formal-admin', 'authority-miniapp-test', 'formal-admin', 'super_admin', NULL, NULL,
      'active', 1, 'host-super-admin', ?, ?),
    ('binding-formal-teacher', 'authority-miniapp-test', 'formal-teacher', 'teacher', 'teacher',
      'teacher-formal-record', 'active', 1, 'host-super-admin', ?, ?),
    ('binding-manual-existing', 'authority-miniapp-test', 'manual-existing', 'super_admin', NULL, NULL,
      'active', 1, 'host-super-admin', ?, ?)`)
    .run(now, now, now, now, now, now);
  db.prepare(`INSERT INTO students
    (id, name, phone, deleted, created_at, updated_at)
    VALUES ('legacy-only-student-record', 'Legacy Only Student', '13800138009', 0, ?, ?)`)
    .run(now, now);
  db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, student_id, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES ('legacy-only-student', '13800138009', '13800138009', 'Legacy Only Student',
      'student', 'student', 'legacy-only-student-record', 1, 1, 'approved', 1, 0, ?, ?)`)
    .run(now, now);

  assert.throws(
    () => identity.loginWithVerifiedWechat({
      openid: 'wx-legacy-only-student',
      phone: '13800138009',
    }),
    error => error?.code === 'FORMAL_IDENTITY_MAPPING_INVALID',
    'legacy role and subject scalars alone must never authorize a formal miniapp session',
  );

  const manualFresh = identity.loginWithClaimedWechat({
    openid: 'wx-manual-fresh',
    phone: '138 0013 8006',
    miniappVersion: '6.4.0',
    platform: 'wechat',
  });
  assert.strictEqual(manualFresh.user.account_state, 'visitor');
  assert.strictEqual(manualFresh.user.role, 'visitor');
  assert.strictEqual(manualFresh.user.user_type, 'visitor');
  assert.strictEqual(manualFresh.user.identity_kind, 'visitor');
  assert.strictEqual(manualFresh.user.token_use, 'miniapp-visitor');
  assert.strictEqual(manualFresh.user.authority_id, 'authority-miniapp-test');
  assert.strictEqual(manualFresh.claims.token_use, 'miniapp-visitor');
  assert.strictEqual(manualFresh.claims.role, 'visitor');
  assert.strictEqual(manualFresh.claims.authority_id, 'authority-miniapp-test');
  assert.deepStrictEqual(
    db.prepare(`SELECT role,identity_kind,review_status,login_enabled
      FROM users WHERE id=?`).get(manualFresh.user.id),
    { role: 'visitor', identity_kind: 'visitor', review_status: 'approved', login_enabled: 1 },
  );
  assert.deepStrictEqual(
    db.prepare(`SELECT authority_id,status FROM authority_accounts
      WHERE user_id=?`).get(manualFresh.user.id),
    { authority_id: 'authority-miniapp-test', status: 'active' },
  );
  assert.strictEqual(manualFresh.user.phone, '13800138006');
  assert.strictEqual(
    identity.loginWithClaimedWechat({
      openid: 'wx-manual-fresh',
      phone: '13800138006',
    }).user.id,
    manualFresh.user.id,
  );
  db.prepare(`INSERT INTO teachers
    (id, name, phone, deleted, created_at, updated_at)
    VALUES ('teacher-canonical-grant', 'Canonical Grant Teacher', '13800138006', 0, ?, ?)`)
    .run(now, now);
  db.prepare(`INSERT INTO authority_role_bindings
    (binding_id, authority_id, user_id, role, subject_type, subject_id, status,
     grant_version, granted_by, created_at, updated_at)
    VALUES ('binding-canonical-teacher', 'authority-miniapp-test', ?, 'teacher', 'teacher',
      'teacher-canonical-grant', 'active', 1, 'host-super-admin', ?, ?)`)
    .run(manualFresh.user.id, now, now);
  const canonicalGrantLogin = identity.loginWithClaimedWechat({
    openid: 'wx-manual-fresh',
    phone: '13800138006',
  });
  assert.strictEqual(canonicalGrantLogin.user.account_state, 'formal');
  assert.strictEqual(canonicalGrantLogin.user.role, 'teacher');
  assert.strictEqual(canonicalGrantLogin.user.teacher_id, 'teacher-canonical-grant');
  assert.strictEqual(canonicalGrantLogin.claims.token_use, 'miniapp-session');
  assert.strictEqual(canonicalGrantLogin.claims.role, 'teacher');
  assert.deepStrictEqual(
    (() => {
      const tokenUser = identity.readIdentityForToken(canonicalGrantLogin.claims);
      return {
        role: tokenUser.role,
        identityKind: tokenUser.identity_kind,
        teacherId: tokenUser.teacher_id,
      };
    })(),
    {
      role: 'teacher',
      identityKind: 'teacher',
      teacherId: 'teacher-canonical-grant',
    },
    'formal middleware identity must expose the canonical grant instead of stale visitor scalars',
  );
  assert.throws(
    () => identity.readIdentityForToken(manualFresh.claims),
    error => error?.code === 'MINIAPP_VISITOR_NOT_ELIGIBLE',
    'approving a canonical formal grant must invalidate the previous visitor session',
  );
  assert.deepStrictEqual(
    db.prepare('SELECT role, identity_kind, teacher_id FROM users WHERE id=?')
      .get(manualFresh.user.id),
    { role: 'visitor', identity_kind: 'visitor', teacher_id: null },
    'canonical role approval must not rewrite the immutable account through legacy scalar role fields',
  );
  const unboundStudentAccount = identity.loginWithClaimedWechat({
    openid: 'wx-unbound-student',
    phone: '13800138008',
  });
  db.prepare(`INSERT INTO authority_role_bindings
    (binding_id, authority_id, user_id, role, subject_type, subject_id, status,
     grant_version, granted_by, created_at, updated_at)
    VALUES ('binding-unbound-student', 'authority-miniapp-test', ?, 'student', NULL,
      NULL, 'active', 1, 'host-super-admin', ?, ?)`)
    .run(unboundStudentAccount.user.id, now, now);
  const unboundStudentLogin = identity.loginWithClaimedWechat({
    openid: 'wx-unbound-student',
    phone: '13800138008',
  });
  assert.strictEqual(unboundStudentLogin.user.account_state, 'formal');
  assert.strictEqual(unboundStudentLogin.user.role, 'student');
  assert.strictEqual(unboundStudentLogin.user.student_id, null,
    'a canonical student role may exist before a local student subject is linked');
  assert.strictEqual(unboundStudentLogin.claims.token_use, 'miniapp-session');
  assert.strictEqual(
    identity.readIdentityForToken(unboundStudentLogin.claims).student_id,
    null,
    'formal token verification must retain an intentionally unbound student role',
  );
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) count FROM students WHERE phone=?').get('13800138008').count,
    0,
    'logging in with an unbound role must not synthesize a local subject record',
  );
  assert.throws(
    () => identity.loginWithClaimedWechat({
      openid: 'wx-manual-fresh',
      phone: '13800138007',
    }),
    error => error?.code === 'OPENID_PHONE_BINDING_CONFLICT',
  );
  assert.throws(
    () => identity.loginWithClaimedWechat({
      openid: 'wx-manual-other',
      phone: '13800138006',
    }),
    error => error?.code === 'PHONE_WECHAT_BINDING_CONFLICT',
  );

  const manualExisting = identity.loginWithClaimedWechat({
    openid: 'wx-manual-existing',
    unionid: 'union-manual-existing',
    phone: '13800138005',
  });
  assert.strictEqual(manualExisting.user.id, 'manual-existing');
  assert.strictEqual(manualExisting.user.role, 'super_admin');
  assert.strictEqual(manualExisting.user.account_state, 'formal');
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) count FROM miniapp_wechat_binding_requests WHERE target_user_id=?').get('manual-existing').count,
    0,
  );
  assert.deepStrictEqual(
    db.prepare("SELECT wechat_openid, wechat_unionid FROM users WHERE id='manual-existing'").get(),
    { wechat_openid: 'wx-manual-existing', wechat_unionid: 'union-manual-existing' },
    'manual phone entry must bind the matching existing account directly',
  );
  assert.throws(
    () => identity.loginWithClaimedWechat({
      openid: 'wx-disabled-manual',
      phone: '13800138002',
    }),
    error => error?.code === 'MINIAPP_LOGIN_DISABLED',
  );
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) count FROM miniapp_wechat_binding_requests WHERE target_user_id=?').get('disabled-user').count,
    0,
  );

  const formal = identity.loginWithVerifiedWechat({
    openid: 'wx-formal',
    phone: '13800138001',
    miniappVersion: '5.15.0',
    platform: 'ios',
  });
  assert.strictEqual(formal.user.role, 'super_admin');
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

  const repeatedFormalLogin = identity.loginWithVerifiedWechat({
    openid: 'wx-formal',
    phone: '13800138001',
  });
  assert.strictEqual(repeatedFormalLogin.user.id, formal.user.id,
    'the same verified WeChat identity must be reusable for another desktop authorization');

  const formalTeacher = identity.loginWithVerifiedWechat({
    openid: 'wx-formal-teacher',
    phone: '13800138004',
  });
  assert.strictEqual(formalTeacher.user.role, 'teacher');
  assert.strictEqual(formalTeacher.user.teacher_id, 'teacher-formal-record');
  assert.strictEqual(formalTeacher.claims.token_use, 'miniapp-session');

  const visitor = identity.loginWithVerifiedWechat({
    openid: 'wx-new',
    phone: '13800138000',
    miniappVersion: '5.15.0',
    platform: 'android',
  });
  assert.strictEqual(visitor.user.role, 'visitor');
  assert.strictEqual(visitor.user.account_state, 'visitor');
  assert.strictEqual(visitor.user.token_use, 'miniapp-visitor');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(visitor.user, 'membership'), false);
  assert.deepStrictEqual(visitor.user.capabilities, [
    'projection:read',
    'role-application:read',
    'role-application:submit',
    'question-preview:read',
  ]);
  assert.strictEqual(visitor.claims.token_use, 'miniapp-visitor');
  assert.strictEqual(visitor.claims.iss, 'gewu-miniapp-auth');
  assert.strictEqual(visitor.claims.aud, 'gewu-api');
  assert.ok(!('phone' in visitor.claims));
  assert.ok(!('openid' in visitor.claims));
  const pending = db.prepare('SELECT * FROM users WHERE id=?').get(visitor.user.id);
  assert.deepStrictEqual(
    [pending.role, pending.identity_kind, pending.review_status, pending.login_enabled],
    ['visitor', 'visitor', 'approved', 1],
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

  db.prepare('UPDATE users SET auth_version=auth_version+1 WHERE id=?').run(visitor.user.id);
  assert.throws(
    () => identity.readIdentityForToken(visitor.claims),
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
    error => error?.code === 'MINIAPP_VISITOR_NOT_ELIGIBLE',
    'changing a visitor into an invalid formal mapping must revoke the visitor token',
  );

  const events = db.prepare(`SELECT user_id, phone_normalized, result_code, session_id,
    miniapp_version, platform FROM miniapp_login_events ORDER BY created_at, rowid`).all();
  assert.ok(events.some(event => event.result_code === 'FORMAL_LOGIN_SUCCESS' && event.user_id === 'formal-admin'));
  assert.ok(events.some(event => event.result_code === 'VISITOR_LOGIN_SUCCESS' && event.user_id === visitor.user.id));
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
  assert.throws(
    () => identity.loginWithClaimedWechat({ openid: 'wx-missing-phone', phone: '' }),
    error => error?.code === 'MANUAL_PHONE_REQUIRED',
  );
  assert.throws(
    () => identity.loginWithClaimedWechat({ openid: 'wx-invalid-phone', phone: '123' }),
    error => error?.code === 'MANUAL_PHONE_INVALID',
  );
  for (const [openid, phone] of [
    ['wx-invalid-prefix-12', '12800138000'],
    ['wx-invalid-prefix-10', '10800138000'],
  ]) {
    const usersBefore = db.prepare('SELECT COUNT(*) count FROM users').get().count;
    assert.throws(
      () => identity.loginWithClaimedWechat({ openid, phone }),
      error => error?.code === 'MANUAL_PHONE_INVALID',
      `${phone} must be rejected by the mainland mobile contract`,
    );
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM users').get().count, usersBefore);
    assert.strictEqual(db.prepare('SELECT id FROM users WHERE wechat_openid=?').get(openid), undefined);
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) count FROM miniapp_login_events WHERE phone_normalized=?').get(phone).count,
      0,
      'invalid input must not create a login event or bind an openid',
    );
  }
  const usersBeforeInvalidVerifiedPhone = db.prepare('SELECT COUNT(*) count FROM users').get().count;
  assert.throws(
    () => identity.loginWithVerifiedWechat({ openid: 'wx-invalid-verified-prefix', phone: '12800138001' }),
    error => error?.code === 'VERIFIED_WECHAT_IDENTITY_REQUIRED',
  );
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM users').get().count, usersBeforeInvalidVerifiedPhone);
  assert.strictEqual(
    db.prepare("SELECT id FROM users WHERE wechat_openid='wx-invalid-verified-prefix'").get(),
    undefined,
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
