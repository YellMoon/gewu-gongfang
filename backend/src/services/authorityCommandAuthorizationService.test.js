const assert = require('assert');
const Database = require('better-sqlite3');
const { createAuthorityCommandAuthorizationService } = require('./authorityCommandAuthorizationService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE primary_host_epochs (
      id TEXT PRIMARY KEY, db_authority_id TEXT NOT NULL, device_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE device_grants (
      grant_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, device_id TEXT NOT NULL,
      user_id TEXT NOT NULL, status TEXT NOT NULL, grant_version INTEGER NOT NULL
    );
    CREATE TABLE device_leases (
      lease_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, authority_id TEXT NOT NULL,
      device_id TEXT NOT NULL, user_id TEXT NOT NULL, active_role TEXT NOT NULL,
      grant_version INTEGER NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE authority_role_bindings (
      binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL,
      grant_version INTEGER NOT NULL
    );
    INSERT INTO primary_host_epochs VALUES ('epoch-1', 'authority-1', 'host-device', 'active');
    INSERT INTO device_grants VALUES ('grant-1', 'authority-1', 'device-1', 'user-1', 'active', 3);
    INSERT INTO device_leases VALUES (
      'lease-1', 'grant-1', 'authority-1', 'device-1', 'user-1', 'teacher', 3,
      'active', '2026-07-29T00:00:00.000Z', NULL
    );
    INSERT INTO authority_role_bindings VALUES (
      'binding-1', 'authority-1', 'user-1', 'teacher', 'teacher', 'teacher-1', 'active', 7
    );
  `);
  return db;
}

function envelope(overrides = {}) {
  return {
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'teacher' },
    lease: { id: 'lease-1', grantVersion: 3 },
    type: 'schedule.update.v1',
    ...overrides,
  };
}

const db = createDb();
const service = createAuthorityCommandAuthorizationService({
  db,
  now: () => new Date('2026-07-28T00:00:00.000Z'),
  commandPolicy: ({ type, scope }) => type === 'schedule.update.v1' && scope.kind === 'teacher',
});
assert.deepStrictEqual(service.authorize(envelope()), {
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  hostDeviceId: 'host-device',
  grantId: 'grant-1',
  leaseId: 'lease-1',
  scope: {
    kind: 'teacher',
    userId: 'user-1',
    teacherId: 'teacher-1',
    authorityId: 'authority-1',
  },
});
assert.throws(
  () => service.authorize(envelope({ hostEpochId: 'retired-epoch' })),
  error => error?.code === 'AUTHORITY_HOST_EPOCH_INACTIVE',
);
db.prepare("UPDATE device_leases SET expires_at='2026-07-27T00:00:00.000Z' WHERE lease_id='lease-1'").run();
assert.throws(
  () => service.authorize(envelope()),
  error => error?.code === 'DEVICE_LEASE_EXPIRED',
);
db.prepare("UPDATE device_leases SET expires_at='2026-07-29T00:00:00.000Z' WHERE lease_id='lease-1'").run();
db.prepare("UPDATE authority_role_bindings SET status='revoked' WHERE binding_id='binding-1'").run();
assert.throws(
  () => service.authorize(envelope()),
  error => error?.code === 'ACTING_ROLE_NOT_GRANTED',
);

console.log('authorityCommandAuthorizationService tests passed');
