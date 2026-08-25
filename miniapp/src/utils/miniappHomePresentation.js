'use strict';

function cleanLabel(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getMiniappHomeDisplayName(identity) {
  return cleanLabel(identity?.name)
    || cleanLabel(identity?.nickname)
    || '\u5fae\u4fe1\u7528\u6237';
}

function getMiniappHomeRoleLabel(role) {
  const normalizedRole = cleanLabel(role);
  const labels = {
    super_admin: '\u8d85\u7ea7\u7ba1\u7406\u5458',
    teacher: '\u6559\u5e08',
    student: '\u5b66\u751f',
    visitor: '\u8bbf\u5ba2',
  };
  return labels[normalizedRole] || normalizedRole;
}

module.exports = { getMiniappHomeDisplayName, getMiniappHomeRoleLabel };
