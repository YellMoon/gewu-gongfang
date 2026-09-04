'use strict';

function selectDesktopBusinessAccount({ directAccount, phoneAccount }) {
  return phoneAccount || directAccount || null;
}

function desktopSessionRoles(roles) {
  if (!Array.isArray(roles)) return Object.freeze([]);
  return Object.freeze(['super_admin', 'teacher'].filter(role => roles.includes(role)));
}

module.exports = Object.freeze({ selectDesktopBusinessAccount, desktopSessionRoles });
