'use strict';

const crypto = require('crypto');

const PROTOCOL_VERSION = 'gewu-single-user-pairing/v1';
const DEFAULT_CAPABILITY_TTL_MS = 5 * 60 * 1000;
const REQUEST_TTL_MS = 2 * 60 * 1000;
const CROCKFORD_CODE = /^[0-9A-HJKMNP-TV-Z]{16}$/;
const ENVELOPE_KEYS = new Set([
  'protocolVersion', 'capabilityId', 'clientEphemeralPublicKey', 'iv', 'ciphertext', 'tag',
]);

function pairingError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function currentDate(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw pairingError('PAIRING_CLOCK_INVALID');
  return date;
}

function requiredText(value, code, maxLength) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw pairingError(code);
  return normalized;
}

function isoTimestamp(value, code) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw pairingError(code);
  return date.toISOString();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizePairingCode(value) {
  const normalized = String(value || '').toUpperCase().replace(/[\s-]+/g, '');
  if (!CROCKFORD_CODE.test(normalized)) throw pairingError('PAIRING_CODE_INVALID');
  return normalized;
}

function normalizeDevice(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw pairingError('PAIRING_DEVICE_INVALID');
  }
  const deviceId = requiredText(value.deviceId, 'PAIRING_DEVICE_ID_INVALID', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId)) {
    throw pairingError('PAIRING_DEVICE_ID_INVALID');
  }
  const deviceName = requiredText(value.deviceName, 'PAIRING_DEVICE_NAME_INVALID', 128);
  const deviceKind = requiredText(value.deviceKind, 'PAIRING_DEVICE_KIND_INVALID', 32);
  if (deviceKind !== 'desktop-client') throw pairingError('PAIRING_DEVICE_KIND_INVALID');
  const publicKey = requiredText(value.publicKey, 'PAIRING_DEVICE_PUBLIC_KEY_INVALID', 4096);
  try {
    const parsed = crypto.createPublicKey(publicKey);
    if (parsed.asymmetricKeyType !== 'ed25519') throw pairingError('PAIRING_DEVICE_PUBLIC_KEY_INVALID');
  } catch (error) {
    if (error?.code === 'PAIRING_DEVICE_PUBLIC_KEY_INVALID') throw error;
    throw pairingError('PAIRING_DEVICE_PUBLIC_KEY_INVALID', error);
  }
  return Object.freeze({ deviceId, deviceName, publicKey, deviceKind });
}

function normalizeCapability(value, now) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw pairingError('PAIRING_CAPABILITY_INVALID');
  }
  if (value.protocolVersion !== PROTOCOL_VERSION) throw pairingError('PAIRING_CAPABILITY_INVALID');
  const id = requiredText(value.id, 'PAIRING_CAPABILITY_INVALID', 32);
  if (!/^[a-f0-9]{32}$/.test(id)) throw pairingError('PAIRING_CAPABILITY_INVALID');
  const publicKey = requiredText(value.publicKey, 'PAIRING_CAPABILITY_INVALID', 4096);
  try {
    const parsed = crypto.createPublicKey(publicKey);
    if (parsed.asymmetricKeyType !== 'x25519') throw pairingError('PAIRING_CAPABILITY_INVALID');
  } catch (error) {
    if (error?.code === 'PAIRING_CAPABILITY_INVALID') throw error;
    throw pairingError('PAIRING_CAPABILITY_INVALID', error);
  }
  const issuedAt = isoTimestamp(value.issuedAt, 'PAIRING_CAPABILITY_INVALID');
  const expiresAt = isoTimestamp(value.expiresAt, 'PAIRING_CAPABILITY_INVALID');
  const current = currentDate(now);
  if (Date.parse(issuedAt) > current.getTime() + 30_000 || Date.parse(expiresAt) <= current.getTime()) {
    throw pairingError('PAIRING_CAPABILITY_STALE');
  }
  return Object.freeze({ protocolVersion: PROTOCOL_VERSION, id, publicKey, issuedAt, expiresAt });
}

function deriveKey({ privateKey, publicKey, capabilityId }) {
  let shared;
  try {
    shared = crypto.diffieHellman({ privateKey, publicKey });
    return Buffer.from(crypto.hkdfSync(
      'sha256',
      shared,
      Buffer.from(capabilityId, 'hex'),
      Buffer.from(`${PROTOCOL_VERSION}:${capabilityId}`, 'utf8'),
      32
    ));
  } catch (error) {
    throw pairingError('PAIRING_ENVELOPE_KEY_INVALID', error);
  } finally {
    if (shared) shared.fill(0);
  }
}

function envelopeHeader({ capabilityId, clientEphemeralPublicKey }) {
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    capabilityId,
    clientEphemeralPublicKey,
  });
}

