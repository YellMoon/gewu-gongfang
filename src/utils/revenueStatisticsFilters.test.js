const assert = require('assert');
const dayjs = require('dayjs');

(async () => {
  const {
    applyRevenueDateChange,
    clearRevenueDateRange,
    buildRevenueFacetOptions,
    buildCourseCatalogOptionSources,
    filterRevenueSchedules,
    isDateWithinRevenueRange,
  } = await import('./revenueStatisticsFilters.mjs');
  assert.strictEqual(typeof filterRevenueSchedules, 'function', 'revenue schedule filtering should be reusable and testable');

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

  const clearedStart = applyRevenueDateChange(clampedStart, 'start', null);
  assert.strictEqual(clearedStart[0], null);
  assert.strictEqual(clearedStart[1].format('YYYY-MM-DD'), '2026-07-01');

  const clearedEnd = applyRevenueDateChange(clearedStart, 'end', null);
  assert.strictEqual(clearedEnd[0], null);
  assert.strictEqual(clearedEnd[1], null);
  assert.deepStrictEqual(clearRevenueDateRange(), [null, null]);

  const openStartRange = [null, dayjs('2026-07-01')];
  const openEndRange = [dayjs('2026-06-01'), null];
  assert.strictEqual(isDateWithinRevenueRange('2025-01-01', [null, null]), true);
  assert.strictEqual(isDateWithinRevenueRange('2026-07-01', openStartRange), true);
  assert.strictEqual(isDateWithinRevenueRange('2026-07-02', openStartRange), false);
  assert.strictEqual(isDateWithinRevenueRange('2026-05-31', openEndRange), false);
  assert.strictEqual(isDateWithinRevenueRange('2027-01-01', openEndRange), true);

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

  const courseCatalogSources = buildCourseCatalogOptionSources([
    {
      id: 'course-math-spring',
      name: '\u6570\u5b66\u63d0\u9ad8',
      year: 2026,
      semester: '\u6625\u5b66\u671f',
      teacher_id: 'teacher-a',
      student_pricings: [{ student_id: 'student-a' }, { student_id: 'student-b' }],
      active: true,
    },
    {
      id: 'course-math-autumn',
      name: '\u6570\u5b66\u63d0\u9ad8',
      year: 2026,
      semester: '\u79cb\u5b66\u671f',
      teacher_id: 'teacher-b',
      student_pricings: [{ student_id: 'student-c' }],
      active: true,
    },
    { id: 'course-closed', name: '\u5386\u53f2\u7ed3\u8bfe\u73ed', active: false },
    { id: 'course-no-schedule', display_name: '\u65b0\u5f00\u65e0\u6392\u8bfe', name: '\u65b0\u5f00\u65e0\u6392\u8bfe', active: true },
  ]);
  assert.deepStrictEqual(
    courseCatalogSources.map(item => item.id).sort(),
    [
      'course-closed',
      'course-math-autumn',
      'course-math-spring',
      'course-no-schedule',
    ],
    'course name source should come from the course catalog'
  );

  const optionsWithCatalogCourses = buildRevenueFacetOptions(rows, students, teachers, institutions, {}, courseCatalogSources);
  assert.deepStrictEqual(
    optionsWithCatalogCourses.courseNames.map(item => item.value).sort(),
    [
      'course-closed',
      'course-math-autumn',
      'course-math-spring',
      'course-no-schedule',
    ],
    'course name filter should use stable course ids from the course catalog'
  );
  const springMath = optionsWithCatalogCourses.courseNames.find(item => item.value === 'course-math-spring');
  assert.ok(springMath.label.includes('\u6625\u5b66\u671f'));
  assert.ok(springMath.label.includes('\u5f20\u8001\u5e08'));
  assert.ok(springMath.label.includes('\u5b66\u751f\u7532'));
  assert.ok(springMath.label.includes('\u5b66\u751f\u4e59'));

  const byCourseId = buildRevenueFacetOptions(rows, students, teachers, institutions, {
    courseId: 'course-math-spring',
  }, courseCatalogSources);
  assert.deepStrictEqual(
    byCourseId.students.map(item => item.value),
    ['student-a', 'student-b'],
    'course id filters should limit dependent facets to matching scheduled revenue rows'
  );

  const sameNameSchedules = [
    { id: 'spring-in-range', course_id: 'course-math-spring', start_time: '2026-06-10 08:00', status: 1 },
    { id: 'autumn-in-range', course_id: 'course-math-autumn', start_time: '2026-06-11 08:00', status: 1 },
    { id: 'spring-outside-range', course_id: 'course-math-spring', start_time: '2026-07-02 08:00', status: 1 },
    { id: 'spring-cancelled', course_id: 'course-math-spring', start_time: '2026-06-12 08:00', status: 3 },
  ];
  const selectedCourseSchedules = filterRevenueSchedules(sameNameSchedules, courseCatalogSources, {
    dateRange: [dayjs('2026-06-01'), dayjs('2026-06-30')],
    courseTypes: [],
    courseId: 'course-math-spring',
  }, { excludedStatuses: [3, 4] });
  assert.deepStrictEqual(
    selectedCourseSchedules.map(item => item.id),
    ['spring-in-range'],
    'date-scoped revenue filtering should not mix schedules from same-name course ids'
  );

  console.log('revenueStatisticsFilters tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
