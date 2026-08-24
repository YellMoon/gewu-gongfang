'use strict';

const assert = require('assert');
const { createBusinessScheduleLifecycleMutations } = require('./businessScheduleLifecycleMutationService');

(async () => {
  const calls = [];
  const mutations = createBusinessScheduleLifecycleMutations({
    query: async (text, values) => {
      calls.push([text, values]);
      return { rows: [{ id: values[1], updatedAt: '2026-08-24T03:00:00.000Z' }] };
    },
  });
  const created = await mutations.create({
    tenantId: 'default', scheduleId: 'schedule-2', courseId: 'course-1',
    startAt: '2026-08-25T01:00:00.000Z', endAt: '2026-08-25T02:00:00.000Z',
    recurringRule: null, status: 1, roomDisplay: 'Room One', serviceType: 1,
    tuition: 100, teacherFee: 60, notes: null,
    pricings: [{ studentId: 'student-1', attendanceStatus: 1, tuition: 100, teacherFee: 60 }],
  });
  assert.deepStrictEqual(created, { id: 'schedule-2', updatedAt: '2026-08-24T03:00:00.000Z' });
  assert.match(calls[0][0], /business\.vnext_create_schedule_record_v1/);
  assert.deepStrictEqual(calls[0][1], [
    'default', 'schedule-2', 'course-1', '2026-08-25T01:00:00.000Z', '2026-08-25T02:00:00.000Z',
    null, 1, 'Room One', 1, 100, 60, null,
    JSON.stringify([{ student_id: 'student-1', attendance_status: 1, tuition: 100, teacher_fee: 60 }]),
  ]);
  const removed = await mutations.remove({
    tenantId: 'default', scheduleId: 'schedule-2', expectedUpdatedAt: '2026-08-24T03:00:00.000Z',
  });
  assert.deepStrictEqual(removed, { id: 'schedule-2', updatedAt: '2026-08-24T03:00:00.000Z' });
  assert.match(calls[1][0], /business\.vnext_soft_delete_schedule/);
  assert.deepStrictEqual(calls[1][1], ['default', 'schedule-2', '2026-08-24T03:00:00.000Z']);
  console.log('business schedule lifecycle mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
