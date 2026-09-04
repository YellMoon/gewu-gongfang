'use strict';

const REQUIRED_COVERAGE_CATEGORIES = Object.freeze([
  'super-admin-path',
  'teacher-path',
  'student-path',
  'family-member-path',
  'empty',
  'offline',
  'permission-denied',
  'limited-write',
  'guest',
  'visitor',
]);

function scenario(id, route, roleView, identity, state, expectedText, categories, fixtureMode = 'empty', interaction = '') {
  return Object.freeze({ id, route, roleView, identity, state, expectedText, categories: Object.freeze(categories), fixtureMode, interaction });
}

const scenarioTemplates = [
  scenario('login-guest', 'pages/login/index', 'guest', 'guest', 'cloud-login', '手机号快捷登录', ['guest']),
  scenario('desktop-login-confirmation', 'pages/login/index', 'guest', 'guest', 'desktop-login-confirmation', '确认登录', ['guest']),
  scenario('privacy-guest', 'pages/login/privacy', 'guest', 'guest', 'privacy-content', '隐私保护指引', ['guest'], 'empty', 'tap-privacy-link'),
  scenario('home-super-admin', 'pages/index/index', 'super_admin', 'super_admin', 'super-admin-dashboard', '运营面板', ['super-admin-path']),
  scenario('home-teacher', 'pages/index/index', 'teacher', 'teacher', 'teacher-dashboard', String.fromCharCode(25945, 23398, 38754, 26495), ['teacher-path']),
  scenario('home-student', 'pages/index/index', 'student', 'student', 'student-dashboard', '学习面板', ['student-path']),
  scenario('home-guardian', 'pages/index/index', 'student', 'guardian', 'student-dashboard', '学习面板', ['student-path']),
  scenario('home-visitor', 'pages/index/index', 'visitor', 'visitor', 'empty-modules', '可用功能', ['visitor']),
  scenario('schedule-super-admin-empty', 'pages/schedule/index', 'super_admin', 'super_admin', 'empty-day', '暂无排课数据', ['super-admin-path', 'empty']),
  scenario('schedule-teacher-empty', 'pages/schedule/index', 'teacher', 'teacher', 'empty-day', '暂无排课数据', ['teacher-path', 'empty']),
  scenario('schedule-student-empty', 'pages/schedule/index', 'student', 'student', 'empty-day', '暂无排课数据', ['student-path', 'empty']),
  scenario('schedule-guardian-empty', 'pages/schedule/index', 'student', 'guardian', 'empty-day', '暂无排课数据', ['student-path', 'empty']),
  scenario('schedule-visitor-empty', 'pages/schedule/index', 'visitor', 'visitor', 'visitor-empty', '暂无课程安排', ['visitor', 'empty']),
  scenario('schedule-detail-super-admin-missing', 'pages/schedule/detail/index', 'super_admin', 'super_admin', 'missing-record', '未找到排课记录', ['super-admin-path', 'empty']),
  scenario('schedule-detail-teacher-missing', 'pages/schedule/detail/index', 'teacher', 'teacher', 'missing-record', '未找到排课记录', ['teacher-path', 'empty']),
  scenario('schedule-detail-student-missing', 'pages/schedule/detail/index', 'student', 'student', 'missing-record', '未找到排课记录', ['student-path', 'empty']),
  scenario('student-detail-guardian-missing', 'pages/student-detail/index', 'student', 'guardian', 'missing-student', '未找到该学生信息', ['student-path', 'empty']),
  scenario('schedule-edit-super-admin-boundary', 'pages/schedule/edit/index', 'super_admin', 'super_admin', 'miniapp-readonly-boundary', '不提供排课新增和编辑', ['super-admin-path', 'limited-write']),
  scenario('schedule-edit-teacher-boundary', 'pages/schedule/edit/index', 'teacher', 'teacher', 'miniapp-readonly-boundary', '不提供排课新增和编辑', ['teacher-path', 'limited-write']),
  scenario('schedule-edit-student-boundary', 'pages/schedule/edit/index', 'student', 'student', 'miniapp-readonly-boundary', '不提供排课新增和编辑', ['student-path', 'limited-write']),
  scenario('students-super-admin-empty', 'pages/students/index', 'super_admin', 'super_admin', 'empty', '暂无学生数据', ['super-admin-path', 'empty']),
  scenario('students-teacher-empty', 'pages/students/index', 'teacher', 'teacher', 'empty', '暂无学生数据', ['teacher-path', 'empty']),
  scenario('student-detail-super-admin-missing', 'pages/student-detail/index', 'super_admin', 'super_admin', 'missing-student', '未找到该学生信息', ['super-admin-path', 'empty']),
  scenario('student-detail-teacher-missing', 'pages/student-detail/index', 'teacher', 'teacher', 'missing-student', '未找到该学生信息', ['teacher-path', 'empty']),
  scenario('student-detail-student-missing', 'pages/student-detail/index', 'student', 'student', 'missing-student', '未找到该学生信息', ['student-path', 'empty']),
  scenario('courses-super-admin-empty', 'pages/courses/index', 'super_admin', 'super_admin', 'empty', '暂无课程', ['super-admin-path', 'empty']),
  scenario('courses-teacher-empty', 'pages/courses/index', 'teacher', 'teacher', 'empty', '暂无课程', ['teacher-path', 'empty']),
  scenario('teachers-super-admin-empty', 'pages/teachers/index', 'super_admin', 'super_admin', 'empty', '暂无教师数据', ['super-admin-path', 'empty']),
  scenario('teachers-teacher-empty', 'pages/teachers/index', 'teacher', 'teacher', 'empty', '暂无教师数据', ['teacher-path', 'empty']),
  scenario('payments-super-admin-empty', 'pages/payments/index', 'super_admin', 'super_admin', 'empty', '暂无缴费记录', ['super-admin-path', 'empty']),
  scenario('payments-teacher-empty', 'pages/payments/index', 'teacher', 'teacher', 'empty', '暂无缴费记录', ['teacher-path', 'empty']),
  scenario('stats-super-admin-empty', 'pages/stats/index', 'super_admin', 'super_admin', 'empty', '暂无完成课程数据', ['super-admin-path', 'empty']),
  scenario('stats-teacher-empty', 'pages/stats/index', 'teacher', 'teacher', 'empty', '暂无完成课程数据', ['teacher-path', 'empty']),
  scenario('question-super-admin-empty', 'pages/question-bank/index', 'super_admin', 'super_admin', 'preview-empty', '题库中暂无题目', ['super-admin-path', 'empty'], 'question-empty'),
  scenario('question-teacher-empty', 'pages/question-bank/index', 'teacher', 'teacher', 'preview-empty', '题库中暂无题目', ['teacher-path', 'empty'], 'question-empty'),
  scenario('question-student-empty', 'pages/question-bank/index', 'student', 'student', 'preview-empty', '题库中暂无题目', ['student-path', 'empty'], 'question-empty'),
  scenario('question-guardian-empty', 'pages/question-bank/index', 'student', 'guardian', 'preview-empty', '题库中暂无题目', ['student-path', 'empty'], 'question-empty'),
  scenario('question-student-offline', 'pages/question-bank/index', 'student', 'student', 'preview-offline', '暂时无法加载题库', ['student-path', 'offline'], 'question-offline'),
  scenario('question-student-forbidden', 'pages/question-bank/index', 'student', 'student', 'preview-forbidden', '当前账号暂无题库访问权限', ['student-path', 'permission-denied'], 'question-forbidden'),
  scenario('question-visitor-preview', 'pages/question-bank/index', 'visitor', 'visitor', 'visitor-preview', '加入试题篮', ['visitor']),
  scenario('question-super-admin-rich', 'pages/question-bank/index', 'super_admin', 'super_admin', 'preview-rich', '来源：格物工坊·力学基础测试', ['super-admin-path'], 'question-rich'),
  scenario('question-teacher-rich-basket', 'pages/question-bank/index', 'teacher', 'teacher', 'preview-rich', '进入组卷', ['teacher-path', 'limited-write'], 'question-rich', 'open-first-question-basket'),
  scenario('question-student-rich', 'pages/question-bank/index', 'student', 'student', 'preview-rich', '加入试题篮', ['student-path'], 'question-rich'),
  scenario('question-visitor-rich-answer', 'pages/question-bank/index', 'visitor', 'visitor', 'visitor-preview', '收起答案与解析', ['visitor'], 'question-rich', 'expand-first-answer'),
  scenario('question-paper-super-admin-empty', 'pages/question-paper/index', 'super_admin', 'super_admin', 'paper-editor-empty', '\u8bd5\u9898\u7bee\u4e2d\u6682\u65e0\u9898\u76ee', ['super-admin-path', 'empty'], 'question-paper-empty'),
  scenario('question-paper-teacher-empty', 'pages/question-paper/index', 'teacher', 'teacher', 'paper-editor-empty', '\u8bd5\u9898\u7bee\u4e2d\u6682\u65e0\u9898\u76ee', ['teacher-path', 'empty'], 'question-paper-empty'),
  scenario('assets-super-admin-import', 'pages/assets/index', 'super_admin', 'super_admin', 'import-task', '导入财务数据', ['super-admin-path', 'limited-write']),
  scenario('assets-teacher-import', 'pages/assets/index', 'teacher', 'teacher', 'import-task', '导入财务数据', ['teacher-path', 'limited-write']),
  scenario('settings-super-admin-online', 'pages/settings/index', 'super_admin', 'super_admin', 'online', '网络已连接', ['super-admin-path']),
  scenario('settings-teacher-online', 'pages/settings/index', 'teacher', 'teacher', 'online', '网络已连接', ['teacher-path']),
  scenario('settings-student-online', 'pages/settings/index', 'student', 'student', 'online', '网络已连接', ['student-path']),
  scenario('settings-guardian-online', 'pages/settings/index', 'student', 'guardian', 'online', '网络已连接', ['student-path']),
  scenario('settings-visitor', 'pages/settings/index', 'visitor', 'visitor', 'visitor-account-application', String.fromCharCode(30003, 35831, 35282, 33394), ['visitor']),
  scenario('forbidden-super-admin', 'pages/forbidden/index', 'super_admin', 'super_admin', 'blocked-module', '暂无权限访问此功能', ['super-admin-path', 'permission-denied']),
  scenario('forbidden-teacher', 'pages/forbidden/index', 'teacher', 'teacher', 'blocked-module', '暂无权限访问此功能', ['teacher-path', 'permission-denied']),
  scenario('forbidden-student', 'pages/forbidden/index', 'student', 'student', 'blocked-module', '暂无权限访问此功能', ['student-path', 'permission-denied']),
  scenario('forbidden-visitor', 'pages/forbidden/index', 'visitor', 'visitor', 'blocked-module', '暂无权限访问此功能', ['visitor', 'permission-denied']),
  scenario('application-visitor', 'pages/account-application/index', 'visitor', 'visitor', 'not-submitted', '提交申请', ['visitor']),
  scenario('application-visitor-offline', 'pages/account-application/index', 'visitor', 'visitor', 'network-error', '网络', ['visitor', 'offline'], 'application-offline'),
];

