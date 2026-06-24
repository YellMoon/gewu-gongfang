const assert = require('assert');

(async () => {
  const { applyScheduleListFilters } = await import('./scheduleListFilters.mjs');

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
      student_pricings: [{ student_id: 'student-a' }],
    },
    {
      id: 'course-physics',
      teacher_id: 'teacher-b',
      student_pricings: [{ student_id: 'student-b' }],
    },
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
})();
