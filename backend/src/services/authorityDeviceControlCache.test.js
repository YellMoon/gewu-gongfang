'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { createAuthorityDeviceControlCache } = require('./authorityDeviceControlCache');

const db = new Database(':memory:');
db.exec(`CREATE TABLE authority_accounts(user_id TEXT,authority_id TEXT,status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE device_grants(grant_id TEXT,authority_id TEXT,device_id TEXT,user_id TEXT,public_key TEXT,host_generation INTEGER,status TEXT,grant_version INTEGER,approved_by TEXT,created_at TEXT,updated_at TEXT,revoked_at TEXT);
CREATE TABLE device_leases(lease_id TEXT,grant_id TEXT,authority_id TEXT,device_id TEXT,user_id TEXT,active_role TEXT,grant_version INTEGER,status TEXT,issued_at TEXT,expires_at TEXT,revoked_at TEXT);`);
db.exec('CREATE TABLE authority_role_bindings(binding_id TEXT,authority_id TEXT,user_id TEXT,role TEXT,subject_type TEXT,subject_id TEXT,status TEXT,grant_version INTEGER,granted_by TEXT,created_at TEXT,updated_at TEXT,revoked_at TEXT);');
const cache = createAuthorityDeviceControlCache({ db });
const result = cache.replace({ authorityId: 'a', hostEpochId: 'e', hostGeneration: 1, sourceVersion: 1,
  accounts: [{ userId: 'u', authorityId: 'a', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  grants: [{ grantId: 'g', authorityId: 'a', deviceId: 'd', userId: 'u', publicKey: 'key', hostGeneration: 1, status: 'active', grantVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  leases: [{ leaseId: 'l', grantId: 'g', authorityId: 'a', deviceId: 'd', userId: 'u', activeRole: 'super_admin', grantVersion: 1, status: 'active', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z' }],
  roleBindings: [{ bindingId: 'b', authorityId: 'a', userId: 'u', role: 'super_admin', status: 'active', grantVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
});
assert.strictEqual(result.grants, 1);
assert.strictEqual(db.prepare("SELECT status FROM device_grants WHERE grant_id='g'").get().status, 'active');
assert.strictEqual(db.prepare("SELECT role FROM authority_role_bindings WHERE binding_id='b'").get().role, 'super_admin');
console.log('authority device control cache checks passed');
