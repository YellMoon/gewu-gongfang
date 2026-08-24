'use strict';

const { types } = require('util');

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function invalid() {
  return codedError('CLOUD_CANONICAL_ACCOUNT_INVALID');
}

function unavailable() {
  return codedError('CLOUD_CANONICAL_ACCOUNT_UNAVAILABLE');
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

function canonicalAccount(value) {
  const copy = exact(value, ['authorityId', 'accountId']);
  if (!nonBlank(copy.authorityId) || !nonBlank(copy.accountId)) throw invalid();
  return copy;
}

function createCanonicalAccountProvisioningService(config = {}) {
  const settings = exact(config, [
    'phoneHash', 'randomId', 'legacyAccountForPhoneHash', 'provisionPhoneAccount',
  ]);
  if (typeof settings.phoneHash !== 'function' || types.isProxy(settings.phoneHash)
    || typeof settings.randomId !== 'function' || types.isProxy(settings.randomId)
    || typeof settings.legacyAccountForPhoneHash !== 'function' || types.isProxy(settings.legacyAccountForPhoneHash)
    || typeof settings.provisionPhoneAccount !== 'function' || types.isProxy(settings.provisionPhoneAccount)) throw invalid();

  return Object.freeze({
    async resolveOrProvision(input) {
      const request = exact(input, ['verifiedPhone', 'verificationEvidenceHash']);
      if (!nonBlank(request.verifiedPhone) || !/^[0-9a-f]{64}$/u.test(request.verificationEvidenceHash)) throw invalid();
      let phoneHash;
      try {
        phoneHash = settings.phoneHash(request.verifiedPhone);
      } catch (_) {
        throw invalid();
      }
      if (!/^[0-9a-f]{64}$/u.test(phoneHash)) throw invalid();
      let legacy;
      try {
        legacy = settings.legacyAccountForPhoneHash({ phoneHash });
      } catch (_) {
        throw unavailable();
      }
      let accountId;
      if (legacy !== null) {
        const candidate = exact(legacy, ['accountId']);
        if (!nonBlank(candidate.accountId)) throw invalid();
        accountId = candidate.accountId;
      } else {
        try {
          accountId = settings.randomId('account');
        } catch (_) {
          throw unavailable();
        }
        if (!nonBlank(accountId)) throw unavailable();
      }
      let contactId;
      try {
        contactId = settings.randomId('verified-contact');
      } catch (_) {
        throw unavailable();
      }
      if (!nonBlank(contactId)) throw unavailable();
      let provisioned;
      try {
        provisioned = await settings.provisionPhoneAccount({ accountId, contactId, phoneHash, verificationEvidenceHash: request.verificationEvidenceHash });
      } catch (_) {
        throw unavailable();
      }
      const canonical = canonicalAccount(provisioned);
      return Object.freeze({ ...canonical, phoneHmac: phoneHash, provisioned: true });
    },
  });
}

module.exports = Object.freeze({ createCanonicalAccountProvisioningService });
