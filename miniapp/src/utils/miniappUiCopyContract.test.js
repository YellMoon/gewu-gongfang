'use strict';

const assert = require('assert');
const fs = require('fs');

const read = path => fs.readFileSync(path, 'utf8');
const display = source => source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
const applicationConfig = display(read('miniapp/src/pages/account-application/index.config.ts'));
const applicationPage = display(read('miniapp/src/pages/account-application/index.tsx'));
const applicationRuntime = display(read('miniapp/src/pages/account-application/applicationRuntime.js'));
const accountBanner = display(read('miniapp/src/components/AccountStatusBanner.tsx'));
const settingsPage = display(read('miniapp/src/pages/settings/index.tsx'));
const questionBankPage = display(read('miniapp/src/pages/question-bank/index.tsx'));
const questionBankStyles = read('miniapp/src/pages/question-bank/index.scss');
const questionPaperPage = display(read('miniapp/src/pages/question-paper/index.tsx'));
const homePage = display(read('miniapp/src/pages/index/index.tsx'));
const schedulePage = display(read('miniapp/src/pages/schedule/index.tsx'));
const forbiddenPage = display(read('miniapp/src/pages/forbidden/index.tsx'));
const scheduleEditConfig = display(read('miniapp/src/pages/schedule/edit/index.config.ts'));
const scheduleDetailPage = read('miniapp/src/pages/schedule/detail/index.tsx');
const studentDetailPage = read('miniapp/src/pages/student-detail/index.tsx');
const studentsConfig = display(read('miniapp/src/pages/students/index.config.ts'));
const coursesConfig = display(read('miniapp/src/pages/courses/index.config.ts'));
const coursesPage = read('miniapp/src/pages/courses/index.tsx');
const teachersConfig = display(read('miniapp/src/pages/teachers/index.config.ts'));
const assetsConfig = display(read('miniapp/src/pages/assets/index.config.ts'));
const appConfig = read('miniapp/src/app.config.ts');
const appSource = read('miniapp/src/app.tsx');
const privacyPage = display(read('miniapp/src/pages/login/privacy.tsx'));
const privacyConfig = read('miniapp/src/pages/login/privacy.config.ts');
const loginConfig = read('miniapp/src/pages/login/index.config.ts');
const loginRaw = read('miniapp/src/pages/login/index.tsx');
const loginPage = display(read('miniapp/src/pages/login/index.tsx'));
const loginStyles = read('miniapp/src/pages/login/index.scss');
const desktopNavigation = read('src/navigation/appNavigation.tsx');
const desktopQuestionBank = read('src/pages/QuestionBankPreview.tsx');

assert.ok(
  appSource.includes("'pages/login/privacy'"),
  'privacy guidance must remain directly available before sign-in',
);

const retiredTerms = [
  String.fromCharCode(27491, 24335, 36134, 21495),
  String.fromCharCode(25968, 25454, 20027, 26426),
  String.fromCharCode(26435, 23041, 21629, 20196),
  String.fromCharCode(21629, 20196, 38431, 21015),
  String.fromCharCode(20307, 39564, 36134, 21495),
];
for (const source of [applicationConfig, applicationPage, applicationRuntime, accountBanner, settingsPage]) {
  for (const retiredTerm of retiredTerms) {
    assert.ok(!source.includes(retiredTerm), `miniapp user copy must not expose retired term: ${retiredTerm}`);
  }
}

