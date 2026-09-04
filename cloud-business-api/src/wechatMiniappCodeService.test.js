'use strict';

const assert = require('assert');
const { createWechatMiniappCodeService } = require('./wechatMiniappCodeService');

(async () => {
  const calls = [];
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(320, 7)]);
  const service = createWechatMiniappCodeService({
    appId: 'wx-test-app',
    appSecret: 'wechat-test-secret',
    envVersion: 'develop',
    now: () => new Date('2026-09-05T00:00:00.000Z'),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: new URL(String(url)), options });
      if (calls.length === 1) {
        return { ok: true, json: async () => ({ access_token: 'access-token-1', expires_in: 7200 }) };
      }
      return {
        ok: true,
        headers: { get: name => name.toLowerCase() === 'content-type' ? 'image/png' : null },
        arrayBuffer: async () => png,
      };
    },
  });

  const scene = 'd_123456789012345678901234567890';
  const qrImageDataUrl = await service.generateDesktopLoginCode({ scene });
  assert.strictEqual(qrImageDataUrl, `data:image/png;base64,${png.toString('base64')}`);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].url.pathname, '/cgi-bin/token');
  assert.strictEqual(calls[0].url.searchParams.get('appid'), 'wx-test-app');
  assert.strictEqual(calls[1].url.pathname, '/wxa/getwxacodeunlimit');
  assert.strictEqual(calls[1].url.searchParams.get('access_token'), 'access-token-1');
  assert.deepStrictEqual(JSON.parse(calls[1].options.body), {
    scene,
    page: 'pages/login/index',
    check_path: true,
    env_version: 'develop',
    width: 280,
  });

  await assert.rejects(
    () => service.generateDesktopLoginCode({ scene: `${scene}x` }),
    error => error?.code === 'CLOUD_WECHAT_MINIAPP_CODE_INVALID',
  );

  const unavailable = createWechatMiniappCodeService({
    appId: 'wx-test-app',
    appSecret: 'wechat-test-secret',
    envVersion: 'release',
    now: () => new Date('2026-09-05T00:00:00.000Z'),
    fetchImpl: async url => String(url).includes('/cgi-bin/token')
      ? { ok: true, json: async () => ({ access_token: 'access-token-2', expires_in: 7200 }) }
      : {
        ok: true,
        headers: { get: () => 'application/json; charset=utf-8' },
        arrayBuffer: async () => Buffer.from(JSON.stringify({ errcode: 41030, errmsg: 'invalid page' }), 'utf8'),
      },
  });
  await assert.rejects(
    () => unavailable.generateDesktopLoginCode({ scene }),
    error => error?.code === 'CLOUD_WECHAT_MINIAPP_CODE_UNAVAILABLE',
  );

  console.log('WeChat miniapp desktop login code checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
