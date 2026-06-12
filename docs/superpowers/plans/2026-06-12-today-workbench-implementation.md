# Today Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved A2 Today Workbench: one-click top-level navigation, four primary module tiles, actionable alert cards that jump directly to contextual result views, and zero-count feedback without navigation.

**Architecture:** Add a small navigation context layer so existing string navigation remains compatible while new workbench links can carry target context. Add a focused Today Workbench data utility for schedules, financial alerts, question issues, and sync status, then let target pages consume context to open the right filtered view. Keep changes local to navigation, workbench, and the three target pages that need contextual landing behavior.

**Tech Stack:** React 18, TypeScript 4.9, Ant Design 5, dayjs, existing local `dbService`, localStorage schedules, existing financial detail utilities.

---

## File Structure

- Create `src/navigation/navigationContext.ts`: shared navigation target/context types and helpers.
- Create `src/utils/todayWorkbenchData.ts`: pure data aggregation for today schedules, arrears, closed-course balances, question issues, and sync snapshot.
- Modify `src/App.tsx`: accept both legacy string navigation and contextual navigation objects; pass context to target pages.
- Modify `src/layout/AppShell.tsx`: render “今日工作台” as a direct top-level menu item and keep grouped menus for the rest.
- Modify `src/navigation/appNavigation.tsx`: expose `todayNavItem` and remove the redundant single-item “今日” group.
- Replace `src/pages/TodayWorkbench.tsx`: implement A2 layout and direct contextual navigation behavior.
- Modify `src/pages/ScheduleCalendar.tsx`: consume optional context to highlight today or a specific schedule after navigation.
- Modify `src/pages/RevenueStatistics.tsx`: consume `mode: 'arrears' | 'closed-balance'`, show a context result card, and keep the normal summary/detail tables below.
- Modify `src/pages/QuestionBankTools.tsx`: consume `mode: 'problem-questions'` and open the quality/problem tab directly.
- Modify `src/pages/SyncSettings.tsx`: consume `mode: 'issues' | 'pending'` and emphasize the pending/issue state.
- Modify `src/index.css`: add A2 workbench layout styles.
- Modify `scripts/ui-smoke-check.js`: update smoke expectations for one-click today and new workbench text.
- Test with `npm exec tsc -- --noEmit --pretty false`, `npm test`, `npm run build`, `npm run test:ui-smoke`, and targeted Playwright checks.

## Task 1: Navigation Context Layer

**Files:**
- Create: `src/navigation/navigationContext.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create navigation context types**

Create `src/navigation/navigationContext.ts`:

```ts
import type { PageKey } from './appNavigation';

export type CourseCalendarContext = {
  date?: string;
  scheduleId?: string;
  highlightToday?: boolean;
};

export type RevenueStatisticsContext = {
  mode?: 'arrears' | 'closed-balance';
};

export type QuestionBankToolsContext = {
  mode?: 'problem-questions';
};

export type CloudSyncContext = {
  mode?: 'issues' | 'pending';
};

export type PageContextMap = {
  today: undefined;
  'course-calendar': CourseCalendarContext;
  'revenue-statistics': RevenueStatisticsContext;
  'question-bank-tools': QuestionBankToolsContext;
  'cloud-sync': CloudSyncContext;
};

export type NavigationContext = CourseCalendarContext | RevenueStatisticsContext | QuestionBankToolsContext | CloudSyncContext | undefined;

export type NavigationTarget = {
  page: PageKey;
  context?: NavigationContext;
};

export type NavigationInput = PageKey | NavigationTarget;

