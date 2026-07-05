const assert = require('assert');
const dayjs = require('dayjs');

(async () => {
  const {
    applyRevenueDateChange,
    buildRevenueFacetOptions,
  } = await import('./revenueStatisticsFilters.mjs');

  const initialRange = [dayjs('2026-06-01'), dayjs('2026-06-30')];
  const startChanged = applyRevenueDateChange(initialRange, 'start', dayjs('2026-06-12'));
  assert.strictEqual(startChanged[0].format('YYYY-MM-DD'), '2026-06-12');
  assert.strictEqual(startChanged[1].format('YYYY-MM-DD'), '2026-06-30');

  const endChanged = applyRevenueDateChange(startChanged, 'end', dayjs('2026-06-20'));
  assert.strictEqual(endChanged[0].format('YYYY-MM-DD'), '2026-06-12');
  assert.strictEqual(endChanged[1].format('YYYY-MM-DD'), '2026-06-20');

  const clampedStart = applyRevenueDateChange(endChanged, 'start', dayjs('2026-07-01'));
  assert.strictEqual(clampedStart[0].format('YYYY-MM-DD'), '2026-07-01');
  assert.strictEqual(clampedStart[1].format('YYYY-MM-DD'), '2026-07-01');

  const rows = [
    {
      key: 'math-spring-a',
      studentId: 'student-a',
      studentName: '学生甲',
      teacherId: 'teacher-a',
      teacherName: '张老师',
      courseId: 'course-math-spring',
      courseName: '数学提高',
      courseType: 3,
      courseTypeName: '小组课',
      courseYear: 2026,
      semester: '春学期',
      institutionId: 'inst-a',
    },
    {
      key: 'math-spring-b',
      studentId: 'student-b',
      studentName: '学生乙',
      teacherId: 'teacher-a',
      teacherName: '张老师',
      courseId: 'course-math-spring',
      courseName: '数学提高',
      courseType: 3,
      courseTypeName: '小组课',
      courseYear: 2026,
      semester: '春学期',
      institutionId: 'inst-a',
    },
    {
      key: 'physics-autumn',
      studentId: 'student-c',
      studentName: '学生丙',
      teacherId: 'teacher-b',
      teacherName: '李老师',
      courseId: 'course-physics-autumn',
      courseName: '物理竞赛',
      courseType: 1,
      courseTypeName: '一对一',
      courseYear: 2026,
      semester: '秋学期',
      institutionId: 'inst-b',
    },
    {
      key: 'chemistry-summer',
      studentId: 'student-a',
      studentName: '学生甲',
      teacherId: 'teacher-c',
      teacherName: '王老师',
      courseId: 'course-chemistry-summer',
      courseName: '化学冲刺',
      courseType: 4,
      courseTypeName: '大班课',
      courseYear: 2027,
      semester: '暑假',
      institutionId: undefined,
    },
  ];

  const students = [
    { id: 'student-a', name: '学生甲' },
    { id: 'student-b', name: '学生乙' },
    { id: 'student-c', name: '学生丙' },
    { id: 'student-unused', name: '无明细学生' },
  ];
  const teachers = [
    { id: 'teacher-a', name: '张老师' },
    { id: 'teacher-b', name: '李老师' },
    { id: 'teacher-c', name: '王老师' },
  ];
  const institutions = [
    { id: 'inst-a', name: '机构A' },
    { id: 'inst-b', name: '机构B' },
  ];

  const byTeacher = buildRevenueFacetOptions(rows, students, teachers, institutions, {
    teacherId: 'teacher-a',
  });
  assert.deepStrictEqual(byTeacher.students.map(item => item.value), ['student-a', 'student-b']);
  assert.deepStrictEqual(byTeacher.courseNames.map(item => item.value), ['数学提高']);
  assert.deepStrictEqual(byTeacher.semesters.map(item => item.value), ['春学期']);
  assert.deepStrictEqual(byTeacher.institutions.map(item => item.value), ['inst-a']);

  const byYearSemester = buildRevenueFacetOptions(rows, students, teachers, institutions, {
    year: 2026,
    semester: '秋学期',
  });
  assert.deepStrictEqual(byYearSemester.teachers.map(item => item.value), ['teacher-b']);
  assert.deepStrictEqual(byYearSemester.courseNames.map(item => item.value), ['物理竞赛']);
  assert.deepStrictEqual(byYearSemester.courseTypes.map(item => item.value), [1]);
  assert.deepStrictEqual(byYearSemester.institutions.map(item => item.value), ['inst-b']);

  const byCourseName = buildRevenueFacetOptions(rows, students, teachers, institutions, {
    courseName: '化学冲刺',
  });
  assert.deepStrictEqual(byCourseName.years.map(item => item.value), [2027]);
  assert.deepStrictEqual(byCourseName.semesters.map(item => item.value), ['暑假']);
  assert.deepStrictEqual(byCourseName.students.map(item => item.value), ['student-a']);
  assert.deepStrictEqual(byCourseName.teachers.map(item => item.value), ['teacher-c']);

  console.log('revenueStatisticsFilters tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
