'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { bootstrapVNextControlPlaneReference } = require('./vNextControlPlaneReferenceKernel');
const { createVNextRoleGrantMutationReference } = require('./vNextRoleGrantMutationReference');

const HASH = value => crypto.createHash('sha256').update(value).digest('hex');
const NOW = '2026-08-14T00:00:00.000Z';
const db = new Database(':memory:');
try {
  bootstrapVNextControlPlaneReference(db);
  db.prepare("INSERT INTO vNext_authorities(authority_id,status,created_at,updated_at) VALUES('authority-1','active',?,?)").run(NOW, NOW);
  for (const accountId of ['actor-1','target-1']) db.prepare("INSERT INTO vNext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES(?,'authority-1','active',1,1,1,1,?,?)").run(accountId, NOW, NOW);
  let nextId = 0;
  const service = createVNextRoleGrantMutationReference({
    db,
    now: () => NOW,
    idFactory: kind => `${kind}-${++nextId}`,
    authorize: () => ({ allowed: true, authorityId: 'authority-1', actorAccountId: 'actor-1', context: { gate: 'test' } }),
  });
  const granted = service.execute({ type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'grant-1', reasonCode: 'reviewed' });
  assert.deepStrictEqual(granted, { code: 'ROLE_GRANTED', grantId: 'role-grant-1', replayed: false, status: 'accepted' });
  assert.deepStrictEqual(db.prepare("SELECT auth_version,access_version,revocation_version,row_version FROM vNext_accounts WHERE account_id='target-1'").get(), { auth_version: 2, access_version: 2, revocation_version: 1, row_version: 2 });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_command_receipts').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_audit_events').get().count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_outbox_events').get().count, 1);
  assert.deepStrictEqual(service.execute({ type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'grant-1', reasonCode: 'reviewed' }), { code: 'ROLE_GRANTED', grantId: 'role-grant-1', replayed: true, status: 'accepted' });
  assert.throws(() => service.execute({ type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'grant-1', reasonCode: 'different' }), error => error.code === 'IDEMPOTENCY_KEY_CONFLICT');
  const revoked = service.execute({ type: 'role.revoke', targetGrantId: 'role-grant-1', expectedTargetRowVersion: 1, idempotencyKey: 'revoke-1', reasonCode: 'departure' });
  assert.deepStrictEqual(revoked, { code: 'ROLE_REVOKED', grantId: 'role-grant-1', replayed: false, status: 'accepted' });
  assert.deepStrictEqual(db.prepare("SELECT status,grant_version,row_version FROM vNext_role_grants WHERE grant_id='role-grant-1'").get(), { status: 'revoked', grant_version: 2, row_version: 2 });
  assert.deepStrictEqual(db.prepare("SELECT auth_version,access_version,revocation_version,row_version FROM vNext_accounts WHERE account_id='target-1'").get(), { auth_version: 3, access_version: 3, revocation_version: 2, row_version: 3 });
  const noop = service.execute({ type: 'role.revoke', targetGrantId: 'role-grant-1', expectedTargetRowVersion: 2, idempotencyKey: 'revoke-2', reasonCode: 'repeat' });
  assert.deepStrictEqual(noop, { code: 'ROLE_ALREADY_REVOKED', grantId: 'role-grant-1', replayed: false, status: 'noop' });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_outbox_events').get().count, 2, 'noop must not create an outbox intent');
  assert.throws(() => service.execute({ type: 'role.grant', targetAccountId: 'target-1', role: 'student', expectedTargetRowVersion: 0, idempotencyKey: 'spoof-1', reasonCode: 'bad', authorityId: 'authority-2' }), error => error.code === 'MUTATION_INPUT_INVALID');
} finally { db.close(); }

function seededDb() {
  const value = new Database(':memory:');
  bootstrapVNextControlPlaneReference(value);
  value.prepare("INSERT INTO vNext_authorities(authority_id,status,created_at,updated_at) VALUES('authority-1','active',?,?)").run(NOW, NOW);
  for (const accountId of ['actor-1','target-1']) value.prepare("INSERT INTO vNext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES(?,'authority-1','active',1,1,1,1,?,?)").run(accountId, NOW, NOW);
  return value;
}

