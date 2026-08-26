'use strict';

function resolveTabBarState(access = {}) {
  const role = String(access.role || 'visitor');
  const modules = Array.isArray(access.modules) ? access.modules : [];
  if (role === 'visitor' || modules.length === 0) {
    return { userType: 'visitor', navigationMode: 'visitor' };
  }
  return { userType: role, navigationMode: 'formal' };
}

module.exports = { resolveTabBarState };
