let accessTokenCache = { value: '', expiresAt: 0 };

function config() {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APPSECRET;
  if (!appid || !secret) throw Object.assign(new Error('WeChat miniapp credentials are required'), { code: 'WECHAT_CONFIG_REQUIRED' });
  return { appid, secret };
}

async function jsonFetch(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(Number(process.env.WECHAT_TIMEOUT_MS || 8000)) });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw Object.assign(new Error('WeChat upstream timed out'), { code: 'WECHAT_UPSTREAM_TIMEOUT' });
    throw Object.assign(new Error('WeChat upstream failed'), { code: 'WECHAT_UPSTREAM_FAILED' });
  }
  const payload = await response.json();
  if (!response.ok || payload.errcode) throw Object.assign(new Error('WeChat exchange failed'), { code: 'WECHAT_EXCHANGE_FAILED' });
  return payload;
}

async function resolveWechatIdentity(code) {
  const { appid, secret } = config();
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  Object.entries({ appid, secret, js_code: code, grant_type: 'authorization_code' }).forEach(([key, value]) => url.searchParams.set(key, value));
  const payload = await jsonFetch(url);
  if (!payload.openid) throw Object.assign(new Error('WeChat identity was not returned'), { code: 'WECHAT_CODE_EXCHANGE_FAILED' });
  return { openid: payload.openid, unionid: payload.unionid || null };
}

async function accessToken() {
  if (accessTokenCache.value && accessTokenCache.expiresAt > Date.now()) return accessTokenCache.value;
  const { appid, secret } = config();
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  Object.entries({ grant_type: 'client_credential', appid, secret }).forEach(([key, value]) => url.searchParams.set(key, value));
  const payload = await jsonFetch(url);
  if (!payload.access_token) throw Object.assign(new Error('WeChat access token was not returned'), { code: 'WECHAT_ACCESS_TOKEN_FAILED' });
  accessTokenCache = { value: payload.access_token, expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 7200) - 300) * 1000 };
  return accessTokenCache.value;
}

async function resolveWechatPhoneNumber(code) {
  const token = await accessToken();
  const url = new URL('https://api.weixin.qq.com/wxa/business/getuserphonenumber');
  url.searchParams.set('access_token', token);
  const payload = await jsonFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const phone = String(payload.phone_info?.purePhoneNumber || '').replace(/\D/g, '');
  if (!/^1\d{10}$/.test(phone)) throw Object.assign(new Error('Verified phone number is invalid'), { code: 'WECHAT_PHONE_EXCHANGE_FAILED' });
  return phone;
}

module.exports = { resolveWechatIdentity, resolveWechatPhoneNumber };
