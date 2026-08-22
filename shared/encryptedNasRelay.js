'use strict';

const crypto = require('crypto');

const VERSION = 'x25519-aes-256-gcm-v1';
const MAX_BYTES = 64 * 1024 * 1024;
const ENVELOPE_KEYS = Object.freeze([
  'version', 'ephemeralPublicKey', 'keyDerivationSalt', 'wrappedKeyNonce', 'wrappedKeyCiphertext', 'wrappedKeyTag',
  'contentNonce', 'contentTag', 'ciphertextSha256', 'ciphertextBytes', 'plaintextSha256', 'plaintextBytes',
]);

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function exactEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== ENVELOPE_KEYS.length || ENVELOPE_KEYS.some(key => !Object.hasOwn(value, key))) {
    throw failure('RELAY_ENVELOPE_INPUT_INVALID');
  }
  return value;
}

function bindingValue(value) {
  if (typeof value !== 'string' || !value || value.length > 512) throw failure('RELAY_ENVELOPE_INPUT_INVALID');
  return value;
}

function bytes(value, name, exactLength = null) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) throw failure('RELAY_ENVELOPE_INPUT_INVALID');
  const decoded = Buffer.from(value, 'base64url');
  if (!decoded.length || (exactLength !== null && decoded.length !== exactLength)) throw failure('RELAY_ENVELOPE_INPUT_INVALID');
  if (decoded.toString('base64url') !== value) throw failure('RELAY_ENVELOPE_INPUT_INVALID');
  return decoded;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_BYTES) throw failure('RELAY_ENVELOPE_INPUT_INVALID');
  return value;
}

function parsePublicKey(value) {
  try {
    const key = crypto.createPublicKey({ key: bytes(value, 'agentPublicKey'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'x25519') throw failure('RELAY_ENVELOPE_INPUT_INVALID');
    return key;
  } catch (error) {
    if (error?.code === 'RELAY_ENVELOPE_INPUT_INVALID') throw error;
    throw failure('RELAY_ENVELOPE_INPUT_INVALID');
  }
}

function parsePrivateKey(value) {
  try {
    const key = crypto.createPrivateKey({ key: bytes(value, 'agentPrivateKey'), format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'x25519') throw failure('RELAY_ENVELOPE_INPUT_INVALID');
    return key;
  } catch (error) {
    if (error?.code === 'RELAY_ENVELOPE_INPUT_INVALID') throw error;
    throw failure('RELAY_ENVELOPE_INPUT_INVALID');
  }
}

function aad(label, binding) {
  return Buffer.from(`${label}:${binding}`, 'utf8');
}

function deriveWrappingKey(secret, salt) {
  return Buffer.from(crypto.hkdfSync('sha256', secret, salt, Buffer.from('gewu-nas-relay-wrap-v1', 'utf8'), 32));
}

function encrypt(key, nonce, additionalData, plaintext) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(additionalData);
  return { ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]), tag: cipher.getAuthTag() };
}

function decrypt(key, nonce, additionalData, ciphertext, tag) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(additionalData);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (_) {
    throw failure('RELAY_ENVELOPE_AUTH_FAILED');
  }
}

function sealForAgent({ agentPublicKey, binding, plaintext } = {}) {
  const targetPublicKey = parsePublicKey(agentPublicKey);
  const currentBinding = bindingValue(binding);
  const cleartext = Buffer.isBuffer(plaintext) ? Buffer.from(plaintext) : null;
  if (!cleartext || cleartext.length > MAX_BYTES) throw failure('RELAY_ENVELOPE_INPUT_INVALID');
  const contentKey = crypto.randomBytes(32);
  const ephemeral = crypto.generateKeyPairSync('x25519');
  const salt = crypto.randomBytes(16);
  const wrapNonce = crypto.randomBytes(12);
  const contentNonce = crypto.randomBytes(12);
  const wrappingKey = deriveWrappingKey(crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey: targetPublicKey }), salt);
  const wrapped = encrypt(wrappingKey, wrapNonce, aad('wrap', currentBinding), contentKey);
  const encrypted = encrypt(contentKey, contentNonce, aad('content', currentBinding), cleartext);
  return Object.freeze({
    ciphertext: encrypted.ciphertext,
    envelope: Object.freeze({
      version: VERSION,
      ephemeralPublicKey: ephemeral.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
      keyDerivationSalt: salt.toString('base64url'),
      wrappedKeyNonce: wrapNonce.toString('base64url'),
      wrappedKeyCiphertext: wrapped.ciphertext.toString('base64url'),
      wrappedKeyTag: wrapped.tag.toString('base64url'),
      contentNonce: contentNonce.toString('base64url'),
      contentTag: encrypted.tag.toString('base64url'),
      ciphertextSha256: hash(encrypted.ciphertext),
      ciphertextBytes: encrypted.ciphertext.length,
      plaintextSha256: hash(cleartext),
      plaintextBytes: cleartext.length,
    }),
  });
}

function openForAgent({ agentPrivateKey, binding, envelope, ciphertext } = {}) {
  const privateKey = parsePrivateKey(agentPrivateKey);
  const currentBinding = bindingValue(binding);
  const metadata = exactEnvelope(envelope);
  if (metadata.version !== VERSION || typeof metadata.ciphertextSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(metadata.ciphertextSha256)
    || typeof metadata.plaintextSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(metadata.plaintextSha256)) throw failure('RELAY_ENVELOPE_INPUT_INVALID');
  const encrypted = Buffer.isBuffer(ciphertext) ? Buffer.from(ciphertext) : null;
  if (!encrypted || count(metadata.ciphertextBytes) !== encrypted.length || hash(encrypted) !== metadata.ciphertextSha256) throw failure('RELAY_ENVELOPE_AUTH_FAILED');
  try {
    const ephemeralPublicKey = crypto.createPublicKey({ key: bytes(metadata.ephemeralPublicKey, 'ephemeralPublicKey'), format: 'der', type: 'spki' });
    if (ephemeralPublicKey.asymmetricKeyType !== 'x25519') throw failure('RELAY_ENVELOPE_INPUT_INVALID');
    const salt = bytes(metadata.keyDerivationSalt, 'keyDerivationSalt', 16);
    const wrappingKey = deriveWrappingKey(crypto.diffieHellman({ privateKey, publicKey: ephemeralPublicKey }), salt);
    const contentKey = decrypt(wrappingKey, bytes(metadata.wrappedKeyNonce, 'wrappedKeyNonce', 12), aad('wrap', currentBinding), bytes(metadata.wrappedKeyCiphertext, 'wrappedKeyCiphertext', 32), bytes(metadata.wrappedKeyTag, 'wrappedKeyTag', 16));
    const cleartext = decrypt(contentKey, bytes(metadata.contentNonce, 'contentNonce', 12), aad('content', currentBinding), encrypted, bytes(metadata.contentTag, 'contentTag', 16));
    if (count(metadata.plaintextBytes) !== cleartext.length || hash(cleartext) !== metadata.plaintextSha256) throw failure('RELAY_ENVELOPE_AUTH_FAILED');
    return cleartext;
  } catch (error) {
    if (error?.code === 'RELAY_ENVELOPE_AUTH_FAILED' || error?.code === 'RELAY_ENVELOPE_INPUT_INVALID') throw error;
    throw failure('RELAY_ENVELOPE_AUTH_FAILED');
  }
}

module.exports = Object.freeze({ sealForAgent, openForAgent });
