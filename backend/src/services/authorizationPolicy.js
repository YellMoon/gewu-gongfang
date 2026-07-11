const SUPER_ADMIN_PHONE = '13732250653';
const ROLES = Object.freeze(['super_admin', 'admin', 'teacher', 'student', 'pending']);

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function roleForUser(user = {}) {
  if (normalizePhone(user.phone) === SUPER_ADMIN_PHONE) return 'super_admin';

  const role = user.role || user.user_type;
  return ROLES.includes(role) ? role : 'pending';
}

function canReviewUsers(user) {
  return roleForUser(user) === 'super_admin';
}

function resolveTeacherBinding(user = {}, teachers = []) {
  const phone = normalizePhone(user.phone);
  const matches = teachers.filter(teacher => (
    teacher.deleted !== true
    && teacher.deleted !== 1
    && normalizePhone(teacher.phone) === phone
  ));

  if (matches.length === 0) return { ok: false, code: 'TEACHER_NOT_FOUND' };
  if (matches.length > 1) return { ok: false, code: 'TEACHER_PHONE_NOT_UNIQUE' };
  return { ok: true, teacherId: matches[0].id };
}

function scopeForUser(user = {}) {
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
  ROLES,
  normalizePhone,
  roleForUser,
  canReviewUsers,
  resolveTeacherBinding,
  scopeForUser,
};
