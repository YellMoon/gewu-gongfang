'use strict';

const assert = require('assert');
const { ensureLocalSessionSigningSecret } = require('./localSessionSigningSecret');

const env = {};
const bridgeSecret = 'bridge-secret-for-test-with-at-least-32-bytes';
const first = ensureLocalSessionSigningSecret(env, bridgeSecret);
assert.match(first, /^[a-f0-9]{64}$/);
assert.strictEqual(env.JWT_SECRET, first);
assert.strictEqual(ensureLocalSessionSigningSecret({}, bridgeSecret), first);

const managed = { JWT_SECRET: 'externally-managed-jwt-secret' };
assert.strictEqual(
  ensureLocalSessionSigningSecret(managed, 'different-bridge-secret'),
  'externally-managed-jwt-secret',
);

assert.throws(
  () => ensureLocalSessionSigningSecret({}, ''),
  error => error.code === 'LOCAL_SESSION_SIGNING_SECRET_REQUIRED',
);

console.log('local session signing secret checks passed');
