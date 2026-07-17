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
