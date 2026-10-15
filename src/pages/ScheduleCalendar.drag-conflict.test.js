'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const dayjs = require('dayjs');

const source = fs.readFileSync('src/pages/ScheduleCalendar.tsx', 'utf8');
const ast = ts.createSourceFile('ScheduleCalendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const names = ['slotToTime', 'checkOverlap', 'handleDropCourse', 'handleDragSchedule', 'handleResizeSchedule'];
const handlers = compile(names.map(name => { assert(functions.has(name), name); return functions.get(name); }).join('\n'));

function fixture(schedules) {
  const original = JSON.stringify(schedules);
  const state = { schedules, writes: 0, notices: [], drafts: [] };
  const env = {
    schedules, dayjs, MIN_START_HOUR: 8, SLOT_DURATION: 5, GLOBAL_MAX_SLOT: 192,
    ScheduleStatus: { PLANNED: 1, CANCELLED: 3, LEAVE: 4 }, DEFAULT_DURATION_HOURS: 2,
    courses: [{ id: 'course', name: '物理', default_duration_minutes: 60 }], rooms: [],
    uuidv4: () => 'copy', resolveCalendarRoomDisplay: () => '原教室',
    getCourseDisplayName: course => course.name,
    buildFinancialFieldsForSchedule: schedule => ({ calculated_tuition: schedule.calculated_tuition, student_pricings: schedule.student_pricings }),
    setSchedulesWithHistory: updater => {
      state.writes++;
      state.schedules = typeof updater === 'function' ? updater(state.schedules) : updater;
      state.drafts.push(state.schedules);
    },
    setBatchSchedules: () => {}, message: {
      warning: text => state.notices.push(text), success: () => {},
    }, window: {},
  };
  state.handlers = new Function(...Object.keys(env), handlers + '\nreturn { handleDropCourse, handleDragSchedule, handleResizeSchedule };')(...Object.values(env));
  state.assertUnchanged = () => {
    assert.equal(state.writes, 0, 'rejected drag must never create a history entry or sync draft');
    assert.deepEqual(state.drafts, []);
    assert.equal(JSON.stringify(state.schedules), original, 'original lesson, attendance and fees must remain intact');
    assert.equal(JSON.stringify(schedules), original, 'input projection must remain intact');
    assert.equal(state.notices.length, 1, 'show one local warning');
  };
  return state;
}

const previousTimezone = process.env.TZ;
process.env.TZ = 'Asia/Shanghai';
try {
  for (const encoding of ['local', 'utc', 'offset']) {
    const instant = time => encoding === 'local' ? `2026-10-15 ${time}` : encoding === 'utc'
      ? dayjs(`2026-10-15 ${time}`).toISOString() : `2026-10-15T${time}:00+08:00`;
    const lesson = Object.freeze({ id: 'original', course_id: 'course', course_name: '物理', status: 1,
      start_time: instant('10:00'), end_time: instant('11:00'), updated_at: '2026-10-14T00:00:00.000Z',
      notes: '保留原排课', calculated_tuition: 180, calculated_teacher_fee: 120,
      student_pricings: [{ student_id: 'student', status: 1, tuition: 180, teacher_fee: 120 }] });
    const occupied = { ...lesson, id: 'occupied', course_name: '数学', start_time: instant('12:00'), end_time: instant('13:00') };
    for (const copy of [false, true]) {
      const state = fixture([lesson, occupied]);
      state.handlers.handleDragSchedule(lesson, dayjs('2026-10-15'), 48, copy);
      state.assertUnchanged();
    }
    // A copy overlaps its source even when there are no other lessons.
    const samePlace = fixture([lesson]);
    samePlace.handlers.handleDragSchedule(lesson, dayjs('2026-10-15'), 24, true);
    samePlace.assertUnchanged();
    for (const [start, end] of [[48, null], [null, 24], [null, 12], [null, 54]]) {
      const state = fixture([lesson, occupied]);
      state.handlers.handleResizeSchedule(lesson, start, end);
      state.assertUnchanged();
    }
    const create = fixture([lesson, occupied]);
    create.handlers.handleDropCourse({ id: 'course', name: '物理', default_duration_minutes: 60 }, dayjs('2026-10-15'), 48);
    create.assertUnchanged();
    for (const copy of [false, true]) {
      const valid = fixture([lesson, occupied]);
      valid.handlers.handleDragSchedule(lesson, dayjs('2026-10-15'), 36, copy);
      assert.equal(valid.writes, 1, 'a lesson may touch the adjacent lesson without overlapping');
      const changed = valid.schedules.find(row => row.id === (copy ? 'copy' : lesson.id));
      assert.equal(changed.start_time, dayjs('2026-10-15 11:00').toISOString());
      assert.equal(changed.end_time, dayjs('2026-10-15 12:00').toISOString());
      assert.deepEqual(changed.student_pricings, lesson.student_pricings);
      assert.equal(changed.calculated_tuition, 180);
      if (copy) assert.deepEqual(valid.schedules.find(row => row.id === lesson.id), lesson);
    }
  }
} finally {
  if (previousTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimezone;
}
console.log('calendar drag/copy/resize conflicts preserve original lessons without sync drafts across local/UTC/offset timestamps');
