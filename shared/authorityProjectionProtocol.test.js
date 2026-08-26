const assert = require('assert');
const crypto = require('crypto');
const {
  createSignedAuthorityProjection,
  verifySignedAuthorityProjection,
} = require('./authorityProjectionProtocol');

const keyPair = crypto.generateKeyPairSync('ed25519');
const input = {
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  userId: 'user-1',
  role: 'student',
  sourceVersion: 7,
  generatedAt: '2026-07-28T08:00:00.000Z',
  payload: {
    schedules: [{ id: 'schedule-1' }],
    courses: [{ id: 'course-1', tuition: 100 }],
    assets: [],
    questionPreviews: [],
  },
};
const signed = createSignedAuthorityProjection({
  ...input,
  privateKey: keyPair.privateKey,
});
assert.equal(signed.protocol, 'gewu.authority-projection.v1');
assert.match(signed.payloadHash, /^[a-f0-9]{64}$/);
assert.match(signed.signature, /^[A-Za-z0-9+/]+=*$/);
assert.deepStrictEqual(
  verifySignedAuthorityProjection({
    projection: signed,
    publicKey: keyPair.publicKey,
  }),
  signed
);
assert.throws(
  () => verifySignedAuthorityProjection({
    projection: { ...signed, payload: { ...signed.payload, courses: [] } },
    publicKey: keyPair.publicKey,
  }),
  error => error.code === 'AUTHORITY_PROJECTION_PAYLOAD_HASH_INVALID'
);
assert.throws(
  () => verifySignedAuthorityProjection({
    projection: { ...signed, sourceVersion: 8 },
    publicKey: keyPair.publicKey,
  }),
  error => error.code === 'AUTHORITY_PROJECTION_SIGNATURE_INVALID'
);
assert.throws(
  () => createSignedAuthorityProjection({ ...input, role: 'admin', privateKey: keyPair.privateKey }),
  error => error.code === 'AUTHORITY_PROJECTION_ROLE_INVALID'
);

console.log('authorityProjectionProtocol tests passed');
