const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

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

async function getWithToken(baseUrl, pathName, token) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

async function refreshToken(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });
  return { status: response.status, body: await response.json() };
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-phone-login-'));
  const dbPath = path.join(tempDir, 'scheduling.db');
  const realFetch = global.fetch;
  const envSnapshot = { ...process.env };
  let phoneApiCalls = 0;
  const observedLogs = [];
  const consoleSnapshot = Object.fromEntries(['log', 'warn', 'error'].map(method => [method, console[method]]));
  for (const method of Object.keys(consoleSnapshot)) {
    console[method] = (...args) => {
      observedLogs.push(args.map(value => String(value)).join(' '));
      consoleSnapshot[method](...args);
    };
  }

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
      if (payload.code === 'phone-code-fail') {
        return jsonResponse({ errcode: 40029, errmsg: 'invalid code' });
      }
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
      miniappVersion: '5.15.0',
      platform: 'devtools',
    });
    assert.strictEqual(firstLogin.status, 200, 'verified seeded phone should complete first login');
    assert.strictEqual(firstLogin.body.success, true);
    assert.strictEqual(firstLogin.body.data.user.role, 'super_admin');
    assert.strictEqual(firstLogin.body.data.user.phone, '13732250653');

    const boundUser = getInstance().db.prepare('SELECT * FROM users WHERE phone = ?').get('13732250653');
    assert.strictEqual(boundUser.wechat_openid, 'openid-admin-0653', 'first phone login should bind openid');
    const legacyMiniappToken = jwt.sign({
      id: boundUser.id,
      phone: boundUser.phone,
      openid: boundUser.wechat_openid,
      role: boundUser.role,
    }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
    assert.strictEqual(
      (await getWithToken(baseUrl, '/api/auth/me', legacyMiniappToken)).status,
      401,
      'legacy miniapp tokens containing phone/openid must require a verified-phone relogin',
    );
    assert.strictEqual((await getWithToken(baseUrl, '/api/auth/me', firstLogin.body.data.token)).status, 200);
    const firstClaims = jwt.decode(firstLogin.body.data.token);
    const firstRefresh = await refreshToken(baseUrl, firstLogin.body.data.token);
    assert.strictEqual(firstRefresh.status, 200);
    assert.strictEqual(firstRefresh.body.success, true);
    assert.strictEqual(typeof firstRefresh.body.token, 'string');
    const firstRefreshClaims = jwt.verify(firstRefresh.body.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'gewu-miniapp-auth',
      audience: 'gewu-api',
    });
    assert.strictEqual(firstRefreshClaims.sid, firstClaims.sid, 'refresh must preserve the verified session id');
    assert.strictEqual(firstRefreshClaims.token_use, firstClaims.token_use);
    getInstance().db.prepare('UPDATE users SET auth_version=auth_version+1 WHERE id=?').run(boundUser.id);
    assert.strictEqual(
      (await getWithToken(baseUrl, '/api/auth/me', firstLogin.body.data.token)).status,
      401,
      'auth_version changes must revoke an existing formal token',
    );
    assert.strictEqual(
      (await refreshToken(baseUrl, firstRefresh.body.token)).status,
      401,
      'refresh must not bypass auth_version revocation',
    );

    const repeatWithoutPhone = await postJson(baseUrl, { code: 'login-code-repeat' });
    assert.strictEqual(repeatWithoutPhone.status, 403, 'every new session must verify the phone again');
    assert.strictEqual(repeatWithoutPhone.body.code, 'PHONE_VERIFICATION_REQUIRED');
    assert.strictEqual(phoneApiCalls, 1, 'missing phone authorization must not call the phone exchange API');

    const repeatLogin = await postJson(baseUrl, {
      code: 'login-code-repeat',
      phoneCode: 'phone-code-admin',
    });
    assert.strictEqual(repeatLogin.status, 200, 'bound openid should log in after another verified phone exchange');
    assert.strictEqual(repeatLogin.body.success, true);
    assert.strictEqual(phoneApiCalls, 2, 'repeat login must consume another dynamic phone code');

    const missingVerification = await postJson(baseUrl, { code: 'login-code-unknown', phone: '13732250653' });
    assert.strictEqual(missingVerification.status, 403);
    assert.strictEqual(missingVerification.body.code, 'PHONE_VERIFICATION_REQUIRED', 'caller supplied phone must be ignored');

    const eventCountBeforePhoneFailure = getInstance().db.prepare('SELECT COUNT(*) count FROM miniapp_login_events').get().count;
    const failedPhoneExchange = await postJson(baseUrl, {
      code: 'login-code-repeat',
      phoneCode: 'phone-code-fail',
    });
    assert.strictEqual(failedPhoneExchange.status, 502);
    assert.strictEqual(failedPhoneExchange.body.code, 'WECHAT_PHONE_EXCHANGE_FAILED');
    assert.strictEqual(
      getInstance().db.prepare('SELECT COUNT(*) count FROM miniapp_login_events').get().count,
      eventCountBeforePhoneFailure,
      'a failed phone exchange must not create a fabricated verified-phone event',
    );

    const unknownPhone = await postJson(baseUrl, {
      code: 'login-code-unknown',
      phoneCode: 'phone-code-unknown',
      miniappVersion: '5.15.0',
      platform: 'android',
    });
    assert.strictEqual(unknownPhone.status, 200, 'verified new phone should enter the unrecognized student experience');
    assert.strictEqual(unknownPhone.body.success, true);
    assert.ok(unknownPhone.body.data.token, 'unrecognized users should receive a restricted token');
    assert.strictEqual(unknownPhone.body.data.user.role, 'student');
    assert.strictEqual(unknownPhone.body.data.user.account_state, 'unrecognized');
    assert.strictEqual(unknownPhone.body.data.user.token_use, 'unrecognized-student');
    assert.deepStrictEqual(unknownPhone.body.data.user.capabilities, [
      'experience:read',
      'profile-application:read',
      'profile-application:submit',
      'sample-questions:view',
      'sample-paper-export',
    ]);
    const unrecognizedClaims = jwt.verify(unknownPhone.body.data.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'gewu-miniapp-auth',
      audience: 'gewu-miniapp-experience',
    });
    assert.strictEqual(unrecognizedClaims.token_use, 'unrecognized-student');
    assert.ok(!('phone' in unrecognizedClaims));
    assert.ok(!('openid' in unrecognizedClaims));
    const unrecognizedRefresh = await refreshToken(baseUrl, unknownPhone.body.data.token);
    assert.strictEqual(unrecognizedRefresh.status, 200);
    const unrecognizedRefreshClaims = jwt.verify(unrecognizedRefresh.body.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'gewu-miniapp-auth',
      audience: 'gewu-miniapp-experience',
    });
    assert.strictEqual(unrecognizedRefreshClaims.sid, unrecognizedClaims.sid);
    assert.strictEqual(unrecognizedRefreshClaims.token_use, 'unrecognized-student');
    const pending = getInstance().db.prepare('SELECT * FROM users WHERE phone = ?').get('13900000000');
    assert.strictEqual(pending.review_status, 'pending');
    assert.strictEqual(pending.login_enabled, 0);
    assert.strictEqual(pending.wechat_openid, 'openid-unknown-phone');

    const pendingRepeat = await postJson(baseUrl, { code: 'login-code-pending' });
    assert.strictEqual(pendingRepeat.status, 403);
    assert.strictEqual(pendingRepeat.body.code, 'PHONE_VERIFICATION_REQUIRED');

    const pendingVerified = await postJson(baseUrl, {
      code: 'login-code-pending',
      phoneCode: 'phone-code-unknown',
    });
    assert.strictEqual(pendingVerified.status, 200);
    assert.strictEqual(pendingVerified.body.data.user.account_state, 'unrecognized');

    getInstance().reviewUser({ actorPhone: '13732250653', userId: pending.id, role: 'admin' });
    assert.strictEqual(
      (await getWithToken(baseUrl, '/api/auth/me', unknownPhone.body.data.token)).status,
      401,
      'an unrecognized token must not gain formal access after account approval',
    );
    assert.strictEqual(
      (await refreshToken(baseUrl, unrecognizedRefresh.body.token)).status,
      401,
      'refresh must not upgrade an unrecognized session after approval',
    );
    const approved = await postJson(baseUrl, {
      code: 'login-code-pending',
      phoneCode: 'phone-code-unknown',
    });
    assert.strictEqual(approved.status, 200);
    assert.ok(approved.body.data.token, 'reviewed user should receive a token');
    const formalClaims = jwt.verify(approved.body.data.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'gewu-miniapp-auth',
      audience: 'gewu-api',
    });
    assert.strictEqual(formalClaims.token_use, 'miniapp-session');

    const events = getInstance().db.prepare(`SELECT result_code, phone_normalized, miniapp_version, platform
      FROM miniapp_login_events ORDER BY rowid`).all();
    assert.strictEqual(events.length, 5, 'only attempts with a successfully exchanged phone should create events');
    assert.ok(events.some(event => event.result_code === 'UNRECOGNIZED_LOGIN_SUCCESS'));
    assert.ok(events.some(event => event.result_code === 'FORMAL_LOGIN_SUCCESS'));
    assert.ok(events.some(event => event.miniapp_version === '5.15.0' && event.platform === 'devtools'));
    assert.ok(events.some(event => event.miniapp_version === '5.15.0' && event.platform === 'android'));

    const sensitiveValues = [
      'login-code-first',
      'login-code-repeat',
      'login-code-unknown',
      'phone-code-admin',
      'phone-code-unknown',
      'phone-code-fail',
      firstLogin.body.data.token,
      legacyMiniappToken,
      firstRefresh.body.token,
      unknownPhone.body.data.token,
      unrecognizedRefresh.body.token,
      approved.body.data.token,
    ];
    assert.ok(
      sensitiveValues.every(secret => observedLogs.every(line => !line.includes(secret))),
      'logs must not contain WeChat dynamic codes or JWTs',
    );

    console.log('miniapp verified phone login checks passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    getInstance().close();
    global.fetch = realFetch;
    Object.assign(console, consoleSnapshot);
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
