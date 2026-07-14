const SUPER_ADMIN_PHONE = '13732250653';
const CANONICAL_SUPER_ADMIN_ID = 'miniapp-admin-13732250653';
const normalizePhone = phone => String(phone || '').replace(/\D/g, '');

function roleForUser(user = {}) {
  const role = user.user_type || user.role || 'pending';
  if (normalizePhone(user.phone) === SUPER_ADMIN_PHONE) {
    const canonical = user.id === CANONICAL_SUPER_ADMIN_ID || user.is_super_admin_identity === 1 || user.is_super_admin_identity === true;
    return canonical && role === 'super_admin' && user.status === 1 && user.login_enabled === 1 && user.review_status === 'approved' ? 'super_admin' : 'pending';
  }
  if (role === 'super_admin' || !['admin', 'teacher', 'student'].includes(role)) return 'pending';
  return isApprovedActive(user) ? role : 'pending';
}
function canReviewUsers(user = {}) {
  const canonical = user.id === CANONICAL_SUPER_ADMIN_ID || user.is_super_admin_identity === 1 || user.is_super_admin_identity === true;
  return canonical && roleForUser(user) === 'super_admin';
}
function resolveTeacherBinding(user = {}, teachers = []) {
  const phone = normalizePhone(user.phone);
  if (!phone) return { ok: false, code: 'TEACHER_NOT_FOUND' };
  const matches = (Array.isArray(teachers) ? teachers : []).filter(teacher => teacher
    && teacher.deleted !== true && teacher.deleted !== 1
    && normalizePhone(teacher.phone) === phone);
  if (matches.length === 0) return { ok: false, code: 'TEACHER_NOT_FOUND' };
  if (matches.length > 1) return { ok: false, code: 'TEACHER_PHONE_NOT_UNIQUE' };
  if (matches[0].id == null || String(matches[0].id).trim() === '') return { ok: false, code: 'TEACHER_BINDING_INVALID' };
  return { ok: true, teacherId: matches[0].id };
}
function isApprovedActive(authz = {}) {
  const reviewStatus = authz.reviewStatus ?? authz.review_status;
  const loginEnabled = authz.loginEnabled ?? authz.login_enabled;
  return reviewStatus === 'approved' && authz.status === 1 && loginEnabled === 1;
}
function effectiveCapabilities(authz = {}) {
  const role = authz.role || roleForUser(authz);
  if (role === 'pending' || !isApprovedActive(authz)) return [];
  if (authz.isReviewDemo === true || authz.is_review_demo === true) {
    if (authz.readOnly !== true && authz.read_only !== true) return [];
    if (!['admin', 'student'].includes(role)) return [];
    return ['review-demo:read', `review-demo:${role}`, 'question-bank:view', 'review-demo:paper-export'];
  }
  const result = [];
  if (role === 'super_admin') result.push('users:review');
  if (['super_admin', 'admin'].includes(role)) result.push('business:all');
  if (role === 'teacher') result.push('business:teacher-scope');
  if (['super_admin', 'admin', 'teacher', 'student'].includes(role)) result.push('question-bank:view');
  if (['super_admin', 'admin', 'teacher'].includes(role)) result.push('question-bank:edit');
  return result;
}
module.exports = { SUPER_ADMIN_PHONE, CANONICAL_SUPER_ADMIN_ID, normalizePhone, roleForUser, canReviewUsers, resolveTeacherBinding, isApprovedActive, effectiveCapabilities };
