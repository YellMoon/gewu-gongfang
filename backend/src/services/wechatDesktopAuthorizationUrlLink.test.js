const assert = require('assert');

(async () => {
  const service = require('./wechatMiniappService');
  assert.deepStrictEqual(
    service.desktopAuthorizationUrlLinkPayload('challenge-1234567890'),
    {
      path: 'pages/desktop-authorization/index',
      query: 'challengeId=challenge-1234567890',
      env_version: 'release',
      is_expire: true,
      expire_type: 1,
      expire_interval: 1,
    }
  );
  assert.throws(
    () => service.desktopAuthorizationUrlLinkPayload('../challenge'),
    error => error.code === 'DESKTOP_CHALLENGE_ID_INVALID'
  );
  assert.deepStrictEqual(
    service.desktopAuthorizationQrCodePayload('challenge-1234567890'),
    {
      path: 'pages/desktop-authorization/index?challengeId=challenge-1234567890',
      env_version: 'release',
      check_path: false,
      width: 430,
    }
  );
  const previous = {
    appid: process.env.WECHAT_APPID,
    secret: process.env.WECHAT_APPSECRET,
    envVersion: process.env.WECHAT_MINIAPP_ENV_VERSION,
  };
  const originalFetch = global.fetch;
  process.env.WECHAT_APPID = 'wx-test-appid';
  process.env.WECHAT_APPSECRET = 'test-secret';
  process.env.WECHAT_MINIAPP_ENV_VERSION = 'release';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/cgi-bin/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'access-token', expires_in: 7200 }) };
    }
    return { ok: true, status: 200, json: async () => ({ url_link: 'https://wxaurl.cn/desktop-test' }) };
  };
  try {
    assert.strictEqual(
      await service.createDesktopAuthorizationUrlLink({ challengeId: 'challenge-1234567890' }),
      'https://wxaurl.cn/desktop-test'
    );
    assert.strictEqual(calls.length, 2);
    assert.ok(calls[1].url.includes('/wxa/generate_urllink'));
    assert.deepStrictEqual(JSON.parse(calls[1].options.body), service.desktopAuthorizationUrlLinkPayload('challenge-1234567890'));
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ errcode: 85407, errmsg: 'no scheme permission' }),
    });
    await assert.rejects(
      () => service.createDesktopAuthorizationUrlLink({ challengeId: 'challenge-1234567890' }),
      error => error.code === 'WECHAT_URL_LINK_FAILED' && error.wechatErrcode === 85407
    );
    let qrRequest = null;
    const validQrBytes = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0,
      ...new Array(252).fill(0),
    ]);
    global.fetch = async (url, options = {}) => {
      qrRequest = { url: String(url), options };
      return {
        ok: true,
        status: 200,
        headers: { get: name => name.toLowerCase() === 'content-type' ? 'image/jpeg' : null },
        arrayBuffer: async () => validQrBytes.buffer,
      };
    };
    const qrDataUrl = await service.createDesktopAuthorizationQrCode({ challengeId: 'challenge-1234567890' });
    assert.ok(qrDataUrl.startsWith('data:image/jpeg;base64,/9j/4A'));
    assert.strictEqual(Buffer.from(qrDataUrl.split(',')[1], 'base64').length, 256);
    assert.ok(qrRequest.url.includes('/wxa/getwxacode'));
    assert.deepStrictEqual(JSON.parse(qrRequest.options.body), service.desktopAuthorizationQrCodePayload('challenge-1234567890'));
    global.fetch = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]).buffer,
    });
    await assert.rejects(
      () => service.createDesktopAuthorizationQrCode({ challengeId: 'challenge-1234567890' }),
      error => error.code === 'WECHAT_QR_CODE_FAILED'
    );
    global.fetch = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => { throw new Error('truncated image response'); },
    });
    await assert.rejects(
      () => service.createDesktopAuthorizationQrCode({ challengeId: 'challenge-1234567890' }),
      error => error.code === 'WECHAT_QR_CODE_FAILED'
    );
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('invalid upstream JSON'); },
    });
    await assert.rejects(
      () => service.createDesktopAuthorizationUrlLink({ challengeId: 'challenge-1234567890' }),
      error => error.code === 'WECHAT_URL_LINK_FAILED'
    );
  } finally {
    global.fetch = originalFetch;
    if (previous.appid === undefined) delete process.env.WECHAT_APPID; else process.env.WECHAT_APPID = previous.appid;
    if (previous.secret === undefined) delete process.env.WECHAT_APPSECRET; else process.env.WECHAT_APPSECRET = previous.secret;
    if (previous.envVersion === undefined) delete process.env.WECHAT_MINIAPP_ENV_VERSION; else process.env.WECHAT_MINIAPP_ENV_VERSION = previous.envVersion;
  }
  console.log('wechat desktop authorization URL Link checks passed');
})().catch(error => { console.error(error); process.exit(1); });
