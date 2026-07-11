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
const systemSettings = read('src/pages/SystemSettings.tsx');
const syncSettings = read('src/pages/SyncSettings.tsx');
const syncQuickPanel = read('src/components/sync/SyncQuickPanel.tsx');
const cloudSync = read('src/pages/CloudSync.tsx');
const operateLog = read('src/pages/OperateLog.tsx');
const syncApi = read('src/services/syncApi.ts');
const cloudRelayHostApi = read('src/services/cloudRelayHostApi.ts');
const permissionManager = read('src/pages/PermissionManager.tsx');
const permissionManagerCss = read('src/pages/PermissionManager.css');
const authorizationApi = read('src/services/authorizationApi.ts');
const authorizationRequestCoordinator = read('src/services/authorizationRequestCoordinator.mjs');
const scheduleStorage = read('src/utils/scheduleStorage.mjs');
const packageJson = read('package.json');
const packageManifest = JSON.parse(packageJson);

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
  systemSettings.includes('check-for-updates') &&
  systemSettings.includes('download-update') &&
  systemSettings.includes('install-update') &&
  packageJson.includes('publish:desktop-update'),
  'system settings should expose an in-app desktop updater and release script should publish the desktop update feed'
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
  'katex',
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

assert(
  syncSettings.includes('申请同步权限') &&
  syncSettings.includes('检测到') &&
  syncSettings.includes('离线更改') &&
  syncSettings.includes('只拉取主机数据'),
  'sync settings should require user confirmation before pushing offline changes'
);

assert(
  cloudSync.includes('requestSyncAuthorization') &&
  cloudSync.includes('registerSyncDevice') &&
  cloudSync.includes('Modal.confirm') &&
  cloudSync.includes('authorizationToken') &&
  cloudSync.includes('申请同步权限'),
  'cloud sync dashboard should also require authorization confirmation before pushing offline changes'
);

assert(
  cloudRelayHostApi.includes('publishCloudSnapshot') &&
  cloudRelayHostApi.includes('/api/cloud-relay-host/snapshot') &&
  cloudRelayHostApi.includes('getRuntimeConfig') &&
  cloudRelayHostApi.includes('hostBaseUrl') &&
  cloudRelayHostApi.includes('cloudBaseUrl') &&
  cloudSync.includes('handlePublishCloudSnapshot') &&
  cloudSync.includes('发布云端快照') &&
  cloudSync.includes("runtimeConfig?.nodeRole !== 'primary-host'"),
  'desktop primary host should expose a manual cloud snapshot publish action backed by runtime host/cloud config'
);

assert(
  syncApi.includes('getRuntimeConfig') &&
  syncApi.includes('hostBaseUrl') &&
  syncApi.includes('getSyncBaseUrl') &&
  syncApi.includes('getSyncUrl') &&
  !syncApi.includes('const SYNC_URL ='),
  'desktop sync API should resolve the local data host address from runtime config instead of a build-time constant'
);

assert(
  syncSettings.includes('同步审核中心') &&
  syncSettings.includes('主机优先') &&
  syncSettings.includes('客户端优先') &&
  syncSettings.includes('拒绝'),
  'sync settings should expose host conflict review actions'
);

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
  syncSettings.includes('\\u4e0e\\u6570\\u636e\\u4e3b\\u673a\\u53cc\\u5411\\u540c\\u6b65') &&
  syncSettings.includes('\\u5904\\u7406\\u5f85\\u540c\\u6b65\\u8bf7\\u6c42') &&
  systemSettings.includes('id="sync-settings"') &&
  systemSettings.includes('sync-advanced'),
  'sync UI should expose explicit bidirectional client copy and role-aware advanced host management'
);

assert(
  syncSettings.includes("confirmTitle: '\\u786e\\u8ba4\\u53cc\\u5411\\u540c\\u6b65'") &&
  !syncSettings.includes("confirmTitle: '\\u786e\\u8ba4\\u4e00\\u952e\\u540c\\u6b65'"),
  'sync confirmation dialog should describe bidirectional sync explicitly'
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
  courseList.includes('isPureInstitutionCourseDraft') &&
  courseList.includes('canEditCourseFeeTotalsDirectly') &&
  (courseList.match(/readOnly=\{!canEditCourseFeeTotalsDirectly\}/g) || []).length >= 2 &&
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
  richQuestionEditor.includes('contentEditable') &&
  richQuestionEditor.includes('insertFormula') &&
  richQuestionEditor.includes('insertImage') &&
  richQuestionEditor.includes('applyImageAlignment') &&
  questionBankPreview.includes('RichQuestionEditor') &&
  questionBankEdit.includes('RichQuestionEditor'),
  'question edit dialogs should use a WYSIWYG editor for rich text, formulas, and images'
);

assert(
  !questionBankEdit.includes('/debug/clear-question-bank') &&
  !questionBankEdit.includes('clearQuestionLocalStore') &&
  !questionBankEdit.includes('clearAllQuestionData'),
  'question bank edit page should not expose unsafe debug clear actions'
);
console.log('ui regression checks passed');
