const SUPER_ADMIN_PHONE = '13732250653';
const CANONICAL_SUPER_ADMIN_ID = 'miniapp-admin-13732250653';
const ROLES = Object.freeze(['super_admin', 'admin', 'teacher', 'student', 'visitor', 'pending']);

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value) {
  return isRecord(value) ? value : {};
}

function roleForUser(user) {
  user = asObject(user);
  const role = user.role || user.user_type;
  const hasPersistedId = user.id != null && String(user.id).trim() !== '';
  if (normalizePhone(user.phone) === SUPER_ADMIN_PHONE) {
    if (!hasPersistedId) return 'super_admin';
    const hasCanonicalIdentity = user.id === CANONICAL_SUPER_ADMIN_ID
      || user.is_super_admin_identity === 1 || user.is_super_admin_identity === true;
    const active = hasCanonicalIdentity
      && (user.deleted === 0 || user.deleted === false)
      && (user.status === 1 || user.status === true)
      && (user.login_enabled === 1 || user.login_enabled === true)
      && user.review_status === 'approved';
    return active ? 'super_admin' : 'pending';
  }
  if (role === 'super_admin') return 'pending';
  if (hasPersistedId) {
    const active = (user.deleted === 0 || user.deleted === false)
      && (user.status === 1 || user.status === true)
      && (user.login_enabled === 1 || user.login_enabled === true)
      && user.review_status === 'approved';
    if (!active) return 'pending';
  }
  return ROLES.includes(role) ? role : 'pending';
}

function activeRoleForUser(user) {
  user = asObject(user);
  const activeRole = user.activeRole || user.active_role || null;
  const eligibleRoles = Array.isArray(user.eligibleRoles)
    ? user.eligibleRoles
    : Array.isArray(user.eligible_roles) ? user.eligible_roles : null;
  if (!activeRole) return roleForUser(user);
  if (!eligibleRoles || !eligibleRoles.includes(activeRole)) return 'pending';
  return ROLES.includes(activeRole) ? activeRole : 'pending';
}

function canReviewUsers(user) {
  user = asObject(user);
  const hasCanonicalIdentity = user.id === CANONICAL_SUPER_ADMIN_ID
    || user.is_super_admin_identity === 1 || user.is_super_admin_identity === true;
  return hasCanonicalIdentity && activeRoleForUser(user) === 'super_admin';
}

function canReviewApplications(user) {
  return canReviewUsers(user);
}

function resolveTeacherBinding(user, teachers) {
  user = asObject(user);
  const phone = normalizePhone(user.phone);
  if (!phone) return { ok: false, code: 'TEACHER_NOT_FOUND' };

  const candidates = Array.isArray(teachers) ? teachers : [];
  const matches = candidates.filter(teacher => (
    isRecord(teacher)
    && teacher.deleted !== true
    && teacher.deleted !== 1
    && normalizePhone(teacher.phone) === phone
  ));

  if (matches.length === 0) return { ok: false, code: 'TEACHER_NOT_FOUND' };
  if (matches.length > 1) return { ok: false, code: 'TEACHER_PHONE_NOT_UNIQUE' };
  if (matches[0].id == null || String(matches[0].id).trim() === '') {
    return { ok: false, code: 'TEACHER_BINDING_INVALID' };
  }
  return { ok: true, teacherId: matches[0].id };
}

function scopeForUser(user) {
  user = asObject(user);
  const explicitActiveRole = user.activeRole || user.active_role || null;
  const eligibleRoles = Array.isArray(user.eligibleRoles)
    ? user.eligibleRoles
    : Array.isArray(user.eligible_roles) ? user.eligible_roles : null;
  if (explicitActiveRole && (!eligibleRoles || !eligibleRoles.includes(explicitActiveRole))) {
    return { kind: 'none' };
  }
  const role = explicitActiveRole || roleForUser(user);
  const teacherId = user.teacher_id || user.teacherId;
  const studentId = user.student_id || user.studentId;

  if (role === 'super_admin' || role === 'admin') return { kind: 'all' };
  if (role === 'visitor' && user.id != null && String(user.id).trim()) {
    return { kind: 'visitor', userId: String(user.id).trim() };
  }
  if (role === 'teacher' && teacherId) {
    return { kind: 'teacher', teacherId };
  }
  if (role === 'student' && studentId) {
    return { kind: 'student', studentId };
  }
  return { kind: 'none' };
}

function effectiveCapabilities(authz = {}, { gateway = false } = {}) {
  const role = authz.activeRole || authz.active_role
    ? activeRoleForUser(authz)
    : authz.role || roleForUser(authz);
  if (role === 'pending') return [];
  const capabilities = [];
  if (role === 'super_admin') capabilities.push('users:review');
  if ((['super_admin', 'admin'].includes(role) && authz.userApproved === true)
    || canReviewApplications(authz)) capabilities.push('applications:review');
  if (role === 'super_admin' || role === 'admin') capabilities.push('business:all');
  if (role === 'teacher') capabilities.push('business:teacher-scope');
  if (['super_admin', 'admin', 'teacher', 'student'].includes(role)) capabilities.push('question-bank:view');
  if (['super_admin', 'admin', 'teacher'].includes(role)) capabilities.push('question-bank:edit');
  if (!gateway && authz.isPrimaryHost === true && authz.tokenUse === 'desktop-session'
    && authz.deviceId && authz.deviceId === authz.tokenDeviceId && authz.userApproved === true) {
    capabilities.push('question-bank:delete-committed');
  }
  return capabilities;
}

module.exports = {
  SUPER_ADMIN_PHONE,
  CANONICAL_SUPER_ADMIN_ID,
  ROLES,
  normalizePhone,
  roleForUser,
  activeRoleForUser,
  canReviewApplications,
  canReviewUsers,
  resolveTeacherBinding,
  scopeForUser,
  effectiveCapabilities,
};
