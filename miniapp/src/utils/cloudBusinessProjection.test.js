'use strict';

const assert = require('assert');
const { createCloudBusinessProjectionRuntime } = require('./cloudBusinessProjection');

(async () => {
  const writes = [];
  const projection = {
    students: [{ id: 'student-1', name: 'Student One' }],
    studentContacts: [{ id: 'contact-1', student_id: 'student-1' }],
    teachers: [{ id: 'teacher-1', name: 'Teacher One' }],
    courses: [{ id: 'course-1', name: 'Course One' }],
    schedules: [{ id: 'schedule-1', course_id: 'course-1' }],
    institutions: [{ id: 'institution-1', name: 'Institution One' }],
    schools: [{ id: 'school-1', name: 'School One' }],
    rooms: [{ id: 'room-1', name: 'Room One' }],
  };
  const runtime = createCloudBusinessProjectionRuntime({
    readProjection: async token => {
      assert.strictEqual(token, 'miniapp-ticket.signature');
      return { success: true, data: { ok: true, projection } };
    },
    writeCache: (key, value) => writes.push([key, value]),
  });

  const result = await runtime.refresh('miniapp-ticket.signature');

  assert.deepStrictEqual(result, projection);
  assert.deepStrictEqual(writes, [
    ['students', projection.students],
    ['studentContacts', projection.studentContacts],
    ['teachers', projection.teachers],
    ['courses', projection.courses],
    ['schedules', projection.schedules],
    ['institutions', projection.institutions],
    ['schools', projection.schools],
    ['rooms', projection.rooms],
    ['payments', []],
    ['grades', []],
  ]);
  console.log('miniapp cloud business projection cache checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
