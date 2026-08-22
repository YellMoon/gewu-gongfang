'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { sealQuestionImportSource } = require('./questionImportRelay');
const { openForAgent } = require('../shared/encryptedNasRelay');

const pair = crypto.generateKeyPairSync('x25519');
const agentPublicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
const agentPrivateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
const plaintext = Buffer.from('word-source');
const relay = sealQuestionImportSource({
  agentPublicKey, storageTaskId: 'task_12345678', objectId: 'obj_source_1', objectVersion: 1, bytes: plaintext,
});
assert.strictEqual(relay.sourceSha256, crypto.createHash('sha256').update(plaintext).digest('hex'));
assert.strictEqual(relay.sourceBytes, plaintext.length);
assert.deepStrictEqual(openForAgent({
  agentPrivateKey, binding: 'task_12345678:obj_source_1:1', envelope: relay.envelope, ciphertext: Buffer.from(relay.ciphertextBase64, 'base64url'),
}), plaintext);
assert.throws(() => sealQuestionImportSource({ ...relay, bytes: plaintext }), /QUESTION_IMPORT_RELAY_INPUT_INVALID/);
assert.throws(() => sealQuestionImportSource({ agentPublicKey, storageTaskId: 'task_x', objectId: 'obj_source_1', objectVersion: 1, bytes: plaintext }), /QUESTION_IMPORT_RELAY_INPUT_INVALID/);
console.log('question import relay checks passed');
