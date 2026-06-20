const assert = require('assert');

const {
  buildScheduleExportModel,
  createScheduleWorkbook,
  sanitizeExcelSheetName,
} = require('./scheduleExcelExport');
const XLSX = require('xlsx-js-style');

const schedules = [
  {
    id: 's1',
    course_id: 'c1',
    course_name: '数学提高',
    start_time: '2026-06-01 09:00',
    end_time: '2026-06-01 10:30',
    room: 'A101',
    status: 'PLANNED',
  },
  {
    id: 's2',
    course_id: 'c1',
    course_name: '数学提高',
    start_time: '2026-06-08 14:00',
    end_time: '2026-06-08 15:00',
    room: 'A101',
    status: 'PLANNED',
  },
];

const teachers = [{ id: 't1', name: '张老师' }];
const students = [{ id: 'stu1', name: '李同学' }];
const courses = [
  {
    id: 'c1',
    name: '数学提高',
    teacher_id: 't1',
    student_pricings: [{ student_id: 'stu1' }],
    room_name: 'A101',
  },
];

assert.strictEqual(sanitizeExcelSheetName('张老师/李同学:2026-06-01~2026-06-14课表').length <= 31, true);

const allModel = buildScheduleExportModel({
  schedules,
  courses,
  teachers,
  students,
  filterTeacher: 't1',
  filterStudent: undefined,
  dateRange: ['2026-06-01', '2026-06-14'],
});

assert.strictEqual(allModel.fileName, '张老师_全部学生_20260601-20260614_课表.xlsx');
assert.ok(allModel.sheetName.includes('张老师'));
assert.ok(allModel.sheetName.includes('全部学生'));
assert.strictEqual(allModel.weeks.length, 2);
assert.deepStrictEqual(allModel.weeks.map(w => w.title), [
  '第1周：6月1日 ~ 6月7日',
  '第2周：6月8日 ~ 6月14日',
]);
assert.strictEqual(allModel.weeks[0].courses[0].displayLines.join('\n'), '数学提高\nA101 09:00-10:30');
assert.strictEqual(allModel.weeks[1].courses[0].dayIndex, 0);

const studentModel = buildScheduleExportModel({
  schedules,
  courses,
  teachers,
  students,
  filterTeacher: 't1',
  filterStudent: 'stu1',
  dateRange: ['2026-06-01', '2026-06-14'],
});

assert.strictEqual(studentModel.fileName, '张老师_李同学_20260601-20260614_课表.xlsx');
assert.strictEqual(studentModel.weeks[0].courses[0].displayLines.join('\n'), '数学提高\n09:00-10:30');
assert.ok(!studentModel.weeks[0].courses[0].displayLines.join('\n').includes('A101'));

const workbook = createScheduleWorkbook(XLSX, studentModel);
assert.strictEqual(workbook.SheetNames[0], studentModel.sheetName);
const sheet = workbook.Sheets[studentModel.sheetName];
assert.ok(sheet['!merges'].some(merge => merge.s.r === 0 && merge.e.c === 7));
assert.strictEqual(sheet.B2.v, '周一\n6月1日');
const courseCell = Object.values(sheet).find(cell => cell && cell.v === '数学提高\n09:00-10:30');
assert.ok(courseCell, 'course cell should be written');
assert.strictEqual(courseCell.s.alignment.wrapText, true);
assert.strictEqual(courseCell.s.border.left.style, 'medium');

console.log('scheduleExcelExport tests passed');
