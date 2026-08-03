const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createDesktopAuthorizationProjectionService } = require('./desktopAuthorizationProjectionService');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));

const now = '2026-07-28T12:00:00.000Z';
db.prepare(`INSERT INTO users
  (id, phone, name, role, status, login_enabled, review_status, auth_version, deleted, created_at, updated_at)
  VALUES ('host-user-1', '13800138000', 'Host User', 'admin', 1, 1, 'approved', 1, 0, ?, ?)`)
  .run(now, now);
db.prepare(`INSERT INTO user_role_grants
  (user_id, role, subject_type, subject_id, status, source, created_at, updated_at)
  VALUES ('host-user-1', 'admin', NULL, NULL, 'active', 'host-authority', ?, ?)`)
  .run(now, now);

const service = createDesktopAuthorizationProjectionService({
  db,
  now: () => new Date(now),
});

const projection = {
  authorization: {
    id: 'cloud-auth-1',
    deviceId: 'client-device-1',
    deviceName: 'Ordinary desktop',
    deviceKind: 'desktop-client',
    userId: 'host-user-1',
    publicKey: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7\n-----END PUBLIC KEY-----',
    keyFingerprint: 'a'.repeat(64),
    credentialVersion: 3,
    authorizationSource: 'wechat_phone',
    lastPhoneVerifiedAt: now,
    phoneReverifyDueAt: '2026-08-11T12:00:00.000Z',
    status: 'active',
  },
};

const created = service.apply(projection);
assert.deepStrictEqual(created, {
  authorizationId: 'cloud-auth-1',
  deviceId: 'client-device-1',
  userId: 'host-user-1',
  status: 'active',
  changed: true,
});
const row = db.prepare('SELECT * FROM desktop_device_authorizations WHERE id=?').get('cloud-auth-1');
assert.strictEqual(row.user_id, 'host-user-1');
assert.strictEqual(row.key_fingerprint, 'a'.repeat(64));
assert.strictEqual(row.credential_version, 3);
assert.strictEqual(row.authorization_source, 'wechat_phone');
assert.strictEqual(row.status, 'active');
assert.strictEqual(
  db.prepare("SELECT source FROM user_role_grants WHERE user_id='host-user-1' AND role='admin'").get().source,
  'host-authority',
  'a cloud device projection must never create or alter host-owned role grants'
);

const replayed = service.apply(projection);
assert.strictEqual(replayed.changed, false, 'an identical projection must be idempotent');

assert.throws(
  () => service.apply({ authorization: { ...projection.authorization, userId: 'unknown-host-user' } }),
  error => error.code === 'DESKTOP_AUTHORIZATION_PROJECTION_USER_NOT_FOUND'
);
assert.throws(
  () => service.apply({ authorization: { ...projection.authorization, status: 'pending' } }),
  error => error.code === 'DESKTOP_AUTHORIZATION_PROJECTION_STATUS_INVALID'
);
assert.strictEqual(
  db.prepare('SELECT COUNT(*) AS count FROM desktop_device_authorizations').get().count,
  1,
  'a rejected projection must not leave an authorization row behind'
);

console.log('desktop authorization projection checks passed');
