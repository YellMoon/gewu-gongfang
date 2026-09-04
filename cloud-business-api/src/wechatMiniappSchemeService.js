'use strict';

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function invalid() {
  return codedError('CLOUD_WECHAT_MINIAPP_SCHEME_INVALID');
}

function unavailable() {
  return codedError('CLOUD_WECHAT_MINIAPP_SCHEME_UNAVAILABLE');
}

function text(value, maximum = 4096) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum
    ? value
    : null;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
  return value;
}

function createWechatMiniappSchemeService(config) {
  const settings = exact(config, ['appId', 'appSecret', 'envVersion', 'fetchImpl', 'now']);
  if (!text(settings.appId, 128) || !text(settings.appSecret, 512)
    || !['release', 'trial', 'develop'].includes(settings.envVersion)
    || typeof settings.fetchImpl !== 'function' || typeof settings.now !== 'function') throw invalid();
  let cachedToken = null;

  function currentTimestamp() {
    const value = settings.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw invalid();
    return value.getTime();
  }

  async function accessToken(timestamp) {
    if (cachedToken && cachedToken.expiresAt > timestamp) return cachedToken.value;
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', settings.appId);
    url.searchParams.set('secret', settings.appSecret);
    let response;
    let payload;
    try {
      response = await settings.fetchImpl(url);
      payload = await response.json();
    } catch (_) {
      throw unavailable();
    }
    if (!response?.ok || payload?.errcode || !text(payload?.access_token, 4096)) throw unavailable();
    const ttlSeconds = Number(payload.expires_in || 7200);
    cachedToken = Object.freeze({
      value: payload.access_token,
      expiresAt: timestamp + Math.max(60, ttlSeconds - 300) * 1000,
    });
    return cachedToken.value;
  }

  return Object.freeze({
    async generateDesktopLoginScheme(input) {
      const request = exact(input, ['pairingId', 'pairingSecret', 'expiresAt']);
      const pairingId = text(request.pairingId, 256);
      const pairingSecret = text(request.pairingSecret, 512);
      const timestamp = currentTimestamp();
      const expiresAt = Date.parse(request.expiresAt);
      if (!pairingId || !pairingSecret || !Number.isFinite(expiresAt)
        || expiresAt <= timestamp || expiresAt > timestamp + (10 * 60 * 1000)) throw invalid();
      const query = new URLSearchParams({
        desktopLogin: '1',
        pairingId,
        secret: pairingSecret,
      }).toString();
      let response;
      let payload;
      try {
        const token = await accessToken(timestamp);
        const url = new URL('https://api.weixin.qq.com/wxa/generatescheme');
        url.searchParams.set('access_token', token);
        response = await settings.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            jump_wxa: {
              path: 'pages/login/index',
              query,
              env_version: settings.envVersion,
            },
            is_expire: true,
            expire_time: Math.floor(expiresAt / 1000),
          }),
        });
        payload = await response.json();
      } catch (error) {
        if (error?.code === 'CLOUD_WECHAT_MINIAPP_SCHEME_INVALID') throw error;
        throw unavailable();
      }
      if (!response?.ok || payload?.errcode || !text(payload?.openlink, 4096)
        || !String(payload.openlink).startsWith('weixin://')) throw unavailable();
      return payload.openlink;
    },
  });
}

module.exports = Object.freeze({ createWechatMiniappSchemeService });
