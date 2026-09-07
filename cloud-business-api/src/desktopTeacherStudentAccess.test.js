'use strict';
const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('./app');
const version = '2026-09-07T00:00:00.000Z';
const student = { name: 'Student', school: 'School', gradeYear: null, gradeCurrent: null, institutionId: null, parentName: null, notes: null, sourceType: 1, studentSource: null };
async function exercise(context, { miniappOnly = false, databaseDenies = false, spoof = false } = {}) {
  const writes = [];
  const mutate = async input => {
    writes.push(input);
    if (databaseDenies) throw Object.assign(new Error('VNEXT_TEACHER_STUDENT_SCOPE_DENIED'), { code: '42501' });
    return { id: input.studentId, updatedAt: version };
  };
  const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), businessTenantId: 'tenant-1',
    desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => { if (miniappOnly) throw Error('not desktop'); return context; } },
    miniappCloudAccount: { login: async () => {}, context: async () => context },
    businessStudentUpdate: mutate, businessStudentRecordUpdate: mutate,
    businessStudentLifecycleMutations: { create: mutate, remove: mutate },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const results = [];
    const operations = [
      ['POST', '/api/business/students', { studentId: 'student-1', ...student, contacts: [] }],
      ['PUT', '/api/business/students/student-1', { expectedUpdatedAt: version, ...student }],
      ['PUT', '/api/business/students/student-1/record', { expectedUpdatedAt: version, ...student, contacts: [] }],
      ['DELETE', '/api/business/students/student-1', { expectedUpdatedAt: version }],
    ];
    for (const [method, route, body] of operations) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method, headers: { authorization: 'Bearer eyJ2IjoxfQ.signature', 'content-type': 'application/json' }, body: JSON.stringify(spoof ? { ...body, actorScope: { role: 'super_admin', teacherId: null } } : body) });
      results.push({ status: response.status, body: await response.json() });
    }
    return { writes, results };
  } finally { await new Promise(resolve => server.close(resolve)); }
}
(async () => {
  for (const context of [{ roles: ['teacher'], teacherId: 'teacher-1' }, { roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-1' } }, { roles: ['super_admin', 'teacher'], activeRole: 'teacher', teacherId: 'teacher-1' }]) {
    const result = await exercise(context);
    assert.deepEqual(result.results.map(x => x.status), [201, 200, 200, 200]);
    assert(result.writes.every(x => x.actorScope?.role === 'teacher' && x.actorScope.teacherId === 'teacher-1'));
  }
  const admin = await exercise({ roles: ['super_admin'] });
  assert.deepEqual(admin.results.map(x => x.status), [201, 200, 200, 200]);
  assert(admin.writes.every(x => x.actorScope?.role === 'super_admin' && x.actorScope.teacherId === null));
  for (const context of [{ roles: ['teacher'] }, { roles: ['visitor'] }, { roles: ['student'] }, { roles: ['family_member'] }]) {
    const denied = await exercise(context);
    assert(denied.results.every(x => x.status === 403)); assert.equal(denied.writes.length, 0);
  }
  for (const options of [{ miniappOnly: true }, { databaseDenies: true }]) {
    const denied = await exercise({ roles: ['teacher'], teacherId: 'teacher-1' }, options);
    assert(denied.results.every(x => x.status === 403 && x.body.code === 'CLOUD_BUSINESS_ACCESS_DENIED'));
  }
  const spoof = await exercise({ roles: ['teacher'], teacherId: 'teacher-1' }, { spoof: true });
  assert(spoof.results.every(x => x.status === 400)); assert.equal(spoof.writes.length, 0);
  console.log('desktop teacher student lifecycle session-scope checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
