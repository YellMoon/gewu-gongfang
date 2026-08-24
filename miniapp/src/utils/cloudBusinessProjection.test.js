'use strict';

const assert = require('assert');
const { createCloudBusinessProjectionRuntime, shanghaiDateKey } = require('./cloudBusinessProjection');

(async () => {
  const writes = [];
  const projection = {
    students: [{ id: 'student-1', name: 'Student One' }],
    studentContacts: [{ id: 'contact-1', student_id: 'student-1' }],
    teachers: [{ id: 'teacher-1', name: 'Teacher One' }],
    courses: [{ id: 'course-1', name: 'Course One' }],
    schedules: [{
      id: 'schedule-1',
      course_id: 'course-1',
      start_time: '2026-08-24T16:30:00.000Z',
      end_time: '2026-08-24T17:30:00.000Z',
      student_ids: ['student-1'],
    }],
    institutions: [{ id: 'institution-1', name: 'Institution One' }],
    schools: [{ id: 'school-1', name: 'School One' }],
    rooms: [{ id: 'room-1', name: 'Room One' }],
    assetRecords: [{ id: 'asset_record-1', amount: 8 }],
    assetCategories: [{ id: 'asset_category-1', name: 'Tuition' }],
  };
  const runtime = createCloudBusinessProjectionRuntime({
    readProjection: async token => {
      assert.strictEqual(token, 'miniapp-ticket.signature');
      return { success: true, data: { ok: true, projection } };
    },
    writeCache: (key, value) => writes.push([key, value]),
  });

  const result = await runtime.refresh('miniapp-ticket.signature');

  const normalizedSchedules = [{
    ...projection.schedules[0],
    start_time: '2026-08-25T00:30:00',
    end_time: '2026-08-25T01:30:00',
  }];
  assert.deepStrictEqual(result, { ...projection, schedules: normalizedSchedules });
  assert.deepStrictEqual(writes, [
    ['students', projection.students],
    ['studentContacts', projection.studentContacts],
    ['teachers', projection.teachers],
    ['courses', projection.courses],
    ['schedules', normalizedSchedules],
    ['institutions', projection.institutions],
    ['schools', projection.schools],
    ['rooms', projection.rooms],
    ['assetRecords', projection.assetRecords],
    ['assetCategories', projection.assetCategories],
    ['payments', []],
    ['grades', []],
  ]);
  assert.deepStrictEqual(normalizedSchedules[0].student_ids, ['student-1'], 'projection normalization must preserve the authoritative roster');
  assert.strictEqual(shanghaiDateKey('2026-08-24T16:30:00.000Z'), '2026-08-25', 'calendar filtering must use the product time zone instead of UTC date slicing');
  console.log('miniapp cloud business projection cache checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
