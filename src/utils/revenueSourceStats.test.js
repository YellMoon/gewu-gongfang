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
const minuteStats=buildSourceStats(Array.from({length:3},(_,i)=>({studentId:'student-self',durationHours:40/60,tuitionTotal:80,teacherFeeTotal:40})),students,institutions);
assert.strictEqual(minuteStats[0].durationHours,2,'sum exact duration before display rounding');
assert.strictEqual(minuteStats[0].tuitionAmount,240);
assert.strictEqual(minuteStats[0].teacherFeeAmount,120);

const { addDurationStats, formatDurationBreakdown } = require('./revenueSourceStats');
const durations = { durationMinutes: 0, durationCounts: {} };
for (const durationMinutes of [40,40,40,80,90,120]) addDurationStats(durations,{durationMinutes});
assert.strictEqual(durations.durationMinutes,410);
assert.strictEqual(formatDurationBreakdown(durations.durationCounts),'40分钟 × 3节、80分钟 × 1节、90分钟 × 1节、120分钟 × 1节');
assert.strictEqual(formatDurationBreakdown({}),'');

const { formatDurationSummary, formatDetailDuration } = require('./revenueSourceStats');
const hourly = {durationMinutes:0,durationCounts:{}};
for (let i=0;i<3;i++) addDurationStats(hourly,{durationMinutes:40,billingUnit:1});
assert.strictEqual(hourly.durationMinutes,120);
assert.strictEqual(formatDurationSummary(hourly),'2 小时');
assert.strictEqual(formatDetailDuration({durationMinutes:40,billingUnit:1}),'0.67 小时');
assert.strictEqual(formatDetailDuration({durationMinutes:80,billingUnit:2}),'80 分钟');
addDurationStats(hourly,{durationMinutes:80,billingUnit:2});
assert.strictEqual(formatDurationSummary(hourly),'2 小时、80分钟 × 1节');
