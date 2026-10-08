'use strict';

const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');
const { buildCourseColorMap, getTextColorForBackground, DEFAULT_COURSE_COLOR } = require('./desktopCourseColors.test-support');

const source = fs.readFileSync('miniapp/src/pages/schedule/index.tsx', 'utf8');
const projectionSource = fs.readFileSync('miniapp/src/utils/cloudBusinessProjection.js', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.ok(source.includes('pullFromCloudBusinessProjection()'), 'schedule page must refresh the role-scoped cloud business projection');
assert.match(source, /getCachedList<Schedule(?:WithCourse)?>\('schedules'\)/, 'schedule page must render the cloud-backed derived cache');
assert.ok(source.includes('shanghaiWeekDateKeys(currentDateKey)'), 'schedule week layout must use the product calendar instead of device-local dates');
assert.ok(source.includes('shiftShanghaiDateKey(current, dir * 7)'), 'schedule week navigation must use product-calendar date keys');
assert.ok(!source.includes('.getDate()') && !source.includes('.getMonth()') && !source.includes('.getDay()'), 'schedule labels and today highlighting must not mix device-local calendar fields');
assert.ok(!source.includes('miniappCloudBusinessApi'), 'schedule page must not bypass the shared cloud projection runtime');
const ast = ts.createSourceFile('schedule/index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loader;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'loadData') loader = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(loader, 'execute the actual schedule cache loader');
for (const limited of [false, true]) {
  const values = {
    schedules: [{ id: 'a', course_id: 'live', course_name: 'Old label' }, { id: 'b', course_id: 'retired', course_name: 'Retained lesson', course_type: 3 }, { id: 'c', course_id: 'unknown' }],
    courses: [{ id: 'live', name: 'Name', display_name: 'Display', type: 2 }],
    students: [{ id: 'student', name: 'Student' }],
    rooms: [],
  };
  const before = structuredClone(values), rendered = {}, reads = [];
  const env = { isLimitedIdentity: limited,
    buildCourseColorMap, getTextColorForBackground, DEFAULT_COURSE_COLOR,
    getCachedList: key => { reads.push(key); return values[key]; },
    setSchedules: value => { rendered.schedules = value; },
    setCourses: value => { rendered.courses = value; },
    setStudents: value => { rendered.students = value; },
    setLoading: value => { rendered.loading = value; },
  };
  const code = ts.transpileModule(`return (${loader.getText(ast)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function(...Object.keys(env), code)(...Object.values(env))();
  assert.deepEqual(values, before, 'rendering must never rewrite the cloud-derived cache');
  assert.equal(rendered.loading, false);
  assert.deepEqual(reads, limited ? [] : ['schedules', 'courses', 'rooms']);
  assert.deepEqual(rendered.schedules, limited ? [] : [
    { ...values.schedules[0], course_name: 'Display', course_type: 2, room_display: '', card_background: DEFAULT_COURSE_COLOR, card_text_color: getTextColorForBackground(DEFAULT_COURSE_COLOR) },
    { ...values.schedules[1], room_display: '', card_background: DEFAULT_COURSE_COLOR, card_text_color: getTextColorForBackground(DEFAULT_COURSE_COLOR) },
    { ...values.schedules[2], course_name: '\u672a\u77e5\u8bfe\u7a0b', course_type: undefined, room_display: '', card_background: DEFAULT_COURSE_COLOR, card_text_color: getTextColorForBackground(DEFAULT_COURSE_COLOR) },
  ]);
}
assert.ok(!source.includes('selectedStudentId') && !source.includes('filter-tag'), 'no local student selector may appear; authorization stays in cloud projection');
assert.ok(projectionSource.includes("timeZone: 'Asia/Shanghai'"), 'cloud schedule instants must be projected in the product time zone before date filtering');
assert.ok(projectionSource.includes('cloudScheduleDateTime(schedule.start_time)'), 'cloud schedule start times must be normalized before the calendar filter receives them');
assert.ok(projectionSource.includes('cloudScheduleDateTime(schedule.end_time)'), 'cloud schedule end times must be normalized before rendering');
assert.ok(!source.includes("'/pages/cloud-account-admin/index'"), 'retired cloud account authorization must not remain reachable from the schedule page');
assert.strictEqual((source.match(/enableFlex/g) || []).length, 1, 'the two-week board uses one coordinated scroller');
const styles = fs.readFileSync('miniapp/src/pages/schedule/index.scss', 'utf8');
assert.ok(styles.includes('width: 1028PX;') && styles.includes('gap: 8PX;'), 'the board retains real desktop column widths and gap');
assert.ok(!styles.includes('.week-view {\n    padding:'), 'wide schedule layout must not rely on scroll-view padding in webview mode');
assert.ok(packageJson.scripts['test:cloud-schedule'].includes('miniapp/src/pages/schedule/cloudBusinessSchedule.test.js'), 'cloud schedule test runner must include the miniapp cloud schedule boundary');
console.log('miniapp cloud schedule source checks passed');
