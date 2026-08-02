const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createDesktopSessionService } = require('./desktopSessionService');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));

let clock = new Date('2026-07-17T08:00:00.000Z');
let sequence = 0;
const canonicalId = 'miniapp-admin-13732250653';
const unboundTeacherUserId = 'unbound-teacher-desktop';
const legacyOnlyUserId = 'legacy-only-desktop-session';
const visitorOnlyUserId = 'visitor-only-desktop-session';
const authorityId = 'authority-desktop-session-test';
const jwtSecret = 'desktop-session-service-test-secret';

db.prepare(`INSERT INTO teachers
  (id, name, phone, deleted, created_at, updated_at)
  VALUES ('teacher-self', 'Canonical Teacher', '13732250653', 0, ?, ?)`)
  .run(clock.toISOString(), clock.toISOString());
db.prepare(`INSERT INTO users
  (id, phone, name, role, status, login_enabled, teacher_id, review_status,
   auth_version, deleted, created_at, updated_at)
  VALUES (?, '13732250653', 'Canonical User', 'super_admin', 1, 1, 'teacher-self',
    'approved', 7, 0, ?, ?)`)
  .run(canonicalId, clock.toISOString(), clock.toISOString());
db.prepare(`INSERT INTO authority_accounts
  (user_id, authority_id, status, created_at, updated_at)
  VALUES (?, ?, 'active', ?, ?)`)
  .run(canonicalId, authorityId, clock.toISOString(), clock.toISOString());
for (const grant of [
  ['super_admin', null, null],
  ['teacher', 'teacher', 'teacher-self'],
  ['student', null, null],
]) {
  db.prepare(`INSERT INTO authority_role_bindings
    (binding_id, authority_id, user_id, role, subject_type, subject_id, status,
     grant_version, granted_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 'test', ?, ?)`)
    .run(
      `binding-${canonicalId}-${grant[0]}`,
      authorityId,
      canonicalId,
      grant[0],
      grant[1],
      grant[2],
      clock.toISOString(),
      clock.toISOString(),
    );
}
for (const grant of [
  ['super_admin', null, null],
  ['teacher', 'teacher', 'teacher-self'],
]) {
  db.prepare(`INSERT INTO user_role_grants
    (user_id, role, subject_type, subject_id, status, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', 'legacy-test-fixture', ?, ?)`)
    .run(canonicalId, grant[0], grant[1], grant[2], clock.toISOString(), clock.toISOString());
}
for (const [userId, role, phone] of [
  [unboundTeacherUserId, 'teacher', '13000000008'],
  [legacyOnlyUserId, 'admin', '13000000009'],
  [visitorOnlyUserId, 'admin', '13000000010'],
]) {
  db.prepare(`INSERT INTO users
    (id, phone, name, role, status, login_enabled, review_status,
     auth_version, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, 'approved', 1, 0, ?, ?)`)
    .run(userId, phone, userId, role, clock.toISOString(), clock.toISOString());
}
db.prepare(`INSERT INTO authority_accounts
  (user_id, authority_id, status, created_at, updated_at)
  VALUES (?, ?, 'active', ?, ?)`)
  .run(unboundTeacherUserId, authorityId, clock.toISOString(), clock.toISOString());
db.prepare(`INSERT INTO authority_accounts
  (user_id, authority_id, status, created_at, updated_at)
  VALUES (?, ?, 'active', ?, ?)`)
  .run(visitorOnlyUserId, authorityId, clock.toISOString(), clock.toISOString());
db.prepare(`INSERT INTO authority_role_bindings
  (binding_id, authority_id, user_id, role, subject_type, subject_id, status,
   grant_version, granted_by, created_at, updated_at)
  VALUES ('binding-unbound-teacher', ?, ?, 'teacher', NULL, NULL, 'active', 1,
    'test', ?, ?)`)
  .run(authorityId, unboundTeacherUserId, clock.toISOString(), clock.toISOString());
