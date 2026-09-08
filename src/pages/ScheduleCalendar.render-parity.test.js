'use strict';
// UTF-8: compare actual pre-cloud/current rendering and load-time presentation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const dayjs = require('dayjs');
const root = path.resolve(__dirname, '../..');
const file = 'src/pages/ScheduleCalendar.tsx';
const current = fs.readFileSync(path.join(root, file), 'utf8');
const historical = cp.execFileSync('git', ['show', '8118419f:' + file], { cwd: root, encoding: 'utf8' });
const oldRooms = cp.execFileSync('git', ['show', '8118419f:src/utils/scheduleRoomDisplay.mjs'], { cwd: root, encoding: 'utf8' });
const compile = text => ts.transpileModule(text, { compilerOptions: {
  jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;

function renderer(text) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Map(['MIN_START_HOUR', 'SLOT_DURATION', 'stripCourseSystemPrefix', 'getCourseDisplayName', 'slotToTime'].map(name => [name, null]));
  const cards = [], loaders = [], roomDeclarations = [];
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && names.has(node.name?.getText(ast))) {
      names.set(node.name.getText(ast), (ts.isVariableDeclaration(node) ? 'const ' : '') + node.getText(ast) + ';');
    }
    if (ts.isJsxExpression(node) && node.expression?.getText(ast) === 'schedule.course_name') cards.push(node.parent.parent);
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'setSchedules' &&
        node.arguments[0]?.getText(ast).includes('coursesData.find')) loaders.push(node.arguments[0]);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'roomDisplay') roomDeclarations.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const [name, value] of names) assert(value, 'missing real declaration: ' + name);
  assert.equal(cards.length, 1); assert.equal(loaders.length, 1); assert.equal(roomDeclarations.length, 1);
  // Use the real loader mapper and real JSX, including styles/highlights; no copied card template.
  return new Function('React', 'dayjs', 'resolveScheduleRoomDisplay', 'resolveCalendarRoomDisplay', compile(`
    ${[...names.values()].join('\n')}
    return (schedules, coursesData, rooms, dragState) => {
      const loaded = (${loaders[0].getText(ast)})(schedules);
      return loaded.map(schedule => {
        const course = coursesData.find(item => item.id === schedule.course_id);
        const ${roomDeclarations[0].getText(ast)};
        const isDragging = Boolean(dragState), textColor = '#333';
        const pos = { startSlot: 31, endSlot: 49 };
        return (${cards[0].getText(ast)});
      });
    };
  `));
}

(async () => {
  const { resolveCalendarRoomDisplay } = await import('../utils/scheduleRoomDisplay.mjs');
  const { buildAuthorityBackedBrowserCache } = await import('../services/authorityProjectionCacheAdapter.mjs');
  const historicalExports = {};
  new Function('exports', compile(oldRooms))(historicalExports);
  const oldView = renderer(historical)(React, dayjs, historicalExports.resolveScheduleRoomDisplay, undefined);
  const newView = renderer(current)(React, dayjs, undefined, resolveCalendarRoomDisplay);
  const html = (view, schedules, courses, rooms, drag) => view(schedules, courses, rooms, drag).map(renderToStaticMarkup);
  const rooms = [{ id: 'ROOM-ID', name: '东湖上课点' }];
  const states = [null, ...['move', 'resize-top', 'resize-bottom'].flatMap(type => [false, true].map(ctrlKey => ({ type, ctrlKey })))];
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  let comparisons = 0;
  try {
    for (const name of ['2026 秋学期 初二物理', 'E2E-20260905-物理课程', '2026提高班-A01']) {
      for (const roomFields of [{ room_name: '最新上课点' }, { room_id: 'ROOM-ID' }, { room_name: '' }, {}]) {
        for (const encoding of ['local', 'utc', 'offset']) {
          const course = { id: 'COURSE-ID', name, year: 2026, semester: '秋学期', ...roomFields };
          const schedule = { id: 'SCHEDULE-ID', course_id: course.id, course_name: '旧名称', room: 'ROOM-ID',
            start_time: '2026-09-08 10:00:00', end_time: '2026-09-08 11:30:00', status: 1 };
          const cloudSchedule = { ...schedule, start_time: encoding === 'local' ? schedule.start_time :
            encoding === 'utc' ? '2026-09-08T02:00:00.000Z' : '2026-09-08T10:00:00+08:00',
          end_time: encoding === 'local' ? schedule.end_time :
            encoding === 'utc' ? '2026-09-08T03:30:00.000Z' : '2026-09-08T11:30:00+08:00' };
          const projection = { protocol: 'gewu.authority-projection.v1', sourceVersion: 1,
            payload: { schedules: [cloudSchedule], courses: [course], rooms } };
          const before = JSON.stringify(projection);
          const cache = buildAuthorityBackedBrowserCache({ projection });
          const cacheBefore = JSON.stringify(cache);
          for (const drag of states) {
            assert.deepEqual(html(newView, cache.schedules, cache.courses, cache.rooms, drag),
              html(oldView, [schedule], [course], rooms, drag), `original card parity: ${name}/${JSON.stringify(roomFields)}/${encoding}/${JSON.stringify(drag)}`);
            comparisons++;
          }
          assert.equal(JSON.stringify(projection), before, 'rendering must not modify cloud records');
          assert.equal(JSON.stringify(cache), cacheBefore, 'presentation must not rewrite cached snapshots');
        }
      }
    }
    const course = { id: 'COURSE-ID', name: '2026 秋学期 初二物理', room_name: '最新上课点' };
    const schedule = { id: 'SCHEDULE-ID', course_id: course.id, course_name: '旧名称', room: '旧地址',
      start_time: '2026-09-08T02:00:00.000Z', end_time: '2026-09-08T03:30:00.000Z' };
    const expected = html(newView, [schedule], [course], rooms, null);
    // UTF-8: keep the extraction anchor while deliberately adding an unwanted internal ID.
    for (const badSource of [current.replace('{schedule.course_name}', '{schedule.course_name}{schedule.course_id}'),
      current.replace("dayjs(schedule.start_time).format('HH:mm')", 'schedule.start_time.substring(11,16)')]) {
      assert.notEqual(badSource, current, 'mutation must hit the real source');
      assert.notDeepEqual(html(renderer(badSource)(React, dayjs, undefined, resolveCalendarRoomDisplay), [schedule], [course], rooms, null), expected,
        'comparison must detect internal IDs and UTC-time display regressions');
    }
    const badRoomView = renderer(current)(React, dayjs, undefined, historicalExports.resolveScheduleRoomDisplay);
    assert.notDeepEqual(html(badRoomView, [schedule], [course], rooms, null), expected, 'comparison must detect stale address display');
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  console.log(`original/cloud calendar load-and-render parity: ${comparisons} comparisons and 3 regression mutations passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
