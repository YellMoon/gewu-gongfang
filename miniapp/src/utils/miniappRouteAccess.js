'use strict';

const ROUTE_MODULES = Object.freeze({
  'pages/schedule/index': 'scheduling',
  'pages/schedule/detail/index': 'scheduling',
  'pages/schedule/edit/index': 'scheduling',
  'pages/students/index': 'students',
  'pages/student-detail/index': 'students',
  'pages/courses/index': 'courses',
  'pages/teachers/index': 'teachers',
  'pages/payments/index': 'payments',
  'pages/stats/index': 'stats',
  'pages/question-bank/index': 'question-bank',
  'pages/question-paper/index': 'question-paper',
  'pages/assets/index': 'assets',
});

function normalizeRoute(path) {
  return String(path || '').replace(/^\/+/, '').split('?')[0];
}

function moduleForMiniappRoute(path) {
  return ROUTE_MODULES[normalizeRoute(path)] || null;
}

function canOpenMiniappRoute(path, access = {}) {
  const moduleId = moduleForMiniappRoute(path);
  if (!moduleId) return true;
  const role = String(access.role || 'visitor');
  const modules = Array.isArray(access.modules) ? access.modules : [];
  const capabilities = Array.isArray(access.capabilities) ? access.capabilities : [];
  if (moduleId === 'question-bank') return capabilities.includes('question-bank:view') || modules.includes(moduleId);
  if (moduleId === 'question-paper') {
    return ['super_admin', 'teacher'].includes(role)
      && (capabilities.includes('question-bank:view') || capabilities.includes('question-paper') || modules.includes('question-bank'));
  }
  if (moduleId === 'students' && (role === 'student' || role === 'family_member') && normalizeRoute(path) === 'pages/student-detail/index') return true;
  return modules.includes(moduleId);
}

module.exports = { canOpenMiniappRoute, moduleForMiniappRoute };
