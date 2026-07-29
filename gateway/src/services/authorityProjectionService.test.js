const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { createSignedAuthorityProjection } = require('../../../shared/authorityProjectionProtocol');
const { createGatewayAuthorityProjectionService } = require('./authorityProjectionService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE primary_host_epochs (
    id TEXT PRIMARY KEY, db_authority_id TEXT NOT NULL, generation INTEGER NOT NULL,
    device_id TEXT NOT NULL, status TEXT NOT NULL, host_credential_hash TEXT NOT NULL,
    host_public_key TEXT, credential_version INTEGER NOT NULL
  );
  CREATE TABLE authority_scoped_projections (
    authority_id TEXT NOT NULL, host_epoch_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, source_version INTEGER NOT NULL, payload_hash TEXT NOT NULL,
    document_json TEXT NOT NULL, signature TEXT NOT NULL, generated_at TEXT NOT NULL,
    PRIMARY KEY(authority_id,user_id,role)
  );
  CREATE TABLE authority_role_bindings (
    binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL,
    grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE TABLE authority_role_mirror_versions (
    authority_id TEXT PRIMARY KEY, host_epoch_id TEXT NOT NULL,
    source_version INTEGER NOT NULL, payload_hash TEXT NOT NULL,
    projection_signature TEXT NOT NULL, generated_at TEXT NOT NULL
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
const otherKey = crypto.generateKeyPairSync('ed25519');
const publicKey = hostKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
db.prepare(`INSERT INTO primary_host_epochs
  (id,db_authority_id,generation,device_id,status,host_credential_hash,host_public_key,credential_version)
  VALUES('epoch-1','authority-1',1,'host-1','active','hash',?,1)`).run(publicKey);
const input = {
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  userId: 'user-1',
  role: 'student',
  sourceVersion: 1,
  generatedAt: '2026-07-28T08:00:00.000Z',
  payload: { schedules: [], courses: [], assets: [], questionPreviews: [] },
};
const service = createGatewayAuthorityProjectionService({ db });
const signed = createSignedAuthorityProjection({ ...input, privateKey: hostKey.privateKey });
assert.equal(service.publish(signed).sourceVersion, 1);
assert.deepStrictEqual(service.read({
  authorityId: 'authority-1',
  userId: 'user-1',
  role: 'student',
}), signed);
const superAdminProjection = createSignedAuthorityProjection({
  ...input,
  userId: 'super-admin-1',
  role: 'super_admin',
  sourceVersion: 2,
  payload: {
    roleApplications: [{
      applicationId: 'application-1', authorityId: 'authority-1', userId: 'visitor-1',
      requestedRole: 'teacher', status: 'pending',
    }],
    roleGrants: [{
      bindingId: 'binding-1', authorityId: 'authority-1', userId: 'super-admin-1',
      role: 'super_admin', status: 'active', grantVersion: 1,
    }],
  },
  privateKey: hostKey.privateKey,
});
assert.equal(service.publish(superAdminProjection).sourceVersion, 2);
assert.strictEqual(
  db.prepare("SELECT requested_role FROM role_application_mirrors WHERE application_id='application-1'").get()
    .requested_role,
  'teacher',
);
assert.strictEqual(
  db.prepare("SELECT role FROM role_grant_mirrors WHERE binding_id='binding-1'").get().role,
  'super_admin',
);
assert.throws(
  () => service.publish(createSignedAuthorityProjection({ ...input, sourceVersion: 2, privateKey: otherKey.privateKey })),
  error => error.code === 'AUTHORITY_PROJECTION_SIGNATURE_INVALID'
);
db.prepare("UPDATE primary_host_epochs SET status='retired' WHERE id='epoch-1'").run();
assert.throws(
  () => service.publish(createSignedAuthorityProjection({ ...input, sourceVersion: 2, privateKey: hostKey.privateKey })),
  error => error.code === 'AUTHORITY_PROJECTION_HOST_EPOCH_INACTIVE'
);

console.log('gateway authorityProjectionService tests passed');
