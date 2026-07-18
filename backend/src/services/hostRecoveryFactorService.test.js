const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createHostRecoveryFactorService } = require('./hostRecoveryFactorService');

const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
const timestamp = '2026-07-18T00:00:00.000Z';
db.prepare(`INSERT INTO users
  (id, phone, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
  VALUES ('owner-1', '13900000071', 'Owner', 'super_admin', 1, 1, 'approved', 0, ?, ?)`)
  .run(timestamp, timestamp);
for (const [deviceId, authorizationId] of [['device-1', 'authorization-1'], ['device-2', 'authorization-2']]) {
  db.prepare(`INSERT INTO desktop_device_authorizations
    (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
     status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
     credential_version, row_version, created_at, updated_at)
    VALUES (?, ?, ?, 'desktop-client', 'owner-1', 'public-key', ?, 'active', ?, ?,
      '2026-08-18T00:00:00.000Z', 1, 1, ?, ?)`)
    .run(authorizationId, deviceId, deviceId, deviceId === 'device-1' ? 'a'.repeat(64) : 'b'.repeat(64),
      `source-${deviceId}`, timestamp, timestamp, timestamp);
}
db.prepare(`INSERT INTO primary_host_operation_challenges
  (id, operation, requested_by_user_id, requested_by_device_id, target_device_id,
   status, expires_at, row_version, created_at, updated_at, consumed_at)
  VALUES ('challenge-1', 'bootstrap', 'owner-1', 'device-1', 'device-1', 'consumed',
    '2026-07-18T01:00:00.000Z', 2, ?, ?, ?)`)
  .run(timestamp, timestamp, timestamp);
db.prepare(`INSERT INTO primary_host_epochs
  (id, generation, device_id, user_id, authorization_id, status, activation_reason,
   challenge_id, db_instance_digest, schema_version, store_id, db_authority_id,
   host_credential_hash, credential_version, row_version, created_at, updated_at, activated_at)
  VALUES ('epoch-1', 1, 'device-1', 'owner-1', 'authorization-1', 'active', 'bootstrap',
    'challenge-1', ?, 3107, 'store-1', 'authority-1', ?, 1, 1, ?, ?, ?)`)
  .run('c'.repeat(64), 'd'.repeat(64), timestamp, timestamp, timestamp);
let sequence = 0;
const service = createHostRecoveryFactorService({
  db,
  now: () => new Date('2026-07-18T00:00:00.000Z'),
  uuid: () => `factor-${++sequence}`,
  randomBytes: size => Buffer.alloc(size, 7 + sequence),
});

const prepared = service.prepare({
  epochId: 'epoch-1',
  userId: 'owner-1',
  deviceId: 'device-1',
  generation: 1,
});
assert.ok(prepared.recoveryPackage.recoveryCode.length >= 32);
service.storePrepared(prepared);

const stored = db.prepare('SELECT * FROM host_recovery_factors WHERE id=?').get(prepared.recoveryPackage.factorId);
assert.strictEqual(stored.status, 'active');
assert.strictEqual(stored.epoch_id, 'epoch-1');
assert.ok(stored.factor_hash.length >= 64);
assert.ok(stored.factor_salt.length >= 32);
assert.ok(stored.kdf_params_json.includes('scrypt'));
assert.ok(!JSON.stringify(stored).includes(prepared.recoveryPackage.recoveryCode), 'raw recovery code must never be stored');

assert.throws(
  () => service.assertUnused({
    factorId: prepared.recoveryPackage.factorId,
    recoveryCode: 'wrong-code',
    userId: 'owner-1',
  }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_FACTOR_INVALID'
);
assert.throws(
  () => service.assertUnused({
    factorId: prepared.recoveryPackage.factorId,
    recoveryCode: prepared.recoveryPackage.recoveryCode,
    userId: 'other-owner',
  }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_FACTOR_OWNER_MISMATCH'
);

const verified = service.assertUnused({
  factorId: prepared.recoveryPackage.factorId,
  recoveryCode: prepared.recoveryPackage.recoveryCode,
  userId: 'owner-1',
});
assert.strictEqual(verified.id, prepared.recoveryPackage.factorId);
service.consumeVerified({ factor: verified, usedByDeviceId: 'device-2' });
assert.strictEqual(db.prepare('SELECT status FROM host_recovery_factors WHERE id=?').get(verified.id).status, 'used');
assert.throws(
  () => service.assertUnused({
    factorId: prepared.recoveryPackage.factorId,
    recoveryCode: prepared.recoveryPackage.recoveryCode,
    userId: 'owner-1',
  }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_FACTOR_USED'
);

const second = service.prepare({ epochId: 'epoch-2', userId: 'owner-1', deviceId: 'device-2', generation: 2 });
db.prepare("UPDATE primary_host_epochs SET status='retired', retired_at=?, updated_at=? WHERE id='epoch-1'")
  .run(timestamp, timestamp);
db.prepare(`INSERT INTO primary_host_operation_challenges
  (id, operation, requested_by_user_id, requested_by_device_id, target_device_id,
   status, expires_at, row_version, created_at, updated_at, consumed_at)
  VALUES ('challenge-2', 'transfer', 'owner-1', 'device-1', 'device-2', 'consumed',
    '2026-07-18T01:00:00.000Z', 2, ?, ?, ?)`)
  .run(timestamp, timestamp, timestamp);
db.prepare(`INSERT INTO primary_host_epochs
  (id, generation, device_id, user_id, authorization_id, status, activation_reason,
   source_epoch_id, challenge_id, db_instance_digest, schema_version, store_id,
   db_authority_id, host_credential_hash, credential_version, row_version,
   created_at, updated_at, activated_at)
  VALUES ('epoch-2', 2, 'device-2', 'owner-1', 'authorization-2', 'active', 'transfer',
    'epoch-1', 'challenge-2', ?, 3107, 'store-1', 'authority-1', ?, 1, 1, ?, ?, ?)`)
  .run('e'.repeat(64), 'f'.repeat(64), timestamp, timestamp, timestamp);
service.storePrepared(second);
assert.strictEqual(service.revokeActiveForUser({ userId: 'owner-1', exceptFactorId: second.recoveryPackage.factorId }), 0);
assert.strictEqual(db.prepare('SELECT status FROM host_recovery_factors WHERE id=?').get(second.recoveryPackage.factorId).status, 'active');

db.close();
console.log('host recovery factor service checks passed');
