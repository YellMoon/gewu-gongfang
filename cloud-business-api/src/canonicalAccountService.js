'use strict';

const { types } = require('util');

const SURFACES = new Set(['desktop', 'miniapp']);

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function invalid() {
  return codedError('CLOUD_CANONICAL_ACCOUNT_INVALID');
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = keys.slice().sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw invalid();
  if (actual.some(key => !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) throw invalid();
  return Object.freeze(Object.fromEntries(keys.map(key => [key, descriptors[key].value])));
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim() === value && value !== '';
}

function createCanonicalAccountService(config = {}) {
  const { phoneHash, accountRepository } = exact(config, ['phoneHash', 'accountRepository']);
  const repository = exact(accountRepository, ['resolveVerifiedPhoneHash']);
  if (typeof phoneHash !== 'function' || types.isProxy(phoneHash)
    || typeof repository.resolveVerifiedPhoneHash !== 'function'
    || types.isProxy(repository.resolveVerifiedPhoneHash)) throw invalid();
  return Object.freeze({
    async resolveVerifiedPhone(input) {
      const request = exact(input, ['verifiedPhone', 'surface']);
      if (!nonBlank(request.verifiedPhone) || !SURFACES.has(request.surface)) throw invalid();
      let normalizedHash;
      try {
        normalizedHash = phoneHash(request.verifiedPhone);
      } catch (_) {
        throw invalid();
      }
      if (!/^[0-9a-f]{64}$/u.test(normalizedHash)) throw invalid();
      let account;
      try {
        account = await repository.resolveVerifiedPhoneHash({ phoneHash: normalizedHash });
      } catch (error) {
        if (error && typeof error.code === 'string' && error.code.startsWith('CLOUD_CANONICAL_ACCOUNT_')) throw error;
        throw codedError('CLOUD_CANONICAL_ACCOUNT_UNAVAILABLE');
      }
      if (account === null) throw codedError('CLOUD_CANONICAL_ACCOUNT_NOT_PROVISIONED');
      const canonical = exact(account, ['authorityId', 'accountId']);
      if (!nonBlank(canonical.authorityId) || !nonBlank(canonical.accountId)) throw invalid();
      return Object.freeze({ authorityId: canonical.authorityId, accountId: canonical.accountId });
    },
  });
}

module.exports = Object.freeze({ createCanonicalAccountService });
