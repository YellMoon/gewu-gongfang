let accessTokenCache = { value: '', expiresAt: 0 };

function isProductionRuntime() {
  return process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'prod';
}

function canUseDevWechatIdentity() {
  return process.env.ALLOW_DEV_WECHAT_LOGIN === 'true' || !isProductionRuntime();
}

function makeDevOpenid(code) {
  return `dev_${String(code || 'mock').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}`;
}

function wechatConfig() {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APPSECRET;
  if (!appid || !secret) {
    const error = new Error('WECHAT_APPID/WECHAT_APPSECRET are required');
    error.code = 'WECHAT_CONFIG_REQUIRED';
    throw error;
  }
  return { appid, secret };
}

async function getWechatAccessToken() {
  const now = Date.now();
  if (accessTokenCache.value && accessTokenCache.expiresAt > now) {
    return accessTokenCache.value;
  }

  const { appid, secret } = wechatConfig();
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const payload = await response.json();
  if (!response.ok || payload.errcode || !payload.access_token) {
    const error = new Error(`wechat access token failed: ${payload.errmsg || `HTTP ${response.status}`}`);
    error.code = 'WECHAT_ACCESS_TOKEN_FAILED';
    throw error;
  }

  const expiresInMs = Math.max(60, Number(payload.expires_in || 7200) - 300) * 1000;
  accessTokenCache = { value: payload.access_token, expiresAt: now + expiresInMs };
  return accessTokenCache.value;
}

async function resolveWechatIdentity(code) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) {
    const error = new Error('code is required');
    error.code = 'WECHAT_CODE_REQUIRED';
    throw error;
  }
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APPSECRET;
  if (appid && secret && process.env.WECHAT_USE_MOCK_LOGIN !== 'true') {
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', appid);
    url.searchParams.set('secret', secret);
    url.searchParams.set('js_code', normalizedCode);
    url.searchParams.set('grant_type', 'authorization_code');
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const payload = await response.json();
    if (!response.ok || payload.errcode || !payload.openid) {
      const detail = payload.errmsg || `HTTP ${response.status}`;
      const error = new Error(`wechat code exchange failed: ${detail}`);
      error.code = 'WECHAT_CODE_EXCHANGE_FAILED';
      throw error;
    }
    return { openid: payload.openid, unionid: payload.unionid || null };
  }
  if (!canUseDevWechatIdentity()) {
    const error = new Error('WECHAT_APPID/WECHAT_APPSECRET are required');
    error.code = 'WECHAT_CONFIG_REQUIRED';
    throw error;
  }
  return { openid: makeDevOpenid(normalizedCode), unionid: null };
}

async function resolveWechatPhoneNumber(phoneCode) {
  if (!phoneCode) {
    const error = new Error('phoneCode is required');
    error.code = 'WECHAT_PHONE_CODE_REQUIRED';
    throw error;
  }

  const accessToken = await getWechatAccessToken();
  const url = new URL('https://api.weixin.qq.com/wxa/business/getuserphonenumber');
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: phoneCode }),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json();
  const phone = String(payload.phone_info?.purePhoneNumber || payload.phone_info?.phoneNumber || '').replace(/\D/g, '');
  if (!response.ok || payload.errcode || !/^1\d{10}$/.test(phone)) {
    const error = new Error(`wechat phone exchange failed: ${payload.errmsg || `HTTP ${response.status}`}`);
    error.code = 'WECHAT_PHONE_EXCHANGE_FAILED';
    throw error;
  }
  return phone;
}

function desktopAuthorizationUrlLinkPayload(challengeId) {
  const normalizedId = String(challengeId || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(normalizedId)) {
    const error = new Error('desktop challenge id is invalid');
    error.code = 'DESKTOP_CHALLENGE_ID_INVALID';
    throw error;
  }
  const envVersion = String(process.env.WECHAT_MINIAPP_ENV_VERSION || 'release').trim();
  if (!['release', 'trial', 'develop'].includes(envVersion)) {
    const error = new Error('wechat miniapp environment version is invalid');
    error.code = 'WECHAT_MINIAPP_ENV_VERSION_INVALID';
    throw error;
  }
  return {
    path: 'pages/desktop-authorization/index',
    query: `challengeId=${encodeURIComponent(normalizedId)}`,
    env_version: envVersion,
    is_expire: true,
    expire_type: 1,
    expire_interval: 1,
  };
}

async function createDesktopAuthorizationUrlLink({ challengeId } = {}) {
  const body = desktopAuthorizationUrlLinkPayload(challengeId);
  const accessToken = await getWechatAccessToken();
  const url = new URL('https://api.weixin.qq.com/wxa/generate_urllink');
  url.searchParams.set('access_token', accessToken);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (cause) {
    const error = new Error('wechat URL Link request failed');
    error.code = cause?.name === 'AbortError' || cause?.name === 'TimeoutError'
      ? 'WECHAT_URL_LINK_TIMEOUT'
      : 'WECHAT_URL_LINK_FAILED';
    error.cause = cause;
    throw error;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    const error = new Error('wechat URL Link response was invalid');
    error.code = 'WECHAT_URL_LINK_FAILED';
    error.cause = cause;
    throw error;
  }
  const urlLink = String(payload.url_link || '').trim();
  if (!response.ok || payload.errcode || !/^https:\/\/wxaurl\.cn\//i.test(urlLink)) {
    const error = new Error('wechat URL Link generation failed');
    error.code = 'WECHAT_URL_LINK_FAILED';
    throw error;
  }
  return urlLink;
}

module.exports = {
  createDesktopAuthorizationUrlLink,
  desktopAuthorizationUrlLinkPayload,
  resolveWechatIdentity,
  resolveWechatPhoneNumber,
};
