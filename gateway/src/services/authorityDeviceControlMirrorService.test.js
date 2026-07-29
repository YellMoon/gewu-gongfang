const assert = require('assert');
const Database = require('better-sqlite3');
const {
  createAuthorityDeviceControlMirrorService,
} = require('./authorityDeviceControlMirrorService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY);
  INSERT INTO users(id) VALUES('user-1');
  CREATE TABLE authority_device_control_mirror_versions (
    authority_id TEXT PRIMARY KEY, host_epoch_id TEXT NOT NULL,
    host_generation INTEGER NOT NULL, source_version INTEGER NOT NULL,
    snapshot_hash TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE authority_accounts (
    user_id TEXT NOT NULL, authority_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,authority_id)
  );
  CREATE TABLE device_grants (
    grant_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, device_id TEXT NOT NULL,
    user_id TEXT NOT NULL, public_key TEXT NOT NULL, host_generation INTEGER NOT NULL,
    status TEXT NOT NULL, grant_version INTEGER NOT NULL, approved_by TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE TABLE device_leases (
    lease_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, authority_id TEXT NOT NULL,
    device_id TEXT NOT NULL, user_id TEXT NOT NULL, active_role TEXT NOT NULL,
    grant_version INTEGER NOT NULL, status TEXT NOT NULL, issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE TABLE authority_role_bindings (
    binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL,
    grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, revoked_at TEXT
  );
`);
const snapshot = {
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  hostGeneration: 3,
  sourceVersion: 11,
  accounts: [{
    userId: 'user-1', authorityId: 'authority-1', status: 'active',
    createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z',
  }],
  grants: [{
    grantId: 'grant-1', authorityId: 'authority-1', deviceId: 'device-1',
    userId: 'user-1', publicKey: 'public-key', hostGeneration: 3,
    status: 'active', grantVersion: 2, approvedBy: 'super-1',
    createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z',
  }],
  leases: [{
    leaseId: 'lease-1', grantId: 'grant-1', authorityId: 'authority-1',
    deviceId: 'device-1', userId: 'user-1', activeRole: 'student',
    grantVersion: 2, status: 'active', issuedAt: '2026-07-28T00:00:00.000Z',
    expiresAt: '2026-08-11T00:00:00.000Z',
  }],
  roleBindings: [{ bindingId: 'binding-1', authorityId: 'authority-1', userId: 'user-1', role: 'student', status: 'active', grantVersion: 2, createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z' }],
};
const service = createAuthorityDeviceControlMirrorService({ db });
assert.deepStrictEqual(service.replace(snapshot), {
  authorityId: 'authority-1', sourceVersion: 11, accounts: 1, grants: 1, leases: 1, roleBindings: 1,
  replayed: false,
});
assert.strictEqual(
  db.prepare("SELECT status FROM device_grants WHERE grant_id='grant-1'").get().status,
  'active',
);
assert.strictEqual(
  db.prepare("SELECT active_role FROM device_leases WHERE lease_id='lease-1'").get().active_role,
  'student',
);
assert.strictEqual(service.replace(snapshot).replayed, true);
assert.throws(
  () => service.replace({ ...snapshot, sourceVersion: 10 }),
  error => error.code === 'AUTHORITY_DEVICE_CONTROL_MIRROR_VERSION_STALE',
);
assert.throws(
  () => service.replace({
    ...snapshot,
    grants: [{ ...snapshot.grants[0], authorityId: 'authority-other' }],
  }),
  error => error.code === 'AUTHORITY_DEVICE_CONTROL_MIRROR_SCOPE_MISMATCH',
);
assert.throws(
  () => service.replace({
    ...snapshot,
    leases: [{ ...snapshot.leases[0], grantId: 'grant-other' }],
  }),
  error => error.code === 'AUTHORITY_DEVICE_CONTROL_MIRROR_GRANT_MISSING',
);

db.close();
console.log('gateway authorityDeviceControlMirrorService tests passed');
