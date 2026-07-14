const {
  hasReviewExperienceMarker,
  isReviewExperienceIdentity,
  reviewSessionIdentityKey,
} = require('./reviewExperience');

const ADMIN_MODULES = ['scheduling', 'question-bank', 'assets', 'students', 'courses', 'teachers', 'payments', 'stats', 'admin'];
const TEACHER_MODULES = ADMIN_MODULES.filter(moduleId => moduleId !== 'admin');
const STUDENT_MODULES = ['scheduling', 'question-bank'];
const REVIEW_ADMIN_MODULES = ADMIN_MODULES.filter(moduleId => moduleId !== 'admin');
const REVIEW_STUDENT_MODULES = STUDENT_MODULES.slice();
const VALID_ROLES = new Set(['super_admin', 'admin', 'teacher', 'student', 'pending']);

function roleOf(user) {
  const role = user && (user.user_type || user.role);
  return VALID_ROLES.has(role) ? role : 'pending';
}

function permissionIdentityKey(user) {
  if (!user || !user.id) return '';
  if (hasReviewExperienceMarker(user) && !isReviewExperienceIdentity(user)) return '';
  if (isReviewExperienceIdentity(user)) return reviewSessionIdentityKey(user);
  return `${user.id}:${roleOf(user)}`;
}

function businessCacheIdentityKey(user) {
  const role = roleOf(user);
  if (!user || !user.id || role === 'pending') return '';
  if (hasReviewExperienceMarker(user) && !isReviewExperienceIdentity(user)) return '';
  if (isReviewExperienceIdentity(user)) return reviewSessionIdentityKey(user);
  const teacherId = role === 'teacher' ? (user.teacher_id || user.teacherId) : '';
  if (role === 'teacher' && !teacherId) return '';
  return [user.id, role, teacherId].filter(Boolean).join(':');
}

function reviewCapabilityAllowlist(user) {
  if (!isReviewExperienceIdentity(user)) return [];
  return [
    'review-demo:read',
    roleOf(user) === 'admin' ? 'review-demo:admin' : 'review-demo:student',
    'review-demo:paper-export',
    'question-bank:view',
  ];
}

function sanitizeCapabilitiesForIdentity(user, capabilities) {
  const stringCapabilities = Array.isArray(capabilities)
    ? capabilities.filter(capability => typeof capability === 'string') : [];
  if (!hasReviewExperienceMarker(user)) return stringCapabilities;
  if (!isReviewExperienceIdentity(user)) return [];
  return reviewCapabilityAllowlist(user).filter(capability => stringCapabilities.includes(capability));
}

function deriveAccess(user, permissionState) {
  const role = roleOf(user);
  const reviewIdentity = isReviewExperienceIdentity(user);
  const identityKey = permissionIdentityKey(user);
  const loadedForIdentity = permissionState && permissionState.status === 'loaded'
    && identityKey && permissionState.identityKey === identityKey;
  const loadedCapabilities = loadedForIdentity && Array.isArray(permissionState.capabilities)
    ? permissionState.capabilities : [];
  const capabilities = sanitizeCapabilitiesForIdentity(user, loadedCapabilities);
  let modules = [];
  if (reviewIdentity && role === 'admin' && capabilities.includes('review-demo:admin')) modules = REVIEW_ADMIN_MODULES.slice();
  else if (reviewIdentity && role === 'student' && capabilities.includes('review-demo:student')) modules = REVIEW_STUDENT_MODULES.slice();
  else if (!reviewIdentity && capabilities.includes('business:all')) modules = ADMIN_MODULES.slice();
  else if (capabilities.includes('business:teacher-scope') && role === 'teacher') modules = TEACHER_MODULES.slice();
  else if (!reviewIdentity && capabilities.includes('question-bank:view') && role === 'student') modules = STUDENT_MODULES.slice();
  return {
    role,
    modules,
    capabilities,
    permissionStatus: loadedForIdentity ? 'loaded' : (permissionState && permissionState.status === 'error' ? 'error' : 'idle'),
    canReadUsers: !reviewIdentity && capabilities.includes('business:all') && (role === 'super_admin' || role === 'admin'),
    canReviewUsers: !reviewIdentity && capabilities.includes('users:review') && role === 'super_admin',
    canEditQuestionBank: !reviewIdentity && capabilities.includes('question-bank:edit'),
    canDeleteCommittedQuestions: false,
  };
}

function reviewRolePolicy(user) {
  if (!hasReviewExperienceMarker(user)) return null;
  const strict = isReviewExperienceIdentity(user);
  const role = strict ? roleOf(user) : 'pending';
  return {
    role,
    modules: role === 'admin' ? REVIEW_ADMIN_MODULES.slice() : role === 'student' ? REVIEW_STUDENT_MODULES.slice() : [],
    readonlyScope: strict ? 'review-demo' : 'none',
    linkedStudentIds: role === 'student' ? [user.student_id].filter(Boolean) : [],
    allowedWriteTasks: [],
    canReadAllSnapshots: false,
    capabilities: strict ? reviewCapabilityAllowlist(user) : [],
    canReviewUsers: false,
    canEditQuestionBank: false,
  };
}

function canUserSubmitMiniappWrite(user, target, allowedTargets) {
  if (hasReviewExperienceMarker(user)) return false;
  return Array.isArray(allowedTargets) && allowedTargets.includes(target);
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

module.exports = {
  ADMIN_MODULES,
  TEACHER_MODULES,
  STUDENT_MODULES,
  REVIEW_ADMIN_MODULES,
  REVIEW_STUDENT_MODULES,
  canUserSubmitMiniappWrite,
  roleOf,
  permissionIdentityKey,
  reviewRolePolicy,
  sanitizeCapabilitiesForIdentity,
  businessCacheIdentityKey,
  deriveAccess,
  scopeDashboardCollections,
};
