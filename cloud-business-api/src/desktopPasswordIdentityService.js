'use strict';

const crypto = require('crypto');
const { types } = require('util');

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 32, saltLength: 16, algorithm: 'scrypt-v1' });

function invalid() {
  return Object.assign(new Error('desktop password identity input is invalid'), { code: 'CLOUD_DESKTOP_PASSWORD_INVALID' });
}

function rejected() {
  return Object.assign(new Error('desktop password identity was rejected'), { code: 'CLOUD_DESKTOP_PASSWORD_REJECTED' });
}

function exact(value, keys, error = invalid) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw error();
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw error();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw error();
    copy[key] = descriptor.value;
  }
  return copy;
}

function identifier(value) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 512 ? value : null;
}

function loginName(value) {
  if (value === null) return null;
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]{2,63}$/u.test(value) ? value : undefined;
}

function passwordBytes(value, error) {
  if (typeof value !== 'string') throw error();
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < 10 || bytes > 1024) throw error();
  return Buffer.from(value, 'utf8');
}

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 }, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function credentialRow(value) {
  let row;
  try {
    row = exact(value, ['authorityId', 'accountId', 'phoneHash', 'loginName', 'saltB64', 'passwordHashB64', 'algorithm'], rejected);
  } catch (_) {
    row = exact(value, ['authorityId', 'accountId', 'loginName', 'saltB64', 'passwordHashB64', 'algorithm'], rejected);
  }
  if (!identifier(row.authorityId) || !identifier(row.accountId)
    || (Object.hasOwn(row, 'phoneHash') && row.phoneHash !== null && !/^[0-9a-f]{64}$/u.test(row.phoneHash))
    || loginName(row.loginName) === undefined || typeof row.saltB64 !== 'string' || typeof row.passwordHashB64 !== 'string' || row.algorithm !== SCRYPT.algorithm) throw rejected();
  let salt;
  let passwordHash;
  try {
    salt = Buffer.from(row.saltB64, 'base64');
    passwordHash = Buffer.from(row.passwordHashB64, 'base64');
  } catch (_) {
    throw rejected();
  }
  if (salt.length !== SCRYPT.saltLength || passwordHash.length !== SCRYPT.keyLength) throw rejected();
  return { ...row, salt, passwordHash };
}

function createDesktopPasswordIdentityService(config) {
  const settings = exact(config, ['phoneHash', 'randomBytes', 'saveCredential', 'lookupByPhoneHash', 'lookupByLoginName']);
  if (Object.values(settings).some(value => typeof value !== 'function' || types.isProxy(value))) throw invalid();

  async function findCredential(request) {
    let value;
    try {
      if (request.loginType === 'phone') {
        value = await settings.lookupByPhoneHash(settings.phoneHash(request.login));
      } else if (request.loginType === 'account_name' && loginName(request.login) !== undefined) {
        value = await settings.lookupByLoginName(request.login);
      } else {
        throw rejected();
      }
    } catch (error) {
      if (error && error.code === 'CLOUD_DESKTOP_PASSWORD_REJECTED') throw error;
      throw rejected();
    }
    if (value === null) throw rejected();
    return credentialRow(value);
  }

  async function persistCredential({ authorityId, accountId, phoneHash, loginName: requestedLoginName, password: requestedPassword }) {
    const normalizedLoginName = loginName(requestedLoginName);
    const password = passwordBytes(requestedPassword, invalid);
    if (!identifier(accountId) || !identifier(authorityId) || normalizedLoginName === undefined
      || !(phoneHash === null || /^[0-9a-f]{64}$/u.test(phoneHash))) {
      password.fill(0);
      throw invalid();
    }
    let salt;
    try {
      salt = settings.randomBytes(SCRYPT.saltLength);
    } catch (_) {
      password.fill(0);
      throw invalid();
    }
    if (!Buffer.isBuffer(salt) || salt.length !== SCRYPT.saltLength) {
      password.fill(0);
      throw invalid();
    }
    let derived;
    try {
      derived = await derive(password, salt);
      await settings.saveCredential(Object.freeze({
        authorityId, accountId, phoneHash, loginName: normalizedLoginName,
        saltB64: salt.toString('base64'), passwordHashB64: derived.toString('base64'), algorithm: SCRYPT.algorithm,
      }));
    } catch (_) {
      throw invalid();
    } finally {
      password.fill(0);
      if (derived) derived.fill(0);
    }
    return Object.freeze({ authorityId, accountId });
  }

  return Object.freeze({
    async enroll(input) {
      const request = exact(input, ['verifiedPhone', 'accountId', 'authorityId', 'loginName', 'password']);
      const accountId = identifier(request.accountId);
      const authorityId = identifier(request.authorityId);
      let phoneHash;
      try {
        phoneHash = settings.phoneHash(request.verifiedPhone);
      } catch (_) {
        throw invalid();
      }
      return persistCredential({ authorityId, accountId, phoneHash, loginName: request.loginName, password: request.password });
    },
    async enrollVerifiedAccount(input) {
      const request = exact(input, ['accountId', 'authorityId', 'loginName', 'password']);
      return persistCredential({ authorityId: request.authorityId, accountId: request.accountId, phoneHash: null, loginName: request.loginName, password: request.password });
    },
    async verify(input) {
      const request = exact(input, ['loginType', 'login', 'password'], rejected);
      if (!['phone', 'account_name'].includes(request.loginType) || !identifier(request.login)) throw rejected();
      const password = passwordBytes(request.password, rejected);
      try {
        const row = await findCredential(request);
        const derived = await derive(password, row.salt);
        try {
          if (!crypto.timingSafeEqual(derived, row.passwordHash)) throw rejected();
        } finally {
          derived.fill(0);
          row.salt.fill(0);
          row.passwordHash.fill(0);
        }
        return Object.freeze({ authorityId: row.authorityId, accountId: row.accountId });
      } catch (error) {
        if (error && error.code === 'CLOUD_DESKTOP_PASSWORD_REJECTED') throw error;
        throw rejected();
      } finally {
        password.fill(0);
      }
    },
  });
}

module.exports = Object.freeze({ createDesktopPasswordIdentityService, SCRYPT });
