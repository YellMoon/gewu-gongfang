const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'admin-users-route-test-secret';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-admin-users-')), 'test.db');

const { DatabaseService } = require('../database');
const db = new DatabaseService();
const now = new Date().toISOString();
db.db.prepare(`INSERT INTO users (id, phone, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
 VALUES (?, ?, ?, ?, 1, 1, ?, 0, ?, ?)`)
  .run('ordinary-admin', '13900000000', 'Admin', 'admin', 'approved', now, now);
db.db.prepare(`INSERT INTO users (id, phone, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
 VALUES (?, ?, ?, 'pending', 1, 1, 'pending', 0, ?, ?)`)
  .run('pending-user', '13800000000', 'Pending', now, now);
db.db.prepare(`INSERT INTO users (id, phone, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
 VALUES (?, ?, ?, 'teacher', 1, 1, 'approved', 0, ?, ?)`).run('approved-teacher', '13600000000', 'Teacher', now, now);
db.db.prepare(`INSERT INTO users (id, phone, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
 VALUES (?, ?, ?, 'admin', 0, 1, 'approved', 0, ?, ?)`).run('disabled-admin', '13500000000', 'Disabled', now, now);

const databaseModule = require('../database');
databaseModule.getInstance = () => db;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');
const app = createApp();

function token(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET);
}
async function request(server, method, url, auth, body, headers = {}) {
  const response = await fetch(`${server}${url}`, { method, headers: {
    ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    ...(body ? { 'content-type': 'application/json' } : {}), ...headers,
  }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}

(async () => {
  const listener = app.listen(0);
  const base = `http://127.0.0.1:${listener.address().port}`;
  try {
    assert.strictEqual((await request(base, 'PATCH', '/api/admin/users/pending-user/review', null, { role: 'admin', actorPhone: '13732250653' })).status, 401);
    const ghost = jwt.sign({ id: 'ghost-super', phone: '13732250653', role: 'super_admin', user_type: 'super_admin' }, process.env.JWT_SECRET);
    assert.strictEqual((await request(base, 'PATCH', '/api/admin/users/pending-user/review', ghost, { role: 'admin' })).status, 401, 'JWT claims without a persisted user must fail closed');
    const ordinary = await request(base, 'PATCH', '/api/admin/users/pending-user/review', token('ordinary-admin'), { role: 'admin', actorPhone: '13732250653', isPrimaryHost: true }, { 'x-node-role': 'primary-host' });
    assert.strictEqual(ordinary.status, 403);
    assert.strictEqual(ordinary.body.code, 'SUPER_ADMIN_REQUIRED');

    const list = await request(base, 'GET', '/api/admin/users', token('ordinary-admin'));
    assert.strictEqual(list.status, 200);
    assert.ok(list.body.users.some(user => user.id === 'pending-user'));

    const pending = await request(base, 'GET', '/api/permissions/my', token('pending-user'));
    assert.deepStrictEqual(pending.body.capabilities, []);
    assert.strictEqual(pending.body.user_type, 'pending');
    const disabled = await request(base, 'GET', '/api/permissions/my', token('disabled-admin'));
    assert.deepStrictEqual(disabled.body.capabilities, []);
    const teacher = await request(base, 'GET', '/api/permissions/my', token('approved-teacher'));
    assert.deepStrictEqual(teacher.body.capabilities, ['business:teacher-scope', 'question-bank:view', 'question-bank:edit']);
    assert.ok(teacher.body.permissions.every(item => teacher.body.capabilities.includes(item.id)), 'compat permissions must be a capability projection');

    const superToken = token('miniapp-admin-13732250653');
    const reviewed = await request(base, 'PATCH', '/api/admin/users/pending-user/review', superToken, { role: 'admin' });
    assert.strictEqual(reviewed.status, 200);
    assert.strictEqual(reviewed.body.user.role, 'admin');
    const ordinaryDisable = await request(base, 'PATCH', '/api/admin/users/approved-teacher/disable', token('ordinary-admin'));
    assert.strictEqual(ordinaryDisable.status, 403);
    assert.strictEqual(ordinaryDisable.body.code, 'SUPER_ADMIN_REQUIRED');
    const disabledBySuper = await request(base, 'PATCH', '/api/admin/users/approved-teacher/disable', superToken);
    assert.strictEqual(disabledBySuper.status, 200);
    assert.deepStrictEqual([disabledBySuper.body.user.status, disabledBySuper.body.user.login_enabled], [0, 0]);
    assert.strictEqual(db.db.prepare("SELECT action FROM authorization_audit_log WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 1").get('approved-teacher').action, 'disable_user');
    const immutableDisable = await request(base, 'PATCH', '/api/admin/users/miniapp-admin-13732250653/disable', superToken);
    assert.strictEqual(immutableDisable.status, 400);
    assert.strictEqual(immutableDisable.body.code, 'SUPER_ADMIN_IMMUTABLE');
    assert.strictEqual((await request(base, 'PATCH', '/api/admin/users/missing-user/disable', superToken)).status, 404);
    const permissions = await request(base, 'GET', '/api/permissions/my', token('ordinary-admin'), null, { 'x-node-role': 'primary-host', 'x-client-type': 'desktop' });
    assert.ok(permissions.body.capabilities.includes('business:all'));
    assert.ok(!permissions.body.capabilities.includes('users:review'));
    assert.ok(!permissions.body.capabilities.includes('question-bank:delete-committed'), 'a forged host header cannot elevate a desktop admin');
    db.registerSyncDevice('known-trusted-host', { deviceName: 'Known host', trusted: true, role: 'host' });
    const replayedDevice = await request(base, 'GET', '/api/permissions/my', token('ordinary-admin'), null, { 'x-device-id': 'known-trusted-host', 'x-client-type': 'desktop' });
    assert.ok(!replayedDevice.body.capabilities.includes('question-bank:delete-committed'), 'knowing a trusted device id is not authentication');
    assert.ok(list.body.users.every(user => !('wechat_openid' in user) && !('wechat_unionid' in user)), 'admin list must not leak identity provider secrets');
  } finally {
    await new Promise(resolve => listener.close(resolve));
    db.close();
    fs.rmSync(path.dirname(process.env.DB_PATH), { recursive: true, force: true });
  }
  console.log('backend admin users route tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
