const assert = require('assert');

(async () => {
  const { projectCloudSchedules } = await import('./cloudScheduleProjection.mjs');
  assert.deepStrictEqual(projectCloudSchedules([
    {
      id: 'schedule-1', courseId: 'course-1', courseName: 'Course A',
      startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
      status: 1, roomDisplay: 'Room A', tuition: '100', teacherFee: '50',
    },
  ]), [{
    id: 'schedule-1', course_id: 'course-1', course_name: 'Course A',
    start_time: '2026-08-22T01:00:00.000Z', end_time: '2026-08-22T02:00:00.000Z',
    updated_at: '2026-08-22T00:00:00.000Z',
    status: 1, room: 'Room A', calculated_tuition: '100', calculated_teacher_fee: '50',
  }]);
  assert.throws(() => projectCloudSchedules([{ id: 'schedule-1', courseId: 'course-1' }]), error => error?.code === 'CLOUD_SCHEDULE_PROJECTION_INVALID');
  console.log('cloud schedule projection checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
