const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createDesktopSessionService } = require('./desktopSessionService');
const {
  createDesktopDeviceChallengeService,
  createDesktopOfflineLease,
  desktopDeviceSessionSigningPayload,
} = require('./desktopDeviceChallengeService');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));

let clock = new Date('2026-07-17T10:00:00.000Z');
let challengeSequence = 0;
let sessionSequence = 0;
const userId = 'canonical-super-admin-teacher';
const teacherId = 'teacher-self';
const authorizationId = 'authorization-device-2';
const deviceId = 'device-2';
const jwtSecret = 'desktop-device-challenge-test-secret';
const keyPair = crypto.generateKeyPairSync('ed25519');
const otherKeyPair = crypto.generateKeyPairSync('ed25519');
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const publicKeyDer = keyPair.publicKey.export({ type: 'spki', format: 'der' });
const keyFingerprint = crypto.createHash('sha256').update(publicKeyDer).digest('hex');

db.prepare(`INSERT INTO teachers
  (id, name, phone, deleted, created_at, updated_at)
  VALUES (?, 'Canonical Teacher', '13732250653', 0, ?, ?)`)
  .run(teacherId, clock.toISOString(), clock.toISOString());
db.prepare(`INSERT INTO users
  (id, phone, name, role, status, login_enabled, teacher_id, review_status,
   auth_version, deleted, created_at, updated_at)
  VALUES (?, '13732250653', 'Canonical Human', 'super_admin', 1, 1, ?,
    'approved', 1, 0, ?, ?)`)
  .run(userId, teacherId, clock.toISOString(), clock.toISOString());
const authorityId = 'authority-desktop-device-challenge-test';
db.prepare(`INSERT INTO authority_accounts
  (user_id, authority_id, status, created_at, updated_at)
  VALUES (?, ?, 'active', ?, ?)`)
  .run(userId, authorityId, clock.toISOString(), clock.toISOString());
for (const grant of [
  ['super_admin', null, null],
  ['teacher', 'teacher', teacherId],
]) {
  db.prepare(`INSERT INTO authority_role_bindings
    (binding_id, authority_id, user_id, role, subject_type, subject_id, status,
     grant_version, granted_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 'test', ?, ?)`)
    .run(`binding-${grant[0]}`, authorityId, userId, grant[0], grant[1], grant[2],
      clock.toISOString(), clock.toISOString());
}
db.prepare(`INSERT INTO desktop_device_authorizations
  (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
   status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
   credential_version, row_version, created_at, updated_at)
  VALUES (?, ?, 'Second PC', 'desktop-client', ?, ?, ?, 'active',
    'registration-challenge', ?, '2026-08-16T10:00:00.000Z', 3, 1, ?, ?)`)
  .run(
    authorizationId,
    deviceId,
    userId,
    publicKey,
    keyFingerprint,
    clock.toISOString(),
    clock.toISOString(),
    clock.toISOString()
  );

assert.ok(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='desktop_device_session_challenges'"
).get(), 'daily device session challenge table must exist');

const sessions = createDesktopSessionService({
  db,
  jwtSecret,
  now: function () { return new Date(clock); },
  uuid: function () { sessionSequence += 1; return `desktop-session-${sessionSequence}`; },
});
const service = createDesktopDeviceChallengeService({
  db,
  sessionService: sessions,
  now: function () { return new Date(clock); },
  uuid: function () { challengeSequence += 1; return `device-challenge-${challengeSequence}`; },
  randomBytes: function () { return Buffer.alloc(32, challengeSequence); },
});

const started = service.startChallenge({ authorizationId, deviceId });
assert.deepStrictEqual(
  Object.keys(started).sort(),
  [
    'authorizationId', 'credentialVersion', 'deviceId', 'expiresAt', 'id',
    'nonce', 'nonceIssuedAt', 'rowVersion', 'status',
  ].sort()
);
assert.strictEqual(started.authorizationId, authorizationId);
assert.strictEqual(started.deviceId, deviceId);
assert.strictEqual(started.credentialVersion, 3);
assert.strictEqual(started.status, 'pending');
assert.strictEqual(started.rowVersion, 1);
assert.strictEqual(Date.parse(started.expiresAt) - clock.getTime(), 2 * 60 * 1000);
assert.ok(started.nonce.length >= 40);
const stored = db.prepare(
  'SELECT * FROM desktop_device_session_challenges WHERE id=?'
).get(started.id);
assert.strictEqual(stored.nonce_hash.length, 64);
assert.ok(!JSON.stringify(stored).includes(started.nonce), 'raw server nonce must not be stored');

