'use strict';

const { types } = require('util');

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function invalid() {
  return codedError('CLOUD_WECHAT_MINIAPP_CODE_INVALID');
}

function unavailable() {
  return codedError('CLOUD_WECHAT_MINIAPP_CODE_UNAVAILABLE');
}

function text(value, maximum = 4096) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum
    ? value
    : null;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}

function imageMime(contentType, bytes) {
  const normalized = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (normalized === 'image/png') return 'image/png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

function createWechatMiniappCodeService(config) {
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
    async generateDesktopLoginCode(input) {
      const request = exact(input, ['scene']);
      const scene = text(request.scene, 32);
      if (!scene || !/^[A-Za-z0-9_-]{1,32}$/u.test(scene)) throw invalid();
      const timestamp = currentTimestamp();
      let response;
      let bytes;
      try {
        const token = await accessToken(timestamp);
        const url = new URL('https://api.weixin.qq.com/wxa/getwxacodeunlimit');
        url.searchParams.set('access_token', token);
        response = await settings.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            scene,
            page: 'pages/login/index',
            check_path: true,
            env_version: settings.envVersion,
            width: 280,
          }),
        });
        bytes = Buffer.from(await response.arrayBuffer());
      } catch (error) {
        if (error?.code === 'CLOUD_WECHAT_MINIAPP_CODE_INVALID') throw error;
        throw unavailable();
      }
      const contentType = response?.headers?.get?.('content-type') || '';
      const startsAsJson = bytes.subarray(0, Math.min(bytes.length, 64)).toString('utf8').trimStart().startsWith('{');
      if (!response?.ok || startsAsJson || String(contentType).toLowerCase().includes('application/json')
        || bytes.length < 128 || bytes.length > 5 * 1024 * 1024) throw unavailable();
      const mime = imageMime(contentType, bytes);
      if (!mime) throw unavailable();
      return `data:${mime};base64,${bytes.toString('base64')}`;
    },
  });
}

module.exports = Object.freeze({ createWechatMiniappCodeService });
