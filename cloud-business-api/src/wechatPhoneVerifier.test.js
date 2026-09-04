'use strict';

const assert = require('assert');
const { createWechatPhoneVerifier } = require('./wechatPhoneVerifier');

const calls = [];
const verify = createWechatPhoneVerifier({
  appId: 'appid', appSecret: 'appsecret',
  fetchImpl: async (url, options = {}) => {
    calls.push([url.pathname, options.method || 'GET']);
    if (url.pathname === '/cgi-bin/token') return { ok: true, json: async () => ({ access_token: 'token-1', expires_in: 7200 }) };
    const code = JSON.parse(options.body).code;
    const phone = code === 'phone-code-1'
      ? '+86 137-0000-0000'
      : code === 'phone-code-2'
        ? '86 (137) 0000 0000'
        : code === 'invalid-prefix'
          ? '+86 127-0000-0000'
          : '137abc00000000';
    return { ok: true, json: async () => ({ phone_info: { purePhoneNumber: phone } }) };
  },
});

(async () => {
  assert.strictEqual(await verify('phone-code-1'), '13700000000');
  assert.strictEqual(await verify('phone-code-2'), '13700000000');
  assert.deepStrictEqual(calls, [['/cgi-bin/token', 'GET'], ['/wxa/business/getuserphonenumber', 'POST'], ['/wxa/business/getuserphonenumber', 'POST']]);
  await assert.rejects(() => verify(''), error => error.code === 'WECHAT_PHONE_VERIFICATION_UNAVAILABLE');
  await assert.rejects(() => verify('invalid-prefix'), error => error.code === 'WECHAT_PHONE_VERIFICATION_UNAVAILABLE');
  await assert.rejects(() => verify('invalid-characters'), error => error.code === 'WECHAT_PHONE_VERIFICATION_UNAVAILABLE');
  console.log('wechat phone verifier checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
