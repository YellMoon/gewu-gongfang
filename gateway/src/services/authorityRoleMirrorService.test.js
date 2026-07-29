const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {
  createSignedAuthorityProjection,
} = require('../../../shared/authorityProjectionProtocol');
const {
  createAuthorityRoleMirrorService,
} = require('./authorityRoleMirrorService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY);
  INSERT INTO users(id) VALUES('super-admin-1'),('visitor-1');
  CREATE TABLE authority_role_bindings (
    binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL,
    grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE TABLE authority_role_mirror_versions (
    authority_id TEXT PRIMARY KEY, host_epoch_id TEXT NOT NULL,
    source_version INTEGER NOT NULL, payload_hash TEXT NOT NULL,
    projection_signature TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );
  CREATE TABLE role_application_mirrors (
    authority_id TEXT NOT NULL, application_id TEXT NOT NULL, host_epoch_id TEXT NOT NULL,
    source_version INTEGER NOT NULL, user_id TEXT NOT NULL, requested_role TEXT NOT NULL,
    status TEXT NOT NULL, payload_json TEXT NOT NULL, projection_signature TEXT NOT NULL,
    generated_at TEXT NOT NULL, PRIMARY KEY(authority_id,application_id)
  );
  CREATE TABLE role_grant_mirrors (
    authority_id TEXT NOT NULL, binding_id TEXT NOT NULL, host_epoch_id TEXT NOT NULL,
    source_version INTEGER NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
    grant_version INTEGER NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL,
    projection_signature TEXT NOT NULL, generated_at TEXT NOT NULL,
    PRIMARY KEY(authority_id,binding_id)
  );
`);
const hostKey = crypto.generateKeyPairSync('ed25519');
const signed = createSignedAuthorityProjection({
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  userId: 'super-admin-1',
  role: 'super_admin',
  sourceVersion: 8,
  generatedAt: '2026-07-28T08:00:00.000Z',
  payload: {
    roleApplications: [{
      applicationId: 'application-1',
      authorityId: 'authority-1',
      userId: 'visitor-1',
      requestedRole: 'student',
      bindingHint: 'student-optional',
      status: 'pending',
    }],
    roleGrants: [{
      bindingId: 'binding-1',
      authorityId: 'authority-1',
      userId: 'super-admin-1',
      role: 'super_admin',
      status: 'active',
      grantVersion: 2,
    }],
  },
  privateKey: hostKey.privateKey,
});
const service = createAuthorityRoleMirrorService({ db });
const first = service.replaceFromVerifiedProjection(signed);
assert.deepStrictEqual(first, {
  authorityId: 'authority-1',
  sourceVersion: 8,
  applications: 1,
  grants: 1,
  replayed: false,
});
assert.strictEqual(
  db.prepare("SELECT projection_signature FROM role_application_mirrors WHERE application_id='application-1'").get()
    .projection_signature,
  signed.signature,
);
assert.strictEqual(
  db.prepare("SELECT grant_version FROM role_grant_mirrors WHERE binding_id='binding-1'").get()
    .grant_version,
  2,
);
assert.deepStrictEqual(
  db.prepare("SELECT user_id,role,status,grant_version FROM authority_role_bindings WHERE binding_id='binding-1'").get(),
  { user_id: 'super-admin-1', role: 'super_admin', status: 'active', grant_version: 2 },
);
assert.strictEqual(service.replaceFromVerifiedProjection(signed).replayed, true);

const stale = { ...signed, sourceVersion: 7 };
assert.throws(
  () => service.replaceFromVerifiedProjection(stale),
  error => error.code === 'AUTHORITY_ROLE_MIRROR_VERSION_STALE',
);
assert.throws(
  () => service.replaceFromVerifiedProjection({ ...signed, role: 'admin' }),
  error => error.code === 'AUTHORITY_ROLE_MIRROR_SUPER_ADMIN_PROJECTION_REQUIRED',
);
assert.throws(
  () => service.replaceFromVerifiedProjection({
    ...signed,
    payload: {
      ...signed.payload,
      roleApplications: [{
        ...signed.payload.roleApplications[0],
        authorityId: 'authority-other',
      }],
    },
  }),
  error => error.code === 'AUTHORITY_ROLE_MIRROR_AUTHORITY_MISMATCH',
);

db.close();
console.log('gateway authorityRoleMirrorService tests passed');
