const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

async function requestJson(baseUrl, method, pathname, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let responseBody = null;
  try { responseBody = text ? JSON.parse(text) : null; } catch (_error) { responseBody = { raw: text }; }
  return { status: response.status, body: responseBody };
}

(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-bindings-http-'));
  const envSnapshot = { ...process.env };
  Object.assign(process.env, {
    APP_ENV: 'prod',
    NODE_ENV: 'production',
    DB_PATH: path.join(workspace, 'bindings.db'),
    READ_DB_PATH: path.join(workspace, 'bindings.db'),
    JWT_SECRET: 'miniapp-bindings-http-secret',
    REQUIRE_NONCE: 'false',
  });

  delete require.cache[require.resolve('../database')];
  delete require.cache[require.resolve('../middleware/auth')];
  delete require.cache[require.resolve('../app')];
  const { getInstance } = require('../database');
  const { createMiniappWechatBindingService } = require('../services/miniappWechatBindingService');
  const { createApp } = require('../app');
  const database = getInstance();
  const db = database.db;
  const now = '2026-07-23T09:00:00.000Z';
  const insertUser = db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'approved', 1, 0, ?, ?)`);
  insertUser.run('binding-target-a', '13800138100', '13800138100', 'Binding Target A', 'admin', 'admin', now, now);
  insertUser.run('binding-target-b', '13800138101', '13800138101', 'Binding Target B', 'admin', 'admin', now, now);
  insertUser.run('binding-target-c', '13800138102', '13800138102', 'Binding Target C', 'admin', 'admin', now, now);
  insertUser.run('binding-review-admin', '13800138190', '13800138190', 'Review Admin', 'admin', 'admin', now, now);
  insertUser.run('binding-review-teacher', '13800138191', '13800138191', 'Review Teacher', 'teacher', 'teacher', now, now);

  let sequence = 0;
  const service = createMiniappWechatBindingService({
    db,
    now: () => new Date(now),
    uuid: () => `binding-http-${++sequence}`,
  });
  const first = service.requestBinding({
    targetUserId: 'binding-target-a',
    phone: '13800138100',
    openid: 'binding-http-openid-a',
  });
  const tokens = {
    superAdmin: jwt.sign({ id: 'miniapp-admin-13732250653' }, process.env.JWT_SECRET),
    admin: jwt.sign({ id: 'binding-review-admin' }, process.env.JWT_SECRET),
    teacher: jwt.sign({ id: 'binding-review-teacher' }, process.env.JWT_SECRET),
  };

  const server = createApp().listen(0);
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    assert.strictEqual(
      (await requestJson(baseUrl, 'GET', '/api/miniapp/wechat-bindings/admin')).status,
      401,
    );
    assert.strictEqual(
      (await requestJson(baseUrl, 'GET', '/api/miniapp/wechat-bindings/admin', {
        token: tokens.teacher,
      })).status,
      403,
    );

    const listed = await requestJson(
      baseUrl,
      'GET',
      '/api/miniapp/wechat-bindings/admin?status=submitted',
      { token: tokens.admin },
    );
    assert.strictEqual(listed.status, 200);
    assert.strictEqual(listed.body.data.items[0].phoneMasked, '138****8100');
    assert.ok(!JSON.stringify(listed.body).includes('13800138100'));
    assert.ok(!JSON.stringify(listed.body).includes('binding-http-openid-a'));

    const forbidden = await requestJson(
      baseUrl,
      'POST',
      `/api/miniapp/wechat-bindings/${first.id}/approve`,
      { token: tokens.admin, body: { expectedRevision: 1 } },
    );
    assert.strictEqual(forbidden.status, 403);
    assert.strictEqual(forbidden.body.code, 'WECHAT_BINDING_REVIEW_FORBIDDEN');

    const stale = await requestJson(
      baseUrl,
      'POST',
      `/api/miniapp/wechat-bindings/${first.id}/approve`,
      { token: tokens.superAdmin, body: { expectedRevision: 2 } },
    );
    assert.strictEqual(stale.status, 409);
    assert.strictEqual(stale.body.code, 'WECHAT_BINDING_REVISION_CONFLICT');

    const approved = await requestJson(
      baseUrl,
      'POST',
      `/api/miniapp/wechat-bindings/${first.id}/approve`,
      { token: tokens.superAdmin, body: { expectedRevision: 1 } },
    );
    assert.strictEqual(approved.status, 200);
    assert.strictEqual(approved.body.data.request.status, 'approved');
    assert.strictEqual(
      db.prepare("SELECT wechat_openid FROM users WHERE id='binding-target-a'").get().wechat_openid,
      'binding-http-openid-a',
    );

    const second = service.requestBinding({
      targetUserId: 'binding-target-b',
      phone: '13800138101',
      openid: 'binding-http-openid-b',
    });
    const rejected = await requestJson(
      baseUrl,
      'POST',
      `/api/miniapp/wechat-bindings/${second.id}/reject`,
      {
        token: tokens.superAdmin,
        body: { expectedRevision: 1, reason: 'identity mismatch' },
      },
    );
    assert.strictEqual(rejected.status, 200);
    assert.strictEqual(rejected.body.data.request.status, 'rejected');

    const missing = await requestJson(
      baseUrl,
      'POST',
      '/api/miniapp/wechat-bindings/missing/approve',
      { token: tokens.superAdmin, body: { expectedRevision: 1 } },
    );
    assert.strictEqual(missing.status, 404);

    console.log('miniapp wechat binding HTTP checks passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key];
    }
    Object.assign(process.env, envSnapshot);
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (_error) {}
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