db.prepare(`INSERT INTO user_role_grants
  (user_id, role, subject_type, subject_id, status, source, created_at, updated_at)
  VALUES (?, 'admin', NULL, NULL, 'active', 'legacy-test', ?, ?)`)
  .run(legacyOnlyUserId, clock.toISOString(), clock.toISOString());

function insertAuthorization(
  id,
  deviceId,
  fingerprint,
  authorizationSource = 'wechat_phone',
  deviceKind = 'desktop-client',
  phoneReverifyDueAt = '2026-08-16T08:00:00.000Z',
  userId = canonicalId,
) {
  db.prepare(`INSERT INTO desktop_device_authorizations
    (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
     status, source_challenge_id, authorization_source, last_phone_verified_at, phone_reverify_due_at,
     credential_version, row_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'test-public-key', ?, 'active', ?, ?, ?, ?, 1, 1, ?, ?)`)
    .run(
      id,
      deviceId,
      deviceId,
      deviceKind,
      userId,
      fingerprint,
      `challenge-${deviceId}`,
      authorizationSource,
      clock.toISOString(),
      phoneReverifyDueAt,
      clock.toISOString(),
      clock.toISOString()
    );
}

insertAuthorization('authorization-host', 'device-host', '1'.repeat(64));
insertAuthorization('authorization-second', 'device-second', '2'.repeat(64));
insertAuthorization(
  'authorization-unbound-teacher',
  'device-unbound-teacher',
  '3'.repeat(64),
  'wechat_phone',
  'desktop-client',
  '2026-08-16T08:00:00.000Z',
  unboundTeacherUserId,
);
insertAuthorization(
  'authorization-legacy-only',
  'device-legacy-only',
  '4'.repeat(64),
  'wechat_phone',
  'desktop-client',
  '2026-08-16T08:00:00.000Z',
  legacyOnlyUserId,
);
insertAuthorization(
  'authorization-visitor-only',
  'device-visitor-only',
  '5'.repeat(64),
  'wechat_phone',
  'desktop-client',
  '2026-08-16T08:00:00.000Z',
  visitorOnlyUserId,
);
const service = createDesktopSessionService({
  db,
  jwtSecret,
  now: function () { return new Date(clock); },
  uuid: function () { sequence += 1; return `desktop-session-${sequence}`; },
});

assert.ok(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='desktop_sessions'"
).get());

const teacherSession = service.issueSession({
  userId: canonicalId,
  deviceId: 'device-host',
});
assert.strictEqual(teacherSession.session.activeRole, 'teacher');
assert.deepStrictEqual(teacherSession.session.eligibleRoles, ['super_admin', 'teacher', 'student']);
assert.strictEqual(teacherSession.session.teacherId, 'teacher-self');
assert.strictEqual(teacherSession.session.authVersion, 7);
assert.strictEqual(teacherSession.session.credentialVersion, 1);
assert.strictEqual(teacherSession.session.authorizationId, 'authorization-host');
assert.strictEqual(teacherSession.session.authTime, null);
assert.ok(Date.parse(teacherSession.session.expiresAt) - clock.getTime() <= 14 * 24 * 60 * 60 * 1000);
assert.ok(!teacherSession.token.includes(jwtSecret));

const teacherContext = service.verifySessionToken(teacherSession.token);
assert.strictEqual(teacherContext.userId, canonicalId);
assert.strictEqual(teacherContext.deviceId, 'device-host');
assert.strictEqual(teacherContext.activeRole, 'teacher');
assert.strictEqual(teacherContext.scope.kind, 'teacher');
assert.strictEqual(teacherContext.scope.teacherId, 'teacher-self');
assert.ok(Object.isFrozen(teacherContext));

const unboundStudentSession = service.issueSession({
  userId: canonicalId,
  deviceId: 'device-host',
  activeRole: 'student',
});
assert.strictEqual(unboundStudentSession.session.studentId, null);
const unboundStudentContext = service.verifySessionToken(unboundStudentSession.token);
assert.strictEqual(unboundStudentContext.activeRole, 'student');
assert.strictEqual(unboundStudentContext.studentId, null);
assert.deepStrictEqual(unboundStudentContext.scope, { kind: 'none' },
  'a null-subject student grant may create a desktop role session but has no business scope');

