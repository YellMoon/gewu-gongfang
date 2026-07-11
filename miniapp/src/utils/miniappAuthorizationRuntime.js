const ADMIN_MODULES = ['scheduling', 'question-bank', 'assets', 'students', 'courses', 'teachers', 'payments', 'stats', 'admin'];
const TEACHER_MODULES = ADMIN_MODULES.filter(moduleId => moduleId !== 'admin');
const STUDENT_MODULES = ['scheduling', 'question-bank'];
const VALID_ROLES = new Set(['super_admin', 'admin', 'teacher', 'student', 'pending']);

function roleOf(user) {
  const role = user && (user.user_type || user.role);
  return VALID_ROLES.has(role) ? role : 'pending';
}

function permissionIdentityKey(user) {
  if (!user || !user.id) return '';
  return `${user.id}:${roleOf(user)}`;
}

function businessCacheIdentityKey(user) {
  const role = roleOf(user);
  if (!user || !user.id || role === 'pending') return '';
  const teacherId = role === 'teacher' ? (user.teacher_id || user.teacherId) : '';
  if (role === 'teacher' && !teacherId) return '';
  return [user.id, role, teacherId].filter(Boolean).join(':');
}

function deriveAccess(user, permissionState) {
  const role = roleOf(user);
  const identityKey = permissionIdentityKey(user);
  const loadedForIdentity = permissionState && permissionState.status === 'loaded'
    && identityKey && permissionState.identityKey === identityKey;
  const capabilities = loadedForIdentity && Array.isArray(permissionState.capabilities)
    ? permissionState.capabilities : [];
  let modules = [];
  if (capabilities.includes('business:all')) modules = ADMIN_MODULES.slice();
  else if (capabilities.includes('business:teacher-scope') && role === 'teacher') modules = TEACHER_MODULES.slice();
  else if (capabilities.includes('question-bank:view') && role === 'student') modules = STUDENT_MODULES.slice();
  return {
    role,
    modules,
    capabilities,
    permissionStatus: loadedForIdentity ? 'loaded' : (permissionState && permissionState.status === 'error' ? 'error' : 'idle'),
    canReadUsers: capabilities.includes('business:all') && (role === 'super_admin' || role === 'admin'),
    canReviewUsers: capabilities.includes('users:review') && role === 'super_admin',
    canEditQuestionBank: capabilities.includes('question-bank:edit'),
    canDeleteCommittedQuestions: false,
  };
}

function relatedStudentIds(items) {
  const ids = [];
  for (const item of items) {
    if (Array.isArray(item.student_ids)) ids.push(...item.student_ids);
    if (Array.isArray(item.student_pricings)) {
      ids.push(...item.student_pricings.map(pricing => pricing.student_id || pricing.studentId));
    }
  }
  return new Set(ids.filter(Boolean));
}

function scopeDashboardCollections(user, collections = {}) {
  const students = Array.isArray(collections.students) ? collections.students : [];
  const courses = Array.isArray(collections.courses) ? collections.courses : [];
  const schedules = Array.isArray(collections.schedules) ? collections.schedules : [];
  const role = roleOf(user);
  if (role === 'pending') return { students: [], courses: [], schedules: [] };
  if (role === 'teacher') {
    const teacherId = user && (user.teacher_id || user.teacherId);
    if (!teacherId) return { students: [], courses: [], schedules: [] };
    const scopedCourses = courses.filter(course => (course.teacher_id || course.teacherId) === teacherId);
    const courseIds = new Set(scopedCourses.map(course => course.id));
    const scopedSchedules = schedules.filter(schedule => (
      (schedule.teacher_id || schedule.teacherId) === teacherId || courseIds.has(schedule.course_id || schedule.courseId)
    ));
    const studentIds = relatedStudentIds([...scopedCourses, ...scopedSchedules]);
    return { students: students.filter(student => studentIds.has(student.id)), courses: scopedCourses, schedules: scopedSchedules };
  }
  if (role === 'student') {
    const linkedIds = new Set([
      user.student_id, user.studentId, user.linked_student_id, user.linkedStudentId,
      ...(user.linked_student_ids || []), ...(user.linkedStudentIds || []), user.id,
    ].filter(Boolean));
    const scopedCourses = courses.filter(course => [...relatedStudentIds([course])].some(id => linkedIds.has(id)));
    const courseIds = new Set(scopedCourses.map(course => course.id));
    const scopedSchedules = schedules.filter(schedule => courseIds.has(schedule.course_id || schedule.courseId)
      || [...relatedStudentIds([schedule])].some(id => linkedIds.has(id)));
    return { students: students.filter(student => linkedIds.has(student.id)), courses: scopedCourses, schedules: scopedSchedules };
  }
  return { students: students.slice(), courses: courses.slice(), schedules: schedules.slice() };
}

module.exports = { ADMIN_MODULES, TEACHER_MODULES, STUDENT_MODULES, roleOf, permissionIdentityKey, businessCacheIdentityKey, deriveAccess, scopeDashboardCollections };
