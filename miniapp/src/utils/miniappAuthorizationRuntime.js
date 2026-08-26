const {
  accountCapabilities,
  isVisitorIdentity,
} = require('./accountExperience');

const STAFF_MODULES = ['scheduling', 'question-bank', 'assets', 'students', 'courses', 'teachers', 'payments', 'stats'];
const TEACHER_MODULES = STAFF_MODULES.slice();
const STUDENT_MODULES = ['scheduling', 'question-bank'];
const VISITOR_MODULES = ['question-bank', 'settings'];
const VALID_ROLES = new Set(['super_admin', 'teacher', 'student', 'visitor']);

function isRetiredIdentity(user) {
  if (!user || typeof user !== 'object') return false;
  const role = user.user_type || user.role;
  const accountState = user.account_state;
  const tokenUse = user.token_use;
  return (role && !VALID_ROLES.has(role))
    || (accountState && !['formal', 'visitor'].includes(accountState))
    || (tokenUse && !['miniapp-cloud', 'miniapp-visitor'].includes(tokenUse));
}

function roleOf(user) {
  const role = user && (user.user_type || user.role);
  return !isRetiredIdentity(user) && VALID_ROLES.has(role) ? role : 'visitor';
}

function normalizedIdentityValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value === true || value === 1 || value === '1' || value === 'true') return '1';
  if (value === false || value === 0 || value === '0' || value === 'false') return '0';
  return String(value).trim();
}

function normalizedIdentityIds(...values) {
  const ids = [];
  function append(value) {
    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }
    if (typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          parsed.forEach(append);
          return;
        }
      } catch (_error) { /* keep a non-JSON identifier as-is */ }
    }
    const id = normalizedIdentityValue(value);
    if (id) ids.push(id);
  }
  values.forEach(append);
  return Array.from(new Set(ids)).sort();
}

function permissionIdentityKey(user) {
  if (!user || !user.id) return '';
  if (isRetiredIdentity(user)) return '';
  if (isVisitorIdentity(user)) {
    return `visitor:${normalizedIdentityValue(user.id)}:${normalizedIdentityValue(user.authority_id)}`;
  }
  return JSON.stringify([
    normalizedIdentityValue(user.id),
    roleOf(user),
    normalizedIdentityValue(user.tenant_id ?? user.tenantId),
    normalizedIdentityValue(user.teacher_id ?? user.teacherId),
    normalizedIdentityIds(
      user.student_id,
      user.studentId,
      user.linked_student_id,
      user.linkedStudentId,
      user.linked_student_ids,
      user.linkedStudentIds,
    ),
    normalizedIdentityValue(user.review_status ?? user.reviewStatus),
    normalizedIdentityValue(user.status),
    normalizedIdentityValue(user.active),
    normalizedIdentityValue(user.login_enabled ?? user.loginEnabled),
    normalizedIdentityValue(user.deleted),
    normalizedIdentityValue(user.disabled),
  ]);
}

function studentSubjectIds(user) {
  if (!user) return [];
  return normalizedIdentityIds(
    user.student_id,
    user.studentId,
    user.linked_student_id,
    user.linkedStudentId,
    user.linked_student_ids,
    user.linkedStudentIds,
  );
}

function businessCacheIdentityKey(user) {
  const role = roleOf(user);
  if (!user || !user.id || role === 'visitor') return '';
  if (isRetiredIdentity(user) || isVisitorIdentity(user)) return '';
  if (role === 'teacher' && !(user.teacher_id || user.teacherId)) return '';
  if (role === 'student' && studentSubjectIds(user).length === 0) return '';
  const scope = permissionIdentityKey(user);
  return scope ? `normal:${scope}` : '';
}

function questionPaperTaskCacheKey(user) {
  if (isRetiredIdentity(user) || isVisitorIdentity(user)) return '';
  const scope = businessCacheIdentityKey(user);
  return scope ? `question_paper_tasks_v2_${encodeURIComponent(scope)}` : '';
}

function usesLimitedQuestionProjection(user) {
  const role = roleOf(user);
  if (role === 'visitor') return true;
  return role === 'student' || (role === 'teacher' && !businessCacheIdentityKey(user));
}

function createQuestionPaperTaskCacheRuntime(dependencies) {
  let current = { scopeKey: null, tasks: [] };

  function readSnapshot() {
    const scopeKey = questionPaperTaskCacheKey(dependencies.readIdentity());
    if (scopeKey !== current.scopeKey) {
      let tasks = [];
      if (scopeKey) {
        try {
          const stored = dependencies.read(scopeKey);
          tasks = Array.isArray(stored) ? stored.slice() : [];
        } catch (_error) { tasks = []; }
      }
      current = { scopeKey, tasks };
    }
    return { scopeKey: current.scopeKey || '', tasks: current.tasks.slice() };
  }

  function replace(tasks, expectedScopeKey) {
    const beforeWrite = readSnapshot();
    if (!beforeWrite.scopeKey || beforeWrite.scopeKey !== expectedScopeKey) {
      return { written: false, snapshot: beforeWrite };
    }
    const nextTasks = Array.isArray(tasks) ? tasks.slice() : [];
    dependencies.write(beforeWrite.scopeKey, nextTasks);
    current = { scopeKey: beforeWrite.scopeKey, tasks: nextTasks };
    return { written: true, snapshot: readSnapshot() };
  }

  return { replace, snapshot: readSnapshot };
}

