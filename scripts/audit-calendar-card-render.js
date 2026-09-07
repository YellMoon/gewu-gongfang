// UTF-8. Render actual historical/current JSX with identical synthetic inputs.
// This is a bounded source-render audit, not full desktop or production acceptance.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { Select, Divider } = require('antd');
const dayjs = require('dayjs');
const root = path.resolve(__dirname, '..');
const file = 'src/pages/ScheduleCalendar.tsx';
const baseline = '8118419fe1110ce55f68af114760d41631fdfae7';
function walk(source, predicate) {
  const matches = [];
  function visit(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
  visit(source);
  return matches;
}
function compile(sourceText, roomHelpers) {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = name => {
    const matches = walk(source, n => (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name?.getText(source) === name);
    assert.equal(matches.length, 1, name);
    return ts.isVariableDeclaration(matches[0]) ? `const ${matches[0].getText(source)};` : matches[0].getText(source);
  };
  const cards = walk(source, n => ts.isJsxElement(n) && n.getText(source).includes('{schedule.course_name}') && n.getText(source).includes('{roomDisplay &&'));
  cards.sort((a,b) => a.getWidth(source) - b.getWidth(source));
  assert(cards.length);
  const hydrators = walk(source, n => ts.isCallExpression(n) && n.expression.getText(source) === 'setSchedules' && n.arguments[0]?.getText(source).includes('const courseYear ='));
  assert.equal(hydrators.length, 1);
  const hydrateExpression = hydrators[0].arguments[0].getText(source);
  const roomExpressions = walk(source, n => ts.isVariableDeclaration(n) && n.name.getText(source) === 'roomDisplay');
  assert.equal(roomExpressions.length, 1);
  const code = [declaration('SIDEBAR_WIDTH'), declaration('stripCourseSystemPrefix'), declaration('getCourseDisplayName'), declaration('Sidebar'),
    `function hydrate(rows, coursesData) { return (${hydrateExpression})(rows); }`,
    `function Card({schedule, roomDisplay}) { const textColor = '#000000'; const isDragging = false; return (${cards[0].getText(source)}); }`,
    `function getRoomDisplay(schedule, course, rooms) { return (${roomExpressions[0].initializer.getText(source)}); }`,
    'return {Sidebar, Card, hydrate, getRoomDisplay};',
  ].join('\n');
  const js = ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('React', 'Select', 'Divider', 'CourseType', 'dayjs', 'resolveScheduleRoomDisplay', 'resolveCalendarRoomDisplay', js)(React, Select, Divider, { ONE_ON_ONE: 1, ONE_ON_TWO: 2, GROUP: 3, LARGE_CLASS: 4 }, dayjs, roomHelpers.resolveScheduleRoomDisplay, roomHelpers.resolveCalendarRoomDisplay);
}
async function run() {
  const roomHelpers = await import('../src/utils/scheduleRoomDisplay.mjs');
  const old = compile(cp.execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' }), roomHelpers);
  const current = compile(fs.readFileSync(path.join(root, file), 'utf8'), roomHelpers);
  const courses = [
    { id: 'c1', teacher_id: 't1', active: true, display_name: '物理提高课', name: '2026 秋学期 物理提高课', year: 2026, semester: '秋学期', room_name: '新地址', room_id: 'r1', type: 1 },
    { id: 'c2', teacher_id: 't1', active: true, name: '2025 春学期 数学基础课', room_name: '教室二', type: 2 },
    { id: 'c3', teacher_id: 't1', active: true, name: '班课', type: 3 },
    { id: 'closed', teacher_id: 't1', active: false, name: '已结课不显示' },
    { id: 'other', teacher_id: 't2', active: true, name: '其他教师不显示' },
  ];
  const inputs = { teachers: [{ id: 't1', name: '测试教师' }], selectedTeacherId: 't1', courses, onTeacherChange: () => {} };
  const snapshot = structuredClone(courses);
  const beforeSidebar = renderToStaticMarkup(React.createElement(old.Sidebar, inputs));
  const afterSidebar = renderToStaticMarkup(React.createElement(current.Sidebar, inputs));
  assert.equal(afterSidebar, beforeSidebar);
  for (const text of ['物理提高课', '数学基础课', '一对一', '一对二', '班课', '新地址']) assert(beforeSidebar.includes(text));
  for (const text of ['已结课不显示', '其他教师不显示']) assert(!beforeSidebar.includes(text));
  const rows = [{ id: 's1', course_id: 'c1', course_name: '旧课程名', room: '旧地址', start_time: '2026-09-07 10:00', end_time: '2026-09-07 11:30' }];
  const oldRow = old.hydrate(rows, courses)[0];
  const currentRow = current.hydrate(rows, courses)[0];
  const rooms = [{ id: 'r1', name: '新地址' }];
  const render = (version, row) => renderToStaticMarkup(React.createElement(version.Card, { schedule: row, roomDisplay: version.getRoomDisplay(row, courses[0], rooms) }));
  assert.equal(render(old, oldRow), render(current, oldRow), 'same hydrated input must render the same card');
  assert.equal(render(old, oldRow), render(current, currentRow), 'restore the original latest-course-address rendering without mutating the record');
  assert.equal(oldRow.room, '新地址'); assert.equal(currentRow.room, '旧地址');
  assert.equal(oldRow.course_name, '物理提高课'); assert.equal(currentRow.course_name, '物理提高课');
  assert.deepEqual(courses, snapshot); assert.equal(rows[0].room, '旧地址');
  console.log(JSON.stringify({ baseline, acceptance: false, syntheticData: true, sidebarSameInputsSameMarkup: true, calendarSameHydratedInputsSameMarkup: true, calendarAfterLoadSameMarkup: true, storedRoomNotRewritten: currentRow.room === '旧地址', screenshotCompared: false }, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
