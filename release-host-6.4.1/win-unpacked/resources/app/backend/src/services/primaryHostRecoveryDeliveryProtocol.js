const crypto = require('crypto');

const DELIVERY_PROTOCOL_VERSION = 'primary-host-recovery-delivery/v1';
const ACK_PROTOCOL_VERSION = 'primary-host-recovery-delivery-ack/v1';
const RECOVERY_DELIVERY_KEY_ALGORITHM = 'RSA-3072';
const KEY_WRAP_ALGORITHM = 'RSA-OAEP-SHA256';
const CONTENT_ENCRYPTION_ALGORITHM = 'AES-256-GCM';
const ACK_SIGNATURE_ALGORITHM = 'RSA-PSS-SHA256';

function protocolError(code, message, cause) {
  const error = new Error(message || code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function stableValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
    return value;
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
    }
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] === undefined) throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function requiredText(value, code, maxLength = 256) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw protocolError(code);
  return normalized;
}

function positiveInteger(value, code) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw protocolError(code);
  return normalized;
}

function fingerprintText(value, code) {
  const normalized = requiredText(value, code, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw protocolError(code);
  return normalized;
}

function nonceText(value, code) {
  const normalized = requiredText(value, code, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw protocolError(code);
  return normalized;
}

function isoTimestamp(value, code) {
  const normalized = requiredText(value, code, 64);
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) throw protocolError(code);
  return normalized;
}

function keyFingerprint(publicKey) {
  return crypto.createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

function validateRecoveryDeliveryPublicKey(input = {}) {
  const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID';
  if (input.algorithm !== RECOVERY_DELIVERY_KEY_ALGORITHM) throw protocolError(code);
  const publicKeyPem = requiredText(input.publicKeyPem, code, 8192);
  const expectedFingerprint = fingerprintText(input.publicKeyFingerprint, code);
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(publicKeyPem);
  } catch (cause) {
    throw protocolError(code, code, cause);
  }
  const details = publicKey.asymmetricKeyDetails || {};
  const publicExponent = Number(details.publicExponent);
  const actualFingerprint = keyFingerprint(publicKey);
  if (publicKey.asymmetricKeyType !== 'rsa'
    || Number(details.modulusLength) !== 3072
    || publicExponent !== 65537
    || actualFingerprint !== expectedFingerprint) {
    throw protocolError(code);
  }
  return Object.freeze({
    algorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
    publicKeyPem,
    publicKeyFingerprint: actualFingerprint,
  });
}

function generateRecoveryDeliveryKeyPair() {
  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicExponent: 0x10001,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const publicKeyPem = pair.publicKey.trim();
  const privateKeyPem = pair.privateKey.trim();
  const publicKey = crypto.createPublicKey(publicKeyPem);
  return Object.freeze({
    protocolVersion: DELIVERY_PROTOCOL_VERSION,
    algorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
    publicKeyPem,
    privateKeyPem,
    publicKeyFingerprint: keyFingerprint(publicKey),
  });
}

function normalizeEnvelopeAad(input = {}) {
  const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH';
  return Object.freeze({
    epochId: requiredText(input.epochId, code, 128),
    factorId: requiredText(input.factorId, code, 128),
    deviceId: requiredText(input.deviceId, code, 128),
    generation: positiveInteger(input.generation, code),
    recipientKeyFingerprint: fingerprintText(
      input.recipientKeyFingerprint ?? input.recipientPublicKeyFingerprint,
      code
    ),
  });
}

function strictBase64(value, { bytes, minimumBytes = 1 } = {}) {
  const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED';
  const normalized = requiredText(value, code, 1024 * 1024);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw protocolError(code);
  }
  const buffer = Buffer.from(normalized, 'base64');
  if ((bytes && buffer.length !== bytes) || buffer.length < minimumBytes) throw protocolError(code);
  return buffer;
}

function normalizeEnvelope(envelope = {}) {
  const mismatch = 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH';
  if (envelope.protocolVersion !== DELIVERY_PROTOCOL_VERSION
    || envelope.keyWrapAlgorithm !== KEY_WRAP_ALGORITHM
    || envelope.contentEncryptionAlgorithm !== CONTENT_ENCRYPTION_ALGORITHM) {
    throw protocolError(mismatch);
  }
  const aad = normalizeEnvelopeAad(envelope.aad);
  return Object.freeze({
    protocolVersion: DELIVERY_PROTOCOL_VERSION,
    keyWrapAlgorithm: KEY_WRAP_ALGORITHM,
    contentEncryptionAlgorithm: CONTENT_ENCRYPTION_ALGORITHM,
    aad,
    wrappedKey: strictBase64(envelope.wrappedKey, { bytes: 384 }),
    iv: strictBase64(envelope.iv, { bytes: 12 }),
    authTag: strictBase64(envelope.authTag, { bytes: 16 }),
    ciphertext: strictBase64(envelope.ciphertext),
  });
}

