const assert = require('assert');
const crypto = require('crypto');
const {
  ACK_PROTOCOL_VERSION,
  ACK_SIGNATURE_ALGORITHM,
  CONTENT_ENCRYPTION_ALGORITHM,
  DELIVERY_PROTOCOL_VERSION,
  KEY_WRAP_ALGORITHM,
  RECOVERY_DELIVERY_KEY_ALGORITHM,
  canonicalJson,
  generateRecoveryDeliveryKeyPair,
  validateRecoveryDeliveryPublicKey,
  sealRecoveryPackage,
  openRecoveryPackage,
  signRecoveryDeliveryAcknowledgement,
  verifyRecoveryDeliveryAcknowledgement,
} = require('./primaryHostRecoveryDeliveryProtocol');

function expectCode(action, code) {
  assert.throws(action, error => error?.code === code);
}

assert.strictEqual(
  canonicalJson({ z: 1, a: { y: 2, x: 3 }, list: [{ b: 2, a: 1 }] }),
  '{"a":{"x":3,"y":2},"list":[{"a":1,"b":2}],"z":1}'
);

const keyPair = generateRecoveryDeliveryKeyPair();
assert.strictEqual(keyPair.protocolVersion, DELIVERY_PROTOCOL_VERSION);
assert.strictEqual(keyPair.algorithm, RECOVERY_DELIVERY_KEY_ALGORITHM);
assert.match(keyPair.publicKeyPem, /BEGIN PUBLIC KEY/);
assert.match(keyPair.privateKeyPem, /BEGIN PRIVATE KEY/);
assert.match(keyPair.publicKeyFingerprint, /^[a-f0-9]{64}$/);
assert.deepStrictEqual(validateRecoveryDeliveryPublicKey({
  algorithm: keyPair.algorithm,
  publicKeyPem: keyPair.publicKeyPem,
  publicKeyFingerprint: keyPair.publicKeyFingerprint,
}), {
  algorithm: keyPair.algorithm,
  publicKeyPem: keyPair.publicKeyPem,
  publicKeyFingerprint: keyPair.publicKeyFingerprint,
});
expectCode(
  () => validateRecoveryDeliveryPublicKey({
    algorithm: keyPair.algorithm,
    publicKeyPem: keyPair.publicKeyPem,
    publicKeyFingerprint: '0'.repeat(64),
  }),
  'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID'
);
const undersizedKey = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 0x10001,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
expectCode(
  () => validateRecoveryDeliveryPublicKey({
    algorithm: keyPair.algorithm,
    publicKeyPem: undersizedKey.publicKey,
    publicKeyFingerprint: crypto.createHash('sha256')
      .update(crypto.createPublicKey(undersizedKey.publicKey).export({ type: 'spki', format: 'der' }))
      .digest('hex'),
  }),
  'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID'
);

const recoveryPackage = Object.freeze({
  factorId: 'factor-1',
  recoveryCode: 'offline-secret-code',
  epochId: 'epoch-2',
  generation: 2,
});
const envelopeIdentity = Object.freeze({
  epochId: 'epoch-2',
  factorId: 'factor-1',
  deviceId: 'target-device',
  generation: 2,
  recipientPublicKeyFingerprint: keyPair.publicKeyFingerprint,
});
const envelope = sealRecoveryPackage({
  ...envelopeIdentity,
  recoveryPackage,
  recipientPublicKeyPem: keyPair.publicKeyPem,
});
assert.strictEqual(envelope.protocolVersion, DELIVERY_PROTOCOL_VERSION);
assert.strictEqual(envelope.keyWrapAlgorithm, KEY_WRAP_ALGORITHM);
assert.strictEqual(envelope.contentEncryptionAlgorithm, CONTENT_ENCRYPTION_ALGORITHM);
assert.deepStrictEqual(envelope.aad, {
  epochId: envelopeIdentity.epochId,
  factorId: envelopeIdentity.factorId,
  deviceId: envelopeIdentity.deviceId,
  generation: envelopeIdentity.generation,
  recipientKeyFingerprint: envelopeIdentity.recipientPublicKeyFingerprint,
});
assert.strictEqual(JSON.stringify(envelope).includes(recoveryPackage.recoveryCode), false);
assert.deepStrictEqual(openRecoveryPackage({
  envelope,
  privateKeyPem: keyPair.privateKeyPem,
  expected: envelopeIdentity,
}), recoveryPackage);

