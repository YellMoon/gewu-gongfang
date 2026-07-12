const fs = require('fs');
const path = require('path');

function validateCredential(value) {
  if (!value || typeof value !== 'object') throw new Error('DESKTOP_CREDENTIAL_INVALID');
  const token = String(value.token || value.accessToken || '');
  const userId = String(value.user?.id || value.userId || '');
  const deviceId = String(value.deviceId || '');
  if (!token || !userId || !deviceId || token.length > 8192 || userId.length > 128 || deviceId.length > 128) {
    throw new Error('DESKTOP_CREDENTIAL_INVALID');
  }
  return {
    token,
    userId,
    deviceId,
    user: value.user && typeof value.user === 'object'
      ? { id: userId, name: String(value.user.name || '').slice(0, 128), role: String(value.user.role || '').slice(0, 64) }
      : { id: userId, name: '', role: '' },
    expiresAt: value.expiresAt ? String(value.expiresAt) : null,
  };
}

function createDesktopCredentialStore({ filePath, safeStorage, fsImpl = fs }) {
  if (!filePath || !safeStorage) throw new Error('DESKTOP_CREDENTIAL_STORE_CONFIG_REQUIRED');
  return {
    read() {
      if (!fsImpl.existsSync(filePath)) return null;
      if (!safeStorage.isEncryptionAvailable()) throw new Error('DESKTOP_CREDENTIAL_ENCRYPTION_UNAVAILABLE');
      const encrypted = fsImpl.readFileSync(filePath);
      return validateCredential(JSON.parse(safeStorage.decryptString(encrypted)));
    },
    write(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('DESKTOP_CREDENTIAL_ENCRYPTION_UNAVAILABLE');
      const credential = validateCredential(value);
      fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp`;
      fsImpl.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(credential)));
      fsImpl.renameSync(temporary, filePath);
      return { userId: credential.userId, deviceId: credential.deviceId, user: credential.user, expiresAt: credential.expiresAt };
    },
    clear() {
      if (fsImpl.existsSync(filePath)) fsImpl.unlinkSync(filePath);
      const temporary = `${filePath}.tmp`;
      if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
      return true;
    },
  };
}

module.exports = { createDesktopCredentialStore, validateCredential };
