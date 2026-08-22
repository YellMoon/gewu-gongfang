'use strict';

const { types } = require('util');

function rejected() {
  return Object.assign(new Error('canonical WeChat identity was rejected'), { code: 'CLOUD_CANONICAL_WECHAT_IDENTITY_REJECTED' });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw rejected();
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw rejected();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw rejected();
    copy[key] = descriptor.value;
  }
  return copy;
}

function text(value) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 4096 ? value : null;
}

function canonicalAccount(value) {
  const copy = exact(value, ['authorityId', 'accountId']);
  if (!text(copy.authorityId) || !text(copy.accountId)) throw rejected();
  return Object.freeze(copy);
}

function createCanonicalWechatIdentityService(config) {
  const settings = exact(config, ['wechatVerifier', 'contactHash', 'verificationEvidenceHash', 'resolveByContact', 'resolveCanonicalPhone', 'bind', 'randomId']);
  if (typeof settings.wechatVerifier !== 'function' || typeof settings.contactHash !== 'function' || typeof settings.verificationEvidenceHash !== 'function'
    || typeof settings.resolveByContact !== 'function' || typeof settings.resolveCanonicalPhone !== 'function' || typeof settings.bind !== 'function' || typeof settings.randomId !== 'function') throw rejected();
  return Object.freeze({
    async resolveOrBind(input) {
      const request = exact(input, ['loginCode', 'phoneCode']);
      if (!text(request.loginCode) || (request.phoneCode !== null && !text(request.phoneCode))) throw rejected();
      let verified;
      try { verified = exact(await settings.wechatVerifier(request.loginCode), ['openid', 'unionid']); } catch (_) { throw rejected(); }
      if (!text(verified.openid) || (verified.unionid !== null && !text(verified.unionid))) throw rejected();
      let openidHash;
      let unionidHash = null;
      let byOpenid = null;
      let byUnionid = null;
      try {
        openidHash = settings.contactHash('wechat_openid', verified.openid);
        if (verified.unionid !== null) unionidHash = settings.contactHash('wechat_unionid', verified.unionid);
        if (!/^[0-9a-f]{64}$/u.test(openidHash) || (unionidHash !== null && !/^[0-9a-f]{64}$/u.test(unionidHash))) throw rejected();
        byOpenid = await settings.resolveByContact({ contactType: 'wechat_openid', contactHash: openidHash, loginCode: request.loginCode });
        if (unionidHash !== null) byUnionid = await settings.resolveByContact({ contactType: 'wechat_unionid', contactHash: unionidHash, loginCode: request.loginCode });
      } catch (_) { throw rejected(); }
      const existing = [byOpenid, byUnionid].filter(value => value !== null).map(value => {
        const copy = exact(value, ['authorityId', 'accountId', 'phoneHmac']);
        if (!/^[0-9a-f]{64}$/u.test(copy.phoneHmac)) throw rejected();
        return Object.freeze({ ...canonicalAccount({ authorityId: copy.authorityId, accountId: copy.accountId }), phoneHmac: copy.phoneHmac });
      });
      if (existing.length > 0) {
        if (existing.some(value => value.authorityId !== existing[0].authorityId || value.accountId !== existing[0].accountId || value.phoneHmac !== existing[0].phoneHmac)) throw rejected();
        return Object.freeze({ ...existing[0], provisioned: false, bound: false });
      }
      if (!text(request.phoneCode)) throw rejected();
      let phoneCanonical;
      try { phoneCanonical = exact(await settings.resolveCanonicalPhone(request.phoneCode), ['authorityId', 'accountId', 'phoneHmac', 'provisioned']); } catch (_) { throw rejected(); }
      const phoneAccount = canonicalAccount({ authorityId: phoneCanonical.authorityId, accountId: phoneCanonical.accountId });
      if (!/^[0-9a-f]{64}$/u.test(phoneCanonical.phoneHmac) || typeof phoneCanonical.provisioned !== 'boolean') throw rejected();
      let evidence;
      try {
        evidence = settings.verificationEvidenceHash(request.loginCode);
      } catch (_) { throw rejected(); }
      const canonical = phoneAccount;
      if (!/^[0-9a-f]{64}$/u.test(evidence)) throw rejected();
      const binding = {
        authorityId: canonical.authorityId,
        accountId: canonical.accountId,
        openidContactId: settings.randomId('wechat-openid'),
        openidHash,
        unionidContactId: unionidHash === null ? null : settings.randomId('wechat-unionid'),
        unionidHash,
        verificationEvidenceHash: evidence,
      };
      if (!text(binding.openidContactId) || (binding.unionidContactId !== null && !text(binding.unionidContactId))) throw rejected();
      let bound;
      try { bound = canonicalAccount(await settings.bind(binding)); } catch (_) { throw rejected(); }
      if (bound.authorityId !== canonical.authorityId || bound.accountId !== canonical.accountId) throw rejected();
      return Object.freeze({ ...canonical, phoneHmac: phoneCanonical.phoneHmac, provisioned: phoneCanonical.provisioned, bound: true });
    },
  });
}

module.exports = Object.freeze({ createCanonicalWechatIdentityService });
