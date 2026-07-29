const assert = require('assert');
const crypto = require('crypto');
const {
  authorityHttpSigningPayload,
  verifyAuthorityHttpSignature,
} = require('./authorityHttpAuth');

const keyPair = crypto.generateKeyPairSync('ed25519');
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const actor = Object.freeze({ userId: 'user-1', deviceId: 'device-1', role: 'teacher' });
const request = Object.freeze({
  method: 'POST',
  path: '/api/authority/commands',
  actor,
  body: Object.freeze({ commandId: 'command-1', payload: Object.freeze({ value: 1 }) }),
});

const payload = authorityHttpSigningPayload(request);
assert.strictEqual(payload, authorityHttpSigningPayload({
  ...request,
  body: { payload: { value: 1 }, commandId: 'command-1' },
}));
const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), keyPair.privateKey).toString('base64');
assert.strictEqual(verifyAuthorityHttpSignature({ ...request, publicKey, signature }), true);
assert.throws(
  () => verifyAuthorityHttpSignature({
    ...request,
    path: '/api/authority/commands/other/receipt',
    publicKey,
    signature,
  }),
  error => error?.code === 'AUTHORITY_DEVICE_SIGNATURE_INVALID'
);
assert.throws(
  () => authorityHttpSigningPayload({ ...request, actor: { ...actor, role: '' } }),
  error => error?.code === 'AUTHORITY_HTTP_AUTH_INPUT_INVALID'
);

console.log('authority HTTP auth tests passed');