function signingPayload(payload) {
  return stableJson({
    protocolVersion: payload.protocolVersion,
    capabilityId: payload.capabilityId,
    pairingCode: payload.pairingCode,
    device: payload.device,
    requestNonce: payload.requestNonce,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    capabilityExpiresAt: payload.capabilityExpiresAt,
  });
}

function createHostCapability({ now, ttlMs = DEFAULT_CAPABILITY_TTL_MS } = {}) {
  const current = currentDate(now);
  const normalizedTtl = Number(ttlMs);
  if (!Number.isSafeInteger(normalizedTtl) || normalizedTtl < 60_000 || normalizedTtl > 15 * 60 * 1000) {
    throw pairingError('PAIRING_CAPABILITY_TTL_INVALID');
  }
  const keyPair = crypto.generateKeyPairSync('x25519');
  const id = crypto.randomBytes(16).toString('hex');
  const publicCapability = Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    id,
    publicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    issuedAt: current.toISOString(),
    expiresAt: new Date(current.getTime() + normalizedTtl).toISOString(),
  });
  return Object.freeze({ publicCapability, privateKey: keyPair.privateKey });
}

function encryptPairingRequest({ capability, pairingCode, device, sign, now } = {}) {
  const normalizedCapability = normalizeCapability(capability, now);
  const normalizedCode = normalizePairingCode(pairingCode);
  const normalizedDevice = normalizeDevice(device);
  if (typeof sign !== 'function') throw pairingError('PAIRING_DEVICE_SIGNATURE_REQUIRED');
  const current = currentDate(now);
  const expiresAt = new Date(Math.min(
    current.getTime() + REQUEST_TTL_MS,
    Date.parse(normalizedCapability.expiresAt)
  )).toISOString();
  const payload = {
    protocolVersion: PROTOCOL_VERSION,
    capabilityId: normalizedCapability.id,
    pairingCode: normalizedCode,
    device: normalizedDevice,
    requestNonce: crypto.randomBytes(24).toString('base64url'),
    issuedAt: current.toISOString(),
    expiresAt,
    capabilityExpiresAt: normalizedCapability.expiresAt,
  };
  const signature = requiredText(sign(signingPayload(payload)), 'PAIRING_DEVICE_SIGNATURE_REQUIRED', 1024);
  const plaintext = Buffer.from(stableJson({ ...payload, signature }), 'utf8');
  const ephemeral = crypto.generateKeyPairSync('x25519');
  const clientEphemeralPublicKey = ephemeral.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString()
    .trim();
  const header = envelopeHeader({
    capabilityId: normalizedCapability.id,
    clientEphemeralPublicKey,
  });
  const key = deriveKey({
    privateKey: ephemeral.privateKey,
    publicKey: crypto.createPublicKey(normalizedCapability.publicKey),
    capabilityId: normalizedCapability.id,
  });
  const iv = crypto.randomBytes(12);
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(stableJson(header), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Object.freeze({
      ...header,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    });
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

function normalizeEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw pairingError('PAIRING_ENVELOPE_INVALID');
  }
  for (const key of Object.keys(value)) {
    if (!ENVELOPE_KEYS.has(key)) throw pairingError('PAIRING_ENVELOPE_INVALID');
  }
  for (const key of ENVELOPE_KEYS) {
    if (!Object.hasOwn(value, key)) throw pairingError('PAIRING_ENVELOPE_INVALID');
  }
  if (value.protocolVersion !== PROTOCOL_VERSION) throw pairingError('PAIRING_ENVELOPE_INVALID');
  const capabilityId = requiredText(value.capabilityId, 'PAIRING_ENVELOPE_INVALID', 32);
  if (!/^[a-f0-9]{32}$/.test(capabilityId)) throw pairingError('PAIRING_ENVELOPE_INVALID');
  const clientEphemeralPublicKey = requiredText(
    value.clientEphemeralPublicKey,
    'PAIRING_ENVELOPE_INVALID',
    4096
  );
  let parsedEphemeral;
  try {
    parsedEphemeral = crypto.createPublicKey(clientEphemeralPublicKey);
    if (parsedEphemeral.asymmetricKeyType !== 'x25519') throw pairingError('PAIRING_ENVELOPE_INVALID');
  } catch (error) {
    if (error?.code === 'PAIRING_ENVELOPE_INVALID') throw error;
    throw pairingError('PAIRING_ENVELOPE_INVALID', error);
  }
  const iv = Buffer.from(requiredText(value.iv, 'PAIRING_ENVELOPE_INVALID', 64), 'base64');
  const ciphertext = Buffer.from(requiredText(value.ciphertext, 'PAIRING_ENVELOPE_INVALID', 32 * 1024), 'base64');
  const tag = Buffer.from(requiredText(value.tag, 'PAIRING_ENVELOPE_INVALID', 64), 'base64');
  if (iv.length !== 12 || !ciphertext.length || ciphertext.length > 16 * 1024 || tag.length !== 16) {
    throw pairingError('PAIRING_ENVELOPE_INVALID');
  }
  return { capabilityId, clientEphemeralPublicKey, parsedEphemeral, iv, ciphertext, tag };
}