function sanitizeCapabilitiesForIdentity(user, capabilities) {
  const stringCapabilities = Array.isArray(capabilities)
    ? capabilities.filter(capability => typeof capability === 'string') : [];
  if (isRetiredIdentity(user)) return [];
  if (isVisitorIdentity(user)) return accountCapabilities(user);
  return stringCapabilities;
}

function deriveAccess(user, permissionState) {
  const role = roleOf(user);
  const visitor = isVisitorIdentity(user);
  const experienceOnly = visitor || isRetiredIdentity(user);
  const identityKey = permissionIdentityKey(user);
  const loadedForIdentity = permissionState && permissionState.status === 'loaded'
    && identityKey && permissionState.identityKey === identityKey;
  const loadedCapabilities = loadedForIdentity && Array.isArray(permissionState.capabilities)
    ? permissionState.capabilities : [];
  const capabilities = sanitizeCapabilitiesForIdentity(user, loadedCapabilities);
  let modules = [];
  if (visitor && capabilities.includes('projection:read')) modules = VISITOR_MODULES.slice();
  else if (!experienceOnly && capabilities.includes('business:all')) modules = STAFF_MODULES.slice();
  else if (capabilities.includes('business:teacher-scope') && role === 'teacher') modules = TEACHER_MODULES.slice();
  else if (!experienceOnly && capabilities.includes('question-bank:view') && role === 'student') modules = STUDENT_MODULES.slice();
  return {
    role,
    experienceOnly,
    modules,
    capabilities,
    permissionStatus: loadedForIdentity ? 'loaded' : (permissionState && permissionState.status === 'error' ? 'error' : 'idle'),
    canReadUsers: !experienceOnly && capabilities.includes('business:all') && role === 'super_admin',
    canReviewUsers: !experienceOnly && capabilities.includes('users:review') && role === 'super_admin',
    canEditQuestionBank: !experienceOnly && capabilities.includes('question-bank:edit'),
    canDeleteCommittedQuestions: false,
  };
}

function accountExperiencePolicy(user) {
  if (isVisitorIdentity(user)) {
    return {
      role: 'visitor',
      modules: VISITOR_MODULES.slice(),
      readonlyScope: 'authority-projection',
      linkedStudentIds: [],
      allowedWriteTasks: [],
      canReadAllSnapshots: false,
      capabilities: accountCapabilities(user),
      canReviewUsers: false,
      canEditQuestionBank: false,
      experienceOnly: true,
    };
  }
  return null;
}

function canUserSubmitMiniappWrite(user, target, allowedTargets) {
  const role = roleOf(user);
  if (isRetiredIdentity(user) || role === 'visitor' || isVisitorIdentity(user)) return false;
  if (!Array.isArray(allowedTargets) || !allowedTargets.includes(target)) return false;
  if (target === 'asset-import') return role === 'super_admin' || role === 'teacher';
  return target === 'question-paper' || target === 'paper-export-word' || target === 'paper-export-pdf';
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
  if (isRetiredIdentity(user) || role === 'visitor' || isVisitorIdentity(user)) {
    return { students: [], courses: [], schedules: [] };
  }
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
    const linkedIds = new Set(studentSubjectIds(user));
    if (linkedIds.size === 0) return { students: [], courses: [], schedules: [] };
    const scopedCourses = courses.filter(course => [...relatedStudentIds([course])].some(id => linkedIds.has(id)));
    const courseIds = new Set(scopedCourses.map(course => course.id));
    const scopedSchedules = schedules.filter(schedule => courseIds.has(schedule.course_id || schedule.courseId)
      || [...relatedStudentIds([schedule])].some(id => linkedIds.has(id)));
    return { students: students.filter(student => linkedIds.has(student.id)), courses: scopedCourses, schedules: scopedSchedules };
  }
  return { students: students.slice(), courses: courses.slice(), schedules: schedules.slice() };
}

module.exports = {
  STAFF_MODULES,
  TEACHER_MODULES,
  STUDENT_MODULES,
  VISITOR_MODULES,
  isRetiredIdentity,
  canUserSubmitMiniappWrite,
  roleOf,
  permissionIdentityKey,
  accountExperiencePolicy,
  sanitizeCapabilitiesForIdentity,
  studentSubjectIds,
  businessCacheIdentityKey,
  createQuestionPaperTaskCacheRuntime,
  questionPaperTaskCacheKey,
  usesLimitedQuestionProjection,
  deriveAccess,
  scopeDashboardCollections,
};
