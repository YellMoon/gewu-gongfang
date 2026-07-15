const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-gateway-phone-'));
process.env.GATEWAY_DB_PATH = path.join(temp, 'gateway.db');
process.env.JWT_SECRET = 'gateway-phone-test-secret-at-least-32-bytes';
process.env.MINIAPP_REVIEW_EXPERIENCE_CODE = 'review-http-code-2026';
process.env.WECHAT_APPID = 'test-app';
process.env.WECHAT_APPSECRET = 'test-secret';
process.env.WECHAT_TIMEOUT_MS = '20';
const realFetch = global.fetch;
global.fetch = async (input, options = {}) => { const url = String(input); if (url.includes('jscode2session')) { const code = new URL(url).searchParams.get('js_code'); if (code === 'timeout') return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))); return { ok: true, status: 200, json: async () => ({ openid: `openid-${code}` }) }; } if (url.includes('/cgi-bin/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'token', expires_in: 7200 }) }; if (url.includes('getuserphonenumber')) { const body = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ phone_info: { purePhoneNumber: body.code.startsWith('race') ? '13900000002' : '13900000001' } }) }; } return realFetch(input, options); };
const { initDatabase, closeDatabase, getDb } = require('../db/database');
const { generateToken } = require('../middleware/auth');
const createApp = require('../app');
initDatabase();
const server = createApp().listen(0);
const post = async (route, body) => { const response = await realFetch(`http://127.0.0.1:${server.address().port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, headers: response.headers, body: await response.json() }; };
const postWithToken = async (route, body, token) => { const response = await realFetch(`http://127.0.0.1:${server.address().port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
const get = async (route, token, headers = {}) => { const response = await realFetch(`http://127.0.0.1:${server.address().port}${route}`, { headers: { authorization: `Bearer ${token}`, ...headers } }); return { status: response.status, body: await response.json() }; };
(async () => {
  const usersBeforeReview = getDb().prepare('SELECT COUNT(*) count FROM users').get().count;
  const deniedReview = await post('/api/auth/review-demo', { code: 'wrong', role: 'admin' });
  assert.strictEqual(deniedReview.status, 403);
  assert.strictEqual(deniedReview.body.code, 'REVIEW_DEMO_CODE_INVALID');
  const review = await post('/api/auth/review-demo', { code: process.env.MINIAPP_REVIEW_EXPERIENCE_CODE, role: 'student' });
  assert.strictEqual(review.status, 200); assert.ok(review.body.data.token);
  assert.deepStrictEqual(
    [review.body.data.user.user_type, review.body.data.user.is_review_demo, review.body.data.user.read_only],
    ['student', true, true],
  );
  assert.strictEqual(getDb().prepare('SELECT COUNT(*) count FROM users').get().count, usersBeforeReview);
  const reviewPermissions = await get('/api/permissions/my', review.body.data.token);
  assert.strictEqual(reviewPermissions.status, 200);
  assert.strictEqual(reviewPermissions.body.identity.id, review.body.data.user.id);
  assert.strictEqual(reviewPermissions.body.identity.is_review_demo, true);
  assert.strictEqual(reviewPermissions.body.identity.read_only, true);
  assert.strictEqual(reviewPermissions.body.identity.student_id, 'review-demo-student');
  assert.deepStrictEqual(
    reviewPermissions.body.identity.linked_student_ids,
    ['review-demo-student'],
    'review student permissions must never widen the sample scope with the synthetic session user id',
  );
  assert.ok(reviewPermissions.body.capabilities.includes('review-demo:student'));
  assert.ok(!reviewPermissions.body.capabilities.includes('business:all'));
  assert.strictEqual((await get('/api/admin/users', review.body.data.token)).status, 403);
  const blockedReviewWrite = await postWithToken('/api/cloud/tasks', { taskType: 'question-paper', payload: {} }, review.body.data.token);
  assert.strictEqual(blockedReviewWrite.status, 403);
  assert.strictEqual(blockedReviewWrite.body.code, 'REVIEW_DEMO_READ_ONLY');
  const reviewRefresh = await post('/api/auth/refresh', { token: review.body.data.token });
  assert.strictEqual(reviewRefresh.status, 401, 'review token must not become a normal refreshed token');

  getDb().prepare(`INSERT INTO users
    (id, name, user_type, status, login_enabled, review_status, student_id, linked_student_ids, created_at, updated_at)
    VALUES (?, ?, 'student', 1, 1, 'approved', ?, ?, ?, ?)`).run(
    'student-user-explicit',
    'Explicit Student',
    'student-primary',
    JSON.stringify(['student-secondary', 'student-primary']),
    '2026-07-15T00:00:00.000Z',
    '2026-07-15T00:00:00.000Z',
  );
  const explicitStudentPermissions = await get('/api/permissions/my', generateToken({
    id: 'student-user-explicit', user_type: 'student', name: 'Explicit Student',
    student_id: 'student-primary', linked_student_ids: ['student-secondary', 'student-primary'],
  }));
  assert.deepStrictEqual(
    explicitStudentPermissions.body.identity.linked_student_ids,
    ['student-primary', 'student-secondary'],
    'an explicitly linked normal student must not widen scope with the user id',
  );

  getDb().prepare(`INSERT INTO users
    (id, name, user_type, status, login_enabled, review_status, created_at, updated_at)
    VALUES (?, ?, 'student', 1, 1, 'approved', ?, ?)`).run(
    'student-user-fallback', 'Fallback Student', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z',
  );
  const fallbackStudentPermissions = await get('/api/permissions/my', generateToken({
    id: 'student-user-fallback', user_type: 'student', name: 'Fallback Student',
  }));
  assert.strictEqual(fallbackStudentPermissions.body.identity.student_id, 'student-user-fallback');
  assert.deepStrictEqual(
    fallbackStudentPermissions.body.identity.linked_student_ids,
    ['student-user-fallback'],
    'a normal student without explicit bindings should retain the user-id fallback',
  );

  assert.strictEqual((await post('/api/auth/login', { openid: 'raw' })).status, 410);
  assert.strictEqual((await post('/api/auth/wechat-login', { code: 'new', phone: '13732250653' })).body.code, 'PHONE_VERIFICATION_REQUIRED');
  const pending = await post('/api/auth/wechat-login', { code: 'new', phoneCode: 'verified' });
  assert.strictEqual(pending.status, 202); assert.strictEqual(pending.body.code, 'PENDING_REVIEW');
  assert.strictEqual(getDb().prepare('SELECT COUNT(*) count FROM users WHERE phone_normalized = ?').get('13900000001').count, 1);
  assert.strictEqual((await post('/api/auth/wechat-login', { code: 'new' })).body.code, 'USER_PENDING_REVIEW');
  const pendingUser = getDb().prepare('SELECT * FROM users WHERE phone_normalized = ?').get('13900000001');
  getDb().prepare("UPDATE users SET user_type='admin', review_status='approved', status=1, login_enabled=1, tenant_id='tenant-real', student_id='student-primary', linked_student_ids='student-secondary, student-primary, student-secondary' WHERE id=?").run(pendingUser.id);
  const approved = await post('/api/auth/wechat-login', { code: 'new' });
  assert.strictEqual(approved.status, 200); assert.ok(approved.body.data.token);
  const approvedRefresh = await post('/api/auth/refresh', { token: approved.body.data.token });
  assert.strictEqual(approvedRefresh.status, 200);
  assert.strictEqual(approvedRefresh.body.success, true);
  assert.strictEqual(typeof approvedRefresh.body.token, 'string', 'gateway refresh must return a top-level token');
  assert.ok(approvedRefresh.body.token);
  assert.strictEqual(approvedRefresh.body.data, undefined, 'gateway refresh does not use a nested data.token response');
  const hydrated = await get('/api/admin/users', approved.body.data.token);
  assert.strictEqual(hydrated.status, 200, 'issued claims must hydrate an approved persisted user');
  const spoofedTenant = await get('/api/permissions/my', approved.body.data.token, { 'x-tenantid': 'tenant-spoof' });
  assert.strictEqual(spoofedTenant.status, 403, 'an untrusted tenant alias must not replace the persisted authenticated tenant');
  const permissions = await get('/api/permissions/my', approved.body.data.token);
  assert.deepStrictEqual([permissions.body.identity.id, permissions.body.identity.role, permissions.body.identity.review_status], [pendingUser.id, 'admin', 'approved']);
  assert.strictEqual(permissions.body.identity.tenant_id, 'tenant-real', 'permission identity must return the canonical persisted tenant rather than a caller-provided alias');
  assert.strictEqual(permissions.body.identity.student_id, 'student-primary');
  assert.deepStrictEqual(permissions.body.identity.linked_student_ids, ['student-primary', 'student-secondary'], 'permission identity must return every normalized student binding');
  assert.deepStrictEqual(
    [permissions.body.identity.active, permissions.body.identity.deleted, permissions.body.identity.disabled],
    [true, false, false],
    'permission identity must expose the effective account state used by the normal scope fingerprint',
  );
  for (const sensitive of ['phone', 'phone_normalized', 'openid', 'invite_code', 'token', 'password']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(permissions.body.identity, sensitive), false, `permission identity must not leak ${sensitive}`);
  }
  assert.ok(permissions.body.identity.authorization_revision, 'gateway permission response should carry an authorization revision');

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
