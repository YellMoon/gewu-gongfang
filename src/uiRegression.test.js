const fs = require('fs');
const path = require('path');
const assert = require('assert');
require('./legacyAuthorizationRuntime.test.js');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const scheduleCalendar = read('src/pages/ScheduleCalendar.tsx');
const scheduleList = read('src/pages/ScheduleList.tsx');
const batchSelection = read('src/pages/useBatchSelection.tsx');
const scheduleExcelExport = read('src/utils/scheduleExcelExport.mjs');
const batchSelectionGeometry = read('src/utils/batchSelectionGeometry.mjs');
const questionBankTools = read('src/pages/QuestionBankTools.tsx');
const appNavigation = read('src/navigation/appNavigation.tsx');
const statsLayout = read('src/layout/StatsPageLayout.tsx');
const courseList = read('src/pages/CourseList.tsx');
const studentList = read('src/pages/StudentList.tsx');
const questionBankImport = read('src/pages/QuestionBankImport.tsx');
const questionBankPreview = read('src/pages/QuestionBankPreview.tsx');
const questionBankEdit = read('src/pages/QuestionBankEdit.tsx');
const appIndex = read('src/index.tsx');
const appShell = read('src/layout/AppShell.tsx');
const indexCss = read('src/index.css');
const revenueStatistics = read('src/pages/RevenueStatistics.tsx');
const revenueDetailFilters = read('src/utils/revenueDetailFilters.mjs');
const financialDetails = read('src/utils/financialDetails.ts');
const todayWorkbenchData = read('src/utils/todayWorkbenchData.ts');
const todayWorkbench = read('src/pages/TodayWorkbench.tsx');
const questionRenderer = read('src/components/QuestionRenderer.tsx');
const questionRendererCss = read('src/components/QuestionRenderer.css');
const richQuestionEditor = read('src/components/RichQuestionEditor.tsx');
const richAssetImage = read('src/components/RichAssetImage.tsx');
const structuredQuestionViewer = read('src/components/StructuredQuestionViewer.tsx');
const systemSettings = read('src/pages/SystemSettings.tsx');
const desktopUpdateClient = read('src/services/desktopUpdateClient.mjs');
const desktopIdentityError = read('src/services/desktopIdentityError.mjs');
assert.ok(systemSettings.includes("if (!settingsPolicy.isPrimaryHost)") && systemSettings.includes('\\u7ba1\\u7406\\u5458\\u6258\\u7ba1'), 'ordinary desktop settings must use a dedicated managed simple view');
assert.ok(systemSettings.includes('if (policy.loadQuestionBankStorage)') && systemSettings.includes('if (policy.loadBackupTargets)'), 'ordinary desktop must not load host storage or backup status');
const ordinaryDesktopSettingsStart = systemSettings.indexOf('if (!settingsPolicy.isPrimaryHost)');
const primaryHostSettingsStart = systemSettings.indexOf('\n  return (', ordinaryDesktopSettingsStart);
const ordinaryDesktopSettingsView = systemSettings.slice(ordinaryDesktopSettingsStart, primaryHostSettingsStart);
const primaryHostSettingsView = systemSettings.slice(primaryHostSettingsStart);
assert.ok(
  /renderDesktopUpdatePanel\s*\(/.test(ordinaryDesktopSettingsView) || /<DesktopUpdatePanel\b/.test(ordinaryDesktopSettingsView),
  'ordinary desktop settings must render the OSS desktop updater instead of returning before it'
);
assert.ok(
  /renderDesktopUpdatePanel\s*\(/.test(primaryHostSettingsView) || /<DesktopUpdatePanel\b/.test(primaryHostSettingsView),
  'primary-host settings must render its isolated OSS desktop updater'
);
const syncSettings = read('src/pages/SyncSettings.tsx');
const syncQuickPanel = read('src/components/sync/SyncQuickPanel.tsx');
const cloudSync = read('src/pages/CloudSync.tsx');
const authorityOutboxPanel = read('src/components/AuthorityOutboxPanel.tsx');
const operateLog = read('src/pages/OperateLog.tsx');
const cloudRelayHostApi = read('src/services/cloudRelayHostApi.ts');
const permissionManager = read('src/pages/PermissionManager.tsx');
const permissionManagerCss = read('src/pages/PermissionManager.css');
const identityDeviceCenter = read('src/pages/IdentityDeviceCenter.tsx');
const identityDeviceCenterCss = read('src/pages/IdentityDeviceCenter.css');
const authorizationApi = read('src/services/authorizationApi.ts');
const authorizationRequestCoordinator = read('src/services/authorizationRequestCoordinator.mjs');
const scheduleStorage = read('src/utils/scheduleStorage.mjs');
const packageJson = read('package.json');
const packageManifest = JSON.parse(packageJson);
const miniappApi = read('miniapp/src/utils/api.ts');
const miniappLogin = read('miniapp/src/pages/login/index.tsx');
const miniappLoginCss = read('miniapp/src/pages/login/index.scss');
const miniappUnrecognizedExperience = read('miniapp/src/utils/unrecognizedExperience.ts');
const miniappUnrecognizedPage = read('miniapp/src/pages/unrecognized-experience/index.tsx');
const miniappUnrecognizedContent = read('miniapp/src/components/UnrecognizedExperienceContent/index.tsx');
const miniappAccountApplication = read('miniapp/src/pages/account-application/index.tsx');
const miniappAppConfig = read('miniapp/src/app.config.ts');
const miniappQuestionBank = read('miniapp/src/pages/question-bank/index.tsx');
const decodeUnicodeEscapes = source => source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
const decodedIdentityDeviceCenter = decodeUnicodeEscapes(identityDeviceCenter);

assert(
  miniappLogin.includes("api.post<any>('/api/auth/wechat-login'") &&
  miniappLogin.includes('phone: normalizedPhone') &&
  miniappLogin.includes('validateManualPhone') &&
  miniappLogin.includes('WECHAT_BINDING_REVIEW_REQUIRED') &&
  miniappLogin.includes("'/pages/unrecognized-experience/index'") &&
  !miniappLogin.includes('openType="getPhoneNumber"') &&
  !miniappLogin.includes('reviewDemo'),
  'miniapp login should use the reviewed manual-phone identity path and route unrecognized students to the real limited experience'
);

assert(
  miniappLoginCss.includes('.login-page') &&
  miniappLoginCss.includes('overflow-y: auto') &&
  miniappLoginCss.includes('env(safe-area-inset-top)') &&
  miniappLoginCss.includes('env(safe-area-inset-bottom)'),
  'miniapp verified-phone login should retain safe-area-aware scrolling styles'
);

assert(
  miniappUnrecognizedExperience.includes('getQuestions()') &&
  miniappUnrecognizedExperience.includes('createTask(params:') &&
  miniappUnrecognizedExperience.includes('cancelTask(taskId: string)') &&
  miniappUnrecognizedExperience.includes('downloadArtifact(artifactId: string)') &&
  miniappUnrecognizedExperience.includes('submitApplication') &&
  miniappUnrecognizedExperience.includes('getApplicationStatus') &&
  !miniappUnrecognizedExperience.includes('withdrawApplication'),
  'unrecognized students should have the fixed-question task and authority-owned role-application API surface'
);

assert(
  !miniappApi.includes("'/api/auth/review-demo'") &&
  !miniappApi.includes('reviewDemoApi') &&
  miniappApi.includes("'/api/miniapp/applications/me'") &&
  miniappApi.includes("accountPath('createTask')"),
  'miniapp API must remove the public review-demo login while retaining scoped unrecognized-account APIs'
);

assert(
  miniappUnrecognizedPage.includes("import UnrecognizedExperienceContent from '../../components/UnrecognizedExperienceContent'") &&
  miniappUnrecognizedContent.includes('体验组卷') &&
  miniappUnrecognizedContent.includes('选择示例题目，提交组卷与导出任务') &&
  miniappUnrecognizedContent.includes("Taro.navigateTo({ url: '/pages/account-application/index' })") &&
  miniappQuestionBank.includes("Taro.navigateTo({ url: '/pages/unrecognized-experience/index' })"),
  'unrecognized experience should expose fixed question tasks and a real identity-application entry'
);

assert(
  miniappAccountApplication.includes('buildRoleApplicationRequest') &&
  miniappAccountApplication.includes('authority_role_application_key') &&
  miniappAccountApplication.includes('applicationApi.submit') &&
  miniappAccountApplication.includes("['not_submitted', 'invalid', 'rejected']") &&
  !miniappAccountApplication.includes('withdrawApplication'),
  'role applications should use the authority command contract and allow a rejected request to be corrected and resubmitted'
);

assert(
  miniappAppConfig.includes("'pages/unrecognized-experience/index'") &&
  miniappAppConfig.includes("'pages/account-application/index'"),
  'all unrecognized-student routes must be registered and reachable at runtime'
);

assert(
  !/\\u[0-9a-fA-F]{4}/.test(permissionManager),
  'permission manager user-facing copy should use UTF-8 text instead of literal unicode escapes'
);

assert(
  permissionManager.includes('createLatestRequestCoordinator') &&
  permissionManager.includes('requestCoordinator.current.run') &&
  authorizationRequestCoordinator.includes('requestId === latestRequestId'),
  'authorization list should ignore stale filter and review responses'
);

assert(
  permissionManager.includes("capabilities.includes('users:review')") &&
  permissionManager.includes('authorization-review-actions') &&
  permissionManager.includes('Modal.confirm') &&
  permissionManager.includes('teacher-not-found') &&
  permissionManager.includes('duplicate-teacher-phone') &&
  permissionManager.includes('loading={loading || saving}') &&
  permissionManagerCss.includes(':focus-visible'),
  'desktop permission manager should expose an accessible capability-gated review workbench with binding and saving states'
);
assert(
  authorizationApi.includes('export async function listUsers') &&
  authorizationApi.includes('export async function reviewUser') &&
  authorizationApi.includes('export async function disableUser') &&
  authorizationApi.includes('export async function getMyCapabilities'),
  'desktop authorization API should expose the unified user-review contract'
);
assert(
  permissionManager.includes('disableUser(selected.id)') &&
  permissionManager.includes('authorization-disable-action') &&
  permissionManager.includes('confirmDisable'),
  'only the capability-gated review workbench should expose a confirmed user-disable action'
);

assert(
  appNavigation.includes("'identity-devices'") &&
  appNavigation.includes('identityDeviceNavItem') &&
  appNavigation.includes('0x8eab, 0x4efd, 0x4e0e, 0x8bbe, 0x5907') &&
  appShell.includes('identityDevicePendingCount') &&
  appShell.includes('<Badge') &&
  decodedIdentityDeviceCenter.includes('待审设备申请') &&
  decodedIdentityDeviceCenter.includes('我的设备') &&
  decodedIdentityDeviceCenter.includes('全部设备') &&
  decodedIdentityDeviceCenter.includes('本地数据主机') &&
  identityDeviceCenterCss.includes('.identity-device-center') &&
  !permissionManager.includes('PairingReviewPanel'),
  'desktop identity and device center must be a top-level, badged workbench instead of a permission-page footer'
);

assert(
  decodedIdentityDeviceCenter.includes('设备 ID') &&
  !identityDeviceCenter.includes('name="deviceId"') &&
  !systemSettings.includes('name="deviceId"') &&
  !systemSettings.includes('runtimeConfig?.deviceId ||'),
  'the immutable device id must only appear as read-only identity-device metadata, never in verification or general settings forms'
);

assert(
  systemSettings.includes('/api/question-bank/storage/status') &&
  systemSettings.includes('questionBankCandidatePaths') &&
  systemSettings.includes('questionBankStoreId') &&
  systemSettings.includes('nasBackupPath') &&
  systemSettings.includes('localCachePath') &&
  systemSettings.includes('/backups/targets/status') &&
  systemSettings.includes('backupTargetStatus'),
  'system settings should expose hotplug question-bank status, store id, candidate paths, local cache, NAS backup path, and backup target status'
);

assert(
  systemSettings.includes('软件更新') &&
  systemSettings.includes('invokeDesktopUpdateCheck') &&
  desktopUpdateClient.includes("api.invoke('check-for-updates')") &&
  systemSettings.includes("api.on('update-available'") &&
  systemSettings.includes("api.on('download-progress'") &&
  systemSettings.includes("api.on('update-downloaded'") &&
  systemSettings.includes("api.on('update-error'") &&
  systemSettings.includes('download-update') &&
  systemSettings.includes('install-update') &&
  packageJson.includes('publish:desktop-update'),
  'system settings should expose an in-app desktop updater and release script should publish the desktop update feed'
);

assert(
  desktopIdentityError.includes('desktopIdentityErrorMessage') &&
  !desktopIdentityError.includes('Error invoking remote method'),
  'desktop identity errors must use stable user-facing copy without Electron IPC wrappers'
);

assert(
  packageJson.includes('"asar": false'),
  'desktop packaging should keep asar disabled because the embedded backend/runtime are loaded from resources/app'
);

assert(
  operateLog.includes("import { getApiBase } from '../utils/apiBase'") &&
  operateLog.includes("getApiBase('/api/ops/audit')") &&
  !operateLog.includes("fetch('/api/ops/audit") &&
  !operateLog.includes('fetch("/api/ops/audit'),
  'packaged file:// UI should resolve operation audit API calls through getApiBase instead of direct /api fetches'
);

const desktopRuntimeOnlyDependencies = [
  'antd',
  'chart.js',
  'dayjs',
  'electron-store',
  'react',
  'react-chartjs-2',
  'react-dom',
  'react-scripts',
  'recharts',
  'sql.js',
];
const desktopRuntimeDependencyLeaks = desktopRuntimeOnlyDependencies.filter(
  dependency => packageManifest.dependencies?.[dependency]
);
assert.deepStrictEqual(
  desktopRuntimeDependencyLeaks,
  [],
  'desktop packaging should keep frontend/build-only packages out of runtime dependencies'
);

assert(
  !scheduleList.includes('require(') &&
  !batchSelection.includes('require(') &&
  !scheduleExcelExport.includes('module.exports') &&
  !batchSelectionGeometry.includes('module.exports') &&
  scheduleList.includes("from '../utils/scheduleExcelExport.mjs'") &&
  batchSelection.includes("from '../utils/batchSelectionGeometry.mjs'"),
  'browser-loaded schedule utilities should use ESM imports/exports instead of CommonJS'
);

assert(
  systemSettings.includes('数据主机与同步') &&
  systemSettings.includes('本地数据主机') &&
  systemSettings.includes('普通离线客户端') &&
  systemSettings.includes('题库移动硬盘路径') &&
  systemSettings.includes('主数据库路径'),
  'system settings should expose local-first role and storage path controls'
);

assert(
  !scheduleCalendar.includes('馃搵') && !batchSelection.includes('馃搵'),
  'course drag ghosts should not include mojibake copy markers'
);

assert(
  questionBankImport.includes('questionBankStorageStatus') &&
  questionBankImport.includes('题库移动硬盘未连接') &&
  questionBankPreview.includes('questionBankStorageStatus') &&
  questionBankPreview.includes('题库移动硬盘未连接'),
  'question bank import and preview should warn when the removable question-bank drive is unavailable'
);

assert(syncSettings.includes('AuthorityOutboxPanel'));
assert(cloudSync.includes('AuthorityOutboxPanel'));
assert(authorityOutboxPanel.includes('requireBridge().list()'));
assert(authorityOutboxPanel.includes('confirmAndSubmit(item.id)'));
assert(authorityOutboxPanel.includes('submit(item.id)'));
assert(authorityOutboxPanel.includes('Modal.confirm'));
assert(authorityOutboxPanel.includes("item.status === 'conflict'"));
assert(!authorityOutboxPanel.includes('fetch('));
assert(!syncSettings.includes('runOneClickSync'));
assert(!cloudSync.includes('runOneClickSync'));

assert(
  appShell.includes('SyncQuickPanel') &&
  systemSettings.includes('SyncSettings') &&
  (appNavigation.match(/\{ key: 'cloud-sync', label:/g) || []).length === 1,
  'desktop sync should use a top-bar quick panel, live inside system settings, and have no standalone visible navigation item'
);

assert(
  syncQuickPanel.includes('onOpenChange={setOpen}') &&
  syncQuickPanel.includes('setOpen(false)'),
  'sync quick panel should close before navigating to system settings'
);

assert(
  !todayWorkbench.includes('\u540c\u6b65\u63a7\u5236\u53f0') &&
  todayWorkbench.includes("onNavigate('system-params')"),
  'today workbench should point to consolidated system sync settings instead of the removed standalone console'
);

assert(
  syncSettings.includes("variant?: 'quick' | 'advanced'") &&
  syncSettings.includes('AuthorityOutboxPanel') &&
  authorityOutboxPanel.includes('confirmAndSubmit') &&
  authorityOutboxPanel.includes('projectionVersion') &&
  systemSettings.includes('id="sync-settings"') &&
  systemSettings.includes('sync-advanced'),
  'sync UI should expose the authority outbox and explicit confirmation'
);

assert(
  authorityOutboxPanel.includes('Modal.confirm') &&
  authorityOutboxPanel.includes('copy.safetyText'),
  'authority command confirmation must show an impact and safety preview'
);

assert(
  !batchSelection.includes('馃棏'),
  'batch selection context menu should not include mojibake delete markers'
);

assert(
  (() => {
    const modalStart = batchSelection.indexOf('open={deleteConfirmVisible}');
    const modalEnd = batchSelection.indexOf('</Modal>', modalStart);
    const modalSnippet = modalStart >= 0 && modalEnd > modalStart
      ? batchSelection.slice(modalStart, modalEnd)
      : '';
    return modalSnippet.includes('title="确认批量删除"') &&
      modalSnippet.includes('okText="确认删除"') &&
      modalSnippet.includes('cancelText="取消"') &&
      modalSnippet.includes('确定要删除选中的') &&
      !modalSnippet.includes('纭') &&
      !modalSnippet.includes('鍒犻櫎') &&
      !modalSnippet.includes('鍙栨秷');
  })(),
  'batch delete confirmation modal should use readable Chinese title and buttons'
);

assert(
  scheduleCalendar.includes('db.deleteSchedule') &&
  scheduleCalendar.includes('failedDeletes') &&
  scheduleCalendar.includes('批量删除排课'),
  'batch delete should remove schedules from dbService before showing success'
);

assert(
  scheduleCalendar.includes('stateVisibleIds') &&
  scheduleCalendar.includes('staleLocalIds') &&
  scheduleCalendar.includes('本地残留记录') &&
  scheduleCalendar.includes('dbMissingIds'),
  'batch delete should remove currently visible local stale schedules even when dbService no longer has them'
);

assert(
  scheduleCalendar.includes('readSchedulesFromPrimaryStore') &&
  scheduleCalendar.includes('replaceSchedulesInPrimaryStore') &&
  scheduleCalendar.includes('schedulesDirtyRef') &&
  scheduleCalendar.includes('loadingSchedulesRef') &&
  scheduleCalendar.includes('setInterval(loadData, 30000)') &&
  !scheduleCalendar.includes('setInterval(loadData, 5000)') &&
  scheduleList.includes('readSchedulesFromPrimaryStore') &&
  revenueStatistics.includes('readSchedulesFromPrimaryStore') &&
  todayWorkbench.includes('readSchedulesFromPrimaryStore') &&
  todayWorkbenchData.includes('schedules: Schedule[]') &&
  !scheduleList.includes("localStorage.getItem('schedules')") &&
  !revenueStatistics.includes("localStorage.getItem('schedules')") &&
  !todayWorkbench.includes("localStorage.getItem('schedules')"),
  'schedule pages should use dbService as the primary schedule store instead of independent localStorage reads'
);

assert(
  scheduleStorage.includes('allowEmptyReplace') &&
  scheduleStorage.includes('legacySchedules.length > 0') &&
  scheduleStorage.includes('current.length > 0') &&
  packageJson.includes('node src/utils/scheduleStorage.test.js'),
  'schedule storage should protect non-empty schedule data from accidental empty snapshots and test the recovery path'
);

assert(
  questionBankTools.includes('试题库') && !questionBankTools.includes('原试题编辑') && !questionBankTools.includes('原审核中心') && !questionBankTools.includes('独立导入页'),
  'question bank tools should expose the integrated question bank and hide legacy shortcuts'
);

assert(
  appNavigation.includes("label: '试题库'") && !appNavigation.includes("label: '试题预览'"),
  'question bank preview navigation should be renamed to question bank'
);

assert(
  statsLayout.includes('stats-page-layout__sticky'),
  'revenue statistics filters and metrics should live in a sticky top section'
);

assert(
  courseList.includes('<Modal') && !courseList.includes('drawerContent={'),
  'course add/edit should use a standalone modal instead of the side drawer'
);

assert(
  appShell.includes('onOpenChange={(keys) => setOpenKeys([...keys])}') && !appShell.includes('keys.slice(-1)'),
  'side navigation should allow multiple expanded groups'
);

assert(
  appShell.includes('setOpenKeys([])') &&
  appShell.includes('window.setTimeout(() => setNavOpen(false), 280)') &&
  indexCss.includes('transform: translate3d') &&
  indexCss.includes('transition: transform 260ms') &&
  !indexCss.includes('box-shadow 0.34s'),
  'side navigation should close expanded groups only after hiding and use compositor-friendly animation'
);

assert(
  indexCss.includes('app-shell__content--course-calendar') && indexCss.includes('overflow: hidden'),
  'course calendar should suppress the outer page scrollbar'
);

assert(
  indexCss.includes('height: 100vh') &&
  indexCss.includes('height: calc(100vh - 64px)') &&
  indexCss.includes('overscroll-behavior: contain'),
  'app content should be a bounded scroll container so sticky statistics headers actually stick'
);

assert(
  revenueStatistics.includes('draftStudentId') &&
  revenueStatistics.includes('appliedStudentId') &&
  revenueStatistics.includes('draftInstitutionId') &&
  revenueStatistics.includes('appliedInstitutionId') &&
  revenueStatistics.includes('draftYear') &&
  revenueStatistics.includes('draftSemester') &&
  revenueStatistics.includes('draftCourseName') &&
  revenueStatistics.includes('allInstitutions') &&
  revenueStatistics.includes('const applyFilters') &&
  revenueStatistics.includes('onClick={applyFilters}') &&
  revenueStatistics.includes('>筛选</Button>') &&
  revenueStatistics.includes('年份：') &&
  revenueStatistics.includes('学期：') &&
  revenueStatistics.includes('课程名：') &&
  revenueStatistics.includes('学生：') &&
  revenueStatistics.includes('老师：') &&
  revenueStatistics.includes('课程类型：') &&
  revenueStatistics.includes('统计范围：') &&
  !revenueStatistics.includes('???') &&
  !revenueStatistics.includes('筛选学生') &&
  !revenueStatistics.includes('筛选老师'),
  'revenue filters should be staged until the user clicks the filter button'
);

assert(
  revenueStatistics.includes('restoreRevenueStatisticsSnapshot') &&
  revenueStatistics.includes('saveRevenueStatisticsSnapshot') &&
  !revenueStatistics.includes('useEffect(() => {\n    loadStats();\n  }, []);'),
  'revenue page should restore the previous filter/result snapshot instead of refreshing default filters on every entry'
);

const revenueFilterOrder = [
  '\u5e74\u4efd\uff1a',
  '\u5b66\u671f\uff1a',
  '\u8001\u5e08\uff1a',
  '\u8bfe\u7a0b\u540d\uff1a',
  '\u5b66\u751f\uff1a',
  '\u8bfe\u7a0b\u7c7b\u578b\uff1a',
  '\u673a\u6784\uff1a',
].map(label => revenueStatistics.indexOf(label));
assert(
  revenueFilterOrder.every(index => index >= 0) &&
  revenueFilterOrder.every((index, order) => order === 0 || index > revenueFilterOrder[order - 1]) &&
  revenueStatistics.includes('filterControlStyles') &&
  revenueStatistics.includes('filterActionBarStyle') &&
  revenueStatistics.includes('filterDateFieldStyle') &&
  revenueStatistics.includes('className="revenue-filter-grid"') &&
  !revenueStatistics.includes('revenue-filter-grid--secondary') &&
  indexCss.includes('.revenue-filter-grid') &&
  indexCss.includes('grid-template-columns: repeat(4, max-content)') &&
  indexCss.includes('@media (max-width: 520px)') &&
  revenueStatistics.includes("gridTemplateColumns: 'max-content minmax(0, 1fr)'") &&
  revenueStatistics.includes("width: 'min(100%, 500px)'") &&
  revenueStatistics.includes('style={filterDateFieldStyle}') &&
  revenueStatistics.includes('year: { width: 104 }') &&
  revenueStatistics.includes('courseName: { width: 190 }') &&
  revenueStatistics.includes('student: { width: 112 }') &&
  revenueStatistics.includes('courseTypes: { width: 124 }') &&
  !revenueStatistics.includes('student: { width: 136 }') &&
  !revenueStatistics.includes('filterToolbarStyle') &&
  !revenueStatistics.includes("const filterControlStyle: React.CSSProperties = {\n  width: '100%'"),
  'revenue filter controls should use compact field-aware widths and the requested field order'
);

assert(
  revenueStatistics.includes('机构：') &&
  revenueStatistics.includes('全部机构') &&
  revenueStatistics.includes('filterStudentDetailsForRevenue') &&
  revenueStatistics.includes('buildRevenueFacetOptions') &&
  revenueStatistics.includes('applyRevenueDateChange') &&
  revenueStatistics.includes('buildTeacherDetailsFromStudentDetails') &&
  revenueDetailFilters.includes('STUDENT_SOURCE_INSTITUTION') &&
  revenueDetailFilters.includes('INSTITUTION_UNBOUND_STUDENT_ID') &&
  !revenueDetailFilters.includes('module.exports'),
  'institution filtering should use student-level source rows and rebuild teacher details from filtered rows'
);

assert(
  revenueStatistics.includes('课时数') &&
  revenueStatistics.includes('数据明细') &&
  revenueStatistics.includes('数据分析') &&
  revenueStatistics.includes('按来源统计') &&
  !revenueStatistics.includes('按课程来源统计'),
  'revenue page should use the new metric, section titles, and source analysis labels'
);

assert(
  revenueDetailFilters.includes('COURSE_TYPE_ONE_ON_ONE') &&
  revenueDetailFilters.includes('courseIsInstitutionOwned') &&
  revenueDetailFilters.includes('studentIsFromSelectedInstitution'),
  'institution filtering should distinguish one-on-one institution courses from multi-student course attribution'
);

assert(
  appIndex.includes("import 'dayjs/locale/zh-cn'") &&
  appIndex.includes("dayjs.locale('zh-cn')") &&
  appIndex.includes('weekStart: 1'),
  'all Ant Design date pickers should use Chinese dayjs locale and Monday week start'
);

assert(
  scheduleCalendar.includes('getCourseDisplayName') &&
  scheduleCalendar.includes('c.active || c.id === editingSchedule?.course_id') &&
  !scheduleCalendar.includes('const courseName = course?.name || values.courseName'),
  'editing ended courses should keep using the human display name and keep the inactive course selectable while editing'
);

assert(
  studentList.includes('buildSchoolOptions') &&
  studentList.includes('schoolOptionMatches') &&
  studentList.includes('listHeight={360}') &&
  studentList.includes('maxCount={1}') &&
  !studentList.includes('<AutoComplete'),
  'student school field should use the same Select dropdown behavior as other inputs, with a taller list and fuzzy matching'
);

assert(
  !courseList.includes('prev.room_id !== cur.room_id || prev.color !== cur.color') &&
  !courseList.includes('backgroundColor: color, border'),
  'course address field should not leave the old course-color preview box below the address selector'
);

assert(
  courseList.includes('getEligibleCourseStudents') &&
  courseList.includes('sanitizeCourseStudentPricings') &&
  (courseList.match(/readOnly \/>/g) || []).length >= 2 ||
  courseList.includes('纯机构'),
  'pure institution courses should allow entering total tuition and teacher fee directly without adding student pricing rows'
);

assert(
  financialDetails.includes('isStudentTuitionCollectible') &&
  financialDetails.includes('CourseSourceType.INSTITUTION') &&
  financialDetails.includes('CourseSourceType.MIXED') &&
  financialDetails.includes('StudentSource.INSTITUTION') &&
  todayWorkbenchData.includes('isStudentTuitionCollectible') &&
  todayWorkbenchData.includes('if (!isStudentTuitionCollectible(detail, students)) return;'),
  'arrears statistics should exclude pure institution tuition and mixed-class institution-student tuition while keeping raw financial details'
);

assert(
  questionBankImport.includes('qb-tree-section-title qb-knowledge-tree-title') &&
  questionBankImport.includes('qb-tree-section-title qb-model-tree-title') &&
  questionBankImport.includes('<TagsOutlined /> \u77e5\u8bc6\u70b9') &&
  questionBankImport.includes('<AimOutlined /> \u6a21\u578b'),
  'knowledge and model tree section titles should share typography but use lower-level icons'
);

assert(
  indexCss.includes('.knowledge-tree .ant-tree-switcher-noop::after') &&
  indexCss.includes('.knowledge-tree .ant-tree-switcher-noop .ant-tree-switcher-line-icon') &&
  indexCss.includes('repeating-linear-gradient') &&
  indexCss.includes('margin-top: 5px'),
  'knowledge tree leaf rows should draw connector dashes without plus circles and keep switchers aligned at the correct height'
);

assert(
  !questionRendererCss.includes('.omml-frac') &&
  !questionRendererCss.includes('.omml-rad') &&
  questionRenderer.includes('convertOmmlHtmlToLatexFragments') &&
  questionRenderer.includes('legacyLatexPlaceholder(`\\\\sqrt') &&
  questionRenderer.includes('legacyLatexPlaceholder(`\\\\frac'),
  'formula rendering should leave fractions and roots to KaTeX instead of custom OMML sizing'
);

assert(
  richQuestionEditor.includes('useEditor({') &&
  richQuestionEditor.includes('EditorContent editor={editor}') &&
  richQuestionEditor.includes("output === 'json' ? current.getJSON()") &&
  richQuestionEditor.includes("canonicalLatex") &&
  richQuestionEditor.includes("toggleHighlight") &&
  richQuestionEditor.includes("RichImage.configure({ allowBase64: false })") &&
  richQuestionEditor.includes("transformPastedHTML") &&
  richQuestionEditor.includes("aria-label={title}") &&
  richQuestionEditor.includes("aria-label={t('\\u5b57\\u53f7')}") &&
  richQuestionEditor.includes("aria-label={t('\\u6587\\u5b57\\u989c\\u8272')}") &&
  richQuestionEditor.includes("aria-label={t('\\u5220\\u9664\\u56fe\\u7247')}") &&
  richQuestionEditor.includes("aria-pressed={editor.isActive('image', { align: 'left' })}") &&
  richQuestionEditor.includes("aria-pressed={editor.isActive('highlight')}") &&
  richQuestionEditor.includes("editor.isActive({ textAlign: 'center' })") &&
  richQuestionEditor.includes("value={String(editor.getAttributes('textStyle').fontSize") &&
  richQuestionEditor.includes("forceSelectionRender(value => value + 1)") &&
  richQuestionEditor.includes("pendingImagePositions.current") &&
  richQuestionEditor.includes("<RichAssetImage src={node.attrs.persistedSrc || node.attrs.src} assetKey={node.attrs.assetKey}") &&
  richQuestionEditor.includes('maskPersistedImagesForEditor') &&
  richAssetImage.includes("resolveAssetForDisplay(source, getQuestionAssetDataUrl)") &&
  richAssetImage.includes("replacePersistedAssetImageSources") &&
  questionRenderer.includes("<ResolvedRichHtml") &&
  structuredQuestionViewer.includes("<RichAssetImage") &&
  richQuestionEditor.includes("insertContentAt(range") &&
  richQuestionEditor.includes("<UndoOutlined />, undefined") &&
  questionBankPreview.includes('QuestionStructureEditor') &&
  questionBankEdit.includes('QuestionStructureEditor') &&
  questionBankImport.includes('QuestionStructureEditor') &&
  !questionBankPreview.includes('name="formulas"') &&
  !questionBankEdit.includes('name="formulas"') &&
  !questionBankImport.includes('name="formulas"'),
  'question edit dialogs should use the controlled TipTap editor contract for rich text, formulas, images, and sanitized paste'
);

assert(
  !questionBankEdit.includes('/debug/clear-question-bank') &&
  !questionBankEdit.includes('clearQuestionLocalStore') &&
  !questionBankEdit.includes('clearAllQuestionData'),
  'question bank edit page should not expose unsafe debug clear actions'
);
console.log('ui regression checks passed');
