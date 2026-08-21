'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');

const AUDIENCE = 'gewu-unified-desktop-registration';
const HASH = /^[0-9a-f]{64}$/;
const INPUT_KEYS = Object.freeze([
  'type',
  'accountPresentation',
  'verificationNonce',
  'installationId',
  'installationPublicKey',
  'installationKeyFingerprint',
  'logicalRequestSha256',
  'deviceChallenge',
  'deviceProof',
  'idempotencyKey',
]);
const CLAIM_KEYS = Object.freeze([
  'authorityId',
  'accountId',
  'verificationEventId',
  'audience',
  'nonce',
  'verifiedAt',
  'expiresAt',
  'assertionEvidenceSha256',
]);

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function plainSnapshot(value, keys, code) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length) throw failure(code);
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw failure(code);
    copy[key] = descriptor.value;
  }
  return copy;
}

function text(value, code) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw failure(code);
  return normalized;
}

function instant(value, code) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(Date.parse(value)).toISOString() !== value) throw failure(code);
  return value;
}

function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw failure('UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactConfig(value) {
  const keys = ['verifyAccountPresentation', 'verifyDeviceProof', 'now', 'idFactory', 'sessionTtlMs'];
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== 'string' || !keys.includes(key))
    || !['verifyAccountPresentation', 'verifyDeviceProof'].every(key => own.includes(key))) return null;
  const copy = {};
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}

function snapshotInput(value) {
  const input = plainSnapshot(value, INPUT_KEYS, 'UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID');
  if (input.type !== 'desktop.installation.register') throw failure('UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID');
  for (const key of INPUT_KEYS) {
    if (key !== 'type') input[key] = text(input[key], 'UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID');
  }
  if (!HASH.test(input.installationKeyFingerprint) || !HASH.test(input.logicalRequestSha256)) {
    throw failure('UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID');
  }
  return Object.freeze(input);
}

function snapshotClaims(value, input, now) {
  const claims = plainSnapshot(value, CLAIM_KEYS, 'UNIFIED_DESKTOP_ACCOUNT_VERIFICATION_REJECTED');
  for (const key of ['authorityId', 'accountId', 'verificationEventId', 'audience', 'nonce']) {
    claims[key] = text(claims[key], 'UNIFIED_DESKTOP_ACCOUNT_VERIFICATION_REJECTED');
  }
  claims.verifiedAt = instant(claims.verifiedAt, 'UNIFIED_DESKTOP_ACCOUNT_VERIFICATION_REJECTED');
  claims.expiresAt = instant(claims.expiresAt, 'UNIFIED_DESKTOP_ACCOUNT_VERIFICATION_REJECTED');
  if (!HASH.test(claims.assertionEvidenceSha256)
    || claims.audience !== AUDIENCE
    || claims.nonce !== input.verificationNonce
    || Date.parse(claims.verifiedAt) > Date.parse(now)
    || Date.parse(claims.expiresAt) <= Date.parse(now)) {
    throw failure('UNIFIED_DESKTOP_ACCOUNT_VERIFICATION_REJECTED');
  }
  return Object.freeze(claims);
}

