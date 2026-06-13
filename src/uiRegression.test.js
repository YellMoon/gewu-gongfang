const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const scheduleCalendar = read('src/pages/ScheduleCalendar.tsx');
const batchSelection = read('src/pages/useBatchSelection.tsx');
const questionBankTools = read('src/pages/QuestionBankTools.tsx');
const appNavigation = read('src/navigation/appNavigation.tsx');
const statsLayout = read('src/layout/StatsPageLayout.tsx');
const courseList = read('src/pages/CourseList.tsx');
const appShell = read('src/layout/AppShell.tsx');
const indexCss = read('src/index.css');
const revenueStatistics = read('src/pages/RevenueStatistics.tsx');
const revenueDetailFilters = read('src/utils/revenueDetailFilters.js');

assert(
  !scheduleCalendar.includes('馃搵') && !batchSelection.includes('馃搵'),
  'course drag ghosts should not include mojibake copy markers'
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
  revenueDetailFilters.includes('INSTITUTION_UNBOUND_STUDENT_ID'),
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

console.log('ui regression checks passed');
