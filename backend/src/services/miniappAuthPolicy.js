const { getLinkedStudentIds, parseArray, roleOf } = require('./miniappAccessPolicy');

const ALLOWED_MINIAPP_ROLES = new Set(['super_admin', 'admin', 'student']);

function isEnabled(value) {
  return value === 1 || value === true || value === '1' || value === 'true';
}

function getMiniappLoginDenialReason(user) {
  if (!user) return 'MINIAPP_USER_NOT_PREAUTHORIZED';
  if (user.review_status === 'pending' || roleOf(user) === 'pending') return 'USER_PENDING_REVIEW';
  if (user.deleted === 1 || user.deleted === true || user.status === 0) return 'MINIAPP_LOGIN_DISABLED';
  const role = roleOf(user);
  if (!ALLOWED_MINIAPP_ROLES.has(role)) return 'MINIAPP_ROLE_NOT_ALLOWED';
  if (!isEnabled(user.login_enabled)) return 'MINIAPP_LOGIN_DISABLED';
  if (role === 'student' && getLinkedStudentIds(user).length === 0) return 'MINIAPP_STUDENT_NOT_LINKED';
  return '';
}

function buildMiniappLoginUser(user = {}) {
  const role = roleOf(user);
  const linkedStudentIds = Array.from(new Set([
    ...parseArray(user.linked_student_ids),
    ...parseArray(user.linkedStudentIds),
    ...(user.student_id || user.studentId ? [user.student_id || user.studentId] : []),
  ].filter(Boolean).map(String)));
  const name = user.name || user.nickname || '';
  return {
    id: user.id,
    name,
    nickname: user.nickname || name,
    avatar: user.avatar || user.avatar_url || null,
    avatarUrl: user.avatar_url || user.avatar || null,
    phone: user.phone || null,
    role,
    user_type: role,
    student_id: user.student_id || user.studentId || null,
    linked_student_ids: linkedStudentIds,
  };
}

module.exports = {
  ALLOWED_MINIAPP_ROLES,
  buildMiniappLoginUser,
  getMiniappLoginDenialReason,
  isEnabled,
};
