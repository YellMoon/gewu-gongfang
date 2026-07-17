const assert = require('assert');

(async function () {
  const { projectDesktopCacheForIdentity } = await import('./desktopCacheProjection.mjs');
  const source = {
    students: [
      { id: 'student-self', name: 'Self', school_id: 'school-self' },
      { id: 'student-other', name: 'Other', school_id: 'school-other' },
    ],
    grades: [
      { id: 'grade-self', student_id: 'student-self' },
      { id: 'grade-other', student_id: 'student-other' },
    ],
    courses: [
      { id: 'course-self', teacher_id: 'teacher-self', room_id: 'room-self', institution_id: 'inst-self', student_ids: ['student-self'] },
      { id: 'course-other', teacher_id: 'teacher-other', room_id: 'room-other', institution_id: 'inst-other', student_ids: ['student-other'] },
    ],
    schedules: [
      { id: 'schedule-self', course_id: 'course-self' },
      { id: 'schedule-other', course_id: 'course-other' },
    ],
    enrollments: [
      { id: 'enrollment-self', course_id: 'course-self', student_id: 'student-self' },
      { id: 'enrollment-other', course_id: 'course-other', student_id: 'student-other' },
    ],
    payments: [
      { id: 'payment-self', course_id: 'course-self', student_id: 'student-self' },
      { id: 'payment-other', course_id: 'course-other', student_id: 'student-other' },
    ],
    consumptions: [
      { id: 'consumption-self', schedule_id: 'schedule-self' },
      { id: 'consumption-other', schedule_id: 'schedule-other' },
    ],
    institutions: [{ id: 'inst-self' }, { id: 'inst-other' }],
    schools: [{ id: 'school-self' }, { id: 'school-other' }],
    rooms: [{ id: 'room-self' }, { id: 'room-other' }],
    teachers: [{ id: 'teacher-self' }, { id: 'teacher-other' }],
    assetRecords: [
      { id: 'asset-self', ownerUserId: 'canonical-human' },
      { id: 'asset-other', ownerUserId: 'other-human' },
    ],
    assetCategories: [{ id: 'asset-category' }],
    questions: [{ id: 'question-public' }],
    knowledgeTree: [{ id: 'knowledge-public' }],
    modelTree: [{ id: 'model-public' }],
    tags: [{ id: 'tag-public' }],
    questionTagRels: [{ id: 'rel-public' }],
    questionBasketIds: ['question-public'],
    questionVersions: [{ id: 'version-public' }],
    importTasks: [{ id: 'import-public' }],
    importTaskItems: [{ id: 'import-item-public' }],
  };
  const snapshot = JSON.parse(JSON.stringify(source));

  const teacher = projectDesktopCacheForIdentity(source, {
    userId: 'canonical-human',
    activeRole: 'teacher',
    teacherId: 'teacher-self',
  });
  for (const [key, ids] of Object.entries({
    students: ['student-self'],
    grades: ['grade-self'],
    courses: ['course-self'],
    schedules: ['schedule-self'],
    enrollments: ['enrollment-self'],
    payments: ['payment-self'],
    consumptions: ['consumption-self'],
    institutions: ['inst-self'],
    schools: ['school-self'],
    rooms: ['room-self'],
    teachers: ['teacher-self'],
    assetRecords: ['asset-self'],
  })) {
    assert.deepStrictEqual(teacher[key].map(row => row.id), ids, `${key} must be teacher scoped`);
  }
  assert.deepStrictEqual(teacher.questions.map(row => row.id), ['question-public']);
  assert.deepStrictEqual(teacher.assetCategories.map(row => row.id), ['asset-category']);

  const admin = projectDesktopCacheForIdentity(source, {
    userId: 'canonical-human',
    activeRole: 'super_admin',
  });
  assert.deepStrictEqual(admin.students.map(row => row.id), ['student-self', 'student-other']);
  assert.notStrictEqual(admin.students, source.students);
  assert.notStrictEqual(admin.students[0], source.students[0]);

  const student = projectDesktopCacheForIdentity(source, {
    userId: 'student-human',
    activeRole: 'student',
    studentId: 'student-self',
  });
  assert.deepStrictEqual(student.students.map(row => row.id), ['student-self']);
  assert.deepStrictEqual(student.courses.map(row => row.id), ['course-self']);
  assert.deepStrictEqual(student.payments, []);
  assert.deepStrictEqual(student.assetRecords, []);
  assert.deepStrictEqual(source, snapshot, 'projection must never mutate the legacy cache');

  console.log('desktop cache projection checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
