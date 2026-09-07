const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('../../cloud-business-api/src/app');

async function run() {
  const { createDesktopIdentityClient } = await import('./desktopIdentityClient.mjs');
  const writes = [];
  const app = createCloudBusinessApp({
    query: async () => ({ rows: [] }), businessTenantId: 'default',
    desktopRegistration: { begin: async () => { throw new Error('unused'); }, register: async () => { throw new Error('unused'); }, sessionContext: async () => ({
      authorityId: 'authority-1', accountId: 'account-1', roles: ['teacher'], teacherId: 'teacher-1',
    }) },
    businessScheduleUpdate: async input => {
      writes.push(input);
      return { id: input.scheduleId, updatedAt: '2026-09-07T04:00:00.000Z' };
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const client = createDesktopIdentityClient({ desktopIdentity: { status: () => ({}) } });
    const input = {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      currentSession: { token: 'eyJ2IjoxfQ.signature', offline: false },
      scheduleId: 'schedule-1', courseId: 'course-1',
      expectedUpdatedAt: '2026-09-07T03:29:18.983+00:00',
      startAt: '2026-09-07T02:00:00.000Z', endAt: '2026-09-07T03:30:00.000Z',
      recurringRule: null, status: 1, roomDisplay: 'Room', serviceType: null,
      tuition: 0, teacherFee: 0, notes: null,
      pricings: [{ studentId: 'student-1', attendanceStatus: 4, tuition: 180, teacherFee: 120 }],
    };
    const snapshot = structuredClone(input);
    await client.updateCloudSchedule(input);
    assert.equal(writes[0].expectedUpdatedAt, '2026-09-07T03:29:18.983Z');
    assert.deepEqual(writes[0].actorScope, { role: 'teacher', teacherId: 'teacher-1' });
    assert.deepEqual(writes[0].pricings, input.pricings);
    assert.deepEqual(input, snapshot, 'serialization must not rewrite the saved version baseline');

    // Every business write, including nested contact baselines, uses the same serializer.
    const bodies = [];
    const capture = createDesktopIdentityClient({
      desktopIdentity: { status: () => ({}) },
      fetchImpl: async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ ok: true, student: { id: 'student-1', updatedAt: input.startAt } }) };
      },
    });
    const contacts = [{ slot: 1, relationship: 'student', phone: null, wechat: null, expectedUpdatedAt: '2026-09-07T11:29:18.983+08:00' }];
    await capture.updateCloudStudentRecord({ ...input, studentId: 'student-1', name: 'Test', contacts });
    assert.equal(bodies[0].expectedUpdatedAt, '2026-09-07T03:29:18.983Z');
    assert.equal(bodies[0].contacts[0].expectedUpdatedAt, '2026-09-07T03:29:18.983Z');
    assert.equal(contacts[0].expectedUpdatedAt, '2026-09-07T11:29:18.983+08:00');
    await capture.updateCloudStudentRecord({ ...input, studentId: 'student-1', name: 'Test', contacts: [], expectedUpdatedAt: '2026-09-07T03:29:18.983123+00:00' });
    assert.equal(bodies[1].expectedUpdatedAt, '2026-09-07T03:29:18.983123+00:00', 'never truncate a higher-precision concurrency token');
    console.log('desktop business version REST round-trip checks passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = run;
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
