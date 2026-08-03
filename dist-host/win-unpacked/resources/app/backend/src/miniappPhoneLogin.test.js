const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

async function postJson(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/auth/wechat-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function refreshToken(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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
  let wechatSessionCalls = 0;

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
      wechatSessionCalls += 1;
      const loginCode = new URL(url).searchParams.get('js_code');
      const openids = {
        'login-code-known': 'openid-known-admin',
        'login-code-visitor': 'openid-new-visitor',
        'login-code-conflict': 'openid-known-admin',
        'login-code-invalid-phone': 'openid-invalid-phone',
      };
      return { ok: true, status: 200, json: async () => ({ openid: openids[loginCode] || 'openid-new-visitor', unionid: null }) };
    }
    if (url.includes('/wxa/business/getuserphonenumber')) {
      phoneApiCalls += 1;
      return { ok: true, status: 200, json: async () => ({ errcode: 0, phone_info: { phoneNumber: '13732250653' } }) };
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
    (id, wechat_openid, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES ('manual-known-http', NULL, '13800138005', '13800138005', 'Manual Known HTTP',
      'admin', 'admin', 1, 1, 'approved', 1, 0, ?, ?)`).run(seededAt, seededAt);
  getInstance().db.prepare(`INSERT INTO authority_accounts
    (user_id, authority_id, status, created_at, updated_at)
    VALUES ('manual-known-http', 'authority-miniapp-http', 'active', ?, ?)`)
    .run(seededAt, seededAt);
  getInstance().db.prepare(`INSERT INTO authority_role_bindings
    (binding_id, authority_id, user_id, role, subject_type, subject_id, status,
     grant_version, granted_by, created_at, updated_at)
    VALUES ('binding-manual-known-http', 'authority-miniapp-http', 'manual-known-http',
      'admin', NULL, NULL, 'active', 1, 'test', ?, ?)`)
    .run(seededAt, seededAt);
  const server = app.listen(0);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const retired = await postJson(baseUrl, { code: 'login-code-known', phoneCode: 'retired-phone-code' });
    assert.strictEqual(retired.status, 400);
    assert.strictEqual(retired.body.code, 'MINIAPP_AUTOMATIC_PHONE_RETRIEVAL_RETIRED');
    assert.strictEqual(phoneApiCalls, 0, 'retired production login must not call the automatic phone adapter');

    const missingPhone = await postJson(baseUrl, { code: 'login-code-known' });
    assert.strictEqual(missingPhone.status, 400);
    assert.strictEqual(missingPhone.body.code, 'MANUAL_PHONE_REQUIRED');

    const usersBeforeInvalidPhone = getInstance().db.prepare('SELECT COUNT(*) count FROM users').get().count;
    const wechatSessionCallsBeforeInvalidPhone = wechatSessionCalls;
    const invalidPhone = await postJson(baseUrl, {
      code: 'login-code-invalid-phone',
      phone: '12800138000',
    });
    assert.strictEqual(invalidPhone.status, 400);
    assert.strictEqual(invalidPhone.body.code, 'MANUAL_PHONE_INVALID');
    assert.strictEqual(
      wechatSessionCalls,
      wechatSessionCallsBeforeInvalidPhone,
      'invalid manual phone input must be rejected before exchanging the WeChat login code',
    );
    assert.strictEqual(getInstance().db.prepare('SELECT COUNT(*) count FROM users').get().count, usersBeforeInvalidPhone);
    assert.strictEqual(
      getInstance().db.prepare("SELECT id FROM users WHERE wechat_openid='openid-invalid-phone'").get(),
      undefined,
      'an invalid phone must not create a visitor or bind its resolved openid',
    );

    const known = await postJson(baseUrl, { code: 'login-code-known', phone: '13800138005', miniappVersion: '7.0.1', platform: 'wechat' });
    assert.strictEqual(known.status, 200);
    assert.strictEqual(known.body.data.user.role, 'admin');
    assert.strictEqual(known.body.data.user.account_state, 'formal');
    assert.strictEqual(phoneApiCalls, 0);
    assert.strictEqual(
      getInstance().db.prepare("SELECT wechat_openid FROM users WHERE id='manual-known-http'").get().wechat_openid,
      'openid-known-admin',
      'a matching unbound account must bind and enter directly without a review response',
    );
    const knownClaims = jwt.verify(known.body.data.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'gewu-miniapp-auth', audience: 'gewu-api',
    });
    assert.strictEqual(knownClaims.token_use, 'miniapp-session');

    const visitor = await postJson(baseUrl, { code: 'login-code-visitor', phone: ' 136-0013-6000 ', miniappVersion: '7.0.1', platform: 'wechat' });
    assert.strictEqual(visitor.status, 200);
    assert.strictEqual(visitor.body.data.user.role, 'visitor');
    assert.strictEqual(visitor.body.data.user.account_state, 'visitor');
    assert.strictEqual(visitor.body.data.user.authority_id, 'authority-miniapp-http');
    assert.deepStrictEqual(visitor.body.data.user.capabilities, [
      'projection:read', 'role-application:read', 'role-application:submit', 'question-preview:read',
    ]);
    const visitorClaims = jwt.verify(visitor.body.data.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'gewu-miniapp-auth', audience: 'gewu-api',
    });
    assert.strictEqual(visitorClaims.token_use, 'miniapp-visitor');
    assert.strictEqual(visitorClaims.role, 'visitor');
    assert.ok(!('phone' in visitorClaims));
    assert.ok(!('openid' in visitorClaims));
    assert.strictEqual((await refreshToken(baseUrl, visitor.body.data.token)).status, 200);

    const conflict = await postJson(baseUrl, { code: 'login-code-conflict', phone: '13900139000' });
    assert.strictEqual(conflict.status, 409);
    assert.strictEqual(conflict.body.code, 'OPENID_PHONE_BINDING_CONFLICT');
    assert.strictEqual(phoneApiCalls, 0);

    const events = getInstance().db.prepare('SELECT result_code, miniapp_version FROM miniapp_login_events ORDER BY rowid').all();
    assert.ok(events.some(event => event.result_code === 'FORMAL_LOGIN_SUCCESS' && event.miniapp_version === '7.0.1'));
    assert.ok(events.some(event => event.result_code === 'VISITOR_LOGIN_SUCCESS'));
    console.log('miniapp manual phone login checks passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    getInstance().close();
    global.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in envSnapshot)) delete process.env[key];
    Object.assign(process.env, envSnapshot);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
