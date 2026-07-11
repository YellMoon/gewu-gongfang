const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

async function postJson(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/auth/wechat-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-phone-login-'));
  const dbPath = path.join(tempDir, 'scheduling.db');
  const realFetch = global.fetch;
  const envSnapshot = { ...process.env };
  let phoneApiCalls = 0;

  Object.assign(process.env, {
    APP_ENV: 'prod',
    NODE_ENV: 'production',
    DB_PATH: dbPath,
    READ_DB_PATH: dbPath,
    JWT_SECRET: 'miniapp-phone-login-test-secret',
    WECHAT_APPID: 'wx-test-appid',
    WECHAT_APPSECRET: 'wx-test-secret',
  });

  global.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/sns/jscode2session')) {
      const loginCode = new URL(url).searchParams.get('js_code');
      const openid = loginCode === 'login-code-repeat'
        ? 'openid-admin-0653'
        : loginCode === 'login-code-unknown' || loginCode === 'login-code-pending'
          ? 'openid-unknown-phone'
          : 'openid-admin-0653';
      return jsonResponse({ openid, unionid: null });
    }
    if (url.includes('/cgi-bin/token')) {
      return jsonResponse({ access_token: 'wechat-access-token', expires_in: 7200 });
    }
    if (url.includes('/wxa/business/getuserphonenumber')) {
      phoneApiCalls += 1;
      const payload = JSON.parse(options.body || '{}');
      const phoneNumber = payload.code === 'phone-code-admin'
        ? '13732250653'
        : '13900000000';
      return jsonResponse({
        errcode: 0,
        errmsg: 'ok',
        phone_info: { phoneNumber, purePhoneNumber: phoneNumber, countryCode: '86' },
      });
    }
    return realFetch(input, options);
  };

  delete require.cache[require.resolve('./database')];
  delete require.cache[require.resolve('./routes/auth')];
  delete require.cache[require.resolve('./app')];
  const { createApp } = require('./app');
  const { getInstance } = require('./database');
  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const firstLogin = await postJson(baseUrl, {
      code: 'login-code-first',
      phoneCode: 'phone-code-admin',
    });
    assert.strictEqual(firstLogin.status, 200, 'verified seeded phone should complete first login');
    assert.strictEqual(firstLogin.body.success, true);
    assert.strictEqual(firstLogin.body.data.user.role, 'super_admin');
    assert.strictEqual(firstLogin.body.data.user.phone, '13732250653');

    const boundUser = getInstance().db.prepare('SELECT * FROM users WHERE phone = ?').get('13732250653');
    assert.strictEqual(boundUser.wechat_openid, 'openid-admin-0653', 'first phone login should bind openid');

    const repeatLogin = await postJson(baseUrl, { code: 'login-code-repeat' });
    assert.strictEqual(repeatLogin.status, 200, 'bound openid should log in without another phone code');
    assert.strictEqual(repeatLogin.body.success, true);
    assert.strictEqual(phoneApiCalls, 1, 'repeat login should not consume another phone code');

    const missingVerification = await postJson(baseUrl, { code: 'login-code-unknown', phone: '13732250653' });
    assert.strictEqual(missingVerification.status, 403);
    assert.strictEqual(missingVerification.body.code, 'PHONE_VERIFICATION_REQUIRED', 'caller supplied phone must be ignored');

    const unknownPhone = await postJson(baseUrl, {
      code: 'login-code-unknown',
      phoneCode: 'phone-code-unknown',
    });
    assert.strictEqual(unknownPhone.status, 202, 'verified new phone should create a pending user');
    assert.strictEqual(unknownPhone.body.code, 'PENDING_REVIEW');
    assert.strictEqual(unknownPhone.body.data, undefined, 'pending response must not contain a business token');
    const pending = getInstance().db.prepare('SELECT * FROM users WHERE phone = ?').get('13900000000');
    assert.strictEqual(pending.review_status, 'pending');
    assert.strictEqual(pending.login_enabled, 0);
    assert.strictEqual(pending.wechat_openid, 'openid-unknown-phone');

    const pendingRepeat = await postJson(baseUrl, { code: 'login-code-pending' });
    assert.strictEqual(pendingRepeat.status, 403);
    assert.strictEqual(pendingRepeat.body.code, 'USER_PENDING_REVIEW');

    getInstance().reviewUser({ actorPhone: '13732250653', userId: pending.id, role: 'admin' });
    const approved = await postJson(baseUrl, { code: 'login-code-pending' });
    assert.strictEqual(approved.status, 200);
    assert.ok(approved.body.data.token, 'reviewed user should receive a token');

    console.log('miniapp verified phone login checks passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    getInstance().close();
    global.fetch = realFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key];
    }
    Object.assign(process.env, envSnapshot);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