function sealRecoveryPackage(input = {}) {
  const validatedKey = validateRecoveryDeliveryPublicKey({
    algorithm: input.recipientKeyAlgorithm || RECOVERY_DELIVERY_KEY_ALGORITHM,
    publicKeyPem: input.recipientPublicKeyPem,
    publicKeyFingerprint: input.recipientPublicKeyFingerprint,
  });
  const aad = normalizeEnvelopeAad(input);
  if (aad.recipientKeyFingerprint !== validatedKey.publicKeyFingerprint
    || !input.recoveryPackage || typeof input.recoveryPackage !== 'object'
    || Array.isArray(input.recoveryPackage)) {
    throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
  }
  const contentKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const plaintext = Buffer.from(canonicalJson(input.recoveryPackage), 'utf8');
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, iv);
    cipher.setAAD(Buffer.from(canonicalJson(aad), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrappedKey = crypto.publicEncrypt({
      key: validatedKey.publicKeyPem,
      oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, contentKey);
    return Object.freeze({
      protocolVersion: DELIVERY_PROTOCOL_VERSION,
      keyWrapAlgorithm: KEY_WRAP_ALGORITHM,
      contentEncryptionAlgorithm: CONTENT_ENCRYPTION_ALGORITHM,
      aad,
      wrappedKey: wrappedKey.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    });
  } finally {
    contentKey.fill(0);
    plaintext.fill(0);
  }
}

function openRecoveryPackage({ envelope, privateKeyPem, expected } = {}) {
  let normalized;
  try {
    normalized = normalizeEnvelope(envelope);
    const expectedAad = normalizeEnvelopeAad(expected);
    if (canonicalJson(normalized.aad) !== canonicalJson(expectedAad)) {
      throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
    }
  } catch (cause) {
    if (cause?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH') throw cause;
    throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED', undefined, cause);
  }

  let contentKey;
  let plaintext;
  try {
    contentKey = crypto.privateDecrypt({
      key: requiredText(privateKeyPem, 'PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED', 16384),
      oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, normalized.wrappedKey);
    const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, normalized.iv);
    decipher.setAAD(Buffer.from(canonicalJson(normalized.aad), 'utf8'));
    decipher.setAuthTag(normalized.authTag);
    plaintext = Buffer.concat([decipher.update(normalized.ciphertext), decipher.final()]);
    const value = JSON.parse(plaintext.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Recovery package is not an object');
    }
    return value;
  } catch (cause) {
    throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED', undefined, cause);
  } finally {
    if (contentKey) contentKey.fill(0);
    if (plaintext) plaintext.fill(0);
  }
}

function normalizeAcknowledgement(input = {}) {
  const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_INVALID';
  if (input.protocolVersion && input.protocolVersion !== ACK_PROTOCOL_VERSION) throw protocolError(code);
  return Object.freeze({
    protocolVersion: ACK_PROTOCOL_VERSION,
    deliveryId: requiredText(input.deliveryId, code, 128),
    epochId: requiredText(input.epochId, code, 128),
    factorId: requiredText(input.factorId, code, 128),
    recipientKeyFingerprint: fingerprintText(
      input.recipientKeyFingerprint ?? input.recipientPublicKeyFingerprint,
      code
    ),
    expectedRowVersion: positiveInteger(input.expectedRowVersion ?? input.rowVersion, code),
    acknowledgementNonce: nonceText(input.acknowledgementNonce, code),
    acknowledgedAt: isoTimestamp(input.acknowledgedAt, code),
  });
}

function acknowledgementBytes(acknowledgement) {
  return Buffer.from(canonicalJson(normalizeAcknowledgement(acknowledgement)), 'utf8');
}

function signRecoveryDeliveryAcknowledgement({ acknowledgement, privateKeyPem } = {}) {
  try {
    return crypto.sign('sha256', acknowledgementBytes(acknowledgement), {
      key: requiredText(privateKeyPem, 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_INVALID', 16384),
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }).toString('base64');
  } catch (cause) {
    if (cause?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_INVALID') throw cause;
    throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_INVALID', undefined, cause);
  }
}

function verifyRecoveryDeliveryAcknowledgement({ acknowledgement, signature, publicKeyPem } = {}) {
  try {
    const normalized = normalizeAcknowledgement(acknowledgement);
    const validatedKey = validateRecoveryDeliveryPublicKey({
      algorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
      publicKeyPem,
      publicKeyFingerprint: normalized.recipientKeyFingerprint,
    });
    const signatureBytes = strictBase64(signature, { minimumBytes: 384 });
    if (signatureBytes.length !== 384) return false;
    return crypto.verify('sha256', Buffer.from(canonicalJson(normalized), 'utf8'), {
      key: validatedKey.publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }, signatureBytes);
  } catch (_error) {
    return false;
  }
}

module.exports = {
  ACK_PROTOCOL_VERSION,
  ACK_SIGNATURE_ALGORITHM,
  CONTENT_ENCRYPTION_ALGORITHM,
  DELIVERY_PROTOCOL_VERSION,
  KEY_WRAP_ALGORITHM,
  RECOVERY_DELIVERY_KEY_ALGORITHM,
  canonicalJson,
  generateRecoveryDeliveryKeyPair,
  validateRecoveryDeliveryPublicKey,
  sealRecoveryPackage,
  openRecoveryPackage,
  signRecoveryDeliveryAcknowledgement,
  verifyRecoveryDeliveryAcknowledgement,
};