const unboundTeacherSession = service.issueSession({
  userId: unboundTeacherUserId,
  deviceId: 'device-unbound-teacher',
  activeRole: 'teacher',
});
assert.strictEqual(unboundTeacherSession.session.teacherId, null);
const unboundTeacherContext = service.verifySessionToken(unboundTeacherSession.token);
assert.strictEqual(unboundTeacherContext.activeRole, 'teacher');
assert.strictEqual(unboundTeacherContext.teacherId, null);
assert.deepStrictEqual(unboundTeacherContext.scope, { kind: 'none' },
  'a null-subject teacher grant may create a desktop role session but has no business scope');

assert.throws(
  () => service.issueSession({
    userId: legacyOnlyUserId,
    deviceId: 'device-legacy-only',
    activeRole: 'admin',
  }),
  error => error?.code === 'ACTIVE_ROLE_NOT_GRANTED',
  'legacy user_role_grants rows alone must not authorize a desktop role session',
);

const visitorOnlySession = service.issueSession({
  userId: visitorOnlyUserId,
  deviceId: 'device-visitor-only',
});
assert.strictEqual(visitorOnlySession.session.activeRole, 'visitor');
assert.deepStrictEqual(visitorOnlySession.session.eligibleRoles, ['visitor']);
const visitorOnlyContext = service.verifySessionToken(visitorOnlySession.token);
assert.deepStrictEqual(visitorOnlyContext.scope, {
  kind: 'visitor',
  userId: visitorOnlyUserId,
});
assert.throws(
  () => service.issueSession({
    userId: visitorOnlyUserId,
    deviceId: 'device-visitor-only',
    activeRole: 'admin',
  }),
  error => error?.code === 'ACTIVE_ROLE_NOT_GRANTED',
  'users.role must not lend admin privileges to a canonical visitor account',
);

const elevated = service.issueSession({
  userId: canonicalId,
  deviceId: 'device-host',
  activeRole: 'super_admin',
  authTime: clock,
});
const elevatedContext = service.verifySessionToken(elevated.token);
assert.strictEqual(elevatedContext.activeRole, 'super_admin');
assert.strictEqual(elevatedContext.scope.kind, 'all');
assert.strictEqual(elevatedContext.authTime, clock.toISOString());
assert.strictEqual(
  service.assertRecentSuperAdmin(elevatedContext, { targetDeviceId: 'device-second' }),
  elevatedContext
);
assert.throws(
  function () {
    service.assertRecentSuperAdmin(teacherContext, { targetDeviceId: 'device-second' });
  },
  function (error) { return error && error.code === 'DESKTOP_SUPER_ADMIN_ROLE_REQUIRED'; }
);
assert.throws(
  function () {
    service.assertRecentSuperAdmin(elevatedContext, { targetDeviceId: 'device-host' });
  },
  function (error) { return error && error.code === 'DESKTOP_DEVICE_SELF_APPROVAL_FORBIDDEN'; }
);
assert.throws(
  function () {
    service.assertRecentSuperAdmin(
      { ...elevatedContext, authTime: '2026-07-17T07:44:59.000Z' },
      { targetDeviceId: 'device-second' }
    );
  },
  function (error) { return error && error.code === 'DESKTOP_RECENT_ELEVATION_REQUIRED'; }
);

assert.throws(
  function () {
    service.issueSession({
      userId: canonicalId,
      deviceId: 'device-host',
      activeRole: 'admin',
    });
  },
  function (error) { return error && error.code === 'ACTIVE_ROLE_NOT_GRANTED'; }
);
assert.throws(
  function () {
    service.issueSession({
      userId: canonicalId,
      deviceId: 'device-host',
      durationMs: 14 * 24 * 60 * 60 * 1000 + 1,
    });
  },
  function (error) { return error && error.code === 'DESKTOP_SESSION_DURATION_INVALID'; }
);
assert.throws(
  function () {
    service.issueSession({
      userId: canonicalId,
      deviceId: 'device-host',
      activeRole: 'super_admin',
      authTime: '2026-07-17T08:01:00.000Z',
    });
  },
  function (error) { return error && error.code === 'DESKTOP_SESSION_AUTH_TIME_INVALID'; }
);

