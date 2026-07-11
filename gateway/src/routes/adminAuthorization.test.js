const assert = require('assert');
const express = require('express');

const rows = new Map([
  ['ordinary-admin', { id: 'ordinary-admin', user_type: 'admin' }],
  ['target', { id: 'target', user_type: 'pending' }],
  ['teacher-user', { id: 'teacher-user', phone: '13800000001', user_type: 'teacher', review_status: 'approved', status: 1, login_enabled: 1, teacher_id: 'teacher-live' }],
  ['teacher-empty', { id: 'teacher-empty', phone: '', user_type: 'pending' }],
  ['teacher-deleted-only', { id: 'teacher-deleted-only', phone: '138-0000-0002', user_type: 'pending' }],
  ['teacher-duplicate', { id: 'teacher-duplicate', phone: '138 0000 0003', user_type: 'pending' }],
  ['miniapp-admin-13732250653', { id: 'miniapp-admin-13732250653', phone: '13732250653', user_type: 'super_admin', is_super_admin_identity: 1 }],
]);
const teachers = [
  { id: 'teacher-live', phone: '13800000001', deleted: 0 },
  { id: 'teacher-deleted', phone: '13800000002', deleted: 1 },
  { id: 'teacher-duplicate-a', phone: '138-0000-0003', deleted: 0 },
  { id: 'teacher-duplicate-b', phone: '13800000003', deleted: 0 },
];
let permissionWrites = 0;
let auditWrites = 0;
const fakeDb = {
  transaction(fn) { return fn; },
  prepare(sql) {
    return {
      get(...args) {
        if (sql.includes('COUNT(*)')) {
          let result = [...rows.values()]; let index = 0;
          if (sql.includes('user_type = ?')) { const expected = args[index++]; result = result.filter(row => row.user_type === expected); }
          if (sql.includes('review_status = ?')) { const expected = args[index++]; result = result.filter(row => row.review_status === expected); }
          return { count: result.length };
        }
        if (sql.includes('FROM users')) return rows.get(args[0]);
        return { count: rows.size };
      },
      all(...args) {
        if (sql.includes('FROM teachers')) return teachers;
        let result = [...rows.values()];
        let index = 0;
        if (sql.includes('user_type = ?')) { const expected = args[index++]; result = result.filter(row => row.user_type === expected); }
        if (sql.includes('review_status = ?')) { const expected = args[index++]; result = result.filter(row => row.review_status === expected); }
        return result;
      },
      run(...args) {
        if (sql.includes('user_permissions')) permissionWrites += 1;
        if (sql.includes('authorization_audit_log')) auditWrites += 1;
        if (sql.includes('UPDATE users SET status = 0')) Object.assign(rows.get(args[args.length - 1]), { status: 0, login_enabled: 0 });
        return { changes: 1 };
      },
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
    const teacherList = await call(server, 'GET', '/api/admin/users?role=teacher&status=approved');
    assert.strictEqual(teacherList.status, 200);
    assert.deepStrictEqual(teacherList.body.users.map(user => user.id), ['teacher-user']);
    assert.strictEqual(teacherList.body.users[0].role, 'teacher');
    assert.strictEqual(teacherList.body.users[0].teacher_id, 'teacher-live');
    const legacyRole = await call(server, 'PUT', '/api/admin/users/target/type', { user_type: 'admin' });
    assert.strictEqual(legacyRole.status, 410);
    assert.strictEqual(legacyRole.body.code, 'LEGACY_ROLE_ENDPOINT_DISABLED');
    const ordinaryReview = await call(server, 'PATCH', '/api/admin/users/target/review', { role: 'admin' });
    assert.strictEqual(ordinaryReview.status, 403);
    assert.strictEqual(ordinaryReview.body.code, 'SUPER_ADMIN_REQUIRED');
    const superReview = await call(server, 'PATCH', '/api/admin/users/target/review', { role: 'admin' }, { 'x-test-super': 'true' });
    assert.strictEqual(superReview.status, 200, 'canonical super uses the review endpoint');
    assert.strictEqual(auditWrites, 1, 'successful review writes one authorization audit row');
    const immutable = await call(server, 'PATCH', '/api/admin/users/miniapp-admin-13732250653/review', { role: 'student' }, { 'x-test-super': 'true' });
    assert.strictEqual(immutable.status, 400);
    assert.strictEqual(immutable.body.code, 'SUPER_ADMIN_IMMUTABLE');
    const emptyTeacher = await call(server, 'PATCH', '/api/admin/users/teacher-empty/review', { role: 'teacher' }, { 'x-test-super': 'true' });
    assert.strictEqual(emptyTeacher.body.code, 'TEACHER_NOT_FOUND');
    const deletedTeacher = await call(server, 'PATCH', '/api/admin/users/teacher-deleted-only/review', { role: 'teacher' }, { 'x-test-super': 'true' });
    assert.strictEqual(deletedTeacher.body.code, 'TEACHER_NOT_FOUND');
    const duplicateTeacher = await call(server, 'PATCH', '/api/admin/users/teacher-duplicate/review', { role: 'teacher' }, { 'x-test-super': 'true' });
    assert.strictEqual(duplicateTeacher.body.code, 'TEACHER_PHONE_NOT_UNIQUE');
    const ordinaryDisable = await call(server, 'PATCH', '/api/admin/users/target/disable');
    assert.strictEqual(ordinaryDisable.status, 403);
    assert.strictEqual(ordinaryDisable.body.code, 'SUPER_ADMIN_REQUIRED');
    const superDisable = await call(server, 'PATCH', '/api/admin/users/target/disable', null, { 'x-test-super': 'true' });
    assert.strictEqual(superDisable.status, 200);
    assert.deepStrictEqual([superDisable.body.user.status, superDisable.body.user.login_enabled], [0, 0]);
    assert.strictEqual(auditWrites, 2, 'successful disable writes one additional authorization audit row');
    const immutableDisable = await call(server, 'PATCH', '/api/admin/users/miniapp-admin-13732250653/disable', null, { 'x-test-super': 'true' });
    assert.strictEqual(immutableDisable.status, 400);
    assert.strictEqual(immutableDisable.body.code, 'SUPER_ADMIN_IMMUTABLE');
    assert.strictEqual((await call(server, 'PATCH', '/api/admin/users/missing-user/disable', null, { 'x-test-super': 'true' })).status, 404);
    const grant = await call(server, 'POST', '/api/admin/users/target/permissions', { permission_id: 'admin:all' });
    assert.strictEqual(grant.status, 410);
    assert.strictEqual(grant.body.code, 'LEGACY_PERMISSION_GRANTS_DISABLED');
    const revoke = await call(server, 'DELETE', '/api/admin/users/target/permissions/admin:all');
    assert.strictEqual(revoke.status, 410);
    assert.strictEqual(permissionWrites, 0, 'disabled endpoints must not write legacy grants');
  } finally { await new Promise(resolve => listener.close(resolve)); }
  console.log('gateway legacy authorization endpoints tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
