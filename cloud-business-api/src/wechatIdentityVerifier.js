'use strict';

function unavailable() {
  return Object.assign(new Error('wechat identity verification unavailable'), { code: 'WECHAT_IDENTITY_VERIFICATION_UNAVAILABLE' });
}

function text(value) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 1024;
}

function createWechatIdentityVerifier({ appId, appSecret, fetchImpl = fetch }) {
  if (!text(appId) || !text(appSecret) || typeof fetchImpl !== 'function') throw unavailable();
  return Object.freeze(async loginCode => {
    if (!text(loginCode)) throw unavailable();
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', appSecret);
    url.searchParams.set('js_code', loginCode);
    url.searchParams.set('grant_type', 'authorization_code');
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    } catch (_) {
      throw unavailable();
    }
    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw unavailable();
    }
    if (!response.ok || payload?.errcode || !text(payload?.openid) || (payload?.unionid !== undefined && payload.unionid !== null && !text(payload.unionid))) throw unavailable();
    return Object.freeze({ openid: payload.openid, unionid: payload.unionid || null });
  });
}

module.exports = Object.freeze({ createWechatIdentityVerifier });