assert.ok(applicationConfig.includes(String.fromCharCode(30003, 35831, 35282, 33394)), 'the visitor application page must name the role-application action');
assert.ok(!applicationConfig.includes(String.fromCharCode(30003, 35831, 36523, 20221)), 'the visitor application page must not frame the action as an internal identity binding');
assert.ok(applicationRuntime.includes(String.fromCharCode(25945, 24072, 12289, 23398, 29983, 25110, 23478, 24237, 25104, 21592)), 'the visitor action must describe every selectable identity');
assert.ok(applicationPage.includes(String.fromCharCode(25552, 20132, 30003, 35831)), 'the primary visitor action must stay clear and short');
assert.ok(applicationRuntime.includes(String.fromCharCode(31561, 24453, 23457, 26680)), 'application status must explain the neutral review state');
assert.ok(!applicationPage.includes('档案方式') && !applicationPage.includes('关联已有档案') && !applicationPage.includes('新建档案'), 'role application must not expose internal archive terminology');
assert.ok(applicationPage.includes('申请方式') && applicationPage.includes('关联已有身份') && applicationPage.includes('创建新身份'), 'role application must use user-facing identity wording');

assert.ok(!settingsPage.includes('getApiBaseUrl') && !settingsPage.includes('setApiBaseUrl'), 'end users must not edit the service endpoint');
assert.ok(!settingsPage.includes(String.fromCharCode(65, 80, 73, 32, 26381, 21153, 22120, 22336)) && !settingsPage.includes(String.fromCharCode(26381, 21153, 22120, 32622)), 'settings must not leak implementation configuration');
assert.ok(!settingsPage.includes('getPendingChanges') && !settingsPage.includes('clearPendingChanges'), 'miniapp settings must not expose retired core-business draft controls');
assert.ok(settingsPage.includes('isFormalIdentity(currentIdentity)'), 'only a canonical formal identity may reveal formal-account settings');
assert.ok(!settingsPage.includes(String.fromCharCode(26410, 30693, 29992, 25143)), 'settings must not label a stale session as an unknown user');
assert.ok(settingsPage.includes('isVisitorIdentity(currentUser)'), 'the sign-out path must retain the visitor cleanup branch');
assert.ok(settingsPage.includes('isFormalIdentity, isVisitorIdentity'), 'the settings page must import both identity checks used by its formal and sign-out branches');
assert.ok(settingsPage.includes(String.fromCharCode(32593, 32476, 24050, 36830, 25509)), 'settings must label device network reachability without claiming cloud health');
assert.ok(settingsPage.includes('__APP_VERSION__'), 'the displayed miniapp version must use the build version');
assert.ok(settingsPage.includes(String.fromCharCode(30003, 35831, 35282, 33394)), 'visitor settings must use the same clear role-application entry as the application page');
assert.ok(!settingsPage.includes(String.fromCharCode(30003, 35831, 36523, 20221)), 'visitor settings must not expose the internal identity-binding label');
assert.ok(!settingsPage.includes(String.fromCharCode(30003, 35831, 25945, 24072, 25110, 23398, 29983)), 'visitor settings must not omit household-member applications');
assert.ok(!settingsPage.includes('reviewRoleApplication') && !settingsPage.includes('listSubmittedRoleApplications'), 'miniapp settings must not expose role-approval operations');
assert.ok(!settingsPage.includes(String.fromCharCode(36523, 20221, 30003, 35831, 22788, 29702)), 'miniapp settings must not expose the role-application approval queue');
assert.ok(!applicationRuntime.includes('\u6559\u5e08\u7aef') && !applicationPage.includes('\u6559\u5e08\u7aef') && !homePage.includes('\u6559\u5e08\u7aef'), 'visitor role-application copy must not imply that teachers approve identities');
assert.ok(applicationPage.includes('\u5ba1\u6838'), 'the detailed role-application page must explain the review boundary without inventing a reviewer role');
assert.ok(!homePage.includes('\u5ba1\u6838'), 'the visitor home entry must remain concise and defer process details to the application page');
assert.ok(!homePage.includes('\u6a21\u5757\u5f00\u53d1\u4e2d'), 'a rendered miniapp action must not fall back to a fictional unfinished module');
assert.ok(!homePage.includes(String.fromCharCode(39064, 24211, 32452, 21367)), 'the miniapp entry must name the question bank rather than turn it into a grouping feature');
assert.ok(!desktopNavigation.includes(String.fromCharCode(26816, 32034, 21644, 39044, 35272, 39064, 24211, 20869, 23481)), 'desktop navigation must not describe question-bank access as a preview');
assert.ok(!desktopQuestionBank.includes(String.fromCharCode(39064, 30446, 39044, 35272)), 'desktop question dialogs must use a direct viewing label rather than preview');
assert.ok(!questionBankPage.includes(String.fromCharCode(31649, 29702, 21592)), 'question-bank permission guidance must not refer to a retired generic administrator role');
assert.ok(questionPaperPage.includes("disabled={!items.length || Boolean(submitting)}"), 'paper exports must reject an empty selection and remain disabled while an export is in progress');
assert.ok(questionPaperPage.includes('sectionTitle') && questionPaperPage.includes('score'), 'paper editor must retain section and score edits before exporting');
assert.ok(questionPaperPage.includes('String.fromCharCode(31572, 26696, 20301, 32622, 65306)') && questionPaperPage.includes('String.fromCharCode(20844, 24335, 26041, 24335, 65306)'), 'paper editor must visibly name its answer-position and formula-mode selectors');
assert.ok(questionBankStyles.includes('.basket-toggle'), 'question cards must expose a clear basket operation for eligible identities');
assert.ok(!questionBankPage.includes('访客题库浏览') && !questionBankPage.includes('题库文字内容由云端权威提供'), 'question-bank must not expose identity labels or implementation explanations as user-facing content');
assert.ok(!questionBankPage.includes('可浏览的题目'), 'question-bank must not describe its browsing allowance as permanent page copy');
assert.ok(!questionBankPage.includes('关联身份后可组卷') && questionBankPage.includes('组卷需要教师角色'), 'limited paper-building prompts must name the required role without internal binding wording');
assert.ok(!questionPaperPage.includes('关联教师身份后可选题组卷和导出') && questionPaperPage.includes('组卷和导出需要教师角色'), 'paper access guidance must use the same direct role wording');
assert.ok(schedulePage.includes('暂无课程安排') && schedulePage.includes('申请角色'), 'the schedule empty state must give a concise, user-facing next step without labeling the account as a visitor');
assert.ok(!schedulePage.includes('访客账号'), 'the schedule page must not turn visitor state into a persistent identity label');
assert.ok(!homePage.includes('申请关联身份') && homePage.includes('申请角色'), 'the visitor home must not expose internal identity-binding language');
assert.ok(homePage.includes('查看课程安排。') && !homePage.includes('已关联的课程安排'), 'the visitor schedule entry must not imply an existing relationship before one exists');
assert.ok(homePage.includes('教师、学生或家庭成员') && !homePage.includes('申请老师、学生或家庭成员'), 'the visitor application entry must use a concise action title rather than a sentence-length button');

