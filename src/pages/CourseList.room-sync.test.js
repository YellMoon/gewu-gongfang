// UTF-8: original full-visible-course address linkage, not just the edited course.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
(async () => {
  const ast = ts.createSourceFile('CourseList.tsx', fs.readFileSync(path.join(__dirname, 'CourseList.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Map();
  function visit(n) { if (ts.isVariableDeclaration(n) && ['syncSchedulesRoomName', 'submitCourseToAuthority', 'hasPendingCourseDraft'].includes(n.name.getText(ast))) names.set(n.name.getText(ast), n.initializer.getText(ast)); ts.forEachChild(n, visit); }
  visit(ast);
  function compile(name, deps) {
    assert(names.has(name));
    return new Function(...Object.keys(deps), ts.transpileModule(`return (${names.get(name)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(deps));
  }
  const originalSchedules = [
    { id: 's1', course_id: 'edited', room: 'Old address', status: 1, calculated_tuition: 270, calculated_teacher_fee: 180, updated_at: '2026-09-07T00:00:00Z' },
    { id: 's2', course_id: 'other', room: 'Another old address', status: 3, notes: 'Keep notes', updated_at: '2026-09-06T00:00:00Z' },
    { id: 's3', course_id: 'empty', room: 'Keep address', status: 4 },
    { id: 's4', course_id: 'missing', room: 'Keep missing-course address' },
  ];
  for (const edit of [false, true]) {
    const schedules = structuredClone(originalSchedules); const events = []; let replaced;
    let courses = [{ id: 'edited', room_name: 'Old address' }];
    const dbService = { getAllCourses: () => courses, refreshAuthorityProjection: async () => {
      events.push('refresh'); courses = [{ id: 'edited', room_name: 'New address' }, { id: 'other', active: false, room_name: 'Other new address' }, { id: 'empty', room_name: '' }];
    } };
    const sync = compile('syncSchedulesRoomName', { dbService, localStorage: {}, readSchedulesFromPrimaryStore: () => schedules,
      replaceSchedulesInPrimaryStore: (_db, rows) => { events.push('capture'); replaced = rows; } });
    // UTF-8: bind the actual guard to this same empty-outbox session.
    const window = { desktopAuthority: { list: async () => [] }, desktopIdentitySessionProvider: { createCloudCourse: async () => events.push('cloud'), updateCloudCourse: async () => events.push('cloud') } };
    const submit = compile('submitCourseToAuthority', {
      window, hasPendingCourseDraft: compile('hasPendingCourseDraft', { window }),
      dbService, syncSchedulesRoomName: sync, courseCloudPayload: x => x,
      editingCourse: edit ? { id: 'edited', updated_at: '2026-09-07T00:00:00Z' } : null,
      message: { warning() {}, success() {}, error() {} },
    });
    assert.equal(await submit({ room_id: 'r1' }), true);
    assert.deepEqual(events, ['cloud', 'refresh', 'capture'], 'online create/edit must restore original address linkage after cloud refresh');
    assert.equal(replaced[0].room, 'New address');
    assert.equal(replaced[1].room, 'Other new address', 'must include other and completed courses like the original');
    assert.deepEqual(replaced.slice(2), originalSchedules.slice(2));
    for (let i = 0; i < replaced.length; i++) assert.deepEqual({ ...replaced[i], room: schedules[i].room }, schedules[i], 'address linkage must not change time, attendance, fees, notes or version baselines');
    assert.deepEqual(schedules, originalSchedules, 'source records must not be mutated before durable draft capture');
  }
  console.log('course original full-range address linkage checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
