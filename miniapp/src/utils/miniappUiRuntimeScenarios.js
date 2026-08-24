'use strict';

const REQUIRED_COVERAGE_CATEGORIES = Object.freeze([
  'admin-path',
  'student-path',
  'empty',
  'offline',
  'permission-denied',
  'limited-write',
  'guest',
  'visitor',
  'unrecognized-student',
]);

function scenario(id, route, roleView, identity, state, expectedText, categories, fixtureMode = 'empty') {
  return Object.freeze({ id, route, roleView, identity, state, expectedText, categories: Object.freeze(categories), fixtureMode });
}

const runtimeScenarios = Object.freeze([
  scenario('login-guest', 'pages/login/index', 'guest', 'guest', 'cloud-login', '首次登录', ['guest']),
  scenario('privacy-guest', 'pages/login/privacy', 'guest', 'guest', 'privacy-content', '隐私保护指引', ['guest']),
  scenario('desktop-registration-guest', 'pages/desktop-online-registration/index', 'guest', 'guest', 'scan-code', '扫描电脑二维码', ['guest']),
  scenario('home-super-admin', 'pages/index/index', 'super_admin', 'super_admin', 'admin-dashboard', '运营面板', ['admin-path']),
  scenario('home-student', 'pages/index/index', 'student', 'student', 'student-dashboard', '学习面板', ['student-path']),
  scenario('home-visitor', 'pages/index/index', 'visitor', 'visitor', 'empty-modules', '访客', ['visitor']),
  scenario('home-unrecognized', 'pages/index/index', 'unrecognized-student', 'unrecognized', 'unrecognized-account', '四道示例题', ['unrecognized-student']),
  scenario('schedule-admin-empty', 'pages/schedule/index', 'admin', 'admin', 'empty-day', '暂无排课数据', ['admin-path', 'empty']),
  scenario('schedule-student-empty', 'pages/schedule/index', 'student', 'student', 'empty-day', '暂无排课数据', ['student-path', 'empty']),
  scenario('schedule-unrecognized-empty', 'pages/schedule/index', 'unrecognized-student', 'unrecognized', 'unrecognized-empty', '当前账号暂无已授权的课程投影', ['unrecognized-student', 'empty']),
  scenario('schedule-detail-admin-missing', 'pages/schedule/detail/index', 'admin', 'admin', 'missing-record', '未找到排课记录', ['admin-path', 'empty']),
  scenario('schedule-detail-student-missing', 'pages/schedule/detail/index', 'student', 'student', 'missing-record', '未找到排课记录', ['student-path', 'empty']),
  scenario('schedule-edit-admin-boundary', 'pages/schedule/edit/index', 'admin', 'admin', 'miniapp-readonly-boundary', '不提供排课新增和编辑', ['admin-path', 'limited-write']),
  scenario('schedule-edit-student-boundary', 'pages/schedule/edit/index', 'student', 'student', 'miniapp-readonly-boundary', '不提供排课新增和编辑', ['student-path', 'limited-write']),
  scenario('students-admin-empty', 'pages/students/index', 'admin', 'admin', 'empty', '暂无学生数据', ['admin-path', 'empty']),
  scenario('students-teacher-empty', 'pages/students/index', 'teacher', 'teacher', 'empty', '暂无学生数据', ['admin-path', 'empty']),
  scenario('student-detail-admin-missing', 'pages/student-detail/index', 'admin', 'admin', 'missing-student', '未找到该学生信息', ['admin-path', 'empty']),
  scenario('student-detail-student-missing', 'pages/student-detail/index', 'student', 'student', 'missing-student', '未找到该学生信息', ['student-path', 'empty']),
  scenario('courses-admin-empty', 'pages/courses/index', 'admin', 'admin', 'empty', '暂无课程', ['admin-path', 'empty']),
  scenario('courses-teacher-empty', 'pages/courses/index', 'teacher', 'teacher', 'empty', '暂无课程', ['admin-path', 'empty']),
  scenario('teachers-admin-empty', 'pages/teachers/index', 'admin', 'admin', 'empty', '暂无教师数据', ['admin-path', 'empty']),
  scenario('teachers-teacher-empty', 'pages/teachers/index', 'teacher', 'teacher', 'empty', '暂无教师数据', ['admin-path', 'empty']),
  scenario('payments-admin-empty', 'pages/payments/index', 'admin', 'admin', 'empty', '暂无缴费记录', ['admin-path', 'empty']),
  scenario('stats-admin-empty', 'pages/stats/index', 'admin', 'admin', 'empty', '暂无完成课程数据', ['admin-path', 'empty']),
  scenario('question-super-admin-empty', 'pages/question-bank/index', 'super_admin', 'super_admin', 'preview-empty', '云端暂无可用题目', ['admin-path', 'empty'], 'question-empty'),
  scenario('question-student-empty', 'pages/question-bank/index', 'student', 'student', 'preview-empty', '云端暂无可用题目', ['student-path', 'empty'], 'question-empty'),
  scenario('question-student-offline', 'pages/question-bank/index', 'student', 'student', 'preview-offline', '离线或云端不可达', ['student-path', 'offline'], 'question-offline'),
  scenario('question-student-forbidden', 'pages/question-bank/index', 'student', 'student', 'preview-forbidden', '当前账号无权读取题库', ['student-path', 'permission-denied'], 'question-forbidden'),
  scenario('question-unrecognized', 'pages/question-bank/index', 'unrecognized-student', 'unrecognized', 'four-sample-experience', '体验组卷', ['unrecognized-student', 'limited-write']),
  scenario('assets-admin-import', 'pages/assets/index', 'admin', 'admin', 'import-task', '导入财务数据', ['admin-path', 'limited-write']),
  scenario('settings-admin-online', 'pages/settings/index', 'admin', 'admin', 'online', '在线', ['admin-path']),
  scenario('settings-student-online', 'pages/settings/index', 'student', 'student', 'online', '在线', ['student-path']),
  scenario('settings-unrecognized', 'pages/settings/index', 'unrecognized-student', 'unrecognized', 'unrecognized-account-application', '未识别学生', ['unrecognized-student']),
  scenario('admin-users-super-admin', 'pages/admin/users/index', 'super_admin', 'super_admin', 'pending-review', '待审核用户', ['admin-path'], 'users-one'),
  scenario('admin-users-admin-readonly', 'pages/admin/users/index', 'admin', 'admin', 'ordinary-admin-read-only', '普通管理员可查看脱敏用户状态', ['admin-path', 'permission-denied'], 'users-one'),
  scenario('forbidden-student', 'pages/forbidden/index', 'student', 'student', 'blocked-module', '暂无权限访问此功能', ['student-path', 'permission-denied']),
  scenario('unrecognized-welcome', 'pages/unrecognized-experience/index', 'unrecognized-student', 'unrecognized', 'welcome', '体验组卷', ['unrecognized-student']),
  scenario('application-visitor', 'pages/account-application/index', 'visitor', 'visitor', 'not-submitted', '提交角色申请', ['visitor']),
  scenario('application-visitor-offline', 'pages/account-application/index', 'visitor', 'visitor', 'network-error', '网络', ['visitor', 'offline'], 'application-offline'),
  scenario('cloud-account-super-admin-empty', 'pages/cloud-account-admin/index', 'super_admin', 'super_admin', 'empty', '当前没有待授权账号', ['admin-path', 'empty']),
]);

module.exports = Object.freeze({ REQUIRED_COVERAGE_CATEGORIES, runtimeScenarios });