function decryptPairingRequest({ envelope, capabilityPrivateKey, expectedCapabilityId, now } = {}) {
  const normalized = normalizeEnvelope(envelope);
  const expected = requiredText(expectedCapabilityId, 'PAIRING_CAPABILITY_MISMATCH', 32);
  if (normalized.capabilityId !== expected) throw pairingError('PAIRING_CAPABILITY_MISMATCH');
  let privateKey;
  try {
    privateKey = capabilityPrivateKey?.type === 'private'
      ? capabilityPrivateKey
      : crypto.createPrivateKey(capabilityPrivateKey);
    if (privateKey.asymmetricKeyType !== 'x25519') throw pairingError('PAIRING_ENVELOPE_KEY_INVALID');
  } catch (error) {
    if (error?.code === 'PAIRING_ENVELOPE_KEY_INVALID') throw error;
    throw pairingError('PAIRING_ENVELOPE_KEY_INVALID', error);
  }
  const header = envelopeHeader({
    capabilityId: normalized.capabilityId,
    clientEphemeralPublicKey: normalized.clientEphemeralPublicKey,
  });
  const key = deriveKey({
    privateKey,
    publicKey: normalized.parsedEphemeral,
    capabilityId: normalized.capabilityId,
  });
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, normalized.iv);
    decipher.setAAD(Buffer.from(stableJson(header), 'utf8'));
    decipher.setAuthTag(normalized.tag);
    plaintext = Buffer.concat([decipher.update(normalized.ciphertext), decipher.final()]);
  } catch (error) {
    throw pairingError('PAIRING_ENVELOPE_DECRYPT_FAILED', error);
  } finally {
    key.fill(0);
  }
  let payload;
  try {
    payload = JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    throw pairingError('PAIRING_ENVELOPE_INVALID', error);
  } finally {
    plaintext.fill(0);
  }
  if (!payload || payload.protocolVersion !== PROTOCOL_VERSION
    || payload.capabilityId !== normalized.capabilityId) {
    throw pairingError('PAIRING_ENVELOPE_INVALID');
  }
  const current = currentDate(now);
  const issuedAt = isoTimestamp(payload.issuedAt, 'PAIRING_ENVELOPE_INVALID');
  const expiresAt = isoTimestamp(payload.expiresAt, 'PAIRING_ENVELOPE_INVALID');
  const capabilityExpiresAt = isoTimestamp(payload.capabilityExpiresAt, 'PAIRING_ENVELOPE_INVALID');
  if (Date.parse(capabilityExpiresAt) <= current.getTime()) throw pairingError('PAIRING_CAPABILITY_STALE');
  if (Date.parse(issuedAt) > current.getTime() + 30_000 || Date.parse(expiresAt) <= current.getTime()) {
    throw pairingError('PAIRING_REQUEST_STALE');
  }
  const pairingCode = normalizePairingCode(payload.pairingCode);
  const device = normalizeDevice(payload.device);
  const requestNonce = requiredText(payload.requestNonce, 'PAIRING_ENVELOPE_INVALID', 128);
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(requestNonce)) throw pairingError('PAIRING_ENVELOPE_INVALID');
  const signature = Buffer.from(
    requiredText(payload.signature, 'PAIRING_DEVICE_SIGNATURE_REQUIRED', 1024),
    'base64'
  );
  const valid = crypto.verify(
    null,
    Buffer.from(signingPayload({
      protocolVersion: PROTOCOL_VERSION,
      capabilityId: normalized.capabilityId,
      pairingCode,
      device,
      requestNonce,
      issuedAt,
      expiresAt,
      capabilityExpiresAt,
    }), 'utf8'),
    crypto.createPublicKey(device.publicKey),
    signature
  );
  if (!valid) throw pairingError('PAIRING_DEVICE_SIGNATURE_INVALID');
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    capabilityId: normalized.capabilityId,
    pairingCode,
    device,
    requestNonce,
    issuedAt,
    expiresAt,
    capabilityExpiresAt,
  });
}

module.exports = {
  PROTOCOL_VERSION,
  createHostCapability,
  decryptPairingRequest,
  encryptPairingRequest,
  normalizePairingCode,
};
