'use strict';

const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');

const source = fs.readFileSync('src/pages/StudentList.tsx', 'utf8');

assert.ok(source.includes('getAllStudentContacts'), 'student editor must read cloud-projected contact records');
assert.ok(source.includes("import { studentContactFormValues } from '../services/studentContactDraftProjection.mjs'"), 'student editor must use the behavior-tested local contact draft projection');
assert.ok(source.includes('updateCloudStudentRecord'), 'online student edits must use the atomic cloud command');
assert.ok(source.includes('createCloudStudentRecord'), 'online student creation must use the cloud command');
assert.ok(source.includes('deleteCloudStudent'), 'online student deletion must use the cloud command');
assert.ok(source.includes('expectedUpdatedAt: editingStudent.updated_at'), 'student record updates must carry the observed student version');
assert.ok(source.includes('expectedUpdatedAt: deletedStudent.updated_at'), 'student deletion must carry the observed student version');
assert.ok(source.includes('expectedUpdatedAt: existing.updated_at'), 'student contact updates must carry every observed contact version');
for (const field of ['student_wechat', 'parent_phone', 'parent_wechat', 'second_parent_phone', 'second_parent_wechat']) {
  assert.ok(source.includes(`name="${field}"`), `student editor must expose ${field} instead of silently preserving it`);
}
assert.ok(source.includes('phone: null, wechat: null'), 'clearing an existing student contact must submit a versioned unbind command');
assert.ok(source.includes('refreshAuthorityProjection'), 'a successful command must refresh the cloud projection before rendering');
assert.ok(source.includes('CLOUD_BUSINESS_STUDENT_CONFLICT'), 'the UI must surface concurrent changes instead of overwriting them');
assert.ok(!source.includes('dbService.addOrUpdateSchool(values.school)'),
  'student submission must own school registration atomically, not create a separate school command');

const ast = ts.createSourceFile('StudentList.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let sortExpression;
function findStudentRows(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'studentsData') sortExpression = node.initializer.getText(ast);
  ts.forEachChild(node, findStudentRows);
}
findStudentRows(ast);
const { outputText } = ts.transpileModule('return ' + sortExpression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
const compiledOrder = ts.transpileModule(fs.readFileSync('src/utils/listOrder.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const order = {};
new Function('exports', compiledOrder)(order);
const sortRows = new Function('dbService', 'newestFirst', outputText);
const records = [
  { id: 'a', created_at: '2026-11-20T09:00:00+08:00', updated_at: '2026-11-23T09:00:00+08:00' },
  { id: 'missing' },
  { id: 'c', created_at: '2026-11-21T09:00:00+08:00' },
  { id: 'b', created_at: '2026-11-21T01:00:00Z' },
];
assert.deepStrictEqual(sortRows({ getAllStudents: () => records }, order.newestFirst).map(row => row.id), ['b', 'c', 'a', 'missing']);
assert.deepStrictEqual(records.map(row => row.id), ['a', 'missing', 'c', 'b'], 'display sorting leaves the cache order intact');
for (const page of ['StudentList', 'CourseList', 'ScheduleList', 'TeacherList', 'PaymentList']) {
  const table = fs.readFileSync('src/pages/' + page + '.tsx', 'utf8');
  assert.match(table, /import Table from '..\/components\/NumberedTable'/);
  assert.doesNotMatch(table, /title:\s*['"]\u5e8f\u53f7['"]/, page + ' gets its visible row number from NumberedTable');
}
assert.match(fs.readFileSync('src/pages/CourseList.tsx', 'utf8'),
  /setCourses\(newestFirst<Course>\(coursesData, course => course\.created_at\)\)/);
const scheduleList = fs.readFileSync('src/pages/ScheduleList.tsx', 'utf8');
assert.match(scheduleList, /projectCloudScheduleRecords\(projection\), schedule => schedule\.start_time/);
assert.match(scheduleList, /setSchedules\(newestFirst<Schedule>\(scheduleData, schedule => schedule\.start_time\)\)/);

console.log('student list cloud-write source checks passed');
require('./StudentList.business-parity.test.js');