const deniedDb = seededDb();
try {
  const denied = createVNextRoleGrantMutationReference({ db: deniedDb, authorize: () => { throw new Error('guard rejects'); } });
  assert.throws(() => denied.execute({ type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'deny-1', reasonCode: 'test' }), error => error.code === 'AUTHORIZATION_DENIED');
  assert.strictEqual(deniedDb.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_command_receipts').get().count, 0, 'guard failure must have zero writes');
  assert.throws(() => createVNextRoleGrantMutationReference({ db: deniedDb }), error => error.code === 'AUTHORIZATION_GUARD_REQUIRED');
} finally { deniedDb.close(); }

const guardDb = seededDb();
try {
  const before = guardDb.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_command_receipts').get().count;
  const denied = createVNextRoleGrantMutationReference({ db: guardDb, authorize: () => ({ allowed: false, authorityId: 'authority-1', actorAccountId: 'actor-1' }) });
  assert.throws(() => denied.execute({ type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'false-guard', reasonCode: 'test' }), error => error.code === 'AUTHORIZATION_DENIED');
  const asyncGuard = createVNextRoleGrantMutationReference({ db: guardDb, authorize: () => Promise.resolve({ allowed: true, authorityId: 'authority-1', actorAccountId: 'actor-1' }) });
  assert.throws(() => asyncGuard.execute({ type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'async-guard', reasonCode: 'test' }), error => error.code === 'AUTHORIZATION_DENIED');
  assert.strictEqual(guardDb.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_command_receipts').get().count, before);
} finally { guardDb.close(); }

const rollbackDb = seededDb();
try {
  let sequence = 0;
  const rollback = createVNextRoleGrantMutationReference({
    db: rollbackDb, now: () => NOW, idFactory: kind => `${kind}-${++sequence}`,
    authorize: () => ({ allowed: true, authorityId: 'authority-1', actorAccountId: 'actor-1', context: {} }),
    testHooks: { afterAudit() { throw new Error('inject audit failure'); } },
  });
  assert.throws(() => rollback.execute({ type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'rollback-1', reasonCode: 'test' }), /inject audit failure/);
  assert.strictEqual(rollbackDb.prepare('SELECT COUNT(*) AS count FROM vNext_role_grants').get().count, 0);
  assert.deepStrictEqual(rollbackDb.prepare("SELECT auth_version,access_version,row_version FROM vNext_accounts WHERE account_id='target-1'").get(), { auth_version: 1, access_version: 1, row_version: 1 });
  assert.strictEqual(rollbackDb.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_command_receipts').get().count, 0);
} finally { rollbackDb.close(); }

const superAdminDb = seededDb();
try {
  superAdminDb.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at,granted_by_account_id) VALUES('only-admin','authority-1','target-1','super_admin','active',1,1,?,?,?,'actor-1')").run(NOW, NOW, NOW);
  let sequence = 0;
  const superAdmin = createVNextRoleGrantMutationReference({ db: superAdminDb, now: () => NOW, idFactory: kind => `${kind}-${++sequence}`, authorize: () => ({ allowed: true, authorityId: 'authority-1', actorAccountId: 'actor-1', context: {} }) });
  assert.deepStrictEqual(superAdmin.execute({ type: 'role.revoke', targetGrantId: 'only-admin', expectedTargetRowVersion: 1, idempotencyKey: 'last-admin-1', reasonCode: 'test' }), { code: 'LAST_SUPER_ADMIN_REVOKE_FORBIDDEN', replayed: false, status: 'rejected' });
  assert.deepStrictEqual(superAdminDb.prepare("SELECT status,row_version FROM vNext_role_grants WHERE grant_id='only-admin'").get(), { status: 'active', row_version: 1 });
  assert.strictEqual(superAdminDb.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_command_receipts').get().count, 1);
  assert.strictEqual(superAdminDb.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_audit_events').get().count, 1);
  assert.strictEqual(superAdminDb.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_outbox_events').get().count, 0);
} finally { superAdminDb.close(); }

const fkOff = seededDb();
try {
  fkOff.pragma('foreign_keys = OFF');
  const before = fkOff.pragma('foreign_keys', { simple: true });
  const service = createVNextRoleGrantMutationReference({ db: fkOff, authorize: () => ({ allowed: true, authorityId: 'authority-1', actorAccountId: 'actor-1' }) });
  assert.throws(() => service.execute({ type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'fk-off', reasonCode: 'test' }), error => error.code === 'VNEXT_REFERENCE_FOREIGN_KEYS_REQUIRED');
  assert.strictEqual(fkOff.pragma('foreign_keys', { simple: true }), before, 'read-only schema assertion must not enable FK');
} finally { fkOff.close(); }

const rejectedReplayDb = seededDb();
try {
  let sequence = 0;
  const service = createVNextRoleGrantMutationReference({ db: rejectedReplayDb, now: () => NOW, idFactory: kind => `${kind}-${++sequence}`, authorize: () => ({ allowed: true, authorityId: 'authority-1', actorAccountId: 'actor-1', context: {} }) });
  const missing = { type: 'role.grant', targetAccountId: 'missing', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'missing-replay', reasonCode: 'test' };
  assert.deepStrictEqual(service.execute(missing), { code: 'TARGET_ACCOUNT_NOT_ACTIVE', replayed: false, status: 'rejected' });
  assert.deepStrictEqual(service.execute(missing), { code: 'TARGET_ACCOUNT_NOT_ACTIVE', replayed: true, status: 'rejected' });
} finally { rejectedReplayDb.close(); }

console.log('vNext role mutation reference checks passed');
