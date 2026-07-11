const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-gateway-phone-'));
process.env.GATEWAY_DB_PATH = path.join(temp, 'gateway.db');
process.env.JWT_SECRET = 'gateway-phone-test-secret';
process.env.WECHAT_APPID = 'test-app';
process.env.WECHAT_APPSECRET = 'test-secret';
process.env.WECHAT_TIMEOUT_MS = '20';
const realFetch = global.fetch;
global.fetch = async (input, options = {}) => { const url = String(input); if (url.includes('jscode2session')) { const code = new URL(url).searchParams.get('js_code'); if (code === 'timeout') return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))); return { ok: true, status: 200, json: async () => ({ openid: `openid-${code}` }) }; } if (url.includes('/cgi-bin/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'token', expires_in: 7200 }) }; if (url.includes('getuserphonenumber')) { const body = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ phone_info: { purePhoneNumber: body.code.startsWith('race') ? '13900000002' : '13900000001' } }) }; } return realFetch(input, options); };
const { initDatabase, closeDatabase, getDb } = require('../db/database');
const createApp = require('../app');
initDatabase();
const server = createApp().listen(0);
const post = async (route, body) => { const response = await realFetch(`http://127.0.0.1:${server.address().port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, headers: response.headers, body: await response.json() }; };
const get = async (route, token) => { const response = await realFetch(`http://127.0.0.1:${server.address().port}${route}`, { headers: { authorization: `Bearer ${token}` } }); return { status: response.status, body: await response.json() }; };
(async () => {
  assert.strictEqual((await post('/api/auth/login', { openid: 'raw' })).status, 410);
  assert.strictEqual((await post('/api/auth/wechat-login', { code: 'new', phone: '13732250653' })).body.code, 'PHONE_VERIFICATION_REQUIRED');
  const pending = await post('/api/auth/wechat-login', { code: 'new', phoneCode: 'verified' });
  assert.strictEqual(pending.status, 202); assert.strictEqual(pending.body.code, 'PENDING_REVIEW');
  assert.strictEqual(getDb().prepare('SELECT COUNT(*) count FROM users WHERE phone_normalized = ?').get('13900000001').count, 1);
  assert.strictEqual((await post('/api/auth/wechat-login', { code: 'new' })).body.code, 'USER_PENDING_REVIEW');
  const pendingUser = getDb().prepare('SELECT * FROM users WHERE phone_normalized = ?').get('13900000001');
  getDb().prepare("UPDATE users SET user_type='admin', review_status='approved', status=1, login_enabled=1 WHERE id=?").run(pendingUser.id);
  const approved = await post('/api/auth/wechat-login', { code: 'new' });
  assert.strictEqual(approved.status, 200); assert.ok(approved.body.data.token);
  const hydrated = await get('/api/admin/users', approved.body.data.token);
  assert.strictEqual(hydrated.status, 200, 'issued claims must hydrate an approved persisted user');

  const racing = await Promise.all([
    post('/api/auth/wechat-login', { code: 'race-a', phoneCode: 'race-a' }),
    post('/api/auth/wechat-login', { code: 'race-b', phoneCode: 'race-b' }),
  ]);
  assert.deepStrictEqual(racing.map(result => result.status).sort(), [202, 409]);
  assert.strictEqual(getDb().prepare('SELECT COUNT(*) count FROM users WHERE phone_normalized=?').get('13900000002').count, 1);

  const timedOut = await post('/api/auth/wechat-login', { code: 'timeout' });
  assert.strictEqual(timedOut.status, 502); assert.strictEqual(timedOut.body.code, 'WECHAT_UPSTREAM_TIMEOUT');
  const beforeMissingConfig = getDb().prepare('SELECT COUNT(*) count FROM users').get().count;
  delete process.env.WECHAT_APPID; delete process.env.WECHAT_APPSECRET;
  const missingConfig = await post('/api/auth/wechat-login', { code: 'missing-config' });
  assert.strictEqual(missingConfig.status, 502); assert.strictEqual(missingConfig.body.code, 'WECHAT_CONFIG_REQUIRED');
  assert.strictEqual(getDb().prepare('SELECT COUNT(*) count FROM users').get().count, beforeMissingConfig);
  process.env.WECHAT_APPID = 'test-app'; process.env.WECHAT_APPSECRET = 'test-secret';
  let limited; for (let i = 0; i < 61; i += 1) limited = await post('/api/auth/wechat-login', { code: `rate-${i}` });
  assert.strictEqual(limited.status, 429); assert.ok(limited.headers.get('retry-after'));
  console.log('gateway miniapp phone login HTTP checks passed');
})().finally(() => new Promise(resolve => server.close(resolve))).then(() => { closeDatabase(); global.fetch = realFetch; fs.rmSync(temp, { recursive: true, force: true }); }).catch(error => { console.error(error); process.exitCode = 1; });
