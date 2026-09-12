'use strict';

const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

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
  };
  const before = structuredClone(values), rendered = {}, reads = [];
  const env = { isLimitedIdentity: limited,
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
  assert.deepEqual(reads, limited ? [] : ['schedules', 'courses', 'students']);
  assert.deepEqual(rendered.schedules, limited ? [] : [
    { ...values.schedules[0], course_name: 'Display', course_type: 2 },
    { ...values.schedules[1] },
    { ...values.schedules[2], course_name: '\u672a\u77e5\u8bfe\u7a0b', course_type: undefined },
  ]);
  assert.deepEqual(rendered.courses, limited ? [] : values.courses);
  assert.deepEqual(rendered.students, limited ? [] : values.students);
}
assert.ok(source.includes('function displayStudentName(student: Student)'), 'student filter labels must be normalized before display');
assert.ok(source.includes('<Text>{displayStudentName(student)}</Text>'), 'student filter must not expose raw profile identifiers');
assert.ok(source.includes("!name.toLowerCase().includes('e2e-role-test-')"), 'test-only technical account identifiers must never be shown as student names');
assert.ok(source.includes("setSelectedStudentId('')"), 'changing account scope must clear the previous teacher student filter');
assert.ok(source.includes('if (!isStudent && selectedStudentId)'), 'student and family views must never inherit a hidden teacher-only filter');
assert.ok(projectionSource.includes("timeZone: 'Asia/Shanghai'"), 'cloud schedule instants must be projected in the product time zone before date filtering');
assert.ok(projectionSource.includes('cloudScheduleDateTime(schedule.start_time)'), 'cloud schedule start times must be normalized before the calendar filter receives them');
assert.ok(projectionSource.includes('cloudScheduleDateTime(schedule.end_time)'), 'cloud schedule end times must be normalized before rendering');
assert.ok(!source.includes("'/pages/cloud-account-admin/index'"), 'retired cloud account authorization must not remain reachable from the schedule page');
assert.strictEqual((source.match(/enableFlex/g) || []).length, 2, 'both vertical schedule scrollers must opt into the miniapp flex layout mode');
const styles = fs.readFileSync('miniapp/src/pages/schedule/index.scss', 'utf8');
assert.ok(styles.includes('margin: 0 18rpx;') && styles.includes('width: calc(100% - 36rpx);'), 'wide schedule layout must use outer spacing instead of unsupported scroll-view padding');
assert.ok(!styles.includes('.week-view {\n    padding:'), 'wide schedule layout must not rely on scroll-view padding in webview mode');
assert.ok(packageJson.scripts['test:cloud-schedule'].includes('miniapp/src/pages/schedule/cloudBusinessSchedule.test.js'), 'cloud schedule test runner must include the miniapp cloud schedule boundary');
console.log('miniapp cloud schedule source checks passed');
