const SUPER_ADMIN_PHONE = '13732250653';
const CANONICAL_SUPER_ADMIN_ID = 'miniapp-admin-13732250653';
const normalizePhone = phone => String(phone || '').replace(/\D/g, '');

function roleForUser(user = {}) {
  const role = user.user_type || user.role || 'pending';
  if (normalizePhone(user.phone) === SUPER_ADMIN_PHONE) {
    const canonical = user.id === CANONICAL_SUPER_ADMIN_ID || user.is_super_admin_identity === 1 || user.is_super_admin_identity === true;
    return canonical && role === 'super_admin' && user.status === 1 && user.login_enabled === 1 && user.review_status === 'approved' ? 'super_admin' : 'pending';
  }
  return role === 'super_admin' ? 'pending' : ['admin', 'teacher', 'student', 'pending'].includes(role) ? role : 'pending';
}
function canReviewUsers(user = {}) {
  const canonical = user.id === CANONICAL_SUPER_ADMIN_ID || user.is_super_admin_identity === 1 || user.is_super_admin_identity === true;
  return canonical && roleForUser(user) === 'super_admin';
}
function effectiveCapabilities(authz = {}) {
  const role = authz.role || roleForUser(authz);
  if (role === 'pending') return [];
  const result = [];
  if (role === 'super_admin') result.push('users:review');
  if (['super_admin', 'admin'].includes(role)) result.push('business:all');
  if (role === 'teacher') result.push('business:teacher-scope');
  if (['super_admin', 'admin', 'teacher', 'student'].includes(role)) result.push('question-bank:view');
  if (['super_admin', 'admin', 'teacher'].includes(role)) result.push('question-bank:edit');
  return result;
}
module.exports = { SUPER_ADMIN_PHONE, CANONICAL_SUPER_ADMIN_ID, normalizePhone, roleForUser, canReviewUsers, effectiveCapabilities };
