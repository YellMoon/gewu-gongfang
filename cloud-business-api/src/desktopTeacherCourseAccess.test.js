'use strict';
const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('./app');
const version = '2026-09-07T01:00:00.000Z';
const course = { name: 'Physics', year: 2026, semester: 'autumn', displayName: 'Physics', type: 1, sourceType: 1, institutionId: null, priceTuition: 100, priceTeacher: 60, billingUnit: 1, teacherFeeMode: 1, roomId: 'room-own', roomName: 'Classroom', teacherId: 'teacher-own', teacherName: 'Teacher', active: true, defaultDurationMinutes: 90, notes: null, pricings: [] };
const operations = [
  ['POST', '/api/business/rooms', { roomId: 'room-own', name: 'Classroom', address: null }, 201],
  ['PUT', '/api/business/rooms/room-own', { expectedUpdatedAt: version, name: 'Classroom edited', address: null }, 200],
  ['DELETE', '/api/business/rooms/room-own', { expectedUpdatedAt: version }, 200],
  ['POST', '/api/business/courses', { courseId: 'course-own', data: course }, 201],
  ['PUT', '/api/business/courses/course-own', { expectedUpdatedAt: version, ...course }, 200],
  ['DELETE', '/api/business/courses/course-own', { expectedUpdatedAt: version }, 200],
];
async function exercise(context, { miniappOnly = false, databaseDenies = false } = {}) {
  const writes = [];
  const mutate = async input => {
    writes.push(input);
    if (databaseDenies) throw Object.assign(new Error(input.courseId ? 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' : 'VNEXT_TEACHER_ROOM_SCOPE_DENIED'), { code: '42501' });
    return { id: input.courseId || input.roomId, updatedAt: version };
  };
  const app = createCloudBusinessApp({
    query: async () => ({ rows: [] }), businessTenantId: 'tenant-own',
    desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => { if (miniappOnly) throw Error('not a desktop ticket'); return context; } },
    miniappCloudAccount: { login: async () => {}, context: async () => context },
    businessCourseLifecycleMutations: { create: mutate, update: mutate, remove: mutate },
    businessRoomLifecycleMutations: { create: mutate, update: mutate, remove: mutate },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const responses = [];
    for (const [method, path, body] of operations) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { authorization: 'Bearer eyJ2IjoxfQ.signature', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      responses.push({ status: response.status, body: await response.json() });
    }
    return { writes, responses };
  } finally { await new Promise(resolve => server.close(resolve)); }
}
(async () => {
  for (const context of [{ roles: ['teacher'], teacherId: 'teacher-own' }, { roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-own' } }, { roles: ['super_admin', 'teacher'], activeRole: 'teacher', teacherId: 'teacher-own' }]) {
    const result = await exercise(context);
    assert.deepEqual(result.responses.map(item => item.status), operations.map(item => item[3]), 'the original course/address workflow must be available to a bound desktop teacher');
    for (const input of result.writes) assert.deepEqual(input.actorScope, { role: 'teacher', teacherId: 'teacher-own' });
  }
  for (const context of [{ roles: ['teacher'] }, { roles: ['teacher'], teacherId: ' other ' }, { roles: ['student'], studentId: 'student-own' }, { roles: ['visitor'] }]) {
    const result = await exercise(context);
    assert(result.responses.every(item => item.status === 403)); assert.equal(result.writes.length, 0);
  }
  const miniapp = await exercise({ roles: ['super_admin'] }, { miniappOnly: true });
  assert(miniapp.responses.every(item => item.status === 403)); assert.equal(miniapp.writes.length, 0);
  const admin = await exercise({ roles: ['super_admin'] });
  assert.deepEqual(admin.responses.map(item => item.status), operations.map(item => item[3]));
  assert(admin.writes.every(input => input.actorScope.role === 'super_admin' && input.actorScope.teacherId === null));
  const denied = await exercise({ roles: ['teacher'], teacherId: 'teacher-own' }, { databaseDenies: true });
  assert(denied.responses.every(item => item.status === 403 && item.body.code === 'CLOUD_BUSINESS_ACCESS_DENIED'));
  console.log('desktop teacher course and inline-address access checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
