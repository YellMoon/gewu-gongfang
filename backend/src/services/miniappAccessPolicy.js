const ADMIN_TASK_TYPES = new Set(['asset-import', 'question-paper', 'paper-export-word', 'paper-export-pdf']);
const STUDENT_TASK_TYPES = new Set(['question-paper', 'paper-export-word', 'paper-export-pdf']);

function roleOf(user = {}) {
  return user?.role || user?.user_type || 'guest';
}

function isStudentUser(user) {
  return roleOf(user) === 'student';
}

function isAdminUser(user) {
  return ['admin', 'operator'].includes(roleOf(user));
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return value.split(',').map(item => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function getLinkedStudentIds(user = {}) {
  const ids = [
    user.student_id,
    user.studentId,
    user.linked_student_id,
    user.linkedStudentId,
    ...parseArray(user.linked_student_ids),
    ...parseArray(user.linkedStudentIds),
    isStudentUser(user) ? user.id : undefined,
  ];
  return Array.from(new Set(ids.filter(Boolean).map(String)));
}

function courseStudentIds(course = {}) {
  return [
    ...parseArray(course.student_ids),
    ...parseArray(course.student_pricings).map(pricing => (
      typeof pricing === 'object' && pricing ? (pricing.student_id || pricing.studentId) : pricing
    )),
  ].filter(Boolean).map(String);
}

function scheduleStudentIds(schedule = {}, courseById = new Map()) {
  const directIds = [
    ...parseArray(schedule.student_ids),
    ...parseArray(schedule.student_pricings).map(pricing => (
      typeof pricing === 'object' && pricing ? (pricing.student_id || pricing.studentId) : pricing
    )),
  ].filter(Boolean).map(String);
  const course = courseById.get(schedule.course_id);
  return Array.from(new Set([...directIds, ...courseStudentIds(course)]));
}

function hasAnyStudentLink(candidateIds, allowedIds) {
  const allowed = new Set(allowedIds.map(String));
  return candidateIds.some(idValue => allowed.has(String(idValue)));
}

function pick(record, keys) {
  const result = {};
  for (const key of keys) {
    if (record && record[key] !== undefined) result[key] = record[key];
  }
  return result;
}

function redactStudentForStudent(student = {}) {
  return pick(student, ['id', 'name', 'school', 'grade_year', 'grade_current', 'source_type']);
}

function redactCourseForStudent(course = {}) {
  return pick(course, [
    'id',
    'name',
    'display_name',
    'type',
    'year',
    'semester',
    'teacher_id',
    'teacher_name',
    'room_id',
    'room_name',
    'active',
    'default_duration_minutes',
    'notes',
    'created_at',
    'updated_at',
  ]);
}

function redactScheduleForStudent(schedule = {}) {
  return pick(schedule, [
    'id',
    'course_id',
    'start_time',
    'end_time',
    'recurring_rule',
    'status',
    'room',
    'service_type',
    'notes',
    'created_at',
    'updated_at',
  ]);
}

function redactTeacherForStudent(teacher = {}) {
  return pick(teacher, ['id', 'name', 'subject']);
}

function filterSnapshotForUser(snapshot, user) {
  if (!snapshot || !isStudentUser(user)) return snapshot;

  const linkedStudentIds = getLinkedStudentIds(user);
  const payload = snapshot.payload || {};
  const courseById = new Map((payload.courses || []).map(course => [course.id, course]));

  if (linkedStudentIds.length === 0) {
    return {
      ...snapshot,
      payload: {
        redactedForRole: 'student',
        linkedStudentIds: [],
        students: [],
        courses: [],
        schedules: [],
        teachers: [],
        payments: [],
        consumptions: [],
        assetRecords: [],
        assetCategories: [],
        subjects: payload.subjects || [],
        chapters: payload.chapters || [],
        knowledge_points: payload.knowledge_points || [],
        questions: payload.questions || [],
        question_contents: payload.question_contents || [],
        question_assets: payload.question_assets || [],
      },
    };
  }

  const courses = (payload.courses || []).filter(course =>
    hasAnyStudentLink(courseStudentIds(course), linkedStudentIds)
  );
  const allowedCourseIds = new Set(courses.map(course => course.id));
  const schedules = (payload.schedules || []).filter(schedule =>
    allowedCourseIds.has(schedule.course_id)
    || hasAnyStudentLink(scheduleStudentIds(schedule, courseById), linkedStudentIds)
  );
  const students = (payload.students || []).filter(student => linkedStudentIds.includes(String(student.id)));
  const teachers = (payload.teachers || []).filter(teacher =>
    courses.some(course => course.teacher_id === teacher.id || course.teacherId === teacher.id)
  );

  const {
    payments: _payments,
    consumptions: _consumptions,
    assetRecords: _assetRecords,
    assetCategories: _assetCategories,
    stats: _stats,
    revenueStats: _revenueStats,
    financeStats: _financeStats,
    studentTuitionStats: _studentTuitionStats,
    ...rest
  } = payload;

  return {
    ...snapshot,
    payload: {
      ...rest,
      redactedForRole: 'student',
      linkedStudentIds,
      students: students.map(redactStudentForStudent),
      courses: courses.map(redactCourseForStudent),
      schedules: schedules.map(redactScheduleForStudent),
      teachers: teachers.map(redactTeacherForStudent),
      payments: [],
      consumptions: [],
      assetRecords: [],
      assetCategories: [],
    },
  };
}

function allowedTasksForUser(user) {
  if (isStudentUser(user)) return STUDENT_TASK_TYPES;
  if (isAdminUser(user)) return ADMIN_TASK_TYPES;
  return new Set();
}

function isAllowedMiniappTaskForUser(user, taskType) {
  return allowedTasksForUser(user).has(taskType);
}

module.exports = {
  ADMIN_TASK_TYPES,
  STUDENT_TASK_TYPES,
  allowedTasksForUser,
  courseStudentIds,
  filterSnapshotForUser,
  getLinkedStudentIds,
  hasAnyStudentLink,
  isAdminUser,
  isAllowedMiniappTaskForUser,
  isStudentUser,
  parseArray,
  redactCourseForStudent,
  redactScheduleForStudent,
  redactStudentForStudent,
  redactTeacherForStudent,
  roleOf,
  scheduleStudentIds,
};