const familyMemberScenarios = [
  scenario('schedule-detail-family-member-missing', 'pages/schedule/detail/index', 'family_member', 'guardian', 'missing-record', String.fromCharCode(26410, 25214, 21040, 25490, 35838, 35760, 24405), ['family-member-path', 'empty']),
  scenario('schedule-edit-family-member-boundary', 'pages/schedule/edit/index', 'family_member', 'guardian', 'miniapp-readonly-boundary', String.fromCharCode(19981, 25552, 20379, 25490, 35838, 26032, 22686, 21644, 32534, 36753), ['family-member-path', 'limited-write']),
  scenario('question-family-member-rich', 'pages/question-bank/index', 'family_member', 'guardian', 'preview-rich', String.fromCharCode(21152, 20837, 35797, 39064, 31726), ['family-member-path'], 'question-rich'),
  scenario('forbidden-family-member', 'pages/forbidden/index', 'family_member', 'guardian', 'blocked-module', String.fromCharCode(26242, 26080, 26435, 38480, 35775, 38382, 27492, 21151, 33021), ['family-member-path', 'permission-denied']),
];

const runtimeScenarios = Object.freeze([
  ...scenarioTemplates.map(item => item.identity === 'guardian'
    ? Object.freeze({
      ...item,
      roleView: 'family_member',
      categories: Object.freeze(item.categories.map(category => category === 'student-path' ? 'family-member-path' : category)),
    })
    : item),
  ...familyMemberScenarios,
]);

module.exports = Object.freeze({ REQUIRED_COVERAGE_CATEGORIES, runtimeScenarios });