function createVNextUnifiedDesktopRegistrationReference(config) {
  const values = exactConfig(config);
  const {
    verifyAccountPresentation,
    verifyDeviceProof,
    now = () => new Date().toISOString(),
    idFactory = kind => `${kind}-${crypto.randomUUID()}`,
    sessionTtlMs = 8 * 60 * 60 * 1000,
  } = values || {};
  if (typeof verifyAccountPresentation !== 'function' || types.isProxy(verifyAccountPresentation)
    || typeof verifyDeviceProof !== 'function' || types.isProxy(verifyDeviceProof)
    || typeof now !== 'function' || types.isProxy(now)
    || typeof idFactory !== 'function' || types.isProxy(idFactory)
    || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 60 * 1000 || sessionTtlMs > 30 * 24 * 60 * 60 * 1000) {
    throw failure('UNIFIED_DESKTOP_REGISTRATION_CONFIGURATION_INVALID');
  }

  const receipts = new Map();
  const verificationConsumptions = new Map();
  const installationsById = new Map();
  const installationsByFingerprint = new Map();
  const links = new Map();
  const nextId = kind => text(idFactory(kind), 'UNIFIED_DESKTOP_REGISTRATION_ID_INVALID');

  async function execute(rawInput) {
    const input = snapshotInput(rawInput);
    let timestamp;
    try { timestamp = instant(now(), 'UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID'); } catch {
      throw failure('UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID');
    }

    let untrustedClaims;
    try { untrustedClaims = await verifyAccountPresentation(input.accountPresentation); } catch {
      throw failure('UNIFIED_DESKTOP_ACCOUNT_VERIFICATION_REJECTED');
    }
    const claims = snapshotClaims(untrustedClaims, input, timestamp);
    const requestJson = stable({
      type: input.type,
      authorityId: claims.authorityId,
      accountId: claims.accountId,
      verificationEventId: claims.verificationEventId,
      verificationNonce: input.verificationNonce,
      installationId: input.installationId,
      installationPublicKey: input.installationPublicKey,
      installationKeyFingerprint: input.installationKeyFingerprint,
      logicalRequestSha256: input.logicalRequestSha256,
      deviceChallenge: input.deviceChallenge,
      assertionEvidenceSha256: claims.assertionEvidenceSha256,
    });
    const requestHash = digest(requestJson);
    const actorKey = `${claims.authorityId}\u0000${claims.accountId}`;
    const receiptKey = `${actorKey}\u0000${input.idempotencyKey}`;

    let deviceVerified = false;
    try {
      deviceVerified = await verifyDeviceProof(Object.freeze({
        proof: input.deviceProof,
        challenge: input.deviceChallenge,
        authorityId: claims.authorityId,
        accountId: claims.accountId,
        verificationEventId: claims.verificationEventId,
        verificationNonce: input.verificationNonce,
        installationId: input.installationId,
        installationPublicKey: input.installationPublicKey,
        installationKeyFingerprint: input.installationKeyFingerprint,
        logicalRequestSha256: input.logicalRequestSha256,
        idempotencyKey: input.idempotencyKey,
        type: input.type,
      }));
    } catch {
      throw failure('UNIFIED_DESKTOP_DEVICE_PROOF_REJECTED');
    }
    if (deviceVerified !== true) throw failure('UNIFIED_DESKTOP_DEVICE_PROOF_REJECTED');

    const existingReceipt = receipts.get(receiptKey);
    if (existingReceipt) {
      if (existingReceipt.requestHash !== requestHash) throw failure('UNIFIED_DESKTOP_IDEMPOTENCY_CONFLICT');
      return deepFreeze({
        code: 'UNIFIED_DESKTOP_REGISTERED',
        status: 'accepted',
        replayed: true,
        registration: { ...existingReceipt.registration },
        session: { ...existingReceipt.session },
      });
    }
    if (verificationConsumptions.has(claims.verificationEventId)) {
      throw failure('UNIFIED_DESKTOP_VERIFICATION_EVENT_CONSUMED');
    }

    const installationKey = `${claims.authorityId}\u0000${input.installationId}`;
    const fingerprintKey = `${claims.authorityId}\u0000${input.installationKeyFingerprint}`;
    const byId = installationsById.get(installationKey);
    const byFingerprint = installationsByFingerprint.get(fingerprintKey);
    if ((byId && (byId.installationPublicKey !== input.installationPublicKey
      || byId.installationKeyFingerprint !== input.installationKeyFingerprint))
      || (byFingerprint && byFingerprint.installationId !== input.installationId)) {
      throw failure('UNIFIED_DESKTOP_INSTALLATION_CONFLICT');
    }

    const installation = byId || byFingerprint || Object.freeze({
      deviceId: nextId('unified-device'),
      installationId: input.installationId,
      installationPublicKey: input.installationPublicKey,
      installationKeyFingerprint: input.installationKeyFingerprint,
    });
    const linkKey = `${actorKey}\u0000${input.installationId}`;
    const link = links.get(linkKey) || Object.freeze({ linkId: nextId('unified-link') });
    const issuedAt = timestamp;
    const session = Object.freeze({
      sessionId: nextId('unified-session'),
      status: 'active',
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + sessionTtlMs).toISOString(),
    });
    const registration = Object.freeze({
      deviceId: installation.deviceId,
      installationId: installation.installationId,
      linkId: link.linkId,
    });

    const receipt = Object.freeze({ requestHash, registration, session });
    installationsById.set(installationKey, installation);
    installationsByFingerprint.set(fingerprintKey, installation);
    links.set(linkKey, link);
    verificationConsumptions.set(claims.verificationEventId, receiptKey);
    receipts.set(receiptKey, receipt);

    return deepFreeze({
      code: 'UNIFIED_DESKTOP_REGISTERED',
      status: 'accepted',
      replayed: false,
      registration: { ...registration },
      session: { ...session },
    });
  }

  return Object.freeze({ execute });
}

module.exports = Object.freeze({ createVNextUnifiedDesktopRegistrationReference });
