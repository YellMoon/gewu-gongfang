const assert = require('assert');
const express = require('express');

const rows = new Map([
  ['ordinary-admin', { id: 'ordinary-admin', user_type: 'admin' }],
  ['target', { id: 'target', user_type: 'pending' }],
]);
let permissionWrites = 0;
const fakeDb = {
  prepare(sql) {
    return {
      get(id) { if (sql.includes('FROM users')) return rows.get(id); return { count: rows.size }; },
      all() { return [...rows.values()]; },
      run() { if (sql.includes('user_permissions')) permissionWrites += 1; return { changes: 1 }; },
    };
  },
};
const dbModule = require('../db/database');
dbModule.getDb = () => fakeDb;
delete require.cache[require.resolve('./admin')];
const router = require('./admin');

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const isSuper = req.headers['x-test-super'] === 'true';
  req.user = isSuper
    ? { id: 'miniapp-admin-13732250653', phone: '13732250653', user_type: 'super_admin', status: 1, login_enabled: 1, review_status: 'approved', is_super_admin_identity: 1 }
    : { id: 'ordinary-admin', user_type: 'admin' };
  req.authz = { userId: req.user.id, role: isSuper ? 'super_admin' : 'admin' };
  next();
});
app.use('/api/admin', router);

async function call(server, method, path, body, headers = {}) {
  const response = await fetch(`${server}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}

(async () => {
  const listener = app.listen(0);
  const server = `http://127.0.0.1:${listener.address().port}`;
  try {
    const legacyRole = await call(server, 'PUT', '/api/admin/users/target/type', { user_type: 'admin' });
    assert.strictEqual(legacyRole.status, 410);
    assert.strictEqual(legacyRole.body.code, 'LEGACY_ROLE_ENDPOINT_DISABLED');
    const ordinaryReview = await call(server, 'PATCH', '/api/admin/users/target/review', { role: 'admin' });
    assert.strictEqual(ordinaryReview.status, 403);
    assert.strictEqual(ordinaryReview.body.code, 'SUPER_ADMIN_REQUIRED');
    const superReview = await call(server, 'PATCH', '/api/admin/users/target/review', { role: 'admin' }, { 'x-test-super': 'true' });
    assert.strictEqual(superReview.status, 200, 'canonical super uses the review endpoint');
    const grant = await call(server, 'POST', '/api/admin/users/target/permissions', { permission_id: 'admin:all' });
    assert.strictEqual(grant.status, 410);
    assert.strictEqual(grant.body.code, 'LEGACY_PERMISSION_GRANTS_DISABLED');
    const revoke = await call(server, 'DELETE', '/api/admin/users/target/permissions/admin:all');
    assert.strictEqual(revoke.status, 410);
    assert.strictEqual(permissionWrites, 0, 'disabled endpoints must not write legacy grants');
  } finally { await new Promise(resolve => listener.close(resolve)); }
  console.log('gateway legacy authorization endpoints tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
