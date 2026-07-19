const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  DELIVERY_PROTOCOL_VERSION,
  RECOVERY_DELIVERY_KEY_ALGORITHM,
  validateRecoveryDeliveryPublicKey,
} = require('../backend/src/services/primaryHostRecoveryDeliveryProtocol');

const STORE_VERSION = 1;
const STAGED_STORE_VERSION = 2;
const RECOVERY_DELIVERY_STORE_VERSION = 3;

function credentialError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function requiredText(value, maxLength = 256, code = 'PRIMARY_HOST_CREDENTIAL_INVALID') {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw credentialError(code);
  return normalized;
}

function credentialCommitment(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeRecoveryDeliveryKey(value = {}) {
  const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID';
  try {
    if (value.protocolVersion !== DELIVERY_PROTOCOL_VERSION) throw credentialError(code);
    const validated = validateRecoveryDeliveryPublicKey(value);
    const privateKeyPem = requiredText(value.privateKeyPem, 16384, code);
    const derivedPublicKeyPem = crypto.createPublicKey(
      crypto.createPrivateKey(privateKeyPem)
    ).export({ type: 'spki', format: 'pem' }).trim();
    const derived = validateRecoveryDeliveryPublicKey({
      algorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
      publicKeyPem: derivedPublicKeyPem,
      publicKeyFingerprint: validated.publicKeyFingerprint,
    });
    if (derived.publicKeyFingerprint !== validated.publicKeyFingerprint) {
      throw credentialError(code);
    }
    return Object.freeze({
      protocolVersion: DELIVERY_PROTOCOL_VERSION,
      algorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
      publicKeyPem: validated.publicKeyPem,
      privateKeyPem,
      publicKeyFingerprint: validated.publicKeyFingerprint,
    });
  } catch (error) {
    if (error?.code === code) throw error;
    throw credentialError(code, error);
  }
}

function normalizePendingRecoveryDelivery(value = {}, deliveryKey) {
  const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_INVALID';
  const deliveryId = requiredText(value.deliveryId, 128, code);
  const epochId = requiredText(value.epochId, 128, code);
  const factorId = requiredText(value.factorId, 128, code);
  const generation = Number(value.generation);
  const rowVersion = Number(value.rowVersion);
  const acknowledgementNonce = requiredText(value.acknowledgementNonce, 64, code).toLowerCase();
  const recipientPublicKeyFingerprint = requiredText(
    value.recipientPublicKeyFingerprint,
    64,
    code
  ).toLowerCase();
  const recoveryPackageInput = value.recoveryPackage && typeof value.recoveryPackage === 'object'
    ? value.recoveryPackage
    : {};
  const recoveryCode = requiredText(recoveryPackageInput.recoveryCode, 4096, code);
  const packageGeneration = Number(recoveryPackageInput.generation);
  const recoveryPackage = Object.freeze({
    factorId: requiredText(recoveryPackageInput.factorId, 128, code),
    recoveryCode,
    epochId: requiredText(recoveryPackageInput.epochId, 128, code),
    generation: packageGeneration,
    deviceId: requiredText(recoveryPackageInput.deviceId, 128, code),
    createdAt: requiredText(recoveryPackageInput.createdAt, 64, code),
  });
  if (!Number.isSafeInteger(generation) || generation < 1
    || !Number.isSafeInteger(rowVersion) || rowVersion < 1
    || !Number.isSafeInteger(packageGeneration) || packageGeneration < 1
    || !/^[a-f0-9]{64}$/.test(acknowledgementNonce)
    || !/^[a-f0-9]{64}$/.test(recipientPublicKeyFingerprint)
    || recipientPublicKeyFingerprint !== deliveryKey?.publicKeyFingerprint
    || recoveryCode.length < 32
    || recoveryPackage.factorId !== factorId
    || recoveryPackage.epochId !== epochId
    || recoveryPackage.generation !== generation
    || !Number.isFinite(Date.parse(recoveryPackage.createdAt))) {
    throw credentialError(code);
  }
  return Object.freeze({
    deliveryId,
    epochId,
    factorId,
    generation,
    acknowledgementNonce,
    rowVersion,
    recipientPublicKeyFingerprint,
    recoveryPackage,
  });
}

function normalizeRecoveryDeliveryAcknowledgement(value = {}) {
  const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_INVALID';
  const rowVersion = Number(value.rowVersion);
  const fingerprint = requiredText(value.recipientPublicKeyFingerprint, 64, code).toLowerCase();
  if (!Number.isSafeInteger(rowVersion) || rowVersion < 1 || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw credentialError(code);
  }
  return Object.freeze({
    deliveryId: requiredText(value.deliveryId, 128, code),
    epochId: requiredText(value.epochId, 128, code),
    factorId: requiredText(value.factorId, 128, code),
    rowVersion,
    recipientPublicKeyFingerprint: fingerprint,
  });
}

function normalizeActiveCredential(value = {}) {
  const version = Number(value.version);
  const generation = Number(value.generation);
  const activatedAt = requiredText(value.activatedAt, 64);
  const credential = requiredText(value.credential, 1024);
  const deviceId = requiredText(value.deviceId, 128);
  if (![STORE_VERSION, STAGED_STORE_VERSION, RECOVERY_DELIVERY_STORE_VERSION].includes(version)
    || !Number.isSafeInteger(generation) || generation < 1
    || !Number.isFinite(Date.parse(activatedAt))
    || credential.length < 16
    || !/^[A-Za-z0-9._:-]+$/.test(deviceId)) {
    throw credentialError('PRIMARY_HOST_CREDENTIAL_INVALID');
  }
  const normalized = {
    version,
    ...(version === STAGED_STORE_VERSION
      ? { state: 'active', stageId: requiredText(value.stageId, 256) }
      : {}),
    ...(version === RECOVERY_DELIVERY_STORE_VERSION ? { state: 'active' } : {}),
    epochId: requiredText(value.epochId, 128),
    generation,
    deviceId,
    userId: requiredText(value.userId, 128),
    activatedAt,
    credential,
  };
  if (version === RECOVERY_DELIVERY_STORE_VERSION && value.pendingRecoveryDelivery) {
    const key = normalizeRecoveryDeliveryKey(value.recoveryDeliveryKey);
    const pending = normalizePendingRecoveryDelivery(value.pendingRecoveryDelivery, key);
    if (pending.epochId !== normalized.epochId
      || pending.generation !== normalized.generation
      || pending.recoveryPackage.deviceId !== normalized.deviceId) {
      throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
    }
    normalized.stageId = requiredText(value.stageId, 256);
    normalized.recoveryDeliveryKey = key;
    normalized.pendingRecoveryDelivery = pending;
  } else if (version === RECOVERY_DELIVERY_STORE_VERSION && value.recoveryDeliveryAcknowledgement) {
    const acknowledged = normalizeRecoveryDeliveryAcknowledgement(
      value.recoveryDeliveryAcknowledgement
    );
    if (acknowledged.epochId !== normalized.epochId) {
      throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
    }
    normalized.recoveryDeliveryAcknowledgement = acknowledged;
  }
  return Object.freeze(normalized);
}

function normalizeStagedCredential(value = {}) {
  const version = Number(value.version);
  const generation = Number(value.generation ?? value.targetGeneration);
  const credential = requiredText(value.credential ?? value.hostCredential, 1024);
  const operation = requiredText(value.operation, 32);
  if (![STAGED_STORE_VERSION, RECOVERY_DELIVERY_STORE_VERSION].includes(version)
    || value.state !== 'staged'
    || !['bootstrap', 'transfer', 'recovery'].includes(operation)
    || !Number.isSafeInteger(generation) || generation < 1
    || credential.length < 16) {
    throw credentialError('PRIMARY_HOST_CREDENTIAL_STAGE_INVALID');
  }
  const commitment = credentialCommitment(credential);
  if (value.credentialCommitment && value.credentialCommitment !== commitment) {
    throw credentialError('PRIMARY_HOST_CREDENTIAL_STAGE_INVALID');
  }
  const normalized = {
    version,
    state: 'staged',
    stageId: requiredText(value.stageId, 256),
    operation,
    deviceId: requiredText(value.deviceId, 128),
    generation,
    credentialCommitment: commitment,
    credential,
    createdAt: requiredText(value.createdAt || new Date().toISOString(), 64),
  };
  if (version === RECOVERY_DELIVERY_STORE_VERSION) {
    normalized.recoveryDeliveryKey = normalizeRecoveryDeliveryKey(value.recoveryDeliveryKey);
  }
  return Object.freeze(normalized);
}

function normalizeStoredCredential(value = {}) {
  if ([STAGED_STORE_VERSION, RECOVERY_DELIVERY_STORE_VERSION].includes(Number(value.version))
    && value.state === 'staged') {
    return normalizeStagedCredential(value);
  }
  if (Number(value.version) === STORE_VERSION
    || ([STAGED_STORE_VERSION, RECOVERY_DELIVERY_STORE_VERSION].includes(Number(value.version))
      && value.state === 'active')) {
    return normalizeActiveCredential(value);
  }
  throw credentialError('PRIMARY_HOST_CREDENTIAL_INVALID');
}

function normalizeAdoption(value = {}) {
  const epoch = value.epoch && typeof value.epoch === 'object' ? value.epoch : {};
  return normalizeStoredCredential({
    version: STORE_VERSION,
    epochId: epoch.id,
    generation: epoch.generation,
    deviceId: epoch.deviceId,
    userId: epoch.userId,
    activatedAt: epoch.activatedAt,
    credential: value.hostCredential,
  });
}

function publicStatus(credential) {
  if (!credential) return Object.freeze({ state: 'empty', active: false });
  if (credential.state === 'staged') {
    const result = {
      state: 'staged',
      active: false,
      stageId: credential.stageId,
      operation: credential.operation,
      deviceId: credential.deviceId,
      generation: credential.generation,
      credentialCommitment: credential.credentialCommitment,
    };
    if (credential.version === RECOVERY_DELIVERY_STORE_VERSION) {
      result.recoveryDeliveryKey = Object.freeze({
        protocolVersion: credential.recoveryDeliveryKey.protocolVersion,
        algorithm: credential.recoveryDeliveryKey.algorithm,
        publicKeyPem: credential.recoveryDeliveryKey.publicKeyPem,
        publicKeyFingerprint: credential.recoveryDeliveryKey.publicKeyFingerprint,
      });
    }
    return Object.freeze(result);
  }
  return Object.freeze({
    state: 'active',
    active: true,
    epochId: credential.epochId,
    generation: credential.generation,
    deviceId: credential.deviceId,
    userId: credential.userId,
    activatedAt: credential.activatedAt,
    recoveryDelivery: credential.pendingRecoveryDelivery
      ? Object.freeze({
        pending: true,
        deliveryId: credential.pendingRecoveryDelivery.deliveryId,
        epochId: credential.pendingRecoveryDelivery.epochId,
        rowVersion: credential.pendingRecoveryDelivery.rowVersion,
      })
      : Object.freeze({ pending: false }),
  });
}

function createPrimaryHostCredentialStore({ filePath, safeStorage, fsImpl = fs }) {
  if (!filePath || !safeStorage) throw credentialError('PRIMARY_HOST_CREDENTIAL_STORE_CONFIG_REQUIRED');

  function assertEncryptionAvailable() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw credentialError('PRIMARY_HOST_ENCRYPTION_UNAVAILABLE');
    }
  }

  function read() {
    if (!fsImpl.existsSync(filePath)) return null;
    assertEncryptionAvailable();
    try {
      const encrypted = fsImpl.readFileSync(filePath);
      return normalizeStoredCredential(JSON.parse(safeStorage.decryptString(encrypted)));
    } catch (error) {
      if (error?.code === 'PRIMARY_HOST_CREDENTIAL_INVALID') throw error;
      throw credentialError('PRIMARY_HOST_CREDENTIAL_UNREADABLE', error);
    }
  }

  function writeEncrypted(credential) {
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    try {
      if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
      fsImpl.writeFileSync(
        temporary,
        safeStorage.encryptString(JSON.stringify(credential)),
        { flag: 'wx' }
      );
      fsImpl.renameSync(temporary, filePath);
    } catch (error) {
      try {
        if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
      } catch (_cleanupError) { /* best effort */ }
      throw error;
    }
  }

  return Object.freeze({
    read,
    status() {
      return publicStatus(read());
    },
    stage(value) {
      assertEncryptionAvailable();
      const existing = read();
      const version = value?.recoveryDeliveryKey
        ? RECOVERY_DELIVERY_STORE_VERSION
        : STAGED_STORE_VERSION;
      const candidate = normalizeStagedCredential({
        ...value,
        version,
        state: 'staged',
        credential: value?.hostCredential,
      });
      if (existing) {
        if (existing.state === 'staged'
          && existing.stageId === candidate.stageId
          && existing.operation === candidate.operation
          && existing.deviceId === candidate.deviceId
          && existing.generation === candidate.generation
          && existing.version === candidate.version
          && (candidate.version !== RECOVERY_DELIVERY_STORE_VERSION
            || existing.recoveryDeliveryKey.publicKeyFingerprint
              === candidate.recoveryDeliveryKey.publicKeyFingerprint)) {
          return publicStatus(existing);
        }
        throw credentialError('PRIMARY_HOST_CREDENTIAL_STAGE_CONFLICT');
      }
      writeEncrypted(candidate);
      return publicStatus(candidate);
    },
    commit({ stageId, epoch, pendingRecoveryDelivery } = {}) {
      assertEncryptionAvailable();
      const existing = read();
      if (!existing || existing.stageId !== requiredText(stageId, 256)) {
        throw credentialError('PRIMARY_HOST_CREDENTIAL_STAGE_REQUIRED');
      }
      if (existing.state === 'active') return publicStatus(existing);
      if (existing.state !== 'staged'
        || existing.deviceId !== String(epoch?.deviceId || '')
        || existing.generation !== Number(epoch?.generation)) {
        throw credentialError('PRIMARY_HOST_CREDENTIAL_STAGE_MISMATCH');
      }
      const common = {
        state: 'active',
        stageId: existing.stageId,
        epochId: epoch?.id,
        generation: epoch?.generation,
        deviceId: epoch?.deviceId,
        userId: epoch?.userId,
        activatedAt: epoch?.activatedAt,
        credential: existing.credential,
      };
      let credential;
      if (existing.version === RECOVERY_DELIVERY_STORE_VERSION) {
        const pending = normalizePendingRecoveryDelivery(
          pendingRecoveryDelivery,
          existing.recoveryDeliveryKey
        );
        if (pending.epochId !== String(epoch?.id || '')
          || pending.generation !== Number(epoch?.generation)
          || pending.recoveryPackage.deviceId !== String(epoch?.deviceId || '')) {
          throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
        }
        credential = normalizeStoredCredential({
          ...common,
          version: RECOVERY_DELIVERY_STORE_VERSION,
          recoveryDeliveryKey: existing.recoveryDeliveryKey,
          pendingRecoveryDelivery: pending,
        });
      } else {
        if (pendingRecoveryDelivery) {
          throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID');
        }
        credential = normalizeStoredCredential({
          ...common,
          version: STAGED_STORE_VERSION,
        });
      }
      writeEncrypted(credential);
      return publicStatus(credential);
    },
    write(value) {
      assertEncryptionAvailable();
      const credential = normalizeAdoption(value);
      writeEncrypted(credential);
      return publicStatus(credential);
    },
    revealRecoveryPackage({ deliveryId } = {}) {
      const credential = read();
      const pending = credential?.pendingRecoveryDelivery;
      if (!pending) throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_PENDING');
      if (pending.deliveryId !== requiredText(
        deliveryId,
        128,
        'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH'
      )) {
        throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
      }
      return Object.freeze({
        deliveryId: pending.deliveryId,
        epochId: pending.epochId,
        factorId: pending.factorId,
        generation: pending.generation,
        rowVersion: pending.rowVersion,
        recipientPublicKeyFingerprint: pending.recipientPublicKeyFingerprint,
        recoveryPackage: Object.freeze({ ...pending.recoveryPackage }),
      });
    },
    clearRecoveryDelivery({ deliveryId } = {}) {
      const requestedDeliveryId = requiredText(
        deliveryId,
        128,
        'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH'
      );
      const credential = read();
      const pending = credential?.pendingRecoveryDelivery;
      if (!pending) {
        const acknowledgedId = credential?.recoveryDeliveryAcknowledgement?.deliveryId;
        if (acknowledgedId && acknowledgedId !== requestedDeliveryId) {
          throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
        }
        return publicStatus(credential);
      }
      if (pending.deliveryId !== requestedDeliveryId) {
        throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
      }
      const cleared = normalizeStoredCredential({
        version: RECOVERY_DELIVERY_STORE_VERSION,
        state: 'active',
        epochId: credential.epochId,
        generation: credential.generation,
        deviceId: credential.deviceId,
        userId: credential.userId,
        activatedAt: credential.activatedAt,
        credential: credential.credential,
        recoveryDeliveryAcknowledgement: {
          deliveryId: pending.deliveryId,
          epochId: pending.epochId,
          factorId: pending.factorId,
          rowVersion: pending.rowVersion,
          recipientPublicKeyFingerprint: pending.recipientPublicKeyFingerprint,
        },
      });
      writeEncrypted(cleared);
      return publicStatus(cleared);
    },
    clear() {
      if (fsImpl.existsSync(filePath)) fsImpl.unlinkSync(filePath);
      const temporary = `${filePath}.tmp`;
      if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
      return true;
    },
  });
}

module.exports = {
  RECOVERY_DELIVERY_STORE_VERSION,
  STORE_VERSION,
  createPrimaryHostCredentialStore,
  normalizeStoredCredential,
};
