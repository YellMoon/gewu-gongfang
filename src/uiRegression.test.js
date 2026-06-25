const fs = require('fs');
const path = require('path');
const assert = require('assert');

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
const questionRenderer = read('src/components/QuestionRenderer.tsx');
const questionRendererCss = read('src/components/QuestionRenderer.css');
const richQuestionEditor = read('src/components/RichQuestionEditor.tsx');
const systemSettings = read('src/pages/SystemSettings.tsx');
const syncSettings = read('src/pages/SyncSettings.tsx');

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
  syncSettings.includes('同步审核中心') &&
  syncSettings.includes('主机优先') &&
  syncSettings.includes('客户端优先') &&
  syncSettings.includes('拒绝'),
  'sync settings should expose host conflict review actions'
);

assert(
  !batchSelection.includes('馃棏'),
  'batch selection context menu should not include mojibake delete markers'
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
  revenueStatistics.includes('allInstitutions') &&
  revenueStatistics.includes('const applyFilters') &&
  revenueStatistics.includes('onClick={applyFilters}') &&
  revenueStatistics.includes('>筛选</Button>') &&
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
  revenueStatistics.includes('机构：') &&
  revenueStatistics.includes('全部机构') &&
  revenueStatistics.includes('filterStudentDetailsForRevenue') &&
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
console.log('ui regression checks passed');
