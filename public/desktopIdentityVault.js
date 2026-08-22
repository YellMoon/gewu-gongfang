const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  createPrimaryHostLocalReceipt,
  primaryHostReceiptSigningPayload,
} = require('../backend/src/services/primaryHostReceiptProtocol');
const {
  activationReceiptSigningPayload,
} = require('../backend/src/services/deviceActivationService');
const { validateEnvelope, stableJson } = require('../shared/authorityProtocol');
const { authorityHttpSigningPayload } = require('../shared/authorityHttpAuth');
const { createSignedAuthorityProjection } = require('../shared/authorityProjectionProtocol');

const VAULT_VERSION = 2;
const PRIVATE_PAYLOAD_VERSION = 1;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const RECENT_UNLOCK_MS = 2 * 60 * 1000;
const OFFLINE_LEASE_MAX_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ENVELOPE_BYTES = 256 * 1024;
const ROLE_SET = new Set(['visitor', 'super_admin', 'admin', 'teacher', 'student']);
const DEVICE_KIND_SET = new Set(['primary-host', 'desktop-client']);
const CLOUD_OFFLINE_LEASE_PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEAGY4DlhDvEsOwR7mXM23i+P+lT2n0ZVXKVQXbSZfFR/c=';
const FORBIDDEN_PERSISTED_KEYS = new Set([
  'password',
  'privatekey',
  'private_key',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'challengesecret',
  'challenge_secret',
  'phonecode',
  'phone_code',
  'wechatcode',
  'wechat_code',
  'recoveryfactor',
  'recovery_factor',
]);

function vaultError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stringField(value, code, maxLength = 256) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw vaultError(code);
  return normalized;
}

function optionalString(value, maxLength = 256) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maxLength) throw vaultError('DESKTOP_IDENTITY_VAULT_DATA_INVALID');
  return normalized;
}

function safeInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw vaultError(code);
  return number;
}

function isoTimestamp(value, code) {
  const normalized = String(value || '').trim();
  if (!normalized || !Number.isFinite(Date.parse(normalized))) throw vaultError(code);
  return normalized;
}

function currentDate(now) {
  const value = now();
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw vaultError('DESKTOP_IDENTITY_VAULT_CLOCK_INVALID');
  return date;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function assertNoForbiddenSecrets(value, seen = new Set()) {
  if (value == null || typeof value !== 'object') return;
  if (seen.has(value)) throw vaultError('DESKTOP_IDENTITY_VAULT_DATA_INVALID');
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PERSISTED_KEYS.has(String(key).toLowerCase())) {
      throw vaultError('DESKTOP_IDENTITY_VAULT_FORBIDDEN_SECRET');
    }
    assertNoForbiddenSecrets(nested, seen);
  }
  seen.delete(value);
}

function fingerprintPublicKey(publicKey) {
  let key;
  try {
    key = crypto.createPublicKey(publicKey);
  } catch (error) {
    throw vaultError('DESKTOP_IDENTITY_PUBLIC_KEY_INVALID', error);
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw vaultError('DESKTOP_IDENTITY_PUBLIC_KEY_INVALID');
  }
  return sha256(key.export({ type: 'spki', format: 'der' }));
}

function normalizePublicIdentity(value = {}) {
  const deviceId = stringField(value.deviceId, 'DESKTOP_IDENTITY_DEVICE_ID_INVALID', 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(deviceId)) {
    throw vaultError('DESKTOP_IDENTITY_DEVICE_ID_INVALID');
  }
  const deviceName = String(value.deviceName || 'This device').trim().slice(0, 128);
  if (!deviceName) throw vaultError('DESKTOP_IDENTITY_DEVICE_NAME_INVALID');
  const deviceKind = String(value.deviceKind || 'desktop-client').trim();
  if (!DEVICE_KIND_SET.has(deviceKind)) throw vaultError('DESKTOP_IDENTITY_DEVICE_KIND_INVALID');
  const publicKey = stringField(value.publicKey, 'DESKTOP_IDENTITY_PUBLIC_KEY_INVALID', 4096);
  const keyFingerprint = stringField(
    value.keyFingerprint,
    'DESKTOP_IDENTITY_KEY_FINGERPRINT_INVALID',
    64
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(keyFingerprint)
    || fingerprintPublicKey(publicKey) !== keyFingerprint) {
    throw vaultError('DESKTOP_IDENTITY_KEY_FINGERPRINT_INVALID');
  }
  return Object.freeze({ deviceId, deviceName, deviceKind, publicKey, keyFingerprint });
}

function publicIdentityFromKeyPair(input, keyPair) {
  const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return normalizePublicIdentity({
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    deviceKind: input.deviceKind,
    publicKey,
    keyFingerprint: fingerprintPublicKey(publicKey),
  });
}

