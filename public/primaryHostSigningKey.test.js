const assert = require('assert');
const crypto = require('crypto');
const {
  derivePrimaryHostSigningKey,
  signPrimaryHostProjection,
  validatePrimaryHostSigningPublicKey,
} = require('./primaryHostSigningKey');
const { verifySignedAuthorityProjection } = require('../shared/authorityProjectionProtocol');

const first = derivePrimaryHostSigningKey('managed-host-credential-with-enough-entropy');
const repeated = derivePrimaryHostSigningKey('managed-host-credential-with-enough-entropy');
const other = derivePrimaryHostSigningKey('different-managed-host-credential-value');

assert.equal(first.algorithm, 'Ed25519');
assert.equal(first.publicKeyPem, repeated.publicKeyPem);
assert.equal(first.publicKeyFingerprint, repeated.publicKeyFingerprint);
assert.notEqual(first.publicKeyPem, other.publicKeyPem);
assert.equal(Object.hasOwn(first, 'privateKey'), true);
assert.equal(Object.hasOwn(first, 'privateKeyPem'), false);
assert.deepStrictEqual(validatePrimaryHostSigningPublicKey(first), {
  algorithm: 'Ed25519',
  publicKeyPem: first.publicKeyPem,
  publicKeyFingerprint: first.publicKeyFingerprint,
});

const projection = signPrimaryHostProjection({
  hostCredential: 'managed-host-credential-with-enough-entropy',
  projection: {
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    userId: 'user-1',
    role: 'visitor',
    sourceVersion: 1,
    generatedAt: '2026-07-28T00:00:00.000Z',
    payload: { schedules: [], courses: [], assets: [], questionPreviews: [] },
  },
});
assert.deepStrictEqual(
  verifySignedAuthorityProjection({ projection, publicKey: first.publicKeyPem }),
  projection
);
assert.equal(
  crypto.createPublicKey(first.privateKey).export({ type: 'spki', format: 'pem' }).toString(),
  first.publicKeyPem
);
assert.throws(
  () => derivePrimaryHostSigningKey('short'),
  error => error?.code === 'PRIMARY_HOST_SIGNING_CREDENTIAL_INVALID'
);
assert.throws(
  () => validatePrimaryHostSigningPublicKey({
    ...first,
    publicKeyFingerprint: '0'.repeat(64),
  }),
  error => error?.code === 'PRIMARY_HOST_SIGNING_PUBLIC_KEY_INVALID'
);

console.log('primaryHostSigningKey tests passed');
