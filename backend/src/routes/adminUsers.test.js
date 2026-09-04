'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-embedded-identity-retired-')), 'test.db');
process.env.READ_DB_PATH = process.env.DB_PATH;

const { createApp } = require('../app');
const { getInstance } = require('../database');

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

(async () => {
  const listener = createApp().listen(0);
  const baseUrl = `http://127.0.0.1:${listener.address().port}`;
  try {
    for (const [method, pathname, body] of [
      ['POST', '/api/auth/wechat-login', { phone: '13800138000', code: 'renderer-supplied' }],
      ['GET', '/api/auth/desktop-session'],
      ['GET', '/api/admin/users'],
      ['PATCH', '/api/admin/users/account-1/disable', {}],
      ['GET', '/api/permissions/my'],
      ['GET', '/api/desktop-identity/devices'],
      ['POST', '/api/desktop-identity/session/challenges/start', {}],
    ]) {
      const result = await request(baseUrl, method, pathname, body);
      assert.strictEqual(result.status, 404, `${method} ${pathname} must not be exposed by the embedded cache service`);
    }
  } finally {
    await new Promise(resolve => listener.close(resolve));
    getInstance().close();
    fs.rmSync(path.dirname(process.env.DB_PATH), { recursive: true, force: true });
  }
  console.log('embedded identity and admin route retirement checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
