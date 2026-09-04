'use strict';

const { normalizeMainlandPhone } = require('./mainlandPhone');

function providerFailure() {
  return Object.assign(new Error('wechat phone verification unavailable'), { code: 'WECHAT_PHONE_VERIFICATION_UNAVAILABLE' });
}

function createWechatPhoneVerifier({ appId, appSecret, fetchImpl = fetch, now = () => Date.now() }) {
  if (typeof appId !== 'string' || !appId.trim() || typeof appSecret !== 'string' || !appSecret.trim() || typeof fetchImpl !== 'function' || typeof now !== 'function') throw providerFailure();
  let cached = null;
  async function accessToken() {
    const timestamp = now();
    if (cached && cached.expiresAt > timestamp) return cached.value;
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', appSecret);
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    } catch (_) {
      throw providerFailure();
    }
    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw providerFailure();
    }
    if (!response.ok || payload?.errcode || typeof payload?.access_token !== 'string' || !payload.access_token) throw providerFailure();
    cached = { value: payload.access_token, expiresAt: timestamp + Math.max(60, Number(payload.expires_in || 7200) - 300) * 1000 };
    return cached.value;
  }
  return Object.freeze(async phoneCode => {
    if (typeof phoneCode !== 'string' || phoneCode.trim() !== phoneCode || !phoneCode) throw providerFailure();
    const token = await accessToken();
    const url = new URL('https://api.weixin.qq.com/wxa/business/getuserphonenumber');
    url.searchParams.set('access_token', token);
    let response;
    try {
      response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: phoneCode }), signal: AbortSignal.timeout(8000) });
    } catch (_) {
      throw providerFailure();
    }
    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw providerFailure();
    }
    const phone = normalizeMainlandPhone(payload?.phone_info?.purePhoneNumber);
    if (!response.ok || payload?.errcode || !phone) throw providerFailure();
    return phone;
  });
}

module.exports = Object.freeze({ createWechatPhoneVerifier });