const otherKeyPair = generateRecoveryDeliveryKeyPair();
for (const changedEnvelope of [
  { ...envelope, protocolVersion: 'primary-host-recovery-delivery/v2' },
  { ...envelope, keyWrapAlgorithm: 'RSA-OAEP-SHA1' },
  { ...envelope, contentEncryptionAlgorithm: 'AES-128-GCM' },
  { ...envelope, aad: { ...envelope.aad, deviceId: 'attacker-device' } },
  { ...envelope, aad: { ...envelope.aad, epochId: 'epoch-attacker' } },
  { ...envelope, aad: { ...envelope.aad, factorId: 'factor-attacker' } },
  { ...envelope, aad: { ...envelope.aad, generation: 3 } },
  { ...envelope, aad: { ...envelope.aad, recipientKeyFingerprint: otherKeyPair.publicKeyFingerprint } },
]) {
  expectCode(
    () => openRecoveryPackage({
      envelope: changedEnvelope,
      privateKeyPem: keyPair.privateKeyPem,
      expected: envelopeIdentity,
    }),
    'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH'
  );
}

expectCode(
  () => openRecoveryPackage({ envelope, privateKeyPem: otherKeyPair.privateKeyPem, expected: envelopeIdentity }),
  'PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED'
);
for (const field of ['ciphertext', 'authTag', 'wrappedKey']) {
  expectCode(
    () => openRecoveryPackage({
      envelope: { ...envelope, [field]: Buffer.from(`corrupted-${field}`).toString('base64') },
      privateKeyPem: keyPair.privateKeyPem,
      expected: envelopeIdentity,
    }),
    'PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED'
  );
}
expectCode(
  () => openRecoveryPackage({
    envelope,
    privateKeyPem: keyPair.privateKeyPem,
    expected: { ...envelopeIdentity, recipientPublicKeyFingerprint: otherKeyPair.publicKeyFingerprint },
  }),
  'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH'
);

const acknowledgement = Object.freeze({
  deliveryId: 'delivery-1',
  epochId: envelopeIdentity.epochId,
  factorId: envelopeIdentity.factorId,
  recipientPublicKeyFingerprint: keyPair.publicKeyFingerprint,
  acknowledgementNonce: 'a'.repeat(64),
  acknowledgedAt: '2026-07-19T00:01:00.000Z',
  rowVersion: 1,
});
const signature = signRecoveryDeliveryAcknowledgement({
  acknowledgement,
  privateKeyPem: keyPair.privateKeyPem,
});
assert.match(signature, /^[A-Za-z0-9+/]+=*$/);
assert.strictEqual(verifyRecoveryDeliveryAcknowledgement({
  acknowledgement,
  signature,
  publicKeyPem: keyPair.publicKeyPem,
}), true);
for (const changed of [
  { ...acknowledgement, acknowledgementNonce: 'b'.repeat(64) },
  { ...acknowledgement, acknowledgedAt: '2026-07-19T00:02:00.000Z' },
  { ...acknowledgement, rowVersion: 2 },
  { ...acknowledgement, recipientPublicKeyFingerprint: otherKeyPair.publicKeyFingerprint },
]) {
  assert.strictEqual(verifyRecoveryDeliveryAcknowledgement({
    acknowledgement: changed,
    signature,
    publicKeyPem: keyPair.publicKeyPem,
  }), false);
}
assert.strictEqual(verifyRecoveryDeliveryAcknowledgement({
  acknowledgement,
  signature: Buffer.from('invalid-signature').toString('base64'),
  publicKeyPem: keyPair.publicKeyPem,
}), false);
assert.strictEqual(ACK_PROTOCOL_VERSION, 'primary-host-recovery-delivery-ack/v1');
assert.strictEqual(ACK_SIGNATURE_ALGORITHM, 'RSA-PSS-SHA256');

console.log('primary host recovery delivery protocol checks passed');
