'use strict';

function cleanLabel(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getMiniappHomeDisplayName(identity) {
  return cleanLabel(identity?.name)
    || cleanLabel(identity?.nickname)
    || '\u5fae\u4fe1\u7528\u6237';
}

function getMiniappHomeRoleLabel(identityOrRole) {
  const identity = identityOrRole && typeof identityOrRole === 'object' ? identityOrRole : null;
  const normalizedRole = cleanLabel(identity ? (identity.user_type || identity.role) : identityOrRole);
  if (normalizedRole === 'student' && (identity?.identity_kind === 'family_member' || identity?.student_relationship === 'guardian')) {
    return String.fromCharCode(0x5bb6, 0x5ead, 0x6210, 0x5458);
  }
  const labels = {
    super_admin: '\u8d85\u7ea7\u7ba1\u7406\u5458',
    teacher: '\u6559\u5e08',
    student: '\u5b66\u751f',
    visitor: '',
  };
  return Object.hasOwn(labels, normalizedRole) ? labels[normalizedRole] : normalizedRole;
}

module.exports = { getMiniappHomeDisplayName, getMiniappHomeRoleLabel };