function normalizeAuthorization(value, publicIdentity) {
  if (!value || typeof value !== 'object') throw vaultError('DESKTOP_IDENTITY_AUTHORIZATION_INVALID');
  assertNoForbiddenSecrets(value);
  const authorization = {
    id: stringField(value.id, 'DESKTOP_IDENTITY_AUTHORIZATION_INVALID', 128),
    deviceId: stringField(value.deviceId, 'DESKTOP_IDENTITY_AUTHORIZATION_INVALID', 128),
    deviceName: optionalString(value.deviceName, 128) || publicIdentity.deviceName,
    deviceKind: optionalString(value.deviceKind, 64) || publicIdentity.deviceKind,
    userId: stringField(value.userId, 'DESKTOP_IDENTITY_AUTHORIZATION_INVALID', 128),
    keyFingerprint: stringField(
      value.keyFingerprint,
      'DESKTOP_IDENTITY_AUTHORIZATION_INVALID',
      64
    ).toLowerCase(),
    status: stringField(value.status, 'DESKTOP_IDENTITY_AUTHORIZATION_INVALID', 32),
    authorizationSource: optionalString(value.authorizationSource, 64) || 'wechat_phone',
    credentialVersion: safeInteger(
      value.credentialVersion,
      'DESKTOP_IDENTITY_AUTHORIZATION_INVALID'
    ),
    lastPhoneVerifiedAt: isoTimestamp(
      value.lastPhoneVerifiedAt,
      'DESKTOP_IDENTITY_AUTHORIZATION_INVALID'
    ),
    phoneReverifyDueAt: isoTimestamp(
      value.phoneReverifyDueAt,
      'DESKTOP_IDENTITY_AUTHORIZATION_INVALID'
    ),
  };
  if (authorization.status !== 'active'
    || !['wechat_phone', 'single_user_local_bootstrap', 'single_user_pairing']
      .includes(authorization.authorizationSource)
    || authorization.deviceId !== publicIdentity.deviceId
    || authorization.deviceKind !== publicIdentity.deviceKind
    || authorization.keyFingerprint !== publicIdentity.keyFingerprint
    || Date.parse(authorization.phoneReverifyDueAt) <= Date.parse(authorization.lastPhoneVerifiedAt)) {
    throw vaultError('DESKTOP_IDENTITY_AUTHORIZATION_MISMATCH');
  }
  return Object.freeze(authorization);
}

function normalizeProfile(value, authorization) {
  if (!value || typeof value !== 'object') throw vaultError('DESKTOP_IDENTITY_PROFILE_INVALID');
  assertNoForbiddenSecrets(value);
  const userId = stringField(
    value.userId || value.user?.id,
    'DESKTOP_IDENTITY_PROFILE_INVALID',
    128
  );
  if (userId !== authorization.userId) throw vaultError('DESKTOP_IDENTITY_PROFILE_MISMATCH');
  const eligibleRoles = Array.isArray(value.eligibleRoles)
    ? [...new Set(value.eligibleRoles.map(role => String(role || '').trim()))]
    : [];
  if (!eligibleRoles.length || eligibleRoles.some(role => !ROLE_SET.has(role))) {
    throw vaultError('DESKTOP_IDENTITY_PROFILE_INVALID');
  }
  const activeRole = stringField(value.activeRole, 'DESKTOP_IDENTITY_PROFILE_INVALID', 32);
  if (!eligibleRoles.includes(activeRole)) throw vaultError('DESKTOP_IDENTITY_PROFILE_MISMATCH');
  const teacherId = optionalString(value.teacherId, 128);
  const studentId = optionalString(value.studentId, 128);
  if ((activeRole === 'teacher' && !teacherId) || (activeRole === 'student' && !studentId)) {
    throw vaultError('DESKTOP_IDENTITY_PROFILE_MISMATCH');
  }
  return Object.freeze({
    userId,
    user: Object.freeze({
      id: userId,
      name: String(value.user?.name || '').trim().slice(0, 128),
    }),
    eligibleRoles: Object.freeze(eligibleRoles),
    activeRole,
    teacherId: activeRole === 'teacher' ? teacherId : null,
    studentId: activeRole === 'student' ? studentId : null,
  });
}

function offlineLeaseSignaturePayload(lease) {
  return JSON.stringify({
    v: lease.v,
    id: lease.id,
    userId: lease.userId,
    deviceId: lease.deviceId,
    authorizationId: lease.authorizationId,
    credentialVersion: lease.credentialVersion,
    eligibleRoles: lease.eligibleRoles,
    activeRole: lease.activeRole,
    teacherId: lease.teacherId,
    studentId: lease.studentId,
    issuedAt: lease.issuedAt,
    expiresAt: lease.expiresAt,
    scope: lease.scope,
  });
}

function resolveOfflineLeasePublicKey(value) {
  try {
    if (value && value.type === 'public' && value.asymmetricKeyType === 'ed25519') return value;
    return crypto.createPublicKey(value || {
      key: Buffer.from(CLOUD_OFFLINE_LEASE_PUBLIC_KEY_B64, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch (error) {
    throw vaultError('DESKTOP_IDENTITY_VAULT_CONFIG_REQUIRED', error);
  }
}

function normalizeOfflineLease(value, profile, authorization, offlineLeasePublicKey) {
  if (value == null) return null;
  if (!value || typeof value !== 'object') throw vaultError('DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID');
  assertNoForbiddenSecrets(value);
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw vaultError('DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID', error);
  }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > 64 * 1024) {
    throw vaultError('DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID');
  }
  const parsed = JSON.parse(serialized);
  const issuedAt = isoTimestamp(parsed.issuedAt, 'DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID');
  const expiresAt = isoTimestamp(parsed.expiresAt, 'DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID');
  const eligibleRoles = Array.isArray(parsed.eligibleRoles)
    ? [...new Set(parsed.eligibleRoles.map(role => String(role || '').trim()).filter(Boolean))]
    : [];
  const activeRole = stringField(
    parsed.activeRole,
    'DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID',
    32
  );
  const scope = parsed.scope && typeof parsed.scope === 'object' && !Array.isArray(parsed.scope)
    ? cloneJson(parsed.scope)
    : null;
  const lease = {
    ...parsed,
    v: parsed.v,
    id: stringField(parsed.id, 'DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID', 256),
    userId: stringField(parsed.userId, 'DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID', 128),
    deviceId: stringField(parsed.deviceId, 'DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID', 128),
    authorizationId: stringField(
      parsed.authorizationId,
      'DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID',
      128
    ),
    credentialVersion: safeInteger(
      parsed.credentialVersion,
      'DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID'
    ),
    eligibleRoles,
    activeRole,
    teacherId: optionalString(parsed.teacherId, 128),
    studentId: optionalString(parsed.studentId, 128),
    signature: stringField(parsed.signature, 'DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID', 512),
    issuedAt,
    expiresAt,
    scope,
  };
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)
    || Date.parse(expiresAt) - Date.parse(issuedAt) > OFFLINE_LEASE_MAX_MS
    || Date.parse(expiresAt) > Date.parse(authorization.phoneReverifyDueAt)
    || lease.userId !== profile.userId
    || lease.deviceId !== authorization.deviceId
    || lease.authorizationId !== authorization.id
    || lease.credentialVersion !== authorization.credentialVersion
    || eligibleRoles.length !== profile.eligibleRoles.length
    || eligibleRoles.some((role, index) => role !== profile.eligibleRoles[index])
    || !eligibleRoles.includes(activeRole)
    || activeRole !== profile.activeRole
    || !scope
    || scope.kind !== activeRole) {
    throw vaultError('DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID');
  }
  if (lease.v !== 1 || !/^[A-Za-z0-9_-]{80,100}$/u.test(lease.signature)
    || !crypto.verify(
      null,
      Buffer.from(offlineLeaseSignaturePayload(lease), 'utf8'),
      offlineLeasePublicKey,
      Buffer.from(lease.signature, 'base64url')
    )) {
    throw vaultError('DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID');
  }
  if (activeRole === 'teacher'
    && (lease.teacherId !== profile.teacherId || scope.teacherId !== profile.teacherId)) {
    throw vaultError('DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID');
  }
  if (activeRole === 'student'
    && (lease.studentId !== profile.studentId || scope.studentId !== profile.studentId)) {
    throw vaultError('DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID');
  }
  return Object.freeze(lease);
}

