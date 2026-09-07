'use strict';

const assert = require('assert');
const { createBusinessScheduleStudentOverride } = require('./businessScheduleStudentOverrideService');

(async () => {
  const calls = [];
  const updateOverride = createBusinessScheduleStudentOverride({
    query: async (text, values) => {
      calls.push([text, values]);
      return { rows: [{ id: 'schedule-1', updatedAt: '2026-08-22T02:00:00.000Z' }] };
    },
  });
  const result = await updateOverride({
    actorScope: { role: 'teacher', teacherId: 'teacher-1' },
    tenantId: 'default', scheduleId: 'schedule-1', studentId: 'student-1',
    expectedUpdatedAt: '2026-08-22T01:00:00.000Z', attendanceStatus: 1, tuition: 120, teacherFee: 60,
  });
  assert.deepStrictEqual(result, { id: 'schedule-1', updatedAt: '2026-08-22T02:00:00.000Z' });
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0][0], /business\.vnext_upsert_scoped_schedule_student/);
  assert.deepStrictEqual(calls[0][1], [
    'default', 'schedule-1', 'student-1', '2026-08-22T01:00:00.000Z', 1, 120, 60,
    'teacher', 'teacher-1',
  ]);
  await assert.rejects(() => updateOverride({}), { code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
  assert.equal(calls.length, 1);
  console.log('business schedule student override service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
