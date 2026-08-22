'use strict';

const assert = require('assert');
const crypto = require('crypto');

const { sealForAgent, openForAgent } = require('./encryptedNasRelay');

function main() {
  const pair = crypto.generateKeyPairSync('x25519');
  const agentPublicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const agentPrivateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
  const binding = 'task_12345678:obj_1:1';
  const plaintext = Buffer.from('encrypted NAS relay media', 'utf8');
  const relay = sealForAgent({ agentPublicKey, binding, plaintext });

  assert.deepStrictEqual(openForAgent({ agentPrivateKey, binding, envelope: relay.envelope, ciphertext: relay.ciphertext }), plaintext);
  assert.strictEqual(relay.envelope.version, 'x25519-aes-256-gcm-v1');
  assert.strictEqual(relay.envelope.plaintextSha256, crypto.createHash('sha256').update(plaintext).digest('hex'));
  assert.strictEqual(relay.envelope.plaintextBytes, plaintext.length);
  assert.ok(!JSON.stringify(relay.envelope).includes(plaintext.toString('utf8')), 'metadata must not contain plaintext');

  assert.throws(
    () => openForAgent({ agentPrivateKey, binding: 'task_12345678:obj_1:2', envelope: relay.envelope, ciphertext: relay.ciphertext }),
    /RELAY_ENVELOPE_AUTH_FAILED/,
    'a relay must be cryptographically bound to exactly one task/object/version'
  );
  assert.throws(
    () => openForAgent({ agentPrivateKey, binding, envelope: relay.envelope, ciphertext: Buffer.concat([relay.ciphertext, Buffer.from([0])]) }),
    /RELAY_ENVELOPE_AUTH_FAILED/,
    'ciphertext changes must fail before NAS storage'
  );
}

try {
  main();
  console.log('encrypted NAS relay envelope checks passed');
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
