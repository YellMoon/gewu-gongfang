'use strict';

const assert = require('assert');
const { createCanonicalWechatIdentityService } = require('./canonicalWechatIdentityService');

const hash = character => character.repeat(64);
const calls = [];
const service = createCanonicalWechatIdentityService({
  wechatVerifier: async loginCode => ({ openid: `openid:${loginCode}`, unionid: `union:${loginCode}` }),
  contactHash: (type, value) => { calls.push(['hash', type, value]); return type === 'wechat_openid' ? hash('a') : hash('b'); },
  verificationEvidenceHash: loginCode => hash(loginCode === 'first' ? 'c' : 'd'),
  resolveByContact: async input => input.contactType === 'wechat_unionid' && input.contactHash === hash('b') && input.loginCode === 'known'
    ? { authorityId: 'authority-1', accountId: 'account-known' } : null,
  resolveCanonicalPhone: async phoneCode => {
    if (phoneCode === 'known-phone') return { authorityId: 'authority-1', accountId: 'account-known', phoneHmac: hash('e'), provisioned: false };
    assert.strictEqual(phoneCode, 'phone-proof');
    return { authorityId: 'authority-1', accountId: 'account-new', phoneHmac: hash('f'), provisioned: true };
  },
  bind: async input => { calls.push(['bind', input]); return { authorityId: input.authorityId, accountId: input.accountId }; },
  randomId: prefix => `${prefix}-1`,
});

(async () => {
  const known = await service.resolveOrBind({ loginCode: 'known', phoneCode: 'known-phone' });
  assert.deepStrictEqual(known, { authorityId: 'authority-1', accountId: 'account-known', phoneHmac: hash('e'), provisioned: false, bound: false });

  await assert.rejects(
    () => service.resolveOrBind({ loginCode: 'first', phoneCode: null }),
    error => error && error.code === 'CLOUD_CANONICAL_WECHAT_IDENTITY_REJECTED',
  );

  const first = await service.resolveOrBind({ loginCode: 'first', phoneCode: 'phone-proof' });
  assert.deepStrictEqual(first, { authorityId: 'authority-1', accountId: 'account-new', phoneHmac: hash('f'), provisioned: true, bound: true });
  assert.deepStrictEqual(calls.filter(([type]) => type === 'bind'), [[
    'bind', {
      authorityId: 'authority-1', accountId: 'account-new', openidContactId: 'wechat-openid-1', openidHash: hash('a'), unionidContactId: 'wechat-unionid-1', unionidHash: hash('b'), verificationEvidenceHash: hash('c'),
    },
  ]]);
  console.log('canonical WeChat identity service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
