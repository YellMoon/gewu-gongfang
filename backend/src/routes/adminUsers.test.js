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
    const ordinary = await request(base, 'PATCH', '/api/admin/users/pending-user/review', token('ordinary-admin'), { role: 'admin', actorPhone: '13732250653', isPrimaryHost: true }, { 'x-node-role': 'primary-host' });
    assert.strictEqual(ordinary.status, 403);
    assert.strictEqual(ordinary.body.code, 'SUPER_ADMIN_REQUIRED');

    const list = await request(base, 'GET', '/api/admin/users', token('ordinary-admin'));
    assert.strictEqual(list.status, 200);
    assert.ok(list.body.users.some(user => user.id === 'pending-user'));

    const pending = await request(base, 'GET', '/api/permissions/my', token('pending-user'));
    assert.deepStrictEqual(pending.body.capabilities, []);
    assert.strictEqual(pending.body.user_type, 'pending');

    const superToken = token('miniapp-admin-13732250653');
    const reviewed = await request(base, 'PATCH', '/api/admin/users/pending-user/review', superToken, { role: 'admin' });
    assert.strictEqual(reviewed.status, 200);
    assert.strictEqual(reviewed.body.user.role, 'admin');
    const permissions = await request(base, 'GET', '/api/permissions/my', token('ordinary-admin'), null, { 'x-node-role': 'primary-host', 'x-client-type': 'desktop' });
    assert.ok(permissions.body.capabilities.includes('business:all'));
    assert.ok(!permissions.body.capabilities.includes('users:review'));
    assert.ok(!permissions.body.capabilities.includes('question-bank:delete-committed'), 'a forged host header cannot elevate a desktop admin');
  } finally {
    await new Promise(resolve => listener.close(resolve));
    db.close();
    fs.rmSync(path.dirname(process.env.DB_PATH), { recursive: true, force: true });
  }
  console.log('backend admin users route tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
