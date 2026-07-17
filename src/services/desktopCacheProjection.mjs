const BUSINESS_KEYS = [
  'students', 'grades', 'courses', 'schedules', 'enrollments', 'payments',
  'consumptions', 'institutions', 'schools', 'rooms', 'teachers',
  'assetRecords', 'assetCategories',
];
const QUESTION_KEYS = [
  'questions', 'knowledgeTree', 'modelTree', 'tags', 'questionTagRels',
  'questionBasketIds', 'questionVersions', 'importTasks', 'importTaskItems',
];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function rows(source, key) {
  return Array.isArray(source?.[key]) ? source[key].map(clone) : [];
}

function value(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return null;
}

function stringSet(values) {
  return new Set(values.filter(item => item !== undefined && item !== null).map(String));
}

function array(valueToNormalize) {
  if (Array.isArray(valueToNormalize)) return valueToNormalize;
  if (typeof valueToNormalize !== 'string') return [];
  try {
    const parsed = JSON.parse(valueToNormalize);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return valueToNormalize.split(',').map(item => item.trim()).filter(Boolean);
  }
}

function studentLinks(row) {
  const pricing = array(value(row, 'student_pricings', 'studentPricings'));
  return [
    ...array(value(row, 'student_ids', 'studentIds')),
    ...pricing.map(item => typeof item === 'object' ? value(item, 'student_id', 'studentId') : item),
    value(row, 'student_id', 'studentId'),
  ].filter(Boolean).map(String);
}

function emptyProjection(source) {
  const projected = {};
  for (const key of BUSINESS_KEYS) projected[key] = [];
  for (const key of QUESTION_KEYS) projected[key] = rows(source, key);
  return projected;
}

function projectRelations(source, { courses, schedules, allowedStudentIds, includeFinancial }) {
  const courseIds = stringSet(courses.map(row => row.id));
  const scheduleIds = stringSet(schedules.map(row => row.id));
  const enrollments = rows(source, 'enrollments').filter(row => (
    courseIds.has(String(value(row, 'course_id', 'courseId') || ''))
      || scheduleIds.has(String(value(row, 'schedule_id', 'scheduleId') || ''))
  ) && (!allowedStudentIds.size
    || allowedStudentIds.has(String(value(row, 'student_id', 'studentId') || ''))));
  const linkedStudentIds = stringSet([
    ...allowedStudentIds,
    ...courses.flatMap(studentLinks),
    ...schedules.flatMap(studentLinks),
    ...enrollments.flatMap(studentLinks),
  ]);
  const students = rows(source, 'students').filter(row => linkedStudentIds.has(String(row.id)));
  const grades = rows(source, 'grades').filter(row => (
    linkedStudentIds.has(String(value(row, 'student_id', 'studentId') || ''))
  ));
  const rowInScope = row => (
    courseIds.has(String(value(row, 'course_id', 'courseId') || ''))
      || scheduleIds.has(String(value(row, 'schedule_id', 'scheduleId') || ''))
      || linkedStudentIds.has(String(value(row, 'student_id', 'studentId') || ''))
  );
  return {
    students,
    grades,
    enrollments,
    payments: includeFinancial ? rows(source, 'payments').filter(rowInScope) : [],
    consumptions: includeFinancial ? rows(source, 'consumptions').filter(rowInScope) : [],
    linkedStudentIds,
  };
}

function commonReferences(source, courses, schedules, students) {
  const institutionIds = stringSet([
    ...courses.map(row => value(row, 'institution_id', 'institutionId')),
    ...students.map(row => value(row, 'institution_id', 'institutionId')),
  ]);
  const roomIds = stringSet([
    ...courses.map(row => value(row, 'room_id', 'roomId')),
    ...schedules.map(row => value(row, 'room_id', 'roomId')),
  ]);
  const schoolIds = stringSet(students.map(row => value(row, 'school_id', 'schoolId')));
  return {
    institutions: rows(source, 'institutions').filter(row => institutionIds.has(String(row.id))),
    rooms: rows(source, 'rooms').filter(row => roomIds.has(String(row.id))),
    schools: rows(source, 'schools').filter(row => schoolIds.has(String(row.id))),
  };
}

export function projectDesktopCacheForIdentity(source = {}, identity = {}) {
  const activeRole = String(identity.activeRole || '').trim();
  if (activeRole === 'super_admin' || activeRole === 'admin') return clone(source);
  const projected = emptyProjection(source);

  if (activeRole === 'teacher') {
    const teacherId = String(identity.teacherId || '').trim();
    if (!teacherId) return projected;
    const courses = rows(source, 'courses').filter(row => (
      String(value(row, 'teacher_id', 'teacherId') || '') === teacherId
    ));
    const courseIds = stringSet(courses.map(row => row.id));
    const schedules = rows(source, 'schedules').filter(row => (
      courseIds.has(String(value(row, 'course_id', 'courseId') || ''))
    ));
    const relations = projectRelations(source, {
      courses,
      schedules,
      allowedStudentIds: new Set(),
      includeFinancial: true,
    });
    return {
      ...projected,
      courses,
      schedules,
      students: relations.students,
      grades: relations.grades,
      enrollments: relations.enrollments,
      payments: relations.payments,
      consumptions: relations.consumptions,
      teachers: rows(source, 'teachers').filter(row => String(row.id) === teacherId),
      assetRecords: rows(source, 'assetRecords').filter(row => (
        String(value(row, 'owner_user_id', 'ownerUserId') || '') === String(identity.userId || '')
      )),
      assetCategories: rows(source, 'assetCategories'),
      ...commonReferences(source, courses, schedules, relations.students),
    };
  }

  if (activeRole === 'student' || activeRole === 'parent') {
    const studentId = String(identity.studentId || '').trim();
    if (!studentId) return projected;
    const allowedStudentIds = new Set([studentId]);
    const courses = rows(source, 'courses').filter(row => (
      studentLinks(row).some(id => allowedStudentIds.has(id))
    ));
    const courseIds = stringSet(courses.map(row => row.id));
    const schedules = rows(source, 'schedules').filter(row => (
      courseIds.has(String(value(row, 'course_id', 'courseId') || ''))
        || studentLinks(row).some(id => allowedStudentIds.has(id))
    ));
    const relations = projectRelations(source, {
      courses,
      schedules,
      allowedStudentIds,
      includeFinancial: false,
    });
    const teacherIds = stringSet(courses.map(row => value(row, 'teacher_id', 'teacherId')));
    return {
      ...projected,
      courses,
      schedules,
      students: relations.students,
      grades: relations.grades,
      enrollments: relations.enrollments,
      teachers: rows(source, 'teachers').filter(row => teacherIds.has(String(row.id))),
      ...commonReferences(source, courses, schedules, relations.students),
    };
  }

  return projected;
}
