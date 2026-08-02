'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { createAuthorityDeviceControlCache } = require('./authorityDeviceControlCache');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`CREATE TABLE users(
  id TEXT PRIMARY KEY, phone TEXT, name TEXT, nickname TEXT, avatar_url TEXT,
  role TEXT DEFAULT 'visitor', status INTEGER DEFAULT 1, login_enabled INTEGER DEFAULT 1,
  identity_kind TEXT, auth_version INTEGER DEFAULT 1, review_status TEXT DEFAULT 'approved',
  deleted INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE authority_accounts(
  user_id TEXT PRIMARY KEY,authority_id TEXT,status TEXT,created_at TEXT,updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE device_grants(grant_id TEXT,authority_id TEXT,device_id TEXT,user_id TEXT,public_key TEXT,host_generation INTEGER,status TEXT,grant_version INTEGER,approved_by TEXT,created_at TEXT,updated_at TEXT,revoked_at TEXT);
CREATE TABLE device_leases(lease_id TEXT,grant_id TEXT,authority_id TEXT,device_id TEXT,user_id TEXT,active_role TEXT,grant_version INTEGER,status TEXT,issued_at TEXT,expires_at TEXT,revoked_at TEXT);
CREATE TABLE authority_role_bindings(binding_id TEXT,authority_id TEXT,user_id TEXT,role TEXT,subject_type TEXT,subject_id TEXT,status TEXT,grant_version INTEGER,granted_by TEXT,created_at TEXT,updated_at TEXT,revoked_at TEXT);
INSERT INTO users(id,name,role,identity_kind,created_at,updated_at)
  VALUES('u','Local administrator','visitor','visitor','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
  VALUES('u','a','active','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
INSERT INTO authority_role_bindings(binding_id,authority_id,user_id,role,status,grant_version,created_at,updated_at)
  VALUES('local-role','a','u','super_admin','active',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);

const cache = createAuthorityDeviceControlCache({ db });
const result = cache.replace({
  authorityId: 'a', hostEpochId: 'e', hostGeneration: 1, sourceVersion: 1,
  accounts: [
    { userId: 'u', authorityId: 'a', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { userId: 'visitor', authorityId: 'a', status: 'active', phone: '19972110012', name: 'Miniapp visitor', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
  ],
  grants: [{ grantId: 'g', authorityId: 'a', deviceId: 'd', userId: 'u', publicKey: 'key', hostGeneration: 1, status: 'active', grantVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  leases: [{ leaseId: 'l', grantId: 'g', authorityId: 'a', deviceId: 'd', userId: 'u', activeRole: 'super_admin', grantVersion: 1, status: 'active', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z' }],
  roleBindings: [{
    bindingId: 'cloud-bootstrap-role', authorityId: 'a', userId: 'u', role: 'admin',
    subjectType: null, subjectId: null, status: 'active', grantVersion: 1,
    grantedBy: 'u', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', revokedAt: null,
  }],
});

assert.strictEqual(result.grants, 1);
assert.strictEqual(db.prepare("SELECT status FROM device_grants WHERE grant_id='g'").get().status, 'active');
assert.strictEqual(db.prepare("SELECT role FROM authority_role_bindings WHERE binding_id='local-role'").get().role, 'super_admin',
  'cloud control refresh must not replace host-owned role bindings');
assert.strictEqual(db.prepare("SELECT role FROM authority_role_bindings WHERE binding_id='cloud-bootstrap-role'").get(), undefined,
  'an unsigned cloud control snapshot must never install a role binding on the authoritative host');
assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM authority_role_bindings WHERE authority_id='a'").get().count, 1,
  'forged cloud roles must leave the host-owned role table unchanged');
assert.strictEqual(result.recoveryRoleBindings, 0);
assert.strictEqual(result.ignoredUnsignedRoleBindings, 1);
assert.deepStrictEqual(
  db.prepare("SELECT id,phone,role,identity_kind,login_enabled FROM users WHERE id='visitor'").get(),
  { id: 'visitor', phone: '19972110012', role: 'visitor', identity_kind: 'visitor', login_enabled: 0 },
  'a cloud-owned miniapp account must create its minimal immutable user subject before the FK account row',
);
assert.strictEqual(db.prepare("SELECT status FROM authority_accounts WHERE user_id='visitor'").get().status, 'active');

assert.doesNotThrow(() => cache.replace({
  authorityId: 'a', hostEpochId: 'e2', hostGeneration: 2, sourceVersion: 0,
  accounts: [
    { userId: 'u', authorityId: 'a', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ],
  grants: [{ grantId: 'g2', authorityId: 'a', deviceId: 'd', userId: 'u', publicKey: 'key2', hostGeneration: 2, status: 'active', grantVersion: 1, createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' }],
  leases: [{ leaseId: 'l2', grantId: 'g2', authorityId: 'a', deviceId: 'd', userId: 'u', activeRole: 'super_admin', grantVersion: 1, status: 'active', issuedAt: '2026-01-03T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z' }],
  roleBindings: [],
}), 'an authenticated replacement host epoch must be allowed to restart the cloud-control source counter');
assert.strictEqual(db.prepare("SELECT grant_id FROM device_grants WHERE authority_id='a'").get().grant_id, 'g2');

db.close();
console.log('authority device control cache checks passed');
