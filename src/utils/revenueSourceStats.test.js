const assert = require('assert');
const { buildSourceStats } = require('./revenueSourceStats');

const rows = [
  {
    key: 'mixed-self',
    studentId: 'student-self',
    institutionId: 'inst-course',
    tuitionTotal: 300,
    teacherFeeTotal: 120,
    durationHours: 2,
  },
  {
    key: 'mixed-inst',
    studentId: 'student-inst',
    institutionId: 'inst-course',
    tuitionTotal: 400,
    teacherFeeTotal: 160,
    durationHours: 2,
  },
  {
    key: 'pure-inst',
    studentId: '__institution_unbound__',
    institutionId: 'inst-course',
    tuitionTotal: 500,
    teacherFeeTotal: 200,
    durationHours: 2,
  },
];

const students = [
  { id: 'student-self', name: '自有学生', source_type: 1 },
  { id: 'student-inst', name: '机构学生', source_type: 2, institution_id: 'inst-student' },
];

const institutions = [
  { id: 'inst-student', name: '学生机构' },
  { id: 'inst-course', name: '排课机构' },
];

const result = buildSourceStats(rows, students, institutions);

assert.strictEqual(result[0].sourceName, '自有');
assert.deepStrictEqual(new Set(result.map(item => item.sourceName)), new Set(['自有', '学生机构', '排课机构']));
assert.strictEqual(result.find(item => item.sourceName === '自有').teacherFeeAmount, 120);
assert.strictEqual(result.find(item => item.sourceName === '学生机构').teacherFeeAmount, 160);
assert.strictEqual(result.find(item => item.sourceName === '排课机构').teacherFeeAmount, 200);
assert(!result.some(item => item.sourceName === '混合班'));

console.log('revenueSourceStats tests passed');
