'use strict';

function selectDesktopBusinessAccount({ directAccount, phoneAccount }) {
  return phoneAccount || directAccount || null;
}

function desktopSessionRoles(roles) {
  if (!Array.isArray(roles)) return Object.freeze(['pending']);
  if (roles.includes('super_admin')) return Object.freeze(['super_admin']);
  const selected = roles.filter(role => role === 'teacher' || role === 'student');
  return Object.freeze(selected.length ? [...new Set(selected)] : ['pending']);
}

module.exports = Object.freeze({ selectDesktopBusinessAccount, desktopSessionRoles });
