'use strict';

const assert = require('assert');
const { createBusinessCourseLifecycleMutations } = require('./businessCourseLifecycleMutationService');

(async () => {
  const calls = [];
  const mutations = createBusinessCourseLifecycleMutations({
    query: async (sql, values) => {
      calls.push([sql, values]);
      return { rows: [{ id: values[1], updatedAt: '2026-08-23T06:00:00.000Z' }] };
    },
  });
  const input = {
    tenantId: 'default', courseId: 'course-new', name: 'Course new', year: 2026, semester: 'spring', displayName: 'Course new',
    type: 1, sourceType: 1, institutionId: null, priceTuition: 100, priceTeacher: 50, billingUnit: 1, teacherFeeMode: 1,
    roomId: 'room-1', roomName: 'Room one', teacherId: 'teacher-1', teacherName: 'Teacher one', active: true,
    defaultDurationMinutes: 60, notes: null, pricings: [{ studentId: 'student-1', tuition: 100, teacherFee: 50 }],
  };
  assert.deepStrictEqual(await mutations.create(input), { id: 'course-new', updatedAt: '2026-08-23T06:00:00.000Z' });
  assert.match(calls[0][0], /business\.vnext_create_course_record_v1/);
  assert.strictEqual(calls[0][1].at(-1), JSON.stringify(input.pricings));
  assert.deepStrictEqual(await mutations.update({ ...input, expectedUpdatedAt: '2026-08-23T06:00:00.000Z' }), { id: 'course-new', updatedAt: '2026-08-23T06:00:00.000Z' });
  assert.match(calls[1][0], /business\.vnext_update_course_record_v1/);
  assert.deepStrictEqual(await mutations.remove({ tenantId: 'default', courseId: 'course-new', expectedUpdatedAt: '2026-08-23T06:00:00.000Z' }), { id: 'course-new', updatedAt: '2026-08-23T06:00:00.000Z' });
  assert.match(calls[2][0], /business\.vnext_soft_delete_course/);
  console.log('business course lifecycle mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
