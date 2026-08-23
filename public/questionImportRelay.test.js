'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { sealQuestionImportSource, sealQuestionAsset } = require('./questionImportRelay');
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

const assetPlaintext = Buffer.from('image-bytes');
const assetRelay = sealQuestionAsset({
  agentPublicKey, storageTaskId: 'task_12345679', objectId: 'obj_asset_1', objectVersion: 1, bytes: assetPlaintext,
});
assert.strictEqual(assetRelay.sourceSha256, crypto.createHash('sha256').update(assetPlaintext).digest('hex'));
assert.strictEqual(assetRelay.sourceBytes, assetPlaintext.length);
assert.deepStrictEqual(openForAgent({
  agentPrivateKey, binding: 'task_12345679:obj_asset_1:1', envelope: assetRelay.envelope, ciphertext: Buffer.from(assetRelay.ciphertextBase64, 'base64url'),
}), assetPlaintext);
assert.throws(() => sealQuestionAsset({ agentPublicKey, storageTaskId: 'task_x', objectId: 'obj_asset_1', objectVersion: 1, bytes: assetPlaintext }), /QUESTION_IMPORT_RELAY_INPUT_INVALID/);
console.log('question import relay checks passed');