export function normalizeNavigationTarget(input: NavigationInput): NavigationTarget {
  return typeof input === 'string' ? { page: input } : input;
}
```

- [ ] **Step 2: Update App navigation state**

In `src/App.tsx`, replace the `PageKey`-only navigation signature with `NavigationInput`.

Key implementation:

```ts
import { NavigationContext, NavigationInput, normalizeNavigationTarget } from './navigation/navigationContext';
```

Use state:

```ts
const [currentPage, setCurrentPage] = useState<PageKey>(DEFAULT_PAGE);
const [pageContext, setPageContext] = useState<NavigationContext>(undefined);
```

Update event handling:

```ts
const onNavigate = (event: Event) => {
  const target = normalizeNavigationTarget((event as CustomEvent<NavigationInput>).detail);
  if (target.page) {
    setCurrentPage(target.page);
    setPageContext(target.context);
  }
};
```

Update function:

```ts
const navigateTo = (input: NavigationInput) => {
  const target = normalizeNavigationTarget(input);
  setCurrentPage(target.page);
  setPageContext(target.context);
};
```

Pass context:

```tsx
case 'course-calendar': return <LazyPage><ScheduleCalendar context={pageContext as any} /></LazyPage>;
case 'revenue-statistics': return <RevenueStatistics context={pageContext as any} />;
case 'question-bank-tools': return <LazyPage><QuestionBankTools onNavigate={navigateTo} context={pageContext as any} /></LazyPage>;
case 'cloud-sync': return <ErrorBoundary><SyncSettings context={pageContext as any} /></ErrorBoundary>;
case 'today': return <TodayWorkbench onNavigate={navigateTo} />;
```

- [ ] **Step 3: Run type check**

Run: `npm exec tsc -- --noEmit --pretty false`

Expected: any type errors should point to props that still accept only `(page: PageKey) => void`; Task 4 and Task 5 update those props to `NavigationInput`.

## Task 2: One-Click Today Navigation

**Files:**
- Modify: `src/navigation/appNavigation.tsx`
- Modify: `src/layout/AppShell.tsx`

- [ ] **Step 1: Expose direct today item**

In `src/navigation/appNavigation.tsx`, add:

```ts
export const todayNavItem: NavItem = {
  key: 'today',
  label: '今日工作台',
  description: '查看今日课程、待处理提醒和常用入口',
  icon: <AppstoreOutlined />,
};
```

Remove the `today` group from `navGroups`. Keep `legacyQuestionBankItems.today = todayNavItem`.

Update `findNavItem`:

```ts
if (pageKey === 'today') return todayNavItem;
```

Update `findOpenGroup`:

```ts
if (pageKey === 'today') return '';
```

- [ ] **Step 2: Render the direct menu item**

In `src/layout/AppShell.tsx`, import `todayNavItem`.

Change menu generation:

```ts
const menuItems = useMemo(
  () => [
    {
      key: todayNavItem.key,
      icon: todayNavItem.icon,
      label: todayNavItem.label,
    },
    ...navGroups.map((group) => ({
      key: group.key,
      icon: group.icon,
      label: group.label,
      children: group.items.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: item.label,
      })),
    })),
  ],
  [],
);
```

Update open key initialization and current-page effect so empty group is ignored:

```ts
const initialOpenGroup = findOpenGroup(currentPage);
const [openKeys, setOpenKeys] = useState<string[]>(initialOpenGroup ? [initialOpenGroup] : []);

useEffect(() => {
  if (navVisible) {
    const group = findOpenGroup(currentPage);
    setOpenKeys(group ? [group] : []);
  }
}, [navVisible, currentPage]);
```

- [ ] **Step 3: Verify manually**

Run dev/build UI and confirm the menu shows “今日工作台” directly at top level, with no expandable “今日” submenu.

## Task 3: Today Workbench Data Aggregation

**Files:**
- Create: `src/utils/todayWorkbenchData.ts`
- Test: add lightweight assertions in `src/utils/todayWorkbenchData.test.js`
- Modify: `package.json` test script if needed to include the new test.

- [ ] **Step 1: Create pure utility**

Create `src/utils/todayWorkbenchData.ts`:

```ts
import dayjs from 'dayjs';
import { Course, Payment, Schedule, ScheduleStatus, Student, Teacher } from '../types';
import { StudentCourseFeeDetail, buildFinancialDetails } from './financialDetails';

export interface TodayCourseRow {
  scheduleId: string;
  date: string;
  timeRange: string;
  teacherId?: string;
  teacherName: string;
  courseName: string;
  room?: string;
}

export interface StudentAlertRow {
  studentId: string;
  studentName: string;
  amount: number;
  courseNames: string[];
  lastDate?: string;
}

export interface SyncSnapshot {
  pendingCount: number;
  hasIssues: boolean;
  lastSyncTime?: number | null;
}

