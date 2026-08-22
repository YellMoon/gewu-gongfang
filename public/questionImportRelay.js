'use strict';

const crypto = require('crypto');
const { sealForAgent } = require('../shared/encryptedNasRelay');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure('QUESTION_IMPORT_RELAY_INPUT_INVALID');
  return value;
}

function sourceBytes(value) {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) throw failure('QUESTION_IMPORT_RELAY_INPUT_INVALID');
  const bytes = Buffer.from(value);
  if (!bytes.length || bytes.length > (64 * 1024 * 1024)) throw failure('QUESTION_IMPORT_RELAY_INPUT_INVALID');
  return bytes;
}

function sealQuestionImportSource(input) {
  const request = exact(input, ['agentPublicKey', 'storageTaskId', 'objectId', 'objectVersion', 'bytes']);
  if (typeof request.agentPublicKey !== 'string' || !/^[A-Za-z0-9_-]{40,4096}$/.test(request.agentPublicKey)
    || typeof request.storageTaskId !== 'string' || !/^task_[A-Za-z0-9_-]{8,128}$/.test(request.storageTaskId)
    || typeof request.objectId !== 'string' || !/^obj_[A-Za-z0-9_-]{1,128}$/.test(request.objectId)
    || !Number.isSafeInteger(request.objectVersion) || request.objectVersion < 1) throw failure('QUESTION_IMPORT_RELAY_INPUT_INVALID');
  const plaintext = sourceBytes(request.bytes);
  const sealed = sealForAgent({
    agentPublicKey: request.agentPublicKey,
    binding: `${request.storageTaskId}:${request.objectId}:${request.objectVersion}`,
    plaintext,
  });
  return Object.freeze({
    sourceSha256: crypto.createHash('sha256').update(plaintext).digest('hex'),
    sourceBytes: plaintext.length,
    envelope: sealed.envelope,
    ciphertextBase64: sealed.ciphertext.toString('base64url'),
  });
}

module.exports = Object.freeze({ sealQuestionImportSource });
