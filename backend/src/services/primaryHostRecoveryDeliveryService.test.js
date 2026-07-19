const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  ACK_SIGNATURE_ALGORITHM,
  CONTENT_ENCRYPTION_ALGORITHM,
  DELIVERY_PROTOCOL_VERSION,
  KEY_WRAP_ALGORITHM,
  RECOVERY_DELIVERY_KEY_ALGORITHM,
  generateRecoveryDeliveryKeyPair,
  openRecoveryPackage,
  signRecoveryDeliveryAcknowledgement,
} = require('./primaryHostRecoveryDeliveryProtocol');
const { createPrimaryHostRecoveryDeliveryService } = require('./primaryHostRecoveryDeliveryService');

function expectCode(action, code) {
  assert.throws(action, error => error?.code === code);
}

const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
const createdAt = '2026-07-19T00:00:00.000Z';
db.prepare(`INSERT INTO users
  (id, phone, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
  VALUES ('owner-1', '13900000081', 'Owner', 'super_admin', 1, 1, 'approved', 0, ?, ?)`)
  .run(createdAt, createdAt);
for (const [authorizationId, deviceId, fingerprint, kind] of [
  ['authorization-target', 'target-device', 'a'.repeat(64), 'primary-host'],
  ['authorization-other', 'other-device', 'b'.repeat(64), 'desktop-client'],
]) {
  db.prepare(`INSERT INTO desktop_device_authorizations
    (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
     status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
     credential_version, row_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'owner-1', 'device-public-key', ?, 'active', ?, ?,
      '2026-08-19T00:00:00.000Z', 1, 1, ?, ?)`)
    .run(authorizationId, deviceId, deviceId, kind, fingerprint, `source-${deviceId}`,
      createdAt, createdAt, createdAt);
}
db.prepare(`INSERT INTO primary_host_operation_challenges
  (id, operation, requested_by_user_id, requested_by_device_id, target_device_id,
   status, expires_at, row_version, created_at, updated_at, consumed_at)
  VALUES ('challenge-1', 'bootstrap', 'owner-1', 'target-device', 'target-device',
    'consumed', '2026-07-19T01:00:00.000Z', 2, ?, ?, ?)`)
  .run(createdAt, createdAt, createdAt);
db.prepare(`INSERT INTO primary_host_epochs
  (id, generation, device_id, user_id, authorization_id, status, activation_reason,
   challenge_id, db_instance_digest, schema_version, store_id, db_authority_id,
   host_credential_hash, credential_version, row_version, created_at, updated_at, activated_at)
  VALUES ('epoch-1', 1, 'target-device', 'owner-1', 'authorization-target', 'active', 'bootstrap',
    'challenge-1', ?, 3108, 'store-1', 'authority-1', ?, 1, 1, ?, ?, ?)`)
  .run('c'.repeat(64), 'd'.repeat(64), createdAt, createdAt, createdAt);
db.prepare(`INSERT INTO host_recovery_factors
  (id, epoch_id, user_id, device_id, generation, factor_hash, factor_salt,
   kdf_params_json, status, row_version, created_at, updated_at)
  VALUES ('factor-1', 'epoch-1', 'owner-1', 'target-device', 1, ?, ?, ?, 'active', 1, ?, ?)`)
  .run('e'.repeat(64), 'f'.repeat(32), JSON.stringify({ algorithm: 'scrypt' }), createdAt, createdAt);

const clock = { value: new Date(createdAt) };
let sequence = 0;
const service = createPrimaryHostRecoveryDeliveryService({
  db,
  now: () => new Date(clock.value),
  uuid: purpose => `${purpose}-${++sequence}`,
  randomBytes: size => Buffer.alloc(size, 7),
});
const keyPair = generateRecoveryDeliveryKeyPair();
const descriptor = Object.freeze({
  protocolVersion: DELIVERY_PROTOCOL_VERSION,
  keyAlgorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
  keyWrapAlgorithm: KEY_WRAP_ALGORITHM,
  contentEncryptionAlgorithm: CONTENT_ENCRYPTION_ALGORITHM,
  acknowledgementSignatureAlgorithm: ACK_SIGNATURE_ALGORITHM,
  recipientKeyFingerprint: keyPair.publicKeyFingerprint,
});
const deliveryKey = Object.freeze({
  protocolVersion: DELIVERY_PROTOCOL_VERSION,
  algorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
  publicKeyPem: keyPair.publicKeyPem,
  publicKeyFingerprint: keyPair.publicKeyFingerprint,
});
const recoveryPackage = Object.freeze({
  factorId: 'factor-1',
  recoveryCode: 'one-time-secret',
  epochId: 'epoch-1',
  generation: 1,
});