function normalizeAuthorityContext(value, profile, authorization) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw vaultError('DESKTOP_AUTHORITY_CONTEXT_INVALID');
  }
  assertNoForbiddenSecrets(value);
  const issuedAt = isoTimestamp(value.lease?.issuedAt, 'DESKTOP_AUTHORITY_CONTEXT_INVALID');
  const expiresAt = isoTimestamp(value.lease?.expiresAt, 'DESKTOP_AUTHORITY_CONTEXT_INVALID');
  const context = {
    userId: stringField(value.userId, 'DESKTOP_AUTHORITY_CONTEXT_INVALID', 128),
    deviceId: stringField(value.deviceId, 'DESKTOP_AUTHORITY_CONTEXT_INVALID', 128),
    authorityId: stringField(value.authorityId, 'DESKTOP_AUTHORITY_CONTEXT_INVALID', 128),
    hostEpochId: stringField(value.hostEpochId, 'DESKTOP_AUTHORITY_CONTEXT_INVALID', 128),
    hostGeneration: safeInteger(value.hostGeneration, 'DESKTOP_AUTHORITY_CONTEXT_INVALID'),
    hostPublicKey: stringField(value.hostPublicKey, 'DESKTOP_AUTHORITY_CONTEXT_INVALID', 8192),
    grant: Object.freeze({
      id: stringField(value.grant?.id, 'DESKTOP_AUTHORITY_CONTEXT_INVALID', 128),
      version: safeInteger(value.grant?.version, 'DESKTOP_AUTHORITY_CONTEXT_INVALID'),
    }),
    lease: Object.freeze({
      id: stringField(value.lease?.id, 'DESKTOP_AUTHORITY_CONTEXT_INVALID', 128),
      activeRole: stringField(value.lease?.activeRole, 'DESKTOP_AUTHORITY_CONTEXT_INVALID', 32),
      issuedAt,
      expiresAt,
    }),
  };
  if (context.userId !== authorization.userId
    || context.deviceId !== authorization.deviceId
    || context.lease.activeRole !== profile.activeRole
    || Date.parse(expiresAt) <= Date.parse(issuedAt)
    || Date.parse(expiresAt) - Date.parse(issuedAt) > OFFLINE_LEASE_MAX_MS) {
    throw vaultError('DESKTOP_AUTHORITY_CONTEXT_INVALID');
  }
  return Object.freeze(context);
}

