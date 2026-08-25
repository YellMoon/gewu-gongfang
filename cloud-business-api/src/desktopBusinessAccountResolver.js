'use strict';

function selectDesktopBusinessAccount({ directAccount, phoneAccount }) {
  return phoneAccount || directAccount || null;
}

function desktopSessionRoles(roles) {
  if (!Array.isArray(roles)) return Object.freeze(['visitor']);
  if (roles.includes('super_admin')) return Object.freeze(['super_admin']);
  if (roles.includes('teacher')) return Object.freeze(['teacher']);
  return Object.freeze(['visitor']);
}

module.exports = Object.freeze({ selectDesktopBusinessAccount, desktopSessionRoles });