expectCode(
  () => service.prepare({
    epochId: 'epoch-1', factorId: 'factor-1', userId: 'owner-1', deviceId: 'target-device',
    generation: 1, recoveryPackage, deliveryKey,
    recoveryDeliveryDescriptor: { ...descriptor, recipientKeyFingerprint: '0'.repeat(64) },
  }),
  'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID'
);

const prepared = service.prepare({
  epochId: 'epoch-1',
  factorId: 'factor-1',
  userId: 'owner-1',
  deviceId: 'target-device',
  generation: 1,
  recoveryPackage,
  deliveryKey,
  recoveryDeliveryDescriptor: descriptor,
});
assert.match(prepared.id, /^recovery-delivery-/);
assert.strictEqual(prepared.ackNonce, '07'.repeat(32));
service.storePrepared(prepared);

const stored = db.prepare('SELECT * FROM host_recovery_deliveries WHERE id=?').get(prepared.id);
assert.strictEqual(stored.status, 'pending');
assert.strictEqual(stored.row_version, 1);
assert.strictEqual(stored.recipient_key_fingerprint, keyPair.publicKeyFingerprint);
assert.strictEqual(stored.ack_nonce, prepared.ackNonce);
assert.strictEqual(JSON.stringify(stored).includes(recoveryPackage.recoveryCode), false);

const targetView = service.getTargetDelivery({
  epochId: 'epoch-1', userId: 'owner-1', deviceId: 'target-device',
});
assert.strictEqual(targetView.id, prepared.id);
assert.strictEqual(targetView.epochId, 'epoch-1');
assert.strictEqual(targetView.factorId, 'factor-1');
assert.strictEqual(targetView.generation, 1);
assert.strictEqual(targetView.status, 'pending');
assert.strictEqual(targetView.rowVersion, 1);
assert.strictEqual(targetView.ackNonce, prepared.ackNonce);
assert.strictEqual(targetView.recipientKeyFingerprint, keyPair.publicKeyFingerprint);
assert.strictEqual(targetView.attentionLevel, 'normal');
assert.deepStrictEqual(openRecoveryPackage({
  envelope: targetView.envelope,
  privateKeyPem: keyPair.privateKeyPem,
  expected: {
    epochId: targetView.epochId,
    factorId: targetView.factorId,
    deviceId: 'target-device',
    generation: targetView.generation,
    recipientPublicKeyFingerprint: targetView.recipientKeyFingerprint,
  },
}), recoveryPackage);
assert.deepStrictEqual(service.getPendingSummary({
  userId: 'owner-1', deviceId: 'target-device',
}), {
  id: targetView.id,
  epochId: 'epoch-1',
  factorId: 'factor-1',
  generation: 1,
  status: 'pending',
  rowVersion: 1,
  recipientKeyFingerprint: keyPair.publicKeyFingerprint,
  createdAt,
  acknowledgedAt: null,
  attentionLevel: 'normal',
});
assert.strictEqual(service.hasPendingForUser('owner-1'), true);
expectCode(
  () => service.getTargetDelivery({
    epochId: 'epoch-1', userId: 'owner-1', deviceId: 'other-device',
  }),
  'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND'
);

clock.value = new Date('2026-07-20T00:00:01.000Z');
assert.strictEqual(service.getTargetDelivery({
  epochId: 'epoch-1', userId: 'owner-1', deviceId: 'target-device',
}).attentionLevel, 'due_24h');
clock.value = new Date('2026-07-26T00:00:01.000Z');
assert.strictEqual(service.getTargetDelivery({
  epochId: 'epoch-1', userId: 'owner-1', deviceId: 'target-device',
}).attentionLevel, 'overdue_7d');
assert.ok(db.prepare('SELECT envelope_json FROM host_recovery_deliveries WHERE id=?').get(prepared.id).envelope_json);

