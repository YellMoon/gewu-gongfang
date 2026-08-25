'use strict';

const REQUIRED_COVERAGE_CATEGORIES = Object.freeze([
  'super-admin-path',
  'student-path',
  'empty',
  'offline',
  'permission-denied',
  'limited-write',
  'guest',
  'visitor',
]);

function scenario(id, route, roleView, identity, state, expectedText, categories, fixtureMode = 'empty') {
  return Object.freeze({ id, route, roleView, identity, state, expectedText, categories: Object.freeze(categories), fixtureMode });
}

const runtimeScenarios = Object.freeze([
  scenario('login-guest', 'pages/login/index', 'guest', 'guest', 'cloud-login', '首次登录', ['guest']),
  scenario('privacy-guest', 'pages/login/privacy', 'guest', 'guest', 'privacy-content', '隐私保护指引', ['guest']),
  scenario('home-super-admin', 'pages/index/index', 'super_admin', 'super_admin', 'super-admin-dashboard', '运营面板', ['super-admin-path']),
  scenario('home-student', 'pages/index/index', 'student', 'student', 'student-dashboard', '学习面板', ['student-path']),
  scenario('home-visitor', 'pages/index/index', 'visitor', 'visitor', 'empty-modules', '访客', ['visitor']),
  scenario('schedule-super-admin-empty', 'pages/schedule/index', 'super_admin', 'super_admin', 'empty-day', '暂无排课数据', ['super-admin-path', 'empty']),
  scenario('schedule-student-empty', 'pages/schedule/index', 'student', 'student', 'empty-day', '暂无排课数据', ['student-path', 'empty']),
  scenario('schedule-detail-super-admin-missing', 'pages/schedule/detail/index', 'super_admin', 'super_admin', 'missing-record', '未找到排课记录', ['super-admin-path', 'empty']),
  scenario('schedule-detail-student-missing', 'pages/schedule/detail/index', 'student', 'student', 'missing-record', '未找到排课记录', ['student-path', 'empty']),
  scenario('schedule-edit-super-admin-boundary', 'pages/schedule/edit/index', 'super_admin', 'super_admin', 'miniapp-readonly-boundary', '不提供排课新增和编辑', ['super-admin-path', 'limited-write']),
  scenario('schedule-edit-student-boundary', 'pages/schedule/edit/index', 'student', 'student', 'miniapp-readonly-boundary', '不提供排课新增和编辑', ['student-path', 'limited-write']),
  scenario('students-super-admin-empty', 'pages/students/index', 'super_admin', 'super_admin', 'empty', '暂无学生数据', ['super-admin-path', 'empty']),
  scenario('students-teacher-empty', 'pages/students/index', 'teacher', 'teacher', 'empty', '暂无学生数据', ['super-admin-path', 'empty']),
  scenario('student-detail-super-admin-missing', 'pages/student-detail/index', 'super_admin', 'super_admin', 'missing-student', '未找到该学生信息', ['super-admin-path', 'empty']),
  scenario('student-detail-student-missing', 'pages/student-detail/index', 'student', 'student', 'missing-student', '未找到该学生信息', ['student-path', 'empty']),
  scenario('courses-super-admin-empty', 'pages/courses/index', 'super_admin', 'super_admin', 'empty', '暂无课程', ['super-admin-path', 'empty']),
  scenario('courses-teacher-empty', 'pages/courses/index', 'teacher', 'teacher', 'empty', '暂无课程', ['super-admin-path', 'empty']),
  scenario('teachers-super-admin-empty', 'pages/teachers/index', 'super_admin', 'super_admin', 'empty', '暂无教师数据', ['super-admin-path', 'empty']),
  scenario('teachers-teacher-empty', 'pages/teachers/index', 'teacher', 'teacher', 'empty', '暂无教师数据', ['super-admin-path', 'empty']),
  scenario('payments-super-admin-empty', 'pages/payments/index', 'super_admin', 'super_admin', 'empty', '暂无缴费记录', ['super-admin-path', 'empty']),
  scenario('stats-super-admin-empty', 'pages/stats/index', 'super_admin', 'super_admin', 'empty', '暂无完成课程数据', ['super-admin-path', 'empty']),
  scenario('question-super-admin-empty', 'pages/question-bank/index', 'super_admin', 'super_admin', 'preview-empty', '云端暂无可用题目', ['super-admin-path', 'empty'], 'question-empty'),
  scenario('question-student-empty', 'pages/question-bank/index', 'student', 'student', 'preview-empty', '云端暂无可用题目', ['student-path', 'empty'], 'question-empty'),
  scenario('question-student-offline', 'pages/question-bank/index', 'student', 'student', 'preview-offline', '离线或云端不可达', ['student-path', 'offline'], 'question-offline'),
  scenario('question-student-forbidden', 'pages/question-bank/index', 'student', 'student', 'preview-forbidden', '题库权限', ['student-path', 'permission-denied'], 'question-forbidden'),
  scenario('question-visitor-preview', 'pages/question-bank/index', 'visitor', 'visitor', 'visitor-preview', '题目预览', ['visitor', 'limited-write']),
  scenario('assets-super-admin-import', 'pages/assets/index', 'super_admin', 'super_admin', 'import-task', '导入财务数据', ['super-admin-path', 'limited-write']),
  scenario('settings-super-admin-online', 'pages/settings/index', 'super_admin', 'super_admin', 'online', '网络已连接', ['super-admin-path']),
  scenario('settings-super-admin-role-review', 'pages/settings/index', 'super_admin', 'super_admin', 'role-application-review', '身份申请处理', ['super-admin-path', 'limited-write'], 'role-applications'),
  scenario('settings-student-online', 'pages/settings/index', 'student', 'student', 'online', '网络已连接', ['student-path']),
  scenario('settings-visitor', 'pages/settings/index', 'visitor', 'visitor', 'visitor-account-application', '申请教师或学生身份', ['visitor']),
  scenario('forbidden-student', 'pages/forbidden/index', 'student', 'student', 'blocked-module', '暂无权限访问此功能', ['student-path', 'permission-denied']),
  scenario('application-visitor', 'pages/account-application/index', 'visitor', 'visitor', 'not-submitted', '提交申请', ['visitor']),
  scenario('application-visitor-offline', 'pages/account-application/index', 'visitor', 'visitor', 'network-error', '网络', ['visitor', 'offline'], 'application-offline'),
]);

module.exports = Object.freeze({ REQUIRED_COVERAGE_CATEGORIES, runtimeScenarios });
