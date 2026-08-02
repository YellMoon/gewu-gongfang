'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-gateway-miniapp-auth-moved-'));
process.env.GATEWAY_DB_PATH = path.join(workspace, 'gateway.db');
process.env.JWT_SECRET = 'gateway-auth-moved-test-secret-at-least-32-bytes';

const { initDatabase, closeDatabase, getDb } = require('../db/database');
const { generateToken } = require('../middleware/auth');
const createApp = require('../app');

initDatabase();
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

(async () => {
  const usersBefore = getDb().prepare('SELECT COUNT(*) count FROM users').get().count;
  for (const body of [
    { code: 'legacy-code', phoneCode: 'legacy-phone-code' },
    { code: 'another-code' },
  ]) {
    const moved = await call('POST', '/api/auth/wechat-login', body);
    assert.deepStrictEqual(moved, {
      status: 410,
      body: {
        success: false,
        code: 'MINIAPP_AUTH_MOVED_TO_BACKEND',
        error: 'Miniapp authentication is owned by the scheduling backend',
      },
    });
  }
  assert.strictEqual((await call('GET', '/api/auth/wechat-login')).status, 410);
  assert.strictEqual((await call('POST', '/api/auth/login', { openid: 'legacy' })).status, 410);
  assert.strictEqual((await call('POST', '/api/auth/review-demo', { code: 'legacy' })).status, 410);
  assert.strictEqual(getDb().prepare('SELECT COUNT(*) count FROM users').get().count, usersBefore);

  const now = new Date().toISOString();
  getDb().prepare(`INSERT INTO users
    (id, name, user_type, status, login_enabled, review_status, student_id, linked_student_ids, created_at, updated_at)
    VALUES (?, ?, 'student', 1, 1, 'approved', ?, ?, ?, ?)`).run(
    'student-user-explicit',
    'Explicit Student',
    'student-primary',
    JSON.stringify(['student-secondary', 'student-primary']),
    now,
    now,
  );
  const token = generateToken({
    id: 'student-user-explicit',
    user_type: 'student',
    name: 'Explicit Student',
    student_id: 'student-primary',
    linked_student_ids: ['student-secondary', 'student-primary'],
  });
  const permissions = await call('GET', '/api/permissions/my', undefined, token);
  assert.strictEqual(permissions.status, 200);
  assert.deepStrictEqual(permissions.body.identity.linked_student_ids, ['student-primary', 'student-secondary']);
  assert.strictEqual(permissions.body.identity.student_id, 'student-primary');
  for (const sensitive of ['phone', 'phone_normalized', 'openid', 'token', 'password', 'review_demo_session_id']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(permissions.body.identity, sensitive), false);
  }

  getDb().prepare(`INSERT INTO users
    (id, name, user_type, status, login_enabled, review_status, created_at, updated_at)
    VALUES (?, ?, 'student', 1, 1, 'approved', ?, ?)`).run(
    'student-profile-id-collision',
    'Unbound Miniapp Account',
    now,
    now,
  );
  const unboundToken = generateToken({
    id: 'student-profile-id-collision',
    user_type: 'student',
    name: 'Unbound Miniapp Account',
  });
  const unboundPermissions = await call('GET', '/api/permissions/my', undefined, unboundToken);
  assert.strictEqual(unboundPermissions.status, 200, 'an account without a local subject must still authenticate');
  assert.deepStrictEqual(unboundPermissions.body.capabilities, []);
  assert.strictEqual(unboundPermissions.body.identity.student_id, null, 'the account id must not be synthesized as a student subject id');
  assert.deepStrictEqual(unboundPermissions.body.identity.linked_student_ids, []);
  assert.strictEqual(unboundPermissions.body.identity.subject_scope, 'none');
  assert.strictEqual(unboundPermissions.body.identity.subject_binding, 'unbound');

  console.log('gateway miniapp auth ownership checks passed');
})().finally(async () => {
  await new Promise(resolve => server.close(resolve));
  closeDatabase();
  fs.rmSync(workspace, { recursive: true, force: true });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
