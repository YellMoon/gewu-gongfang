const assert = require('assert');

(async () => {
  const { projectCloudSchedules, projectCloudScheduleRecords } = await import('./cloudScheduleProjection.mjs');
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
  const full={id:'schedule-1',course_id:'course-1',start_time:'2026-09-07T01:00:00Z',end_time:'2026-09-07T02:00:00Z',updated_at:'2026-09-07T00:00:00Z',recurring_rule:'weekly',service_type:2,notes:'keep notes',student_ids:['student-1'],student_pricings:[{student_id:'student-1',attendance_status:4,tuition:100,teacher_fee:50}]};
  const projected=projectCloudScheduleRecords({courses:[{id:'course-1',display_name:'Course A'}],schedules:[full]})[0];
  for(const key of ['recurring_rule','service_type','notes','student_ids','student_pricings']) assert.deepStrictEqual(projected[key],full[key]);
  assert.equal(projected.course_name,'Course A');
  assert.throws(()=>projectCloudScheduleRecords({courses:[],schedules:[{...full,student_pricings:undefined}]}),e=>e.code==='CLOUD_SCHEDULE_PROJECTION_INVALID');
  console.log('cloud schedule projection checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