db.prepare('UPDATE users SET auth_version=8 WHERE id=?').run(canonicalId);
assert.throws(
  function () { service.verifySessionToken(teacherSession.token); },
  function (error) { return error && error.code === 'DESKTOP_SESSION_AUTH_VERSION_MISMATCH'; }
);
db.prepare('UPDATE users SET auth_version=7 WHERE id=?').run(canonicalId);

db.prepare(`UPDATE desktop_device_authorizations
  SET credential_version=2 WHERE device_id='device-host'`).run();
assert.throws(
  function () { service.verifySessionToken(teacherSession.token); },
  function (error) { return error && error.code === 'DESKTOP_SESSION_CREDENTIAL_VERSION_MISMATCH'; }
);
db.prepare(`UPDATE desktop_device_authorizations
  SET credential_version=1 WHERE device_id='device-host'`).run();

db.prepare(`UPDATE desktop_device_authorizations
  SET status='revoked' WHERE device_id='device-host'`).run();
assert.throws(
  function () { service.verifySessionToken(teacherSession.token); },
  function (error) { return error && error.code === 'DESKTOP_DEVICE_NOT_ACTIVE'; }
);
db.prepare(`UPDATE desktop_device_authorizations
  SET status='active' WHERE device_id='device-host'`).run();

db.prepare(`UPDATE desktop_device_authorizations
  SET phone_reverify_due_at='2026-07-17T07:59:59.000Z' WHERE device_id='device-host'`).run();
assert.throws(
  function () { service.verifySessionToken(teacherSession.token); },
  function (error) { return error && error.code === 'DESKTOP_PHONE_REVERIFICATION_REQUIRED'; }
);
db.prepare(`UPDATE desktop_device_authorizations
  SET phone_reverify_due_at='2026-08-16T08:00:00.000Z' WHERE device_id='device-host'`).run();

const secondSession = service.issueSession({
  userId: canonicalId,
  deviceId: 'device-second',
});
assert.strictEqual(service.verifySessionToken(secondSession.token).deviceId, 'device-second');
const revoked = service.revokeDeviceAuthorization({
  deviceId: 'device-second',
  actorContext: elevatedContext,
  expectedRowVersion: 1,
  reason: 'lost',
});
assert.strictEqual(revoked.status, 'revoked');
assert.strictEqual(revoked.credentialVersion, 2);
assert.strictEqual(revoked.rowVersion, 2);
assert.deepStrictEqual(
  db.prepare(`SELECT actor_user_id, target_user_id, action
    FROM authorization_audit_log WHERE action='desktop_device_authorization_revoked'`).get(),
  {
    actor_user_id: canonicalId,
    target_user_id: canonicalId,
    action: 'desktop_device_authorization_revoked',
  }
);
assert.throws(
  function () { service.verifySessionToken(secondSession.token); },
  function (error) { return error && error.code === 'DESKTOP_SESSION_REVOKED'; }
);
assert.strictEqual(service.verifySessionToken(teacherSession.token).deviceId, 'device-host');
assert.throws(
  function () {
    service.revokeDeviceAuthorization({
      deviceId: 'device-second',
      actorContext: elevatedContext,
      expectedRowVersion: 1,
      reason: 'lost',
    });
  },
  function (error) { return error && error.code === 'DESKTOP_DEVICE_VERSION_STALE'; }
);

clock = new Date('2026-07-31T08:00:01.000Z');
assert.throws(
  function () { service.verifySessionToken(teacherSession.token); },
  function (error) { return error && error.code === 'DESKTOP_SESSION_EXPIRED'; }
);

db.close();
console.log('desktop session service tests passed');
