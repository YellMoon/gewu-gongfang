const assert = require('assert');

(async () => {
  const { applyScheduleListFilters, buildScheduleListFilterOptions } = await import('./scheduleListFilters.mjs');

  const schedules = [
    {
      id: 's-old-math',
      course_id: 'course-math',
      start_time: '2026-06-02T09:00:00.000Z',
      end_time: '2026-06-02T10:00:00.000Z',
      student_ids: ['student-a'],
    },
    {
      id: 's-physics',
      course_id: 'course-physics',
      start_time: '2026-06-03T09:00:00.000Z',
      end_time: '2026-06-03T10:00:00.000Z',
      student_ids: ['student-b'],
    },
    {
      id: 's-new-math',
      course_id: 'course-math',
      start_time: '2026-06-04T09:00:00.000Z',
      end_time: '2026-06-04T10:00:00.000Z',
      student_ids: ['student-a'],
    },
  ];

  const courses = [
    {
      id: 'course-math',
      teacher_id: 'teacher-a',
      year: 2026,
      semester: '春季',
      name: '数学',
      student_pricings: [{ student_id: 'student-a' }],
    },
    {
      id: 'course-physics',
      teacher_id: 'teacher-b',
      year: 2025,
      semester: '秋季',
      name: '物理',
      student_pricings: [{ student_id: 'student-b' }],
    },
  ];

  const teachers = [
    { id: 'teacher-a', name: '张老师' },
    { id: 'teacher-b', name: '李老师' },
  ];
  const students = [
    { id: 'student-a', name: '小甲' },
    { id: 'student-b', name: '小乙' },
  ];

  const filteredByTeacher = applyScheduleListFilters(schedules, courses, {
    filterTeacher: 'teacher-a',
  });

  assert.deepStrictEqual(
    filteredByTeacher.map(item => item.id),
    ['s-new-math', 's-old-math'],
    'teacher filter should still be applied after schedules refresh instead of returning the full list'
  );

  const filteredByStudent = applyScheduleListFilters(schedules, courses, {
    filterStudent: 'student-b',
  });

  assert.deepStrictEqual(
    filteredByStudent.map(item => item.id),
    ['s-physics'],
    'student filter should still be applied after schedules refresh'
  );

  const filteredByCourseFields = applyScheduleListFilters(schedules, courses, {
    filterTeacher: 'teacher-a',
    filterStudent: 'student-a',
    filterYear: 2026,
    filterSemester: '春季',
    filterCourseName: '数学',
  });

  assert.deepStrictEqual(
    filteredByCourseFields.map(item => item.id),
    ['s-new-math', 's-old-math'],
    'teacher, student, year, semester, and course name filters should be applied together'
  );

  const optionsAfterTeacher = buildScheduleListFilterOptions(schedules, courses, students, teachers, {
    filterTeacher: 'teacher-a',
  });

  assert.deepStrictEqual(
    optionsAfterTeacher.students.map(item => item.value),
    ['student-a'],
    'student dropdown options should shrink to students that match the selected teacher'
  );
  assert.deepStrictEqual(
    optionsAfterTeacher.years.map(item => item.value),
    [2026],
    'year dropdown options should shrink to years that match the selected teacher'
  );
  assert.deepStrictEqual(
    optionsAfterTeacher.courses.map(item => item.value),
    ['数学'],
    'course-name dropdown options should shrink to courses that match the selected teacher'
  );

  const optionsAfterStudent = buildScheduleListFilterOptions(schedules, courses, students, teachers, {
    filterStudent: 'student-b',
  });

  assert.deepStrictEqual(
    optionsAfterStudent.teachers.map(item => item.value),
    ['teacher-b'],
    'teacher dropdown options should shrink to teachers that match the selected student'
  );
  assert.deepStrictEqual(
    optionsAfterStudent.semesters.map(item => item.value),
    ['秋季'],
    'semester dropdown options should shrink to semesters that match the selected student'
  );
})();
