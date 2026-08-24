'use strict';

const assert = require('assert');
const { createBusinessScheduleUpdate } = require('./businessScheduleMutationService');

(async () => {
  const calls = [];
  const updateSchedule = createBusinessScheduleUpdate({
    query: async (text, values) => {
      calls.push([text, values]);
      return { rows: [{ id: 'schedule-1', updatedAt: '2026-08-23T01:00:00.000Z' }] };
    },
  });
  const result = await updateSchedule({
    tenantId: 'default', scheduleId: 'schedule-1', expectedUpdatedAt: '2026-08-22T01:00:00.000Z',
    startAt: '2026-08-23T01:00:00.000Z', endAt: '2026-08-23T02:00:00.000Z', status: 1,
    roomDisplay: 'A102', tuition: 120, teacherFee: 60, notes: null,
    pricings: [{ studentId: 'student-1', attendanceStatus: 4, tuition: 80, teacherFee: 40 }],
  });
  assert.deepStrictEqual(result, { id: 'schedule-1', updatedAt: '2026-08-23T01:00:00.000Z' });
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0][0], /^SELECT id AS "id", to_char\(updated_at AT TIME ZONE 'UTC'/);
  assert.match(calls[0][0], /business\.vnext_update_schedule_record_v2/);
  assert.deepStrictEqual(calls[0][1], ['default', 'schedule-1', '2026-08-22T01:00:00.000Z', '2026-08-23T01:00:00.000Z', '2026-08-23T02:00:00.000Z', 1, 'A102', 120, 60, null, JSON.stringify([{ student_id: 'student-1', attendance_status: 4, tuition: 80, teacher_fee: 40 }])]);
  await updateSchedule({
    tenantId: 'default', scheduleId: 'schedule-1', expectedUpdatedAt: '2026-08-23T01:00:00.000Z',
    startAt: '2026-08-23T01:30:00.000Z', endAt: '2026-08-23T02:30:00.000Z', status: 1,
    roomDisplay: 'A102', tuition: 120, teacherFee: 60, notes: null, pricings: null,
  });
  assert.strictEqual(calls[1][1][10], null, 'legacy update must preserve existing overrides');
  console.log('business schedule mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
