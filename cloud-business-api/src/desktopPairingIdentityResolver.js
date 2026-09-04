'use strict';

const { types } = require('util');

function invalid() {
  return Object.assign(new Error('desktop pairing identity resolver input is invalid'), { code: 'CLOUD_DESKTOP_PAIRING_REJECTED' });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}

function text(value, maximum = 512) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum ? value : null;
}

function createDesktopPairingIdentityResolver(config) {
  const settings = exact(config, ['accountRepository', 'readCanonicalByPhoneHmac']);
  if (!settings.accountRepository || typeof settings.accountRepository.readVerifiedPhoneBinding !== 'function'
    || typeof settings.readCanonicalByPhoneHmac !== 'function') throw invalid();

  return async function resolveDesktopPairingIdentity(input) {
    const request = exact(input, ['accountId']);
    const accountId = text(request.accountId);
    if (!accountId) throw invalid();
    const binding = await settings.accountRepository.readVerifiedPhoneBinding({ accountId });
    if (!binding) return null;
    const verifiedBinding = exact(binding, ['accountId', 'phoneHmac']);
    if (verifiedBinding.accountId !== accountId || !/^[0-9a-f]{64}$/u.test(verifiedBinding.phoneHmac)) return null;
    const canonical = await settings.readCanonicalByPhoneHmac({ phoneHmac: verifiedBinding.phoneHmac });
    if (!canonical) return null;
    const identity = exact(canonical, ['authorityId', 'accountId', 'phoneHmac']);
    if (!text(identity.authorityId) || identity.accountId !== accountId || identity.phoneHmac !== verifiedBinding.phoneHmac) return null;
    return Object.freeze(identity);
  };
}

module.exports = Object.freeze({ createDesktopPairingIdentityResolver });