function passwordBuffer(value, creating) {
  const password = typeof value === 'string' ? value : '';
  const bytes = Buffer.byteLength(password, 'utf8');
  if (!password || bytes > 1024 || (creating && bytes < 6)) {
    throw vaultError(creating
      ? 'DESKTOP_IDENTITY_LOCAL_PASSWORD_INVALID'
      : 'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
  }
  return Buffer.from(password, 'utf8');
}

function normalizeKdf(value = {}) {
  if (value.algorithm !== 'scrypt'
    || Number(value.N) !== SCRYPT_N
    || Number(value.r) !== SCRYPT_R
    || Number(value.p) !== SCRYPT_P
    || Number(value.keyLength) !== SCRYPT_KEY_LENGTH) {
    throw vaultError('DESKTOP_IDENTITY_VAULT_ENVELOPE_INVALID');
  }
  const salt = String(value.salt || '');
  const decoded = Buffer.from(salt, 'base64');
  if (decoded.length !== 16 || decoded.toString('base64') !== salt) {
    throw vaultError('DESKTOP_IDENTITY_VAULT_ENVELOPE_INVALID');
  }
  return Object.freeze({
    algorithm: 'scrypt',
    salt,
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    keyLength: SCRYPT_KEY_LENGTH,
  });
}

function normalizeCipher(value = {}) {
  if (value.algorithm !== 'aes-256-gcm') {
    throw vaultError('DESKTOP_IDENTITY_VAULT_ENVELOPE_INVALID');
  }
  const iv = Buffer.from(String(value.iv || ''), 'base64');
  const tag = Buffer.from(String(value.tag || ''), 'base64');
  const ciphertext = Buffer.from(String(value.ciphertext || ''), 'base64');
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length
    || ciphertext.length > MAX_ENVELOPE_BYTES) {
    throw vaultError('DESKTOP_IDENTITY_VAULT_ENVELOPE_INVALID');
  }
  return Object.freeze({
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

function envelopeAad(publicIdentity, kdf) {
  return Buffer.from(JSON.stringify({
    version: VAULT_VERSION,
    publicIdentity,
    kdf,
  }), 'utf8');
}

function desktopDeviceSessionSigningPayload({
  challengeId,
  authorizationId,
  deviceId,
  credentialVersion,
  nonce,
  nonceIssuedAt,
} = {}) {
  const normalizedChallengeId = stringField(
    challengeId,
    'DESKTOP_SESSION_NONCE_PAYLOAD_INVALID',
    128
  );
  const normalizedAuthorizationId = stringField(
    authorizationId,
    'DESKTOP_SESSION_NONCE_PAYLOAD_INVALID',
    128
  );
  const normalizedDeviceId = stringField(deviceId, 'DESKTOP_SESSION_NONCE_PAYLOAD_INVALID', 128);
  const normalizedNonce = stringField(nonce, 'DESKTOP_SESSION_NONCE_PAYLOAD_INVALID', 1024);
  const version = safeInteger(credentialVersion, 'DESKTOP_SESSION_NONCE_PAYLOAD_INVALID');
  const normalizedIssuedAt = isoTimestamp(
    nonceIssuedAt,
    'DESKTOP_SESSION_NONCE_PAYLOAD_INVALID'
  );
  return [
    'gewu-desktop-session-v2',
    normalizedChallengeId,
    normalizedAuthorizationId,
    normalizedDeviceId,
    String(version),
    normalizedIssuedAt,
    sha256(normalizedNonce),
  ].join('\n');
}

function desktopExchangeSigningPayload({ challengeId, deviceId, rowVersion, challengeSecret } = {}) {
  const normalizedChallengeId = stringField(
    challengeId,
    'DESKTOP_EXCHANGE_PAYLOAD_INVALID',
    128
  );
  const normalizedDeviceId = stringField(deviceId, 'DESKTOP_EXCHANGE_PAYLOAD_INVALID', 128);
  const version = safeInteger(rowVersion, 'DESKTOP_EXCHANGE_PAYLOAD_INVALID');
  const secret = stringField(challengeSecret, 'DESKTOP_EXCHANGE_PAYLOAD_INVALID', 2048);
  return [
    'gewu-desktop-exchange-v1',
    normalizedChallengeId,
    normalizedDeviceId,
    String(version),
    sha256(secret),
  ].join('\n');
}

function desktopRoleElevationSigningPayload({
  sessionId,
  deviceId,
  activeRole,
  sessionVersion,
  elevationIssuedAt,
} = {}) {
  const normalizedSessionId = stringField(
    sessionId,
    'DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID',
    128
  );
  const normalizedDeviceId = stringField(
    deviceId,
    'DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID',
    128
  );
  const normalizedRole = stringField(
    activeRole,
    'DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID',
    32
  );
  if (!ROLE_SET.has(normalizedRole)) throw vaultError('DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID');
  const version = safeInteger(sessionVersion, 'DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID');
  const issuedAt = isoTimestamp(
    elevationIssuedAt,
    'DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID'
  );
  return [
    'gewu-desktop-role-elevation-v1',
    normalizedSessionId,
    normalizedDeviceId,
    normalizedRole,
    String(version),
    issuedAt,
  ].join('\n');
}

function createDesktopIdentityVault({
  filePath,
  legacyFilePath = null,
  safeStorage,
  offlineLeasePublicKey = null,
  fsImpl = fs,
  now = () => new Date(),
  delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  if (!filePath || !safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    throw vaultError('DESKTOP_IDENTITY_VAULT_CONFIG_REQUIRED');
  }
  const verifiedOfflineLeasePublicKey = resolveOfflineLeasePublicKey(offlineLeasePublicKey);

  let pendingRegistration = null;
  let unlockedSecret = null;
  let lastUnlockedAt = null;
  let unlockFailures = 0;

  function assertEncryptionAvailable() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw vaultError('DESKTOP_IDENTITY_VAULT_ENCRYPTION_UNAVAILABLE');
    }
  }

  function readEnvelope() {
    if (!fsImpl.existsSync(filePath)) throw vaultError('DESKTOP_IDENTITY_VAULT_NOT_FOUND');
    assertEncryptionAvailable();
    let raw;
    let parsed;
    try {
      raw = fsImpl.readFileSync(filePath);
      if (!raw.length || raw.length > MAX_ENVELOPE_BYTES) {
        throw vaultError('DESKTOP_IDENTITY_VAULT_ENVELOPE_INVALID');
      }
      const decrypted = safeStorage.decryptString(raw);
      if (Buffer.byteLength(decrypted, 'utf8') > MAX_ENVELOPE_BYTES) {
        throw vaultError('DESKTOP_IDENTITY_VAULT_ENVELOPE_INVALID');
      }
      parsed = JSON.parse(decrypted);
    } catch (error) {
      if (error?.code === 'DESKTOP_IDENTITY_VAULT_ENVELOPE_INVALID') throw error;
      throw vaultError('DESKTOP_IDENTITY_VAULT_ENVELOPE_INVALID', error);
    }
    if (!parsed || Number(parsed.version) !== VAULT_VERSION) {
      throw vaultError('DESKTOP_IDENTITY_VAULT_ENVELOPE_INVALID');
    }
    return Object.freeze({
      version: VAULT_VERSION,
      publicIdentity: normalizePublicIdentity(parsed.publicIdentity),
      kdf: normalizeKdf(parsed.kdf),
      cipher: normalizeCipher(parsed.cipher),
    });
  }

  function writeEnvelope(envelope) {
    assertEncryptionAvailable();
    const temporary = `${filePath}.tmp`;
    try {
      const protectedBytes = safeStorage.encryptString(JSON.stringify(envelope));
      fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
      fsImpl.writeFileSync(temporary, protectedBytes, { mode: 0o600 });
      fsImpl.renameSync(temporary, filePath);
    } catch (error) {
      try {
        if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
      } catch (_cleanupError) {
        // Best effort only; never remove or replace the prior committed envelope.
      }
      throw vaultError('DESKTOP_IDENTITY_VAULT_WRITE_FAILED', error);
    }
  }

  function privateKeyForSecret(secret) {
    let privateKey;
    try {
      privateKey = crypto.createPrivateKey(secret.privateKey);
    } catch (error) {
      throw vaultError('DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED', error);
    }
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw vaultError('DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
    }
    const derivedPublicKey = crypto.createPublicKey(privateKey);
    const derivedFingerprint = sha256(derivedPublicKey.export({ type: 'spki', format: 'der' }));
    if (derivedFingerprint !== secret.publicIdentity.keyFingerprint) {
      throw vaultError('DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
    }
    return privateKey;
  }

  function normalizePrivatePayload(value, envelope) {
    if (!value || Number(value.version) !== PRIVATE_PAYLOAD_VERSION) {
      throw vaultError('DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
    }
    const publicIdentity = normalizePublicIdentity(value.publicIdentity);
    for (const field of ['deviceId', 'deviceName', 'deviceKind', 'publicKey', 'keyFingerprint']) {
      if (publicIdentity[field] !== envelope.publicIdentity[field]) {
        throw vaultError('DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
      }
    }
    const privateKey = stringField(
      value.privateKey,
      'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED',
      8192
    );
    const authorization = normalizeAuthorization(value.authorization, publicIdentity);
    const profile = normalizeProfile(value.profile, authorization);
    const offlineLease = normalizeOfflineLease(value.offlineLease, profile, authorization, verifiedOfflineLeasePublicKey);
    const authorityContext = normalizeAuthorityContext(
      value.authorityContext,
      profile,
      authorization
    );
    const secret = Object.freeze({
      version: PRIVATE_PAYLOAD_VERSION,
      publicIdentity,
      privateKey,
      authorization,
      profile,
      offlineLease,
      authorityContext,
      sealedAt: isoTimestamp(value.sealedAt, 'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED'),
    });
    privateKeyForSecret(secret);
    return secret;
  }

  function decryptPrivatePayload(envelope, password) {
    const passwordBytes = passwordBuffer(password, false);
    const salt = Buffer.from(envelope.kdf.salt, 'base64');
    const iv = Buffer.from(envelope.cipher.iv, 'base64');
    const tag = Buffer.from(envelope.cipher.tag, 'base64');
    const ciphertext = Buffer.from(envelope.cipher.ciphertext, 'base64');
    let key;
    let plaintext;
    try {
      key = crypto.scryptSync(passwordBytes, salt, SCRYPT_KEY_LENGTH, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      });
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(envelopeAad(envelope.publicIdentity, envelope.kdf));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (!plaintext.length || plaintext.length > MAX_ENVELOPE_BYTES) {
        throw vaultError('DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
      }
      return normalizePrivatePayload(JSON.parse(plaintext.toString('utf8')), envelope);
    } catch (error) {
      if (error?.code === 'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED') throw error;
      throw vaultError('DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED', error);
    } finally {
      passwordBytes.fill(0);
      if (key) key.fill(0);
      if (plaintext) plaintext.fill(0);
    }
  }

  function buildEnvelope({
    password,
    publicIdentity,
    privateKey,
    authorization,
    profile,
    offlineLease,
    authorityContext,
  }) {
    const passwordBytes = passwordBuffer(password, true);
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const kdf = Object.freeze({
      algorithm: 'scrypt',
      salt: salt.toString('base64'),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      keyLength: SCRYPT_KEY_LENGTH,
    });
    const sealedAt = currentDate(now).toISOString();
    const payload = {
      version: PRIVATE_PAYLOAD_VERSION,
      publicIdentity,
      privateKey,
      authorization,
      profile,
      offlineLease,
      authorityContext,
      sealedAt,
    };
    let key;
    let plaintext;
    try {
      plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
      if (!plaintext.length || plaintext.length > MAX_ENVELOPE_BYTES) {
        throw vaultError('DESKTOP_IDENTITY_VAULT_DATA_INVALID');
      }
      key = crypto.scryptSync(passwordBytes, salt, SCRYPT_KEY_LENGTH, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      });
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(envelopeAad(publicIdentity, kdf));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope = Object.freeze({
        version: VAULT_VERSION,
        publicIdentity,
        kdf,
        cipher: Object.freeze({
          algorithm: 'aes-256-gcm',
          iv: iv.toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
          ciphertext: ciphertext.toString('base64'),
        }),
      });
      return {
        envelope,
        secret: normalizePrivatePayload(payload, envelope),
        sealedAt,
      };
    } finally {
      passwordBytes.fill(0);
      if (key) key.fill(0);
      if (plaintext) plaintext.fill(0);
    }
  }

  function presentPublicState(state, publicIdentity, extra = {}) {
    return Object.freeze({
      state,
      sealed: state === 'sealed' || state === 'unlocked',
      unlocked: state === 'unlocked',
      legacyUpgradeRequired: false,
      deviceId: publicIdentity.deviceId,
      deviceName: publicIdentity.deviceName,
      deviceKind: publicIdentity.deviceKind,
      keyFingerprint: publicIdentity.keyFingerprint,
      ...extra,
    });
  }

  function presentUnlocked() {
    if (!unlockedSecret) throw vaultError('DESKTOP_IDENTITY_VAULT_LOCKED');
    const profile = unlockedSecret.profile;
    const authorization = unlockedSecret.authorization;
    const current = currentDate(now).getTime();
    const recentUnlockEligible = Number.isFinite(lastUnlockedAt)
      && current >= lastUnlockedAt
      && current - lastUnlockedAt <= RECENT_UNLOCK_MS;
    return presentPublicState('unlocked', unlockedSecret.publicIdentity, {
      authorizationId: authorization.id,
      credentialVersion: authorization.credentialVersion,
      phoneReverifyDueAt: authorization.phoneReverifyDueAt,
      authorizationSource: authorization.authorizationSource,
      user: cloneJson(profile.user),
      eligibleRoles: profile.eligibleRoles.slice(),
      activeRole: profile.activeRole,
      teacherId: profile.teacherId,
      studentId: profile.studentId,
      offlineLease: cloneJson(unlockedSecret.offlineLease),
      recentUnlockEligible,
    });
  }

  function beginRegistration(input = {}) {
    if (fsImpl.existsSync(filePath)) throw vaultError('DESKTOP_IDENTITY_VAULT_ALREADY_SEALED');
    if (pendingRegistration) throw vaultError('DESKTOP_IDENTITY_REGISTRATION_ALREADY_PENDING');
    const keyPair = crypto.generateKeyPairSync('ed25519');
    const publicIdentity = publicIdentityFromKeyPair(input, keyPair);
    const privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    pendingRegistration = Object.freeze({ purpose: 'register', publicIdentity, privateKey });
    return Object.freeze({ ...publicIdentity });
  }

  function beginUnifiedOnlineRegistration(input = {}) {
    if (fsImpl.existsSync(filePath)) throw vaultError('DESKTOP_IDENTITY_VAULT_ALREADY_SEALED');
    if (pendingRegistration) throw vaultError('DESKTOP_IDENTITY_REGISTRATION_ALREADY_PENDING');
    const keyPair = crypto.generateKeyPairSync('ed25519');
    const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const keyFingerprint = fingerprintPublicKey(publicKey);
    const publicIdentity = normalizePublicIdentity({
      deviceId: `desktop-device-${keyFingerprint.slice(0, 32)}`,
      deviceName: input.deviceName,
      deviceKind: 'desktop-client',
      publicKey,
      keyFingerprint,
    });
    const privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    pendingRegistration = Object.freeze({ purpose: 'register', publicIdentity, privateKey });
    return Object.freeze({ ...publicIdentity });
  }

  function beginPasswordReset() {
    if (!fsImpl.existsSync(filePath)) throw vaultError('DESKTOP_IDENTITY_VAULT_NOT_FOUND');
    if (pendingRegistration) throw vaultError('DESKTOP_IDENTITY_REGISTRATION_ALREADY_PENDING');
    const committedIdentity = readEnvelope().publicIdentity;
    const keyPair = crypto.generateKeyPairSync('ed25519');
    const publicIdentity = publicIdentityFromKeyPair({
      deviceId: committedIdentity.deviceId,
      deviceName: committedIdentity.deviceName,
      deviceKind: committedIdentity.deviceKind,
    }, keyPair);
    const privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    pendingRegistration = Object.freeze({ purpose: 'password_reset', publicIdentity, privateKey });
    unlockedSecret = null;
    lastUnlockedAt = null;
    return Object.freeze({ ...publicIdentity });
  }

  function seal(input = {}) {
    const source = pendingRegistration || unlockedSecret;
    if (!source) throw vaultError('DESKTOP_IDENTITY_PRIVATE_KEY_UNAVAILABLE');
    const publicIdentity = source.publicIdentity;
    const authorization = normalizeAuthorization(input.authorization, publicIdentity);
    const profile = normalizeProfile(input.profile, authorization);
    const offlineLease = normalizeOfflineLease(input.offlineLease, profile, authorization, verifiedOfflineLeasePublicKey);
    const authorityContext = normalizeAuthorityContext(
      input.authorityContext === undefined ? source.authorityContext : input.authorityContext,
      profile,
      authorization
    );
    const built = buildEnvelope({
      password: input.password,
      publicIdentity,
      privateKey: source.privateKey,
      authorization,
      profile,
      offlineLease,
      authorityContext,
    });
    writeEnvelope(built.envelope);
    unlockedSecret = built.secret;
    pendingRegistration = null;
    unlockFailures = 0;
    lastUnlockedAt = Date.parse(built.sealedAt);
    return presentUnlocked();
  }

  function completeRegistration(input = {}) {
    if (!pendingRegistration || pendingRegistration.purpose !== 'register') {
      throw vaultError('DESKTOP_IDENTITY_REGISTRATION_NOT_PENDING');
    }
    return seal(input);
  }

  function completePasswordReset(input = {}) {
    if (!pendingRegistration || pendingRegistration.purpose !== 'password_reset') {
      throw vaultError('DESKTOP_IDENTITY_PASSWORD_RESET_NOT_PENDING');
    }
    return seal(input);
  }

  async function unlock(input = {}) {
    let secret;
    try {
      secret = decryptPrivatePayload(readEnvelope(), input.password);
    } catch (_error) {
      unlockFailures += 1;
      const delayMs = Math.min(30000, 250 * (2 ** Math.min(unlockFailures - 1, 7)));
      try { await delay(delayMs); } catch (_delayError) { /* keep the stable unlock error */ }
      throw vaultError('DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
    }
    unlockedSecret = secret;
    pendingRegistration = null;
    unlockFailures = 0;
    lastUnlockedAt = currentDate(now).getTime();
    return presentUnlocked();
  }

  async function refreshOfflineLease(input = {}) {
    if (!unlockedSecret) throw vaultError('DESKTOP_IDENTITY_VAULT_LOCKED');
    let verified;
    try {
      verified = decryptPrivatePayload(readEnvelope(), input.password);
    } catch (cause) {
      throw vaultError('DESKTOP_IDENTITY_OFFLINE_LEASE_REFRESH_FAILED', cause);
    }
    const offlineLease = normalizeOfflineLease(
      input.offlineLease,
      verified.profile,
      verified.authorization,
      verifiedOfflineLeasePublicKey
    );
    const built = buildEnvelope({
      password: input.password,
      publicIdentity: verified.publicIdentity,
      privateKey: verified.privateKey,
      authorization: verified.authorization,
      profile: verified.profile,
      offlineLease,
      authorityContext: verified.authorityContext,
    });
    writeEnvelope(built.envelope);
    unlockedSecret = built.secret;
    pendingRegistration = null;
    unlockFailures = 0;
    lastUnlockedAt = currentDate(now).getTime();
    return presentUnlocked();
  }

  function lock() {
    pendingRegistration = null;
    unlockedSecret = null;
    lastUnlockedAt = null;
    return status();
  }

  function status() {
    if (unlockedSecret) return presentUnlocked();
    if (pendingRegistration) {
      const state = pendingRegistration.purpose === 'password_reset'
        ? 'password_reset_pending'
        : 'registration_pending';
      return presentPublicState(state, pendingRegistration.publicIdentity);
    }
    if (fsImpl.existsSync(filePath)) {
      const envelope = readEnvelope();
      return presentPublicState('sealed', envelope.publicIdentity);
    }
    if (legacyFilePath && fsImpl.existsSync(legacyFilePath)) {
      return Object.freeze({
        state: 'legacy_upgrade_required',
        sealed: false,
        unlocked: false,
        legacyUpgradeRequired: true,
      });
    }
    return Object.freeze({
      state: 'empty',
      sealed: false,
      unlocked: false,
      legacyUpgradeRequired: false,
    });
  }

  function signingSource(purpose) {
    if (purpose === 'exchange' || purpose === 'unified-online-registration') {
      if (!pendingRegistration) throw vaultError('DESKTOP_IDENTITY_REGISTRATION_NOT_PENDING');
      return pendingRegistration;
    }
    if (purpose === 'activation-finalize') {
      if (pendingRegistration) return pendingRegistration;
      if (unlockedSecret) return unlockedSecret;
      throw vaultError('DESKTOP_IDENTITY_VAULT_LOCKED');
    }
    if (!unlockedSecret) throw vaultError('DESKTOP_IDENTITY_VAULT_LOCKED');
    return unlockedSecret;
  }

  function signChallenge(input = {}) {
    const purpose = String(input.purpose || '').trim();
    if (!['exchange', 'unified-online-registration', 'activation-finalize', 'session', 'role-elevation', 'primary-host-receipt'].includes(purpose)) {
      throw vaultError('DESKTOP_IDENTITY_SIGNING_PURPOSE_INVALID');
    }
    const source = signingSource(purpose);
    const publicIdentity = source.publicIdentity;
    let payload;
    let responseExtra = {};
    if (purpose === 'exchange') {
      payload = desktopExchangeSigningPayload({
        challengeId: input.challengeId,
        deviceId: publicIdentity.deviceId,
        rowVersion: input.rowVersion,
        challengeSecret: input.challengeSecret,
      });
    } else if (purpose === 'unified-online-registration') {
      payload = stringField(input.challenge, 'DESKTOP_UNIFIED_ONLINE_REGISTRATION_CHALLENGE_INVALID', 4096);
    } else if (purpose === 'activation-finalize') {
      payload = activationReceiptSigningPayload({
        activationId: input.activationId,
        packageHash: input.packageHash,
      });
      responseExtra = { activationId: String(input.activationId || '').trim() };
    } else if (purpose === 'session') {
      const authorizationId = unlockedSecret.authorization.id;
      if (input.authorizationId && input.authorizationId !== authorizationId) {
        throw vaultError('DESKTOP_SESSION_NONCE_PAYLOAD_INVALID');
      }
      const credentialVersion = unlockedSecret.authorization.credentialVersion;
      if (input.credentialVersion && Number(input.credentialVersion) !== credentialVersion) {
        throw vaultError('DESKTOP_SESSION_NONCE_PAYLOAD_INVALID');
      }
      payload = desktopDeviceSessionSigningPayload({
        challengeId: input.challengeId,
        authorizationId,
        deviceId: publicIdentity.deviceId,
        credentialVersion,
        nonce: input.nonce,
        nonceIssuedAt: input.nonceIssuedAt,
      });
      responseExtra = { authorizationId, credentialVersion };
    } else if (purpose === 'primary-host-receipt') {
      const current = currentDate(now);
      if (!Number.isFinite(lastUnlockedAt)
        || current.getTime() < lastUnlockedAt
        || current.getTime() - lastUnlockedAt > RECENT_UNLOCK_MS) {
        throw vaultError('DESKTOP_IDENTITY_RECENT_UNLOCK_REQUIRED');
      }
      const receipt = createPrimaryHostLocalReceipt({
        operation: input.operation,
        challengeId: input.challengeId,
        identity: {
          userId: unlockedSecret.profile.userId,
          deviceId: publicIdentity.deviceId,
          authorizationId: unlockedSecret.authorization.id,
          credentialVersion: unlockedSecret.authorization.credentialVersion,
        },
        evidence: input.evidence,
        operationManifest: input.operationManifest,
        physicalConfirmation: input.physicalConfirmation,
        now: () => current,
      });
      payload = primaryHostReceiptSigningPayload(receipt);
      responseExtra = { receipt };
    } else {
      const current = currentDate(now);
      if (!Number.isFinite(lastUnlockedAt)
        || current.getTime() < lastUnlockedAt
        || current.getTime() - lastUnlockedAt > RECENT_UNLOCK_MS) {
        throw vaultError('DESKTOP_IDENTITY_RECENT_UNLOCK_REQUIRED');
      }
      const elevationIssuedAt = current.toISOString();
      payload = desktopRoleElevationSigningPayload({
        sessionId: input.sessionId,
        deviceId: publicIdentity.deviceId,
        activeRole: input.activeRole,
        sessionVersion: input.sessionVersion,
        elevationIssuedAt,
      });
      responseExtra = { elevationIssuedAt };
    }
    const privateKey = privateKeyForSecret(source);
    const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
    return Object.freeze({
      purpose,
      deviceId: publicIdentity.deviceId,
      keyFingerprint: publicIdentity.keyFingerprint,
      signature,
      ...responseExtra,
    });
  }

  function signAuthorityHttpRequest(input = {}) {
    if (!unlockedSecret) throw vaultError('DESKTOP_IDENTITY_VAULT_LOCKED');
    const context = unlockedSecret.authorityContext;
    if (!context) throw vaultError('DESKTOP_AUTHORITY_CONTEXT_REQUIRED');
    const current = currentDate(now);
    if (Date.parse(context.lease.expiresAt) <= current.getTime()) {
      throw vaultError('DEVICE_LEASE_EXPIRED');
    }
    const actor = Object.freeze({
      userId: unlockedSecret.profile.userId,
      deviceId: unlockedSecret.publicIdentity.deviceId,
      role: context.lease.activeRole,
    });
    const payload = authorityHttpSigningPayload({
      method: input.method,
      path: input.path,
      actor,
      body: input.body === undefined ? null : input.body,
    });
    const signature = crypto.sign(
      null,
      Buffer.from(payload, 'utf8'),
      privateKeyForSecret(unlockedSecret)
    ).toString('base64');
    return Object.freeze({
      actor,
      authorityId: context.authorityId,
      hostEpochId: context.hostEpochId,
      hostPublicKey: context.hostPublicKey,
      grantVersion: context.grant.version,
      leaseId: context.lease.id,
      signature,
      headers: Object.freeze({
        'x-gewu-authority-id': context.authorityId,
        'x-gewu-authority-user-id': actor.userId,
        'x-gewu-authority-device-id': actor.deviceId,
        'x-gewu-authority-role': actor.role,
        'x-gewu-device-signature': signature,
      }),
    });
  }

  function createAuthorityCommand(input = {}) {
    if (!unlockedSecret) throw vaultError('DESKTOP_IDENTITY_VAULT_LOCKED');
    const context = unlockedSecret.authorityContext;
    if (!context) throw vaultError('DESKTOP_AUTHORITY_CONTEXT_REQUIRED');
    const type = String(input.type || '').trim();
    const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? cloneJson(input.payload)
      : null;
    if (!/^[a-z][a-z0-9_.-]*\.v[1-9][0-9]*$/.test(type) || !payload) {
      throw vaultError('AUTHORITY_DRAFT_INVALID');
    }
    const actor = Object.freeze({
      userId: unlockedSecret.profile.userId,
      deviceId: unlockedSecret.publicIdentity.deviceId,
      role: context.lease.activeRole,
    });
    const envelope = validateEnvelope({
      protocol: 'gewu.authority-command.v1',
      commandId: stringField(input.commandId || crypto.randomUUID(), 'AUTHORITY_COMMAND_ID_INVALID', 128),
      idempotencyKey: stringField(
        input.idempotencyKey || crypto.randomUUID(),
        'AUTHORITY_COMMAND_IDEMPOTENCY_KEY_INVALID',
        128
      ),
      authorityId: context.authorityId,
      hostEpochId: context.hostEpochId,
      actor,
      lease: { id: context.lease.id, grantVersion: context.grant.version },
      type,
      payload,
      payloadHash: sha256(stableJson(payload)),
      createdAt: currentDate(now).toISOString(),
    });
    const requestAuth = signAuthorityHttpRequest({
      method: 'POST',
      path: '/api/authority/commands',
      body: envelope,
    });
    return Object.freeze({ envelope, requestAuth });
  }

  function signAuthorityProjection(input = {}) {
    if (!unlockedSecret) throw vaultError('DESKTOP_IDENTITY_VAULT_LOCKED');
    const context = unlockedSecret.authorityContext;
    if (!context) throw vaultError('DESKTOP_AUTHORITY_CONTEXT_REQUIRED');
    if (input.authorityId !== context.authorityId || input.hostEpochId !== context.hostEpochId) {
      throw vaultError('AUTHORITY_PROJECTION_HOST_EPOCH_MISMATCH');
    }
    try {
      return createSignedAuthorityProjection({
        ...input,
        privateKey: privateKeyForSecret(unlockedSecret),
      });
    } catch (error) {
      throw vaultError(error?.code || 'AUTHORITY_PROJECTION_SIGNING_FAILED', error);
    }
  }

  function clear() {
    pendingRegistration = null;
    unlockedSecret = null;
    lastUnlockedAt = null;
    unlockFailures = 0;
    for (const candidate of [filePath, `${filePath}.tmp`, legacyFilePath].filter(Boolean)) {
      try {
        if (fsImpl.existsSync(candidate)) fsImpl.unlinkSync(candidate);
      } catch (error) {
        throw vaultError('DESKTOP_IDENTITY_VAULT_CLEAR_FAILED', error);
      }
    }
    return true;
  }

  return Object.freeze({
    beginPasswordReset,
    beginRegistration,
    beginUnifiedOnlineRegistration,
    clear,
    completePasswordReset,
    completeRegistration,
    createAuthorityCommand,
    lock,
    refreshOfflineLease,
    seal,
    signAuthorityProjection,
    signAuthorityHttpRequest,
    signChallenge,
    status,
    unlock,
  });
}

module.exports = {
  RECENT_UNLOCK_MS,
  createDesktopIdentityVault,
  desktopDeviceSessionSigningPayload,
  fingerprintPublicKey,
};