let acknowledgement = {
  deliveryId: prepared.id,
  epochId: 'epoch-1',
  factorId: 'factor-1',
  recipientKeyFingerprint: keyPair.publicKeyFingerprint,
  expectedRowVersion: 1,
  acknowledgementNonce: prepared.ackNonce,
  acknowledgedAt: '2026-07-19T00:01:00.000Z',
};
let signature = signRecoveryDeliveryAcknowledgement({ acknowledgement, privateKeyPem: keyPair.privateKeyPem });
expectCode(
  () => service.acknowledge({
    actor: { userId: 'owner-1', deviceId: 'target-device' }, acknowledgement, signature,
  }),
  'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_CONFLICT'
);

clock.value = new Date('2026-07-26T00:01:00.000Z');
acknowledgement = { ...acknowledgement, acknowledgedAt: clock.value.toISOString() };
signature = signRecoveryDeliveryAcknowledgement({ acknowledgement, privateKeyPem: keyPair.privateKeyPem });
expectCode(
  () => service.acknowledge({
    actor: { userId: 'owner-1', deviceId: 'other-device' }, acknowledgement, signature,
  }),
  'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND'
);
expectCode(
  () => service.acknowledge({
    actor: { userId: 'owner-1', deviceId: 'target-device' },
    acknowledgement,
    signature: Buffer.from('invalid-proof').toString('base64'),
  }),
  'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_PROOF_INVALID'
);
assert.strictEqual(
  db.prepare('SELECT status FROM host_recovery_deliveries WHERE id=?').get(prepared.id).status,
  'pending'
);

assert.deepStrictEqual(service.acknowledge({
  actor: { userId: 'owner-1', deviceId: 'target-device' }, acknowledgement, signature,
}), {
  id: prepared.id,
  status: 'acknowledged',
  rowVersion: 2,
  acknowledgedAt: clock.value.toISOString(),
  recipientKeyFingerprint: keyPair.publicKeyFingerprint,
});

const cleared = db.prepare('SELECT * FROM host_recovery_deliveries WHERE id=?').get(prepared.id);
assert.strictEqual(cleared.status, 'acknowledged');
assert.strictEqual(cleared.envelope_json, null);
assert.strictEqual(cleared.recipient_public_key_pem, null);
assert.strictEqual(cleared.ack_nonce, null);
assert.strictEqual(cleared.recipient_key_fingerprint, keyPair.publicKeyFingerprint);
assert.strictEqual(
  db.prepare('SELECT status FROM host_recovery_factors WHERE id=?').get('factor-1').status,
  'active'
);
assert.strictEqual(service.hasPendingForUser('owner-1'), false);
assert.strictEqual(service.getPendingSummary({ userId: 'owner-1', deviceId: 'target-device' }), null);
assert.deepStrictEqual(service.acknowledge({
  actor: { userId: 'owner-1', deviceId: 'target-device' }, acknowledgement, signature,
}), {
  id: prepared.id,
  status: 'acknowledged',
  rowVersion: 2,
  acknowledgedAt: clock.value.toISOString(),
  recipientKeyFingerprint: keyPair.publicKeyFingerprint,
});

const auditRows = db.prepare(`SELECT action, before_json, after_json
  FROM authorization_audit_log WHERE action LIKE 'primary_host_recovery_delivery_%'
  ORDER BY created_at, rowid`).all();
assert.deepStrictEqual(auditRows.map(row => row.action), [
  'primary_host_recovery_delivery_created',
  'primary_host_recovery_delivery_ack_failed',
  'primary_host_recovery_delivery_ack_failed',
  'primary_host_recovery_delivery_acknowledged',
]);
const persistedText = JSON.stringify({
  delivery: db.prepare('SELECT * FROM host_recovery_deliveries WHERE id=?').get(prepared.id),
  factor: db.prepare('SELECT * FROM host_recovery_factors WHERE id=?').get('factor-1'),
  auditRows,
});
for (const forbidden of [
  recoveryPackage.recoveryCode,
  keyPair.privateKeyPem,
  'wrappedKey',
  'ciphertext',
  'recoveryCode',
  'acknowledgementNonce',
  'signature',
]) {
  assert.strictEqual(persistedText.includes(forbidden), false, `database/audit leaked ${forbidden}`);
}

db.close();
console.log('primary host recovery delivery service checks passed');
