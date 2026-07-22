'use strict';

const assert = require('assert');
const crypto = require('crypto');
const protocol = require('./singleUserPairingEnvelope');

const fixedNow = new Date('2026-07-23T02:00:00.000Z');
const host = protocol.createHostCapability({
  now: () => fixedNow,
  ttlMs: 5 * 60 * 1000,
});
assert.strictEqual(host.publicCapability.protocolVersion, 'gewu-single-user-pairing/v1');
assert.match(host.publicCapability.id, /^[a-f0-9]{32}$/);
assert.strictEqual(Object.hasOwn(host.publicCapability, 'privateKey'), false);
assert.strictEqual(Object.hasOwn(host.publicCapability, 'privateKeyPem'), false);

const device = crypto.generateKeyPairSync('ed25519');
const devicePublicKey = device.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const encrypt = (overrides = {}) => protocol.encryptPairingRequest({
  capability: host.publicCapability,
  pairingCode: '0123-4567-89AB-CDEF',
  device: {
    deviceId: 'ordinary-device-1',
    deviceName: 'Second PC',
    publicKey: devicePublicKey,
    deviceKind: 'desktop-client',
  },
  sign: payload => crypto.sign(null, Buffer.from(payload, 'utf8'), device.privateKey).toString('base64'),
  now: () => fixedNow,
  ...overrides,
});

const encrypted = encrypt();
assert.strictEqual(
  encrypted.clientEphemeralPublicKey,
  encrypted.clientEphemeralPublicKey.trim(),
  'authenticated envelope headers must use a canonical public-key representation'
);
assert.deepStrictEqual(Object.keys(encrypted).sort(), [
  'capabilityId', 'ciphertext', 'clientEphemeralPublicKey', 'iv', 'protocolVersion', 'tag',
].sort());
assert.strictEqual(JSON.stringify(encrypted).includes('0123456789ABCDEF'), false);

const opened = protocol.decryptPairingRequest({
  envelope: encrypted,
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: host.publicCapability.id,
  now: () => fixedNow,
});
assert.strictEqual(opened.pairingCode, '0123456789ABCDEF');
assert.deepStrictEqual(opened.device, {
  deviceId: 'ordinary-device-1',
  deviceName: 'Second PC',
  publicKey: devicePublicKey.trim(),
  deviceKind: 'desktop-client',
});
assert.match(opened.requestNonce, /^[A-Za-z0-9_-]{32,}$/);

const tampered = {
  ...encrypted,
  ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA`,
};
assert.throws(() => protocol.decryptPairingRequest({
  envelope: tampered,
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: host.publicCapability.id,
  now: () => fixedNow,
}), error => error.code === 'PAIRING_ENVELOPE_DECRYPT_FAILED');

const replacementEphemeral = crypto.generateKeyPairSync('x25519').publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()
  .trim();
assert.throws(() => protocol.decryptPairingRequest({
  envelope: { ...encrypted, clientEphemeralPublicKey: replacementEphemeral },
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: host.publicCapability.id,
  now: () => fixedNow,
}), error => error.code === 'PAIRING_ENVELOPE_DECRYPT_FAILED');

const tamperedCapabilityId = `${encrypted.capabilityId[0] === 'f' ? 'e' : 'f'}${encrypted.capabilityId.slice(1)}`;
assert.throws(() => protocol.decryptPairingRequest({
  envelope: { ...encrypted, capabilityId: tamperedCapabilityId },
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: tamperedCapabilityId,
  now: () => fixedNow,
}), error => error.code === 'PAIRING_ENVELOPE_DECRYPT_FAILED');

assert.throws(() => protocol.decryptPairingRequest({
  envelope: { ...encrypted, unexpected: true },
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: host.publicCapability.id,
  now: () => fixedNow,
}), error => error.code === 'PAIRING_ENVELOPE_INVALID');
assert.throws(() => protocol.decryptPairingRequest({
  envelope: { ...encrypted, clientEphemeralPublicKey: 'x'.repeat(4097) },
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: host.publicCapability.id,
  now: () => fixedNow,
}), error => error.code === 'PAIRING_ENVELOPE_INVALID');

const otherDevice = crypto.generateKeyPairSync('ed25519');
const badSignatureEnvelope = encrypt({
  sign: payload => crypto.sign(null, Buffer.from(payload, 'utf8'), otherDevice.privateKey).toString('base64'),
});
assert.throws(() => protocol.decryptPairingRequest({
  envelope: badSignatureEnvelope,
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: host.publicCapability.id,
  now: () => fixedNow,
}), error => error.code === 'PAIRING_DEVICE_SIGNATURE_INVALID');

const mismatchedDeviceKeyEnvelope = encrypt({
  device: {
    deviceId: 'ordinary-device-1',
    deviceName: 'Second PC',
    publicKey: otherDevice.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    deviceKind: 'desktop-client',
  },
});
assert.throws(() => protocol.decryptPairingRequest({
  envelope: mismatchedDeviceKeyEnvelope,
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: host.publicCapability.id,
  now: () => fixedNow,
}), error => error.code === 'PAIRING_DEVICE_SIGNATURE_INVALID');

assert.throws(() => encrypt({ pairingCode: 'IIII-IIII-IIII-IIII' }), error => error.code === 'PAIRING_CODE_INVALID');
assert.throws(() => protocol.decryptPairingRequest({
  envelope: encrypted,
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: 'f'.repeat(32),
  now: () => fixedNow,
}), error => error.code === 'PAIRING_CAPABILITY_MISMATCH');
assert.throws(() => protocol.decryptPairingRequest({
  envelope: encrypted,
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: host.publicCapability.id,
  now: () => new Date('2026-07-23T02:06:00.000Z'),
}), error => error.code === 'PAIRING_CAPABILITY_STALE');

console.log('single-user pairing envelope checks passed');
