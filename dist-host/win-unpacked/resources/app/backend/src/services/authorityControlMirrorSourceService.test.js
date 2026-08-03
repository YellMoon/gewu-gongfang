const assert = require('assert');
const Database = require('better-sqlite3');
const {
  createAuthorityControlMirrorSourceService,
} = require('./authorityControlMirrorSourceService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE primary_host_epochs (
    id TEXT PRIMARY KEY, db_authority_id TEXT NOT NULL, generation INTEGER NOT NULL,
    status TEXT NOT NULL
  );
  CREATE TABLE authority_projection_versions (
    authority_id TEXT NOT NULL, host_epoch_id TEXT NOT NULL, version INTEGER NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY(authority_id,host_epoch_id)
  );
  CREATE TABLE authority_accounts (
    user_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
  INSERT INTO primary_host_epochs VALUES('epoch-1','authority-1',3,'active');
  INSERT INTO authority_projection_versions VALUES(
    'authority-1','epoch-1',11,'2026-07-28T08:00:00.000Z'
  );
  INSERT INTO authority_accounts VALUES(
    'user-1','authority-1','active','2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z'
  );
  INSERT INTO device_grants VALUES(
    'grant-1','authority-1','device-1','user-1','public-key',3,'active',2,'super-1',
    '2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z',NULL
  );
  INSERT INTO device_leases VALUES(
    'lease-1','grant-1','authority-1','device-1','user-1','student',2,'active',
    '2026-07-28T00:00:00.000Z','2026-08-11T00:00:00.000Z',NULL
  );
`);

const snapshot = createAuthorityControlMirrorSourceService({ db }).load({
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
});
assert.strictEqual(snapshot.sourceVersion, 11);
assert.strictEqual(snapshot.hostGeneration, 3);
assert.deepStrictEqual(snapshot.accounts.map(item => item.userId), ['user-1']);
assert.deepStrictEqual(snapshot.grants.map(item => item.grantId), ['grant-1']);
assert.deepStrictEqual(snapshot.leases.map(item => item.leaseId), ['lease-1']);
assert.strictEqual(JSON.stringify(snapshot).includes('host_credential'), false);
assert.throws(
  () => createAuthorityControlMirrorSourceService({ db }).load({
    authorityId: 'authority-other',
    hostEpochId: 'epoch-1',
  }),
  error => error.code === 'AUTHORITY_CONTROL_MIRROR_EPOCH_INACTIVE',
);

db.close();
console.log('authorityControlMirrorSourceService tests passed');
