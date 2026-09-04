'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-gateway-local-authority-retired-'));
const databasePath = path.join(workspace, 'gateway.db');
process.env.GATEWAY_DB_PATH = databasePath;

const createApp = require('../app');
const server = createApp().listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function call(method, route, body, token = '') {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

function assertRetired(result, code, label) {
  assert.strictEqual(result.status, 410, `${label} must stay permanently retired`);
  assert.strictEqual(result.body.success, false);
  assert.strictEqual(result.body.code, code);
}

(async () => {
  const retiredAuthRequests = [
    ['POST', '/api/auth/wechat-login', { code: 'legacy-code', phoneCode: 'legacy-phone-code' }],
    ['POST', '/api/auth/login', { openid: 'legacy' }],
    ['POST', '/api/auth/register', { phone: '10000000000' }],
    ['POST', '/api/auth/refresh', { token: 'legacy-token' }],
    ['GET', '/api/auth/wechat-login'],
  ];
  for (const [method, route, body] of retiredAuthRequests) {
    assertRetired(await call(method, route, body), 'GATEWAY_AUTH_RETIRED', `${method} ${route}`);
  }

  assertRetired(
    await call('GET', '/api/permissions/my', undefined, 'obsolete-local-token'),
    'GATEWAY_PERMISSIONS_RETIRED',
    'GET /api/permissions/my',
  );
  assertRetired(
    await call('GET', '/api/admin/users', undefined, 'obsolete-local-token'),
    'GATEWAY_ADMIN_RETIRED',
    'GET /api/admin/users',
  );

  assert.strictEqual(
    fs.existsSync(databasePath),
    false,
    'retired local authority requests must not initialize a gateway authority database',
  );

  console.log('gateway local account and permission authority retirement checks passed');
})().finally(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(workspace, { recursive: true, force: true });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
