const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_VERSION = 1;
const STAGED_STORE_VERSION = 2;

function credentialError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function requiredText(value, maxLength = 256) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw credentialError('PRIMARY_HOST_CREDENTIAL_INVALID');
  return normalized;
}

function normalizeActiveCredential(value = {}) {
  const generation = Number(value.generation);
  const activatedAt = requiredText(value.activatedAt, 64);
  const credential = requiredText(value.credential, 1024);
  const deviceId = requiredText(value.deviceId, 128);
  if (!Number.isSafeInteger(generation) || generation < 1
    || !Number.isFinite(Date.parse(activatedAt))
    || credential.length < 16
    || !/^[A-Za-z0-9._:-]+$/.test(deviceId)) {
    throw credentialError('PRIMARY_HOST_CREDENTIAL_INVALID');
  }
  return Object.freeze({
    version: Number(value.version),
    ...(Number(value.version) === STAGED_STORE_VERSION
      ? { state: 'active', stageId: requiredText(value.stageId, 256) }
      : {}),
    epochId: requiredText(value.epochId, 128),
    generation,
    deviceId,
    userId: requiredText(value.userId, 128),
    activatedAt,
    credential,
  });
}

function credentialCommitment(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeStagedCredential(value = {}) {
  const generation = Number(value.generation ?? value.targetGeneration);
  const credential = requiredText(value.credential ?? value.hostCredential, 1024);
  const operation = requiredText(value.operation, 32);
  if (Number(value.version) !== STAGED_STORE_VERSION
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
  return Object.freeze({
    version: STAGED_STORE_VERSION,
    state: 'staged',
    stageId: requiredText(value.stageId, 256),
    operation,
    deviceId: requiredText(value.deviceId, 128),
    generation,
    credentialCommitment: commitment,
    credential,
    createdAt: requiredText(value.createdAt || new Date().toISOString(), 64),
  });
}

function normalizeStoredCredential(value = {}) {
  if (Number(value.version) === STAGED_STORE_VERSION && value.state === 'staged') {
    return normalizeStagedCredential(value);
  }
  if (Number(value.version) === STORE_VERSION
    || (Number(value.version) === STAGED_STORE_VERSION && value.state === 'active')) {
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
    return Object.freeze({
      state: 'staged',
      active: false,
      stageId: credential.stageId,
      operation: credential.operation,
      deviceId: credential.deviceId,
      generation: credential.generation,
      credentialCommitment: credential.credentialCommitment,
    });
  }
  return Object.freeze({
    state: 'active',
    active: true,
    epochId: credential.epochId,
    generation: credential.generation,
    deviceId: credential.deviceId,
    userId: credential.userId,
    activatedAt: credential.activatedAt,
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
      const candidate = normalizeStagedCredential({
        ...value,
        version: STAGED_STORE_VERSION,
        state: 'staged',
        credential: value?.hostCredential,
      });
      if (existing) {
        if (existing.state === 'staged'
          && existing.stageId === candidate.stageId
          && existing.operation === candidate.operation
          && existing.deviceId === candidate.deviceId
          && existing.generation === candidate.generation) {
          return publicStatus(existing);
        }
        throw credentialError('PRIMARY_HOST_CREDENTIAL_STAGE_CONFLICT');
      }
      writeEncrypted(candidate);
      return publicStatus(candidate);
    },
    commit({ stageId, epoch } = {}) {
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
      const credential = normalizeStoredCredential({
        version: STAGED_STORE_VERSION,
        state: 'active',
        stageId: existing.stageId,
        epochId: epoch?.id,
        generation: epoch?.generation,
        deviceId: epoch?.deviceId,
        userId: epoch?.userId,
        activatedAt: epoch?.activatedAt,
        credential: existing.credential,
      });
      writeEncrypted(credential);
      return publicStatus(credential);
    },
    write(value) {
      assertEncryptionAvailable();
      const credential = normalizeAdoption(value);
      writeEncrypted(credential);
      return publicStatus(credential);
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
  STORE_VERSION,
  createPrimaryHostCredentialStore,
  normalizeStoredCredential,
};
