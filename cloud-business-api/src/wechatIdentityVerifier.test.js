'use strict';

const assert = require('assert');
const { createWechatIdentityVerifier } = require('./wechatIdentityVerifier');

(async () => {
  const requests = [];
  const verifier = createWechatIdentityVerifier({
    appId: 'wx-test-app',
    appSecret: 'wechat-test-secret',
    fetchImpl: async url => {
      requests.push(url);
      return { ok: true, json: async () => ({ openid: 'official-openid', unionid: 'official-unionid' }) };
    },
  });

  const identity = await verifier('miniapp-login-code');
  assert.deepStrictEqual(identity, { openid: 'official-openid', unionid: 'official-unionid' });
  assert.ok(Object.isFrozen(identity));
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].origin, 'https://api.weixin.qq.com');
  assert.strictEqual(requests[0].pathname, '/sns/jscode2session');
  assert.strictEqual(requests[0].searchParams.get('appid'), 'wx-test-app');
  assert.strictEqual(requests[0].searchParams.get('js_code'), 'miniapp-login-code');
  assert.strictEqual(requests[0].searchParams.get('grant_type'), 'authorization_code');

  const missingUnion = createWechatIdentityVerifier({
    appId: 'wx-test-app', appSecret: 'wechat-test-secret',
    fetchImpl: async () => ({ ok: true, json: async () => ({ openid: 'openid-only' }) }),
  });
  assert.deepStrictEqual(await missingUnion('second-code'), { openid: 'openid-only', unionid: null });

  for (const response of [
    { ok: false, json: async () => ({}) },
    { ok: true, json: async () => ({ errcode: 40029 }) },
    { ok: true, json: async () => ({ openid: '' }) },
  ]) {
    const unavailable = createWechatIdentityVerifier({ appId: 'wx-test-app', appSecret: 'wechat-test-secret', fetchImpl: async () => response });
    await assert.rejects(() => unavailable('invalid-code'), error => error && error.code === 'WECHAT_IDENTITY_VERIFICATION_UNAVAILABLE');
  }
  await assert.rejects(() => verifier('  bad-code'), error => error && error.code === 'WECHAT_IDENTITY_VERIFICATION_UNAVAILABLE');

  console.log('wechat identity verifier checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
