'use strict';

const assert = require('assert');
const { createWechatMiniappSchemeService } = require('./wechatMiniappSchemeService');

(async () => {
  const calls = [];
  const service = createWechatMiniappSchemeService({
    appId: 'wx-test-app',
    appSecret: 'wechat-test-secret',
    envVersion: 'develop',
    now: () => new Date('2026-09-01T08:00:00.000Z'),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: new URL(String(url)), options });
      if (calls.length === 1) {
        return { ok: true, json: async () => ({ access_token: 'access-token-1', expires_in: 7200 }) };
      }
      return { ok: true, json: async () => ({ errcode: 0, openlink: 'weixin://dl/business/?t=desktop-login-1' }) };
    },
  });

  const scheme = await service.generateDesktopLoginScheme({
    pairingId: 'pairing-id-1',
    pairingSecret: 'pairing secret +/=',
    expiresAt: '2026-09-01T08:05:00.000Z',
  });
  assert.strictEqual(scheme, 'weixin://dl/business/?t=desktop-login-1');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].url.origin, 'https://api.weixin.qq.com');
  assert.strictEqual(calls[0].url.pathname, '/cgi-bin/token');
  assert.strictEqual(calls[0].url.searchParams.get('appid'), 'wx-test-app');
  assert.strictEqual(calls[1].url.pathname, '/wxa/generatescheme');
  assert.strictEqual(calls[1].url.searchParams.get('access_token'), 'access-token-1');
  const body = JSON.parse(calls[1].options.body);
  assert.deepStrictEqual(body, {
    jump_wxa: {
      path: 'pages/login/index',
      query: 'desktopLogin=1&pairingId=pairing-id-1&secret=pairing+secret+%2B%2F%3D',
      env_version: 'develop',
    },
    is_expire: true,
    expire_time: 1788249900,
  });

  await assert.rejects(
    () => service.generateDesktopLoginScheme({
      pairingId: 'pairing-id-2',
      pairingSecret: 'secret-2',
      expiresAt: '2026-09-01T08:31:00.000Z',
    }),
    error => error?.code === 'CLOUD_WECHAT_MINIAPP_SCHEME_INVALID',
  );

  const unavailable = createWechatMiniappSchemeService({
    appId: 'wx-test-app',
    appSecret: 'wechat-test-secret',
    envVersion: 'release',
    now: () => new Date('2026-09-01T08:00:00.000Z'),
    fetchImpl: async () => ({ ok: true, json: async () => ({ errcode: 40013, errmsg: 'invalid appid' }) }),
  });
  await assert.rejects(
    () => unavailable.generateDesktopLoginScheme({
      pairingId: 'pairing-id-3', pairingSecret: 'secret-3', expiresAt: '2026-09-01T08:05:00.000Z',
    }),
    error => error?.code === 'CLOUD_WECHAT_MINIAPP_SCHEME_UNAVAILABLE',
  );

  console.log('WeChat miniapp desktop login scheme checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
