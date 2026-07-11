const assert = require('assert');
const fs = require('fs');

const schema = fs.readFileSync('gateway/src/db/schema.sql', 'utf-8');
const route = fs.readFileSync('gateway/src/routes/cloudRelay.js', 'utf-8');
const app = fs.readFileSync('gateway/src/app.js', 'utf-8');
const authRoute = fs.readFileSync('gateway/src/routes/auth.js', 'utf-8');
const permissionMiddleware = fs.readFileSync('gateway/src/middleware/permission.js', 'utf-8');
const { filterSnapshotForUser, requireApprovedSnapshotUser, requireHostToken } = require('./cloudRelay');

assert.ok(schema.includes('host_heartbeats'), 'schema should include host_heartbeats');
assert.ok(schema.includes('readonly_snapshots'), 'schema should include readonly_snapshots');
assert.ok(schema.includes('miniapp_tasks'), 'schema should include miniapp_tasks');
assert.ok(route.includes('/host/heartbeat'), 'cloud relay should expose host heartbeat');
assert.ok(route.includes('/snapshots/publish'), 'cloud relay should expose snapshot publish');
assert.ok(route.includes('/snapshots/read'), 'cloud relay should expose snapshot read');
assert.ok(route.includes('/tasks'), 'cloud relay should expose miniapp tasks');
assert.ok(route.includes("router.get('/tasks'"), 'cloud relay should let host fetch pending miniapp tasks');
assert.ok(route.includes("router.post('/tasks/:id/complete'"), 'cloud relay should let host complete miniapp tasks');
assert.ok(route.includes("status = req.body.success === false ? 'failed' : 'completed'"), 'cloud relay should store completed or failed task status');
assert.ok(route.includes('allowedTasksForUser'), 'cloud relay should apply role-specific task permissions');
assert.ok(route.includes("user?.user_type === 'student'"), 'cloud relay should distinguish student task permissions');
assert.ok(route.includes("['super_admin', 'admin'].includes(user?.user_type)"), 'cloud relay should grant super admin the existing admin task permissions');
assert.ok(route.includes('adminTaskTypes'), 'asset import should be limited to administrator task permissions');
assert.ok(authRoute.includes("['super_admin', 'admin', 'student']"), 'gateway login should accept super admin without widening student access');
assert.ok(permissionMiddleware.includes("['super_admin', 'admin']"), 'gateway permissions should treat only super admin and admin as administrators');
assert.ok(app.includes("require('./routes/cloudRelay')"), 'gateway app should mount cloud relay');

const teacherSnapshot = filterSnapshotForUser({ payload: {
  courses: [{ id: 'c1', teacher_id: 't1' }, { id: 'c2', teacher_id: 't2' }],
  schedules: [{ id: 's1', course_id: 'c1', student_ids: ['stu1'] }, { id: 's2', course_id: 'c2', student_ids: ['stu2'] }],
  students: [{ id: 'stu1' }, { id: 'stu2' }],
  payments: [{ id: 'p1', course_id: 'c1' }, { id: 'p2', course_id: 'c2' }],
  questions: [{ id: 'q1' }, { id: 'q2' }],
} }, { user_type: 'teacher', teacher_id: 't1', id: 'u1', review_status: 'approved', status: 1, login_enabled: 1 });
assert.deepStrictEqual(teacherSnapshot.payload.courses.map(x => x.id), ['c1']);
assert.deepStrictEqual(teacherSnapshot.payload.payments.map(x => x.id), ['p1']);
assert.strictEqual(teacherSnapshot.payload.questions.length, 2, 'teacher snapshot keeps public question bank');
assert.strictEqual(teacherSnapshot.payload.scopedFinancials.payments, 0);

function middlewareStatus(user) {
  let status = 200; let nextCalled = false;
  requireApprovedSnapshotUser({ user }, { status(code) { status = code; return this; }, json() {} }, () => { nextCalled = true; });
  return { status, nextCalled };
}
assert.deepStrictEqual(middlewareStatus(undefined), { status: 401, nextCalled: false });
assert.deepStrictEqual(middlewareStatus({ user_type: 'teacher', review_status: 'pending', status: 1, login_enabled: 1 }), { status: 403, nextCalled: false });
assert.deepStrictEqual(middlewareStatus({ user_type: 'teacher', review_status: 'approved', status: 1, login_enabled: 1 }), { status: 200, nextCalled: true });
const unknownSnapshot = filterSnapshotForUser({ payload: { courses: [{ id: 'secret' }], questions: [{ id: 'q' }], secretRows: [{ id: 'leak' }] } }, {});
assert.strictEqual(unknownSnapshot.payload.courses, undefined);
assert.strictEqual(unknownSnapshot.payload.questions, undefined, 'unknown users receive an empty payload, including no public question bank');
assert.strictEqual(unknownSnapshot.payload.secretRows, undefined);
const studentSnapshot = filterSnapshotForUser({ payload: {
  students: [{ id: 'stu1', name: 'A', phone: 'secret', balance_money: 99 }],
  courses: [{ id: 'c1', teacher_id: 't1', student_ids: ['stu1'], price_tuition: 999, notes: 'secret' }],
  schedules: [{ id: 's1', course_id: 'c1', calculated_tuition: 999, notes: 'secret' }],
  teachers: [{ id: 't1', name: 'T', hourly_rate: 999, phone: 'secret' }],
  payments: [{ id: 'p1', course_id: 'c1', student_id: 'stu1', amount: 999 }], questions: [{ id: 'q1' }],
} }, { id: 'student-user', user_type: 'student', student_id: 'stu1', review_status: 'approved', status: 1, login_enabled: 1 });
assert.strictEqual(studentSnapshot.payload.students[0].phone, undefined);
assert.strictEqual(studentSnapshot.payload.courses[0].price_tuition, undefined);
assert.strictEqual(studentSnapshot.payload.courses[0].notes, undefined);
assert.strictEqual(studentSnapshot.payload.schedules[0].calculated_tuition, undefined);
assert.strictEqual(studentSnapshot.payload.teachers[0].hourly_rate, undefined);
assert.deepStrictEqual(studentSnapshot.payload.payments, []);
assert.strictEqual(studentSnapshot.payload.questions.length, 1);
function hostStatus(token, configured = 'test-host-secret') {
  const previous = process.env.GEWU_CLOUD_RELAY_HOST_TOKEN;
  if (configured) process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = configured; else delete process.env.GEWU_CLOUD_RELAY_HOST_TOKEN;
  let status = 200; let nextCalled = false;
  requireHostToken({ headers: token ? { 'x-gewu-host-token': token } : {} }, { status(code) { status = code; return this; }, json() {} }, () => { nextCalled = true; });
  if (previous === undefined) delete process.env.GEWU_CLOUD_RELAY_HOST_TOKEN; else process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = previous;
  return { status, nextCalled };
}
assert.deepStrictEqual(hostStatus(), { status: 403, nextCalled: false });
assert.deepStrictEqual(hostStatus('wrong'), { status: 403, nextCalled: false });
assert.deepStrictEqual(hostStatus('test-host-secret'), { status: 200, nextCalled: true });
assert.deepStrictEqual(hostStatus('anything', ''), { status: 403, nextCalled: false });
assert.ok(route.includes("router.get('/tasks', requireHostToken"));
assert.ok(route.includes("router.post('/tasks/:id/complete', requireHostToken"));
assert.ok(route.includes("router.post('/tasks', requireApprovedSnapshotUser"));

console.log('cloudRelay route checks passed');
