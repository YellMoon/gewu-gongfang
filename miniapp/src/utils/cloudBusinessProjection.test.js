'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const {
  createCloudBusinessProjectionRuntime,
  shanghaiDateKey,
  shiftShanghaiDateKey,
  shanghaiWeekDateKeys,
  shanghaiDateParts,
} = require('./cloudBusinessProjection');

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

  const result = await runtime.refresh('miniapp-ticket.signature', () => true);

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

  let resolveStaleProjection;
  const staleWrites = [];
  const staleRuntime = createCloudBusinessProjectionRuntime({
    readProjection: () => new Promise(resolve => { resolveStaleProjection = resolve; }),
    writeCache: (key, value) => staleWrites.push([key, value]),
  });
  let staleSessionCurrent = true;
  const staleRefresh = staleRuntime.refresh('old-account-ticket.signature', () => staleSessionCurrent);
  staleSessionCurrent = false;
  resolveStaleProjection({ success: true, data: { ok: true, projection } });
  await assert.rejects(staleRefresh, /CLOUD_BUSINESS_PROJECTION_SESSION_CHANGED/);
  assert.deepStrictEqual(staleWrites, [], 'a response from the previous account must not write into the current account cache');
  assert.strictEqual(shanghaiDateKey('2026-08-24T16:30:00.000Z'), '2026-08-25', 'calendar filtering must use the product time zone instead of UTC date slicing');
  assert.strictEqual(shiftShanghaiDateKey('2026-08-25', -1), '2026-08-24');
  assert.deepStrictEqual(shanghaiWeekDateKeys('2026-08-25'), [
    '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30',
  ]);
  assert.deepStrictEqual(shanghaiDateParts('2026-08-25'), { year: 2026, month: 8, day: 25 });
  const probe = [
    "const c=require('./miniapp/src/utils/cloudBusinessProjection')",
    "const today=c.shanghaiDateKey('2026-08-24T16:30:00.000Z')",
    "process.stdout.write(JSON.stringify({today,week:c.shanghaiWeekDateKeys(today),parts:c.shanghaiDateParts(today)}))",
  ].join(';');
  const calendarByZone = zone => JSON.parse(execFileSync(process.execPath, ['-e', probe], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: zone },
    encoding: 'utf8',
  }));
  assert.deepStrictEqual(calendarByZone('America/New_York'), calendarByZone('Pacific/Auckland'), 'Shanghai calendar layout must not depend on device time zone');
  console.log('miniapp cloud business projection cache checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