const roundMoney = (value: number): number => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export function parseStoredSchedules(raw: string | null): Schedule[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getTodayCourseRows(
  schedules: Schedule[],
  courses: Course[],
  teachers: Teacher[],
  today = dayjs()
): TodayCourseRow[] {
  const target = today.format('YYYY-MM-DD');
  return schedules
    .filter(schedule => String(schedule.start_time || '').startsWith(target))
    .filter(schedule => schedule.status !== ScheduleStatus.CANCELLED)
    .map(schedule => {
      const course = courses.find(item => item.id === schedule.course_id);
      const teacherId = schedule.teacher_id || course?.teacher_id;
      const teacher = teachers.find(item => item.id === teacherId);
      const start = dayjs(schedule.start_time).format('HH:mm');
      const end = dayjs(schedule.end_time).format('HH:mm');
      return {
        scheduleId: schedule.id,
        date: target,
        timeRange: `${start}-${end}`,
        teacherId,
        teacherName: teacher?.name || schedule.teacher_name || course?.teacher_name || '未设置老师',
        courseName: course?.display_name || course?.name || (schedule as any).course_name || '未知课程',
        room: schedule.room || course?.room_name,
      };
    })
    .sort((a, b) => a.timeRange.localeCompare(b.timeRange));
}

export function groupTodayRowsByFirstTeacher(rows: TodayCourseRow[]): { teacherName: string; rows: TodayCourseRow[] } {
  if (rows.length === 0) return { teacherName: '暂无老师', rows: [] };
  const firstTeacherId = rows[0].teacherId;
  const firstTeacherName = rows[0].teacherName;
  return {
    teacherName: firstTeacherName,
    rows: rows.filter(row => row.teacherId === firstTeacherId || row.teacherName === firstTeacherName),
  };
}

export function buildStudentFinancialAlerts(
  schedules: Schedule[],
  courses: Course[],
  students: Student[],
  teachers: Teacher[],
  payments: Payment[]
): { arrears: StudentAlertRow[]; closedBalances: StudentAlertRow[]; studentDetails: StudentCourseFeeDetail[] } {
  const normalSchedules = schedules.filter(schedule => schedule.status !== ScheduleStatus.LEAVE && schedule.status !== ScheduleStatus.CANCELLED);
  const { studentDetails } = buildFinancialDetails(normalSchedules, courses, students, teachers);
  const expectedMap = new Map<string, StudentAlertRow>();
  studentDetails.forEach(detail => {
    if (detail.studentId.startsWith('__')) return;
    const current = expectedMap.get(detail.studentId) || {
      studentId: detail.studentId,
      studentName: detail.studentName,
      amount: 0,
      courseNames: [],
      lastDate: detail.date,
    };
    current.amount = roundMoney(current.amount + detail.tuitionTotal);
    if (!current.courseNames.includes(detail.courseName)) current.courseNames.push(detail.courseName);
    if (!current.lastDate || detail.date > current.lastDate) current.lastDate = detail.date;
    expectedMap.set(detail.studentId, current);
  });

  const paidMap = new Map<string, number>();
  payments.forEach(payment => {
    paidMap.set(payment.student_id, roundMoney((paidMap.get(payment.student_id) || 0) + Number(payment.amount || 0)));
  });

  const arrears = Array.from(expectedMap.values())
    .map(row => ({ ...row, amount: roundMoney(row.amount - (paidMap.get(row.studentId) || 0)) }))
    .filter(row => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const closedCourseIds = new Set(courses.filter(course => course.active === false).map(course => course.id));
  const closedBalances = students
    .filter(student => Number(student.balance_money || 0) > 0)
    .map(student => {
      const closedDetails = studentDetails.filter(detail => detail.studentId === student.id && closedCourseIds.has(detail.courseId));
      if (closedDetails.length === 0) return null;
      return {
        studentId: student.id,
        studentName: student.name,
        amount: roundMoney(Number(student.balance_money || 0)),
        courseNames: [...new Set(closedDetails.map(detail => detail.courseName))],
        lastDate: closedDetails.map(detail => detail.date).sort().pop(),
      };
    })
    .filter((row): row is StudentAlertRow => Boolean(row))
    .sort((a, b) => b.amount - a.amount);

  return { arrears, closedBalances, studentDetails };
}
```

- [ ] **Step 2: Add focused tests**

Create `src/utils/todayWorkbenchData.test.js` using Node assertions. Test:

```js
const assert = require('assert');
const {
  parseStoredSchedules,
} = require('./todayWorkbenchData');

assert.deepStrictEqual(parseStoredSchedules(null), []);
assert.deepStrictEqual(parseStoredSchedules('bad-json'), []);
assert.deepStrictEqual(parseStoredSchedules('[{\"id\":\"s1\"}]'), [{ id: 's1' }]);
console.log('todayWorkbenchData tests passed');
```

If TypeScript source cannot be required directly in the current test setup, skip this JS test and cover the utility through `npm exec tsc` plus targeted Playwright seeded-data tests.

- [ ] **Step 3: Verify**

Run: `npm exec tsc -- --noEmit --pretty false`

Expected: PASS.

## Task 4: Implement A2 Today Workbench UI

**Files:**
- Replace: `src/pages/TodayWorkbench.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Replace static cards with A2 layout**

Use `TodayWorkbench` props:

```ts
import { NavigationInput } from '../navigation/navigationContext';

interface TodayWorkbenchProps {
  onNavigate: (target: NavigationInput) => void;
}
```

Load data with `dbService`, localStorage schedules, and `SyncEngine.getStatus()` inside guarded `try/catch`.

Primary navigation:

```ts
onNavigate({ page: 'course-calendar', context: { date: dayjs().format('YYYY-MM-DD'), highlightToday: true } });
onNavigate('revenue-statistics');
onNavigate('question-bank-tools');
onNavigate('cloud-sync');
```

Alert navigation:

```ts
if (arrears.length === 0) message.info('暂无欠缴学生');
else onNavigate({ page: 'revenue-statistics', context: { mode: 'arrears' } });

if (closedBalances.length === 0) message.info('暂无结课余额异常');
else onNavigate({ page: 'revenue-statistics', context: { mode: 'closed-balance' } });

if (issues.length === 0) message.info('暂无问题试题');
else onNavigate({ page: 'question-bank-tools', context: { mode: 'problem-questions' } });

if (!syncSnapshot.hasIssues && syncSnapshot.pendingCount === 0) message.info('当前同步正常');
else onNavigate({ page: 'cloud-sync', context: { mode: syncSnapshot.hasIssues ? 'issues' : 'pending' } });
```

Course row click:

```ts
onNavigate({
  page: 'course-calendar',
  context: { date: row.date, scheduleId: row.scheduleId, highlightToday: true },
});
```

- [ ] **Step 2: Add CSS**

Add classes:

```css
.today-workbench__hero,
.today-workbench__entry-grid,
.today-workbench__entry-card,
.today-workbench__body-grid,
.today-workbench__course-panel,
.today-workbench__alert-stack,
.today-workbench__alert-card,
.today-workbench__course-row
```

Use a responsive grid: four columns on desktop, two on tablet, one on narrow mobile. Keep cards at 8px radius or less.

- [ ] **Step 3: Verify UI**

Run a local build server and use Playwright to confirm:

- Body contains `课程表`, `费用统计`, `题库`, `云同步`.
- Body does not contain `排课列表` as a workbench primary tile.
- Body does not contain `查看今日课程`.
- Clicking zero-count alert shows an Ant message and does not navigate.

## Task 5: Contextual Target Pages

**Files:**
- Modify: `src/pages/ScheduleCalendar.tsx`
- Modify: `src/pages/RevenueStatistics.tsx`
- Modify: `src/pages/QuestionBankTools.tsx`
- Modify: `src/pages/SyncSettings.tsx`

- [ ] **Step 1: Course calendar context**

Add prop:

```ts
import type { CourseCalendarContext } from '../navigation/navigationContext';

interface ScheduleCalendarProps {
  context?: CourseCalendarContext;
}
```

Use existing `highlightedDate`, `currentMonday`, and course refs:

```ts
useEffect(() => {
  if (!context?.date && !context?.highlightToday) return;
  const target = dayjs(context.date || dayjs());
  setHighlightedDate(target);
  setCurrentMonday(target.startOf('isoWeek'));
}, [context?.date, context?.highlightToday]);
```

After schedules render, if `context.scheduleId` exists, scroll to the schedule element and apply a temporary highlight class. If schedule DOM does not expose id yet, add `data-schedule-id={schedule.id}` to the schedule card wrapper.

- [ ] **Step 2: Revenue statistics context**

Add prop:

```ts
import type { RevenueStatisticsContext } from '../navigation/navigationContext';

interface RevenueStatisticsProps {
  context?: RevenueStatisticsContext;
}
```

Add state:

```ts
const [contextMode, setContextMode] = useState<RevenueStatisticsContext['mode']>(context?.mode);
```

When context changes, set mode and open the financial tables collapse:

```ts
useEffect(() => {
  setContextMode(context?.mode);
}, [context?.mode]);
```

Use `buildStudentFinancialAlerts` or equivalent local data from the current stats load to render a top result card above the details:

- `arrears`: table columns student, amount, courses, lastDate.
- `closed-balance`: table columns student, amount, courses, lastDate.

If result is empty, show `Empty` with the same zero-state text.

- [ ] **Step 3: Question bank tools context**

Add prop:

```ts
interface QuestionBankToolsProps {
  onNavigate: (target: NavigationInput) => void;
  context?: QuestionBankToolsContext;
}
```

Make `Tabs` controlled:

```ts
const [activeTab, setActiveTab] = useState(context?.mode === 'problem-questions' ? 'quality' : 'import');
useEffect(() => {
  if (context?.mode === 'problem-questions') setActiveTab('quality');
}, [context?.mode]);
```

Set `activeKey={activeTab}` and `onChange={setActiveTab}`.

- [ ] **Step 4: Sync settings context**

Add prop:

```ts
import type { CloudSyncContext } from '../navigation/navigationContext';

interface SyncSettingsProps {
  context?: CloudSyncContext;
}
```

If `context?.mode` is `issues` or `pending`, show a top `Alert` before the engine card:

```tsx
{context?.mode && (
  <Alert
    type={status.pendingCount > 0 ? 'warning' : 'info'}
    showIcon
    message={context.mode === 'issues' ? '同步异常入口' : '待同步入口'}
    description={status.pendingCount > 0 ? `当前有 ${status.pendingCount} 条待同步变更` : '当前同步正常，没有待处理项'}
    style={{ marginBottom: 16 }}
  />
)}
```

- [ ] **Step 5: Verify**

Run: `npm exec tsc -- --noEmit --pretty false`

Expected: PASS.

## Task 6: Smoke and Targeted Browser Tests

**Files:**
- Modify: `scripts/ui-smoke-check.js` only if required page text changed.

- [ ] **Step 1: Run standard checks**

Run:

```powershell
npm exec tsc -- --noEmit --pretty false
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 2: Run UI smoke**

Serve the build folder and run:

```powershell
$env:UI_SMOKE_URL='http://127.0.0.1:<port>'; npm run test:ui-smoke
```

Expected: all route smoke checks pass.

- [ ] **Step 3: Run targeted Playwright checks**

Seed browser localStorage with:

- one schedule today;
- one past/normal schedule with tuition;
- one payment less than expected tuition;
- one closed course with a student balance;
- one question missing answer or analysis;
- one pending sync operation if possible.

Then assert:

- Today Workbench is one-click top-level menu item.
- Workbench shows four primary tiles.
- There is no primary `排课列表` tile.
- There is no `查看今日课程` copy in the course tile.
- Clicking arrears card opens revenue statistics and shows the arrears result card.
- Clicking closed-balance card opens revenue statistics and shows the closed-balance result card.
- Clicking problem-question card opens question bank tools with the problem tab active.
- Clicking a zero-state alert does not change page and shows a message.

## Task 7: Commit

**Files:**
- All modified implementation and test files.

- [ ] **Step 1: Review diff**

Run:

```powershell
git diff --stat
git diff -- src/navigation src/pages src/utils src/layout src/index.css scripts/ui-smoke-check.js
```

Expected: changes match only this workbench redesign.

- [ ] **Step 2: Commit implementation**

Run:

```powershell
git add src/navigation src/pages src/utils src/layout src/index.css scripts/ui-smoke-check.js
git commit -m "feat: redesign today workbench"
```

Expected: commit succeeds.

## Task 8: Release Flow

**Files:**
- Modify generated release files: `package.json`, `src/generated/version.ts`

- [ ] **Step 1: Bump version**

Run:

```powershell
npm version patch --no-git-tag-version
npm run build
```

Expected: package version increments from `5.0.14` to `5.0.15`, and `src/generated/version.ts` updates to the new build tag.

- [ ] **Step 2: Verify release build**

Run:

```powershell
npm exec tsc -- --noEmit --pretty false
npm test
npm run test:ui-smoke
```

Expected: all pass.

- [ ] **Step 3: Commit and push release**

Run:

```powershell
git add -A
git commit -m "自动发布 2026-06-12"
git push origin codex/integrate-latest-full
git push gewu codex/integrate-latest-full
```

Expected: both SSH pushes succeed.

- [ ] **Step 4: Build installer and upload**

Run:

```powershell
npx electron-builder --win
node scripts/upload-quark-clean.js
npm rebuild better-sqlite3
npm test
git status --short --branch
```

Expected: installer `dist\格物工坊 Setup 5.0.15.exe` uploads to Quark through the Codex clean script, native dependency is rebuilt for local Node, tests pass, and worktree is clean.

## Self-Review

- Spec coverage: navigation promotion, four primary tiles, direct result alerts, zero-count non-navigation, contextual jumps, and target page behavior are covered by Tasks 1-6. Release requirements are covered by Task 8.
- Placeholder scan: no placeholder steps remain.
- Type consistency: contextual navigation uses `NavigationInput`, `NavigationTarget`, and per-page context types consistently; legacy string navigation remains valid.