assert.ok(!forbiddenPage.includes('\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458'), 'the access boundary must not imply a retired ordinary-administrator role');
assert.ok(forbiddenPage.includes('\u5f53\u524d\u8d26\u53f7\u6682\u4e0d\u80fd\u4f7f\u7528\u6b64\u529f\u80fd'), 'the access boundary must give the user a neutral, actionable explanation');
assert.ok(!homePage.includes('\u7ef4\u62a4\u5b66\u5458\u4e0e\u8bfe\u7a0b\u5173\u7cfb'), 'read-only miniapp shortcuts must not promise student maintenance');
assert.ok(homePage.includes('\u5b66\u751f\u8d44\u6599') && homePage.includes('\u8bfe\u7a0b\u8d44\u6599'), 'read-only miniapp shortcuts must name the information they show');
assert.ok(!homePage.includes('\u6301\u4e45\u547d\u4ee4'), 'visitor role applications must not expose an implementation term as user-facing copy');
assert.ok(scheduleEditConfig.includes('\u6392\u8bfe\u8bf4\u660e'), 'the read-only scheduling boundary must not be titled as schedule creation');
assert.ok(scheduleDetailPage.includes('isStudentUser') && scheduleDetailPage.includes('{!isStudent &&'), 'student schedule details must not expose staff-only fee information');
assert.ok(studentDetailPage.includes('const isStudent = isStudentUser();'), 'student detail must identify a student/guardian view');
assert.strictEqual((studentDetailPage.match(/\{!isStudent && <View className='info-row'>/g) || []).length, 3, 'student detail must keep internal source, notes, and creation rows off student/guardian views');
assert.ok(coursesPage.includes('{!isStudent && <Text className="price-teacher">'), 'student course views must not render a null or internal teacher-fee amount');
assert.ok(studentsConfig.includes('\u5b66\u751f\u8d44\u6599') && coursesConfig.includes('\u8bfe\u7a0b\u8d44\u6599') && teachersConfig.includes('\u6559\u5e08\u8d44\u6599'), 'read-only miniapp titles must describe records instead of management');
assert.ok(assetsConfig.includes('\u4e2a\u4eba\u8d44\u4ea7'), 'the limited-write asset page must identify personal assets');
assert.ok(appSource.includes("import('./utils/miniappRouteAccess')") && appSource.includes("Taro.reLaunch({ url: '/pages/forbidden/index' })"), 'authenticated deep links must enforce the same module boundary as the role-aware home page');
assert.ok(appConfig.includes("navigationBarTitleText: '格物工坊'"), 'the miniapp shell must use the product name rather than a generic management-system title');
assert.ok(privacyPage.includes('微信登录凭证') && privacyPage.includes('经授权的手机号') && privacyPage.includes('身份申请资料'), 'privacy guidance must describe the actual sign-in and application data');
assert.ok(!privacyPage.includes('昵称、头像') && !privacyPage.includes('设备型号'), 'privacy guidance must not claim collection that the miniapp does not perform');
assert.ok(privacyConfig.includes("navigationStyle: 'custom'"), 'privacy guidance must use its own safe-area-aware header instead of stacking a second global navigation bar');
assert.ok(privacyPage.includes('本指引生效日期：2026年8月26日'), 'privacy guidance must show its current effective date');
assert.ok(loginPage.includes('手机号快捷登录'), 'the sign-in action must use the familiar user-facing phone sign-in label');
assert.ok(!loginPage.includes('微信登录'), 'the sign-in action must not use a vague implementation label');
assert.ok(!loginRaw.includes(String.raw`\\u5fae`), 'login copy must not contain double-escaped Unicode sequences that render as raw escape text');
assert.ok(!loginPage.includes(String.fromCharCode(36523, 20221, 26680, 39564)) && !loginPage.includes(String.fromCharCode(36523, 20221, 39564, 35777)), 'login failures must not expose internal identity-verification jargon');
assert.ok(!loginPage.includes('新账号默认为访客') && !loginPage.includes('家庭成员申请'), 'the sign-in page must not expose role-policy explanations before authentication');
assert.ok(loginPage.includes('openType="getPhoneNumber"'), 'the sign-in action must retain the WeChat phone authorization capability');
assert.ok(loginStyles.includes('.login-brand') && loginStyles.includes('flex-direction: row'), 'the logo and product name must form one compact horizontal brand lockup');
assert.ok(!loginStyles.includes('.login-form'), 'the sign-in action must not be wrapped in a decorative explanatory card');
assert.ok(loginConfig.includes("navigationStyle: 'custom'"), 'the sign-in page must not add a redundant navigation title above its own brand');

for (const removedRoute of [
  'pages/admin/users/index',
  'pages/cloud-account-admin/index',
  'pages/unsupported-experience/index',
]) {
  assert.ok(!appConfig.includes(removedRoute), `retired role-management surface must not remain routable: ${removedRoute}`);
}

console.log('miniapp UI copy contract checks passed');
