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
      const openids = {
        'login-code-repeat': 'openid-admin-0653',
        'login-code-unknown': 'openid-unknown-phone',
        'login-code-pending': 'openid-unknown-phone',
        'login-code-manual-fresh': 'openid-manual-fresh',
        'login-code-manual-formal': 'openid-manual-formal',
      };
      const openid = openids[loginCode] || 'openid-admin-0653';
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
  const seededAt = new Date().toISOString();
  getInstance().db.prepare(`INSERT INTO authority_metadata(key,value,updated_at)
    VALUES('database_authority_id','authority-miniapp-http',?)`).run(seededAt);
  getInstance().db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES ('manual-existing-http', '13800138005', '13800138005', 'Manual Existing HTTP',
      'admin', 'admin', 1, 1, 'approved', 1, 0, ?, ?)`).run(seededAt, seededAt);
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

    const manualFresh = await postJson(baseUrl, {
      code: 'login-code-manual-fresh',
      phone: '13600136000',
      miniappVersion: '6.4.0',
      platform: 'wechat',
    });
    assert.strictEqual(manualFresh.status, 200);
    assert.strictEqual(manualFresh.body.success, true);
    assert.strictEqual(manualFresh.body.data.user.account_state, 'visitor');
    assert.strictEqual(manualFresh.body.data.user.role, 'visitor');
    assert.strictEqual(manualFresh.body.data.user.authority_id, 'authority-miniapp-http');

    const manualFormal = await postJson(baseUrl, {
      code: 'login-code-manual-formal',
      phone: '13800138005',
    });
    assert.strictEqual(manualFormal.status, 202);
    assert.strictEqual(manualFormal.body.code, 'WECHAT_BINDING_REVIEW_REQUIRED');
    assert.ok(manualFormal.body.data.requestId);
    assert.strictEqual(
      getInstance().db.prepare("SELECT wechat_openid FROM users WHERE id='manual-existing-http'").get().wechat_openid,
      null,
    );

    const mismatch = await postJson(baseUrl, {
      code: 'login-code-repeat',
      phone: '13900000000',
      phoneCode: 'phone-code-admin',
    });
    assert.strictEqual(mismatch.status, 409);
    assert.strictEqual(mismatch.body.code, 'WECHAT_PHONE_MISMATCH');

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

    const callsBeforeMissingPhone = phoneApiCalls;
    const repeatWithoutPhone = await postJson(baseUrl, { code: 'login-code-repeat' });
    assert.strictEqual(repeatWithoutPhone.status, 400, 'every new session must include a phone claim');
    assert.strictEqual(repeatWithoutPhone.body.code, 'MANUAL_PHONE_REQUIRED');
    assert.strictEqual(phoneApiCalls, callsBeforeMissingPhone, 'missing phone input must not call the phone exchange API');

    const repeatLogin = await postJson(baseUrl, {
      code: 'login-code-repeat',
      phoneCode: 'phone-code-admin',
    });
    assert.strictEqual(repeatLogin.status, 200, 'bound openid should log in after another verified phone exchange');
    assert.strictEqual(repeatLogin.body.success, true);
    assert.strictEqual(phoneApiCalls, callsBeforeMissingPhone + 1, 'repeat verified login must consume another dynamic phone code');

    const missingVerification = await postJson(baseUrl, { code: 'login-code-unknown', phone: '13732250653' });
    assert.strictEqual(missingVerification.status, 409);
    assert.strictEqual(
      missingVerification.body.code,
      'PHONE_WECHAT_BINDING_CONFLICT',
      'manual phone input must not take over a phone bound to another WeChat account',
    );

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
    assert.strictEqual(unknownPhone.status, 200, 'verified new phone should enter visitor scope');
    assert.strictEqual(unknownPhone.body.success, true);
    assert.ok(unknownPhone.body.data.token, 'visitors should receive a restricted token');
    assert.strictEqual(unknownPhone.body.data.user.role, 'visitor');
    assert.strictEqual(unknownPhone.body.data.user.account_state, 'visitor');
    assert.strictEqual(unknownPhone.body.data.user.token_use, 'miniapp-visitor');
    assert.deepStrictEqual(unknownPhone.body.data.user.capabilities, [
      'projection:read',
      'role-application:read',
      'role-application:submit',
      'question-preview:read',
    ]);
    const visitorClaims = jwt.verify(unknownPhone.body.data.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'gewu-miniapp-auth',
      audience: 'gewu-api',
    });
    assert.strictEqual(visitorClaims.token_use, 'miniapp-visitor');
    assert.strictEqual(visitorClaims.role, 'visitor');
    assert.strictEqual(visitorClaims.authority_id, 'authority-miniapp-http');
    assert.ok(!('phone' in visitorClaims));
    assert.ok(!('openid' in visitorClaims));
    const visitorRefresh = await refreshToken(baseUrl, unknownPhone.body.data.token);
    assert.strictEqual(visitorRefresh.status, 200);
    const visitorRefreshClaims = jwt.verify(visitorRefresh.body.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'gewu-miniapp-auth',
      audience: 'gewu-api',
    });
    assert.strictEqual(visitorRefreshClaims.sid, visitorClaims.sid);
    assert.strictEqual(visitorRefreshClaims.token_use, 'miniapp-visitor');
    const pending = getInstance().db.prepare('SELECT * FROM users WHERE phone = ?').get('13900000000');
    assert.strictEqual(pending.review_status, 'approved');
    assert.strictEqual(pending.login_enabled, 1);
    assert.strictEqual(pending.wechat_openid, 'openid-unknown-phone');

    const pendingRepeat = await postJson(baseUrl, { code: 'login-code-pending' });
    assert.strictEqual(pendingRepeat.status, 400);
    assert.strictEqual(pendingRepeat.body.code, 'MANUAL_PHONE_REQUIRED');

    const pendingVerified = await postJson(baseUrl, {
      code: 'login-code-pending',
      phoneCode: 'phone-code-unknown',
    });
    assert.strictEqual(pendingVerified.status, 200);
    assert.strictEqual(pendingVerified.body.data.user.account_state, 'visitor');

    getInstance().reviewUser({ actorPhone: '13732250653', userId: pending.id, role: 'admin' });
    assert.strictEqual(
      (await getWithToken(baseUrl, '/api/auth/me', unknownPhone.body.data.token)).status,
      401,
      'an unrecognized token must not gain formal access after account approval',
    );
    assert.strictEqual(
      (await refreshToken(baseUrl, visitorRefresh.body.token)).status,
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
    assert.strictEqual(events.length, 8, 'successful identity decisions and binding outcomes should create audit events');
    assert.ok(events.some(event => event.result_code === 'WECHAT_BINDING_REVIEW_REQUIRED'));
    assert.ok(events.some(event => event.result_code === 'VISITOR_LOGIN_SUCCESS'));
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
      visitorRefresh.body.token,
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
