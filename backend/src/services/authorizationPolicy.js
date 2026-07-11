const SUPER_ADMIN_PHONE = '13732250653';
const CANONICAL_SUPER_ADMIN_ID = 'miniapp-admin-13732250653';
const ROLES = Object.freeze(['super_admin', 'admin', 'teacher', 'student', 'pending']);

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
    const active = user.id === CANONICAL_SUPER_ADMIN_ID
      && (user.deleted === 0 || user.deleted === false)
      && (user.status === 1 || user.status === true)
      && (user.login_enabled === 1 || user.login_enabled === true)
      && user.review_status === 'approved';
    return active ? 'super_admin' : 'pending';
  }
  if (role === 'super_admin') return 'pending';
  return ROLES.includes(role) ? role : 'pending';
}

function canReviewUsers(user) {
  user = asObject(user);
  return user.id === CANONICAL_SUPER_ADMIN_ID && roleForUser(user) === 'super_admin';
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
  const role = roleForUser(user);

  if (role === 'super_admin' || role === 'admin') return { kind: 'all' };
  if (role === 'teacher' && user.teacher_id) {
    return { kind: 'teacher', teacherId: user.teacher_id };
  }
  if (role === 'student' && user.student_id) {
    return { kind: 'student', studentId: user.student_id };
  }
  return { kind: 'none' };
}

module.exports = {
  SUPER_ADMIN_PHONE,
  CANONICAL_SUPER_ADMIN_ID,
  ROLES,
  normalizePhone,
  roleForUser,
  canReviewUsers,
  resolveTeacherBinding,
  scopeForUser,
};
