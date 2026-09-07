// UTF-8: original financial snapshot must survive draft -> client -> real REST -> SQL arguments.
const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('../../cloud-business-api/src/app');
async function run() {
  const { createAuthorityDraftFromLocalMutation } = await import('./authorityDraftAdapter.mjs');
  const { createDesktopCloudBusinessDraftAdapter } = await import('./desktopCloudBusinessDraft.mjs');
  const { createDesktopIdentityClient } = await import('./desktopIdentityClient.mjs');
  const writes = [];
  const query = async (sql, args) => { writes.push({ sql, args }); return { rows: [{ id: 'schedule-1', updatedAt: '2026-09-07T09:00:00.000Z' }] }; };
  const app = createCloudBusinessApp({ businessTenantId: 'default',
    query,
    businessScheduleUpdate: require('../../cloud-business-api/src/businessScheduleMutationService').createBusinessScheduleUpdate({ query }),
    businessScheduleLifecycleMutations: require('../../cloud-business-api/src/businessScheduleLifecycleMutationService').createBusinessScheduleLifecycleMutations({ query }),
    desktopRegistration: { begin: async () => { throw new Error('unused'); }, register: async () => { throw new Error('unused'); }, sessionContext: async () => ({ authorityId: 'authority-1', accountId: 'account-1', roles: ['teacher'], teacherId: 'teacher-1' }) },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cloudClient = createDesktopIdentityClient({ desktopIdentity: { status: () => ({}) } });
  const adapter = createDesktopCloudBusinessDraftAdapter({ baseUrl, cloudClient, sha256: value => `hash:${value}` });
  try {
    for (const action of ['create', 'update']) {
      const record = { course_id: 'course-1', start_time: '2026-09-08T01:00:00Z', end_time: '2026-09-08T02:30:00Z',
        status: 1, room: 'Room', calculated_tuition: 180, calculated_teacher_fee: 120,
        billing_unit: 2, teacher_fee_mode: 2, teacher_id: 'teacher-1', teacher_name: 'Snapshot teacher',
        student_pricings: [{ student_id: 'student-1', tuition: 180, teacher_fee: 120, status: 1 }] };
      const draft = createAuthorityDraftFromLocalMutation({ collection: 'schedules', action, recordId: 'schedule-1', baseVersion: '2026-09-07T01:00:00.000Z', value: record });
      const saved = action === 'create' ? draft.payload.record : draft.payload.changes;
      for (const key of ['billing_unit', 'teacher_fee_mode', 'teacher_id', 'teacher_name']) assert.equal(saved[key], record[key], `${key} must be captured, not dropped`);
      const command = adapter.createCommand({ ...draft, id: `draft-${action}` });
      await adapter.submit(command, { sessionToken: 'eyJ2IjoxfQ.signature' });
      const call = writes.at(-1);
      assert.match(call.sql, /vnext_(create|update)_scoped_schedule/);
      assert.deepEqual(JSON.parse(call.args.at(-1)), { billingUnit: 2, teacherFeeMode: 2, teacherId: 'teacher-1', teacherName: 'Snapshot teacher' });
    }
    const createInput={baseUrl,currentSession:{token:'eyJ2IjoxfQ.signature',offline:false},scheduleId:'schedule-1',courseId:'course-1',
      startAt:'2026-09-08T01:00:00.000Z',endAt:'2026-09-08T02:30:00.000Z',recurringRule:null,status:1,roomDisplay:'Room',serviceType:null,tuition:180,teacherFee:120,notes:null,pricings:[]};
    const count=writes.length;
    for(const invalid of [{billingUnit:1},{billingUnit:9,teacherFeeMode:2,teacherId:'teacher-1',teacherName:'Teacher'},
      {billingUnit:1,teacherFeeMode:2,teacherId:' teacher-1',teacherName:'Teacher'}]) {
      await assert.rejects(()=>cloudClient.createCloudSchedule({...createInput,...invalid}),e=>e.code==='CLOUD_BUSINESS_INPUT_INVALID');
    }
    assert.equal(writes.length,count,'invalid/partial snapshots must never reach the writer');
    await cloudClient.createCloudSchedule(createInput);
    assert.equal(writes.at(-1).args.at(-1),null,'old callers omit snapshots instead of fabricating them');
    console.log('desktop schedule financial snapshot real REST round-trip checks passed');
  } finally { await new Promise(resolve => server.close(resolve)); }
}
module.exports = run;
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
