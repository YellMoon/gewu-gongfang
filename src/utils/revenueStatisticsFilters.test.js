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

  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  try {
    const early = [{id:'early',start_time:'2026-09-28T23:20:00Z'}];
    assert.strictEqual(filterRevenueSchedules(early,[],{dateRange:['2026-09-29','2026-09-29']}).length,1);
    assert.strictEqual(filterRevenueSchedules(early,[],{dateRange:['2026-09-28','2026-09-28']}).length,0);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }

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

  const visibleInstitutions = [{id:'jianren',name:'建人高复'},{id:'other',name:'其他机构'},{id:'unused',name:'无排课机构'}];
  const rangeRows = [
    {date:'2026-09-21',institutionId:'jianren',courseType:4,sourceType:2,studentId:'__institution_unbound__',teacherId:'teacher-a',courseId:'c-a',courseYear:2026,semester:'秋学期'},
    {date:'2026-10-31',institutionId:'other',courseType:1,sourceType:2,studentId:'s-b',teacherId:'teacher-b',courseId:'c-b',courseYear:2026,semester:'秋学期'},
    {date:'2026-08-31',institutionId:'unused',courseType:1,sourceType:2,teacherId:'teacher-a'},
    {date:'2026-11-01',institutionId:'unused',courseType:1,sourceType:2,teacherId:'teacher-a'},
  ];
  const periodFilters = {dateRange:[dayjs('2026-09-01'),dayjs('2026-10-31')]};
  const facets = filters => buildRevenueFacetOptions(rangeRows,[],[],visibleInstitutions,filters);
  assert.deepStrictEqual(facets({...periodFilters,teacherId:'teacher-a'}).institutions,[{value:'jianren',label:'建人高复'}],
    'institution options use the current date range and teacher, excluding outside dates and unused catalog entries');
  assert.deepStrictEqual(facets({dateRange:['2026-10-01','2026-10-31']}).institutions,[{value:'other',label:'其他机构'}],
    'changing draft dates immediately narrows institutions without another statistics query');
  assert.deepStrictEqual(facets({...periodFilters,courseId:'c-a',courseTypes:[4],year:2026,semester:'秋学期'}).institutions,[{value:'jianren',label:'建人高复'}]);
  assert.deepStrictEqual(facets({...periodFilters,studentId:'s-b'}).institutions,[{value:'other',label:'其他机构'}]);
  assert.deepStrictEqual(facets({...periodFilters,year:2025}).institutions,[]);
  const mixedRow = {...rangeRows[0],studentId:'s-inst',sourceType:3,institutionId:undefined};
  const mixedStudents = [{id:'s-inst',name:'机构学生',source_type:2,institution_id:'jianren'}];
  const mixedFacets = buildRevenueFacetOptions([mixedRow],mixedStudents,[],visibleInstitutions,periodFilters);
  assert.deepStrictEqual(mixedFacets.institutions,[{value:'jianren',label:'建人高复'}],
    'mixed-class institution options use the student institution just like actual revenue filtering');
  assert.equal(buildRevenueFacetOptions([mixedRow],mixedStudents,[],visibleInstitutions,{...periodFilters,institutionId:'jianren'}).students.length,1);
  const octoberOptions = facets({dateRange:['2026-10-01','2026-10-31']});
  for (const [facet, expected] of Object.entries({teachers:['teacher-b'],students:['s-b'],courseTypes:[1],institutions:['other'],years:[2026],semesters:['秋学期'],courseNames:['c-b']})) {
    assert.deepStrictEqual(octoberOptions[facet].map(option=>option.value),expected,`${facet} must narrow with draft dates`);
  }
  const byInstitutionOptions = facets({...periodFilters,institutionId:'jianren'});
  assert.deepStrictEqual(byInstitutionOptions.teachers.map(option=>option.value),['teacher-a']);
  assert.deepStrictEqual(byInstitutionOptions.courseNames.map(option=>option.value),['c-a']);
  assert.deepStrictEqual(byInstitutionOptions.courseTypes.map(option=>option.value),[4]);
  const byClassOptions = facets({...periodFilters,courseTypes:[4]});
  assert.deepStrictEqual(byClassOptions.teachers.map(option=>option.value),['teacher-a']);
  assert.deepStrictEqual(byClassOptions.institutions.map(option=>option.value),['jianren']);
  assert.deepStrictEqual(facets({...periodFilters,semester:'春学期'}).teachers,[]);
  assert.deepStrictEqual(facets({...periodFilters,courseId:'c-b'}).students.map(option=>option.value),['s-b']);
  assert.equal(facets(periodFilters).teachers.length,2,'clearing constraints restores valid alternatives');

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
      sourceType: 2,
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
      sourceType: 2,
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
      sourceType: 2,
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
    { id: 'student-a', name: '学生甲', source_type:2, institution_id:'inst-a' },
    { id: 'student-b', name: '学生乙', source_type:2, institution_id:'inst-a' },
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
  assert.deepStrictEqual(byTeacher.courseNames.map(item => item.value), ['course-math-spring']);
  assert.deepStrictEqual(byTeacher.semesters.map(item => item.value), ['春学期']);
  assert.deepStrictEqual(byTeacher.institutions.map(item => item.value), ['inst-a']);

  const byYearSemester = buildRevenueFacetOptions(rows, students, teachers, institutions, {
    year: 2026,
    semester: '秋学期',
  });
  assert.deepStrictEqual(byYearSemester.teachers.map(item => item.value), ['teacher-b']);
  assert.deepStrictEqual(byYearSemester.courseNames.map(item => item.value), ['course-physics-autumn']);
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
      'course-chemistry-summer',
      'course-math-spring',
      'course-physics-autumn',
    ],
    'course options use matching revenue rows and stable course ids; an unscheduled catalog course must not leak into the list'
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