assert.throws(
  function () { service.startChallenge({ authorizationId, deviceId: 'copied-device-id' }); },
  function (error) { return error.code === 'DESKTOP_DEVICE_AUTHORIZATION_MISMATCH'; }
);

const payload = desktopDeviceSessionSigningPayload(started);
assert.ok(payload.startsWith('gewu-desktop-session-v2\n'));
assert.ok(payload.includes(started.id));
assert.ok(payload.includes(authorizationId));
assert.ok(payload.includes(deviceId));
assert.ok(payload.includes('\n3\n'));
const wrongSignature = crypto.sign(
  null,
  Buffer.from(payload, 'utf8'),
  otherKeyPair.privateKey
).toString('base64');
assert.throws(
  function () {
    service.exchangeChallenge({
      challengeId: started.id,
      signature: wrongSignature,
      expectedRowVersion: 1,
    });
  },
  function (error) { return error.code === 'DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID'; }
);
assert.strictEqual(
  db.prepare('SELECT status FROM desktop_device_session_challenges WHERE id=?').get(started.id).status,
  'pending'
);

const signature = crypto.sign(
  null,
  Buffer.from(payload, 'utf8'),
  keyPair.privateKey
).toString('base64');
const exchanged = service.exchangeChallenge({
  challengeId: started.id,
  signature,
  expectedRowVersion: 1,
});
assert.strictEqual(exchanged.session.activeRole, 'teacher');
assert.deepStrictEqual(exchanged.session.eligibleRoles, ['super_admin', 'teacher']);
assert.strictEqual(exchanged.session.teacherId, teacherId);
assert.strictEqual(exchanged.session.authTime, clock.toISOString(),
  'a session challenge signed after locally unlocking the device must count as recent local elevation');
assert.strictEqual(exchanged.profile.userId, userId);
assert.strictEqual(exchanged.profile.user.name, 'Canonical Human');
assert.strictEqual(exchanged.profile.activeRole, 'teacher');
assert.strictEqual(sessions.verifySessionToken(exchanged.token).deviceId, deviceId);
assert.strictEqual(exchanged.offlineLease.userId, userId);
assert.strictEqual(exchanged.offlineLease.deviceId, deviceId);
assert.strictEqual(exchanged.offlineLease.authorizationId, authorizationId);
assert.strictEqual(exchanged.offlineLease.credentialVersion, 3);
assert.strictEqual(exchanged.offlineLease.activeRole, 'teacher');
assert.strictEqual(exchanged.offlineLease.teacherId, teacherId);
assert.strictEqual(exchanged.offlineLease.scope.kind, 'teacher');
assert.strictEqual(
  Date.parse(exchanged.offlineLease.expiresAt) - Date.parse(exchanged.offlineLease.issuedAt),
  14 * 24 * 60 * 60 * 1000
);
const consumed = db.prepare(
  'SELECT status, issued_session_id, row_version FROM desktop_device_session_challenges WHERE id=?'
).get(started.id);
assert.deepStrictEqual(consumed, {
  status: 'consumed',
  issued_session_id: exchanged.session.id,
  row_version: 2,
});
assert.throws(
  function () {
    service.exchangeChallenge({
      challengeId: started.id,
      signature,
      expectedRowVersion: 1,
    });
  },
  function (error) { return error.code === 'DESKTOP_SESSION_CHALLENGE_REPLAYED'; }
);

const expiring = service.startChallenge({ authorizationId, deviceId });
clock = new Date('2026-07-17T10:02:01.000Z');
const expiredPayload = desktopDeviceSessionSigningPayload(expiring);
const expiredSignature = crypto.sign(
  null,
  Buffer.from(expiredPayload, 'utf8'),
  keyPair.privateKey
).toString('base64');
assert.throws(
  function () {
    service.exchangeChallenge({
      challengeId: expiring.id,
      signature: expiredSignature,
      expectedRowVersion: 1,
    });
  },
  function (error) { return error.code === 'DESKTOP_SESSION_CHALLENGE_EXPIRED'; }
);
assert.strictEqual(
  db.prepare('SELECT status FROM desktop_device_session_challenges WHERE id=?').get(expiring.id).status,
  'expired'
);

db.prepare(`UPDATE desktop_device_authorizations
  SET phone_reverify_due_at='2026-07-17T10:02:00.000Z'
  WHERE id=?`).run(authorizationId);
assert.throws(
  function () { service.startChallenge({ authorizationId, deviceId }); },
  function (error) { return error.code === 'DESKTOP_PHONE_REVERIFICATION_REQUIRED'; }
);

console.log('desktop device challenge service checks passed');
