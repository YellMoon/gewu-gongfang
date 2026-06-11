# 格物工坊 2.0 UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将格物工坊从横向功能页集合改造为左侧分组导航的任务驱动工作台，并完成题库压缩、排课工作台、费用核账和统一管理页模板。

**Architecture:** 先建立 Ant Design token、全局 CSS 和应用壳层，再以页面模板逐步迁移现有页面，业务数据读写逻辑尽量保留在原页面或既有服务中。导航入口由 `src/navigation/appNavigation.tsx` 统一管理，页面标题和操作区通过 `PageHeaderBar` 统一呈现，管理页、工作台页、统计页分别复用专门布局组件。

**Tech Stack:** Electron, React 18, TypeScript 4.9, Ant Design 5, dayjs, Playwright, CRACO.

---

## File Structure

### New Files

- `src/theme/appTheme.ts`: Ant Design theme token and component overrides.
- `src/navigation/appNavigation.tsx`: final left-navigation IA, page metadata, helper lookup functions.
- `src/layout/AppShell.tsx`: left sidebar, top context toolbar, content frame, collapsed state.
- `src/layout/PageHeaderBar.tsx`: page title, description, primary actions, secondary actions, status chips.
- `src/layout/DataPageLayout.tsx`: shared toolbar/table/drawer shell for resource and system management pages.
- `src/layout/WorkbenchLayout.tsx`: shared layout for schedule and question-bank workbench pages.
- `src/layout/StatsPageLayout.tsx`: shared filter, metric, summary, and detail layout for finance pages.
- `src/pages/TodayWorkbench.tsx`: today-centered entry page for courses, question issues, fee review, import/sync status.
- `src/pages/QuestionBankTools.tsx`: compressed question-bank tools page for tree editing, import, stats, and problem queue.
- `src/components/question-bank/QuestionIssueQueue.tsx`: reusable issue queue used by Today and QuestionBankTools.
- `src/styles/design-tokens.css`: CSS custom properties and app shell variables.
- `scripts/ui-smoke-check.js`: Playwright smoke and screenshot script for key UI pages.

### Modified Files

- `src/index.tsx`: use `appTheme`, keep `zhCN`, keep searchable Select defaults.
- `src/index.css`: import token CSS, reduce scattered global visual overrides, keep KaTeX and table density fixes.
- `src/App.tsx`: remove inline shell, use `AppShell`, use new navigation metadata, keep current page mapping.
- `src/components/QuestionBasket.tsx`: keep visible only for question-bank pages, update labels to match compressed IA.
- `src/pages/ScheduleCalendar.tsx`: migrate visual shell to schedule workbench, preserve drag/drop, right-click fees/attendance, refresh warnings.
- `src/pages/RevenueStatistics.tsx`: wrap in stats reconciliation layout, preserve `financialDetails` data source.
- `src/pages/TeacherList.tsx`: first management-page pilot migration.
- `src/pages/StudentList.tsx`: migrate after pilot pattern is verified.
- `src/pages/CourseList.tsx`: migrate after pilot pattern and preserve inline course status switch.
- `src/pages/InstitutionManager.tsx`, `src/pages/SchoolManager.tsx`, `src/pages/RoomManager.tsx`, `src/pages/PaymentList.tsx`, `src/pages/PermissionManager.tsx`, `src/pages/OperateLog.tsx`: migrate to `DataPageLayout` after the pilot.
- `src/pages/QuestionBankImport.tsx`: extract tree/import/stats/problem pieces into `QuestionBankTools`.
- `src/pages/QuestionBankPreview.tsx`: become the visible “试题库” entry, combine preview and edit flow.
- `src/pages/AuditCenter.tsx`: remove from navigation; reuse problem-marking logic through issue queue where useful.
- `package.json`: bump only during final code release, not for this plan-only commit.

---

## Task 1: Baseline Checks and UI Smoke Harness

**Files:**
- Create: `scripts/ui-smoke-check.js`
- Modify: `package.json`

- [ ] **Step 1: Record current baseline**

Run:

```powershell
git status --short --branch
npm test
npm run build
```

Expected:

```text
npm test exits 0
npm run build exits 0
```

If `npm run build` changes generated files under `build/`, do not commit `build/` in this task.

- [ ] **Step 2: Add smoke script**

Create `scripts/ui-smoke-check.js` with:

```js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const baseUrl = process.env.UI_SMOKE_URL || 'http://localhost:3000';
const outDir = path.join(process.cwd(), 'tmp', 'ui-smoke');

const pages = [
  ['today', '/'],
  ['schedule', '/?page=course-calendar'],
  ['question-tools', '/?page=question-bank-import'],
  ['question-library', '/?page=question-bank-preview'],
  ['paper', '/?page=question-bank-paper'],
  ['finance', '/?page=revenue-statistics'],
  ['students', '/?page=student'],
  ['teachers', '/?page=teacher'],
  ['courses', '/?page=course-info'],
  ['system', '/?page=cloud-sync'],
];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });

  for (const [name, route] of pages) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const bodyText = (await page.locator('body').innerText()).trim();
    if (bodyText.length < 20) {
      throw new Error(`${name} rendered too little text`);
    }
    const overlappingButtons = await page.locator('button').evaluateAll((buttons) => {
      return buttons.filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.width < 24;
      }).length;
    });
    if (overlappingButtons > 0) {
      throw new Error(`${name} has ${overlappingButtons} suspiciously narrow buttons`);
    }
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  }

  await browser.close();
  console.log(`UI smoke screenshots written to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Add script entry**

Modify `package.json` scripts:

```json
"test:ui-smoke": "node scripts/ui-smoke-check.js"
```

Place it after `"test:backend"` so the scripts block stays easy to scan.

- [ ] **Step 4: Verify the smoke script can start**

Run with the current dev server:

```powershell
$env:UI_SMOKE_URL='http://localhost:55753'; npm run test:ui-smoke
```

Expected:

```text
UI smoke screenshots written to ...
```

If the current browser server is not serving this workspace, start a fresh app server with:

```powershell
npm run dev:react
```

Then run the smoke script against `http://localhost:3000`.

- [ ] **Step 5: Commit baseline harness**

```powershell
git add package.json scripts/ui-smoke-check.js
git commit -m "test: add UI smoke screenshots"
```

---

## Task 2: Theme Foundation

**Files:**
- Create: `src/theme/appTheme.ts`
- Create: `src/styles/design-tokens.css`
- Modify: `src/index.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Create Ant Design theme**

Create `src/theme/appTheme.ts`:

```ts
import type { ThemeConfig } from 'antd';

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1677b8',
    colorSuccess: '#1f8a5b',
    colorWarning: '#d97706',
    colorError: '#c2413a',
    colorText: '#172033',
    colorTextSecondary: '#586174',
    colorBgLayout: '#f5f7fb',
    colorBgContainer: '#ffffff',
    colorBorder: '#d8dee9',
    borderRadius: 6,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
    controlHeight: 32,
    controlHeightLG: 36,
    controlHeightSM: 26,
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      bodyBg: '#f5f7fb',
      siderBg: '#101827',
    },
    Menu: {
      darkItemBg: '#101827',
      darkItemSelectedBg: '#173b5d',
      darkItemColor: '#c7d2e5',
      darkItemSelectedColor: '#ffffff',
      itemBorderRadius: 6,
    },
    Table: {
      headerBg: '#f7f9fc',
      headerColor: '#253047',
      rowHoverBg: '#eef6fb',
      cellPaddingBlock: 8,
      cellPaddingInline: 10,
    },
    Card: {
      borderRadiusLG: 8,
      headerBg: '#ffffff',
      paddingLG: 16,
    },
    Button: {
      borderRadius: 6,
      controlHeight: 32,
    },
    Drawer: {
      colorBgElevated: '#ffffff',
    },
  },
};
```

- [ ] **Step 2: Create CSS variables**

Create `src/styles/design-tokens.css`:

```css
:root {
  --app-sidebar-width: 224px;
  --app-sidebar-collapsed-width: 64px;
  --app-header-height: 56px;
  --app-content-padding: 16px;
  --app-border-color: #d8dee9;
  --app-bg: #f5f7fb;
  --app-panel-bg: #ffffff;
  --app-title: #172033;
  --app-muted: #586174;
  --app-primary: #1677b8;
  --app-success: #1f8a5b;
  --app-warning: #d97706;
  --app-danger: #c2413a;
  --app-radius: 6px;
  --app-shadow-soft: 0 8px 24px rgba(15, 23, 42, 0.06);
}

.app-page {
  min-height: 100%;
}

.app-panel {
  background: var(--app-panel-bg);
  border: 1px solid var(--app-border-color);
  border-radius: var(--app-radius);
}

.app-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
}

.app-toolbar-main,
.app-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
```

- [ ] **Step 3: Wire theme into entry**

Modify `src/index.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { appTheme } from './theme/appTheme';
import './styles/design-tokens.css';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <ConfigProvider locale={zhCN} theme={appTheme} select={{ showSearch: true }}>
      <App />
    </ConfigProvider>
  );
}
```

- [ ] **Step 4: Tighten global CSS**

At the top of `src/index.css`, keep the existing imports and add the base body style:

```css
html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--app-bg);
  color: var(--app-title);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
  letter-spacing: 0;
}
```

Keep existing KaTeX rules that reduce formula font size; do not enlarge formula selectors in this UI task.

- [ ] **Step 5: Verify theme build**

Run:

```powershell
npm run build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 6: Commit theme foundation**

```powershell
git add src/theme/appTheme.ts src/styles/design-tokens.css src/index.tsx src/index.css
git commit -m "style: add app theme foundation"
```

---

## Task 3: Navigation Metadata and App Shell

**Files:**
- Create: `src/navigation/appNavigation.tsx`
- Create: `src/layout/PageHeaderBar.tsx`
- Create: `src/layout/AppShell.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create navigation metadata**

Create `src/navigation/appNavigation.tsx`:

```tsx
import React from 'react';
import {
  BookOutlined,
  CalendarOutlined,
  CloudSyncOutlined,
  DollarOutlined,
  HomeOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';

export type PageKey =
  | 'today'
  | 'course-calendar'
  | 'schedule-list'
  | 'question-bank-import'
  | 'question-bank-edit'
  | 'question-bank-audit'
  | 'question-bank-tools'
  | 'question-bank-preview'
  | 'question-bank-paper'
  | 'revenue-statistics'
  | 'personal-assets'
  | 'student'
  | 'teacher'
  | 'course-info'
  | 'institution'
  | 'school'
  | 'address'
  | 'payment'
  | 'cloud-sync'
  | 'permission'
  | 'admin'
  | 'invitee'
  | 'menu-manage'
  | 'system-params'
  | 'operate-log';

export type NavItem = {
  key: PageKey;
  label: string;
  description: string;
};

export type NavGroup = {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    key: 'today-group',
    label: '今日',
    icon: <HomeOutlined />,
    items: [
      { key: 'today', label: '今日工作台', description: '课程、费用、题库问题和同步状态' },
    ],
  },
  {
    key: 'teaching',
    label: '教务',
    icon: <CalendarOutlined />,
    items: [
      { key: 'course-calendar', label: '课程表', description: '排课画布、课程池、出勤和费用明细' },
      { key: 'schedule-list', label: '排课列表', description: '按条件核对所有排课记录' },
    ],
  },
  {
    key: 'question-bank',
    label: '题库',
    icon: <BookOutlined />,
    items: [
      { key: 'question-bank-tools', label: '题库工具', description: '知识树、模型树、导入、统计和问题队列' },
      { key: 'question-bank-preview', label: '试题库', description: '筛选、预览、编辑、标记和加入试题篮' },
      { key: 'question-bank-paper', label: '组卷', description: '试卷结构、题号、增删和导出设置' },
    ],
  },
  {
    key: 'finance',
    label: '财务',
    icon: <DollarOutlined />,
    items: [
      { key: 'revenue-statistics', label: '费用核账', description: '按排课明细追踪学费与课时费' },
      { key: 'personal-assets', label: '个人资产', description: '资产流水和账户统计' },
    ],
  },
  {
    key: 'resources',
    label: '资源',
    icon: <TeamOutlined />,
    items: [
      { key: 'student', label: '学生', description: '学生资料、课程关系和缴费信息' },
      { key: 'teacher', label: '老师', description: '老师资料、课时费和任课关系' },
      { key: 'course-info', label: '课程', description: '课程默认信息和结课状态' },
      { key: 'institution', label: '机构', description: '机构基础信息' },
      { key: 'school', label: '学校', description: '学校基础信息' },
      { key: 'address', label: '上课地址', description: '教室和地点信息' },
      { key: 'payment', label: '缴费记录', description: '学生缴费流水' },
    ],
  },
  {
    key: 'system',
    label: '系统与数据',
    icon: <SettingOutlined />,
    items: [
      { key: 'cloud-sync', label: '云同步', description: '同步状态、诊断和备份入口' },
      { key: 'permission', label: '权限', description: '角色与权限配置' },
      { key: 'admin', label: '管理员', description: '管理员账号维护' },
      { key: 'invitee', label: '被邀请者', description: '邀请用户管理' },
      { key: 'menu-manage', label: '菜单结构', description: '系统菜单配置' },
      { key: 'system-params', label: '系统参数', description: '全局参数配置' },
      { key: 'operate-log', label: '操作日志', description: '操作记录查询' },
    ],
  },
];

export const questionBankPages: PageKey[] = [
  'question-bank-tools',
  'question-bank-preview',
  'question-bank-paper',
];

export function findNavItem(pageKey: PageKey): NavItem {
  for (const group of navGroups) {
    const match = group.items.find((item) => item.key === pageKey);
    if (match) return match;
  }
  return navGroups[0].items[0];
}

export function findOpenGroup(pageKey: PageKey): string {
  return navGroups.find((group) => group.items.some((item) => item.key === pageKey))?.key || 'today-group';
}
```

- [ ] **Step 2: Create page header bar**

Create `src/layout/PageHeaderBar.tsx`:

```tsx
import React from 'react';
import { Space, Typography } from 'antd';

const { Text, Title } = Typography;

type PageHeaderBarProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  status?: React.ReactNode;
};

const PageHeaderBar: React.FC<PageHeaderBarProps> = ({
  title,
  description,
  actions,
  secondaryActions,
  status,
}) => (
  <div className="page-header-bar">
    <div className="page-header-bar__main">
      <Title level={4} className="page-header-bar__title">
        {title}
      </Title>
      {description ? <Text className="page-header-bar__description">{description}</Text> : null}
    </div>
    <Space size={8} wrap className="page-header-bar__actions">
      {status}
      {secondaryActions}
      {actions}
    </Space>
  </div>
);

export default PageHeaderBar;
```

Add to `src/index.css`:

```css
.page-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--app-panel-bg);
  border: 1px solid var(--app-border-color);
  border-radius: var(--app-radius);
}

.page-header-bar__main {
  min-width: 0;
}

.page-header-bar__title {
  margin: 0 !important;
  color: var(--app-title) !important;
}

.page-header-bar__description {
  display: block;
  margin-top: 2px;
  color: var(--app-muted);
}

.page-header-bar__actions {
  justify-content: flex-end;
}
```

- [ ] **Step 3: Create shell**

Create `src/layout/AppShell.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { Button, Layout, Menu, Space, Tag, Typography } from 'antd';
import {
  CloudSyncOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { PageKey } from '../navigation/appNavigation';
import { findNavItem, findOpenGroup, navGroups } from '../navigation/appNavigation';
import PageHeaderBar from './PageHeaderBar';

const { Content, Sider } = Layout;
const { Text } = Typography;

type AppShellProps = {
  currentPage: PageKey;
  onPageChange: (page: PageKey) => void;
  children: React.ReactNode;
};

const AppShell: React.FC<AppShellProps> = ({ currentPage, onPageChange, children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const selectedItem = findNavItem(currentPage);
  const openKeys = useMemo(() => [findOpenGroup(currentPage)], [currentPage]);

  return (
    <Layout className="app-shell">
      <Sider
        width={224}
        collapsedWidth={64}
        collapsed={collapsed}
        className="app-shell__sider"
      >
        <div className="app-shell__brand">
          <div className="app-shell__brand-mark">格</div>
          {!collapsed ? (
            <div className="app-shell__brand-copy">
              <Text className="app-shell__brand-title">格物工坊</Text>
              <Text className="app-shell__brand-subtitle">运营工作台</Text>
            </div>
          ) : null}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[currentPage]}
          defaultOpenKeys={openKeys}
          items={navGroups.map((group) => ({
            key: group.key,
            icon: group.icon,
            label: group.label,
            children: group.items.map((item) => ({
              key: item.key,
              label: item.label,
            })),
          }))}
          onClick={({ key }) => onPageChange(key as PageKey)}
        />
      </Sider>
      <Layout className="app-shell__body">
        <div className="app-shell__topbar">
          <Button
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
          />
          <PageHeaderBar
            title={selectedItem.label}
            description={selectedItem.description}
            status={
              <Space size={6}>
                <Tag color="blue">本地数据</Tag>
                <Tag icon={<CloudSyncOutlined />} color="green">
                  可同步
                </Tag>
              </Space>
            }
            secondaryActions={<Button icon={<ReloadOutlined />}>刷新</Button>}
          />
        </div>
        <Content className="app-shell__content">{children}</Content>
      </Layout>
    </Layout>
  );
};

export default AppShell;
```

Add to `src/index.css`:

```css
.app-shell {
  min-height: 100vh;
  background: var(--app-bg);
}

.app-shell__sider {
  min-height: 100vh;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
}

.app-shell__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 14px;
}

.app-shell__brand-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: #fff;
  background: #1677b8;
  border-radius: 8px;
  font-weight: 700;
}

.app-shell__brand-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.app-shell__brand-title {
  color: #fff !important;
  font-weight: 700;
  line-height: 18px;
}

.app-shell__brand-subtitle {
  color: #91a4bd !important;
  font-size: 12px;
  line-height: 16px;
}

.app-shell__body {
  min-width: 0;
}

.app-shell__topbar {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
  padding: 12px 16px 0;
}

.app-shell__content {
  min-height: calc(100vh - 80px);
  padding: 16px;
}
```

- [ ] **Step 4: Replace shell in App**

Modify `src/App.tsx`:

```tsx
import AppShell from './layout/AppShell';
import type { PageKey } from './navigation/appNavigation';
import { questionBankPages } from './navigation/appNavigation';
```

Remove the local `PageKey`, `MenuGroup`, `MENU_GROUPS`, and header rendering. Keep the current `renderPage` switch, then add mappings:

```tsx
case 'today':
  return <TodayWorkbench onNavigate={setCurrentPage} />;
case 'question-bank-tools':
  return <QuestionBankTools />;
```

Replace the JSX return with:

```tsx
return (
  <AppShell currentPage={currentPage} onPageChange={setCurrentPage}>
    {renderPage()}
    <QuestionBasket visible={questionBankPages.includes(currentPage)} />
  </AppShell>
);
```

Set initial page:

```tsx
const [currentPage, setCurrentPage] = useState<PageKey>('today');
```

- [ ] **Step 5: Keep legacy query navigation compatible**

If existing code reads `?page=question-bank-import`, map it before rendering:

```tsx
const normalizePageKey = (page: string | null): PageKey => {
  if (page === 'question-bank-import' || page === 'question-bank-edit' || page === 'question-bank-audit') {
    return 'question-bank-tools';
  }
  return (page || 'today') as PageKey;
};
```

Use this helper in any query-string initialization already present in `App.tsx`.

- [ ] **Step 6: Verify shell**

Run:

```powershell
npm run build
$env:UI_SMOKE_URL='http://localhost:3000'; npm run test:ui-smoke
```

Expected:

```text
Compiled successfully
UI smoke screenshots written to ...
```

- [ ] **Step 7: Commit shell**

```powershell
git add src/App.tsx src/layout/AppShell.tsx src/layout/PageHeaderBar.tsx src/navigation/appNavigation.tsx src/index.css
git commit -m "feat: add left navigation app shell"
```

---

## Task 4: Today Workbench

**Files:**
- Create: `src/pages/TodayWorkbench.tsx`
- Create: `src/components/question-bank/QuestionIssueQueue.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create reusable issue queue**

Create `src/components/question-bank/QuestionIssueQueue.tsx`:

```tsx
import React from 'react';
import { Alert, Button, Empty, List, Space, Tag, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';

const { Text } = Typography;

export type QuestionIssue = {
  id: string;
  title: string;
  subject?: string;
  reason: string;
  updatedAt?: string;
};

type QuestionIssueQueueProps = {
  issues: QuestionIssue[];
  onEdit: (id: string) => void;
};

const QuestionIssueQueue: React.FC<QuestionIssueQueueProps> = ({ issues, onEdit }) => {
  if (!issues.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理问题试题" />;
  }

  return (
    <div className="question-issue-queue">
      <Alert type="warning" showIcon message={`有 ${issues.length} 道问题试题需要处理`} />
      <List
        size="small"
        dataSource={issues}
        renderItem={(issue) => (
          <List.Item
            actions={[
              <Button key="edit" size="small" icon={<EditOutlined />} onClick={() => onEdit(issue.id)}>
                编辑
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space size={6} wrap>
                  <Text strong>{issue.title}</Text>
                  {issue.subject ? <Tag color="blue">{issue.subject}</Tag> : null}
                </Space>
              }
              description={
                <Space direction="vertical" size={2}>
                  <Text type="secondary">{issue.reason}</Text>
                  {issue.updatedAt ? <Text type="secondary">{issue.updatedAt}</Text> : null}
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
};

export default QuestionIssueQueue;
```

- [ ] **Step 2: Create today workbench visual structure**

Create `src/pages/TodayWorkbench.tsx`:

```tsx
import React from 'react';
import { Button, Card, Col, List, Row, Space, Statistic, Tag, Typography } from 'antd';
import {
  CalendarOutlined,
  DollarOutlined,
  FileSearchOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import type { PageKey } from '../navigation/appNavigation';
import QuestionIssueQueue, { QuestionIssue } from '../components/question-bank/QuestionIssueQueue';

const { Text } = Typography;

type TodayWorkbenchProps = {
  onNavigate: (page: PageKey) => void;
};

const sampleIssues: QuestionIssue[] = [];

const TodayWorkbench: React.FC<TodayWorkbenchProps> = ({ onNavigate }) => (
  <div className="app-page today-workbench">
    <Row gutter={[12, 12]}>
      <Col xs={24} sm={12} lg={6}>
        <Card size="small">
          <Statistic title="今日课程" value={0} prefix={<CalendarOutlined />} />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card size="small">
          <Statistic title="待核对费用" value={0} prefix={<DollarOutlined />} />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card size="small">
          <Statistic title="问题试题" value={sampleIssues.length} prefix={<FileSearchOutlined />} />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card size="small">
          <Statistic title="同步状态" value="正常" prefix={<SyncOutlined />} />
        </Card>
      </Col>
      <Col xs={24} lg={14}>
        <Card
          size="small"
          title="今日课程"
          extra={<Button size="small" onClick={() => onNavigate('course-calendar')}>打开课程表</Button>}
        >
          <List
            size="small"
            dataSource={[]}
            locale={{ emptyText: '今天暂无课程' }}
            renderItem={(item: never) => <List.Item>{item}</List.Item>}
          />
        </Card>
      </Col>
      <Col xs={24} lg={10}>
        <Card
          size="small"
          title="题库问题"
          extra={<Button size="small" onClick={() => onNavigate('question-bank-tools')}>进入题库工具</Button>}
        >
          <QuestionIssueQueue
            issues={sampleIssues}
            onEdit={() => onNavigate('question-bank-preview')}
          />
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card
          size="small"
          title="费用核对"
          extra={<Button size="small" onClick={() => onNavigate('revenue-statistics')}>查看明细</Button>}
        >
          <Space direction="vertical" size={8}>
            <Text>费用统计以每一节排课明细为准，右键修改的出勤、学费和课时费会进入核账链路。</Text>
            <Tag color="green">仅正常出勤计入统计</Tag>
          </Space>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card
          size="small"
          title="最近导入与同步"
          extra={<Button size="small" onClick={() => onNavigate('cloud-sync')}>同步诊断</Button>}
        >
          <Text type="secondary">导入异常和同步状态将在这里聚合展示。</Text>
        </Card>
      </Col>
    </Row>
  </div>
);

export default TodayWorkbench;
```

- [ ] **Step 3: Wire today page**

Modify `src/App.tsx` imports:

```tsx
import TodayWorkbench from './pages/TodayWorkbench';
```

Ensure `renderPage()` returns:

```tsx
case 'today':
  return <TodayWorkbench onNavigate={setCurrentPage} />;
```

- [ ] **Step 4: Verify today page**

Run:

```powershell
npm run build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 5: Commit today workbench**

```powershell
git add src/App.tsx src/pages/TodayWorkbench.tsx src/components/question-bank/QuestionIssueQueue.tsx
git commit -m "feat: add today workbench"
```

---

## Task 5: Shared Data Page Template and Pilot Migration

**Files:**
- Create: `src/layout/DataPageLayout.tsx`
- Modify: `src/pages/TeacherList.tsx`
- Modify: `src/pages/StudentList.tsx`
- Modify: `src/pages/CourseList.tsx`

- [ ] **Step 1: Create management layout**

Create `src/layout/DataPageLayout.tsx`:

```tsx
import React from 'react';
import { Card, Drawer, Space } from 'antd';

type DataPageLayoutProps = {
  toolbar: React.ReactNode;
  table: React.ReactNode;
  drawerOpen: boolean;
  drawerTitle: string;
  drawerWidth?: number;
  drawerContent: React.ReactNode;
  onDrawerClose: () => void;
};

const DataPageLayout: React.FC<DataPageLayoutProps> = ({
  toolbar,
  table,
  drawerOpen,
  drawerTitle,
  drawerWidth = 520,
  drawerContent,
  onDrawerClose,
}) => (
  <div className="data-page-layout">
    <Card size="small" className="data-page-layout__toolbar">
      <Space size={8} wrap>
        {toolbar}
      </Space>
    </Card>
    <Card size="small" className="data-page-layout__table">
      {table}
    </Card>
    <Drawer
      title={drawerTitle}
      width={drawerWidth}
      open={drawerOpen}
      onClose={onDrawerClose}
      destroyOnClose
    >
      {drawerContent}
    </Drawer>
  </div>
);

export default DataPageLayout;
```

Add CSS:

```css
.data-page-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.data-page-layout__toolbar,
.data-page-layout__table {
  border: 1px solid var(--app-border-color);
}
```

- [ ] **Step 2: Migrate TeacherList as pilot**

In `src/pages/TeacherList.tsx`, replace the outer `Card` and `Modal` shell with:

```tsx
import DataPageLayout from '../layout/DataPageLayout';
```

Keep the existing state, data loading, form, columns, save and delete functions. In the return block use:

```tsx
return (
  <DataPageLayout
    toolbar={
      <>
        <Button type="primary" onClick={handleAdd}>
          新增老师
        </Button>
        <Input.Search
          allowClear
          placeholder="搜索老师姓名或电话"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          style={{ width: 240 }}
        />
      </>
    }
    table={
      <Table
        rowKey="id"
        columns={columns}
        dataSource={filteredTeachers}
        loading={loading}
        pagination={{ pageSize: 12, showSizeChanger: true }}
        size="middle"
      />
    }
    drawerOpen={modalVisible}
    drawerTitle={editingTeacher ? '编辑老师' : '新增老师'}
    drawerContent={
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        {teacherFormItems}
      </Form>
    }
    onDrawerClose={() => setModalVisible(false)}
  />
);
```

If `teacherFormItems` does not already exist, create it immediately before the return:

```tsx
const teacherFormItems = (
  <>
    <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入老师姓名' }]}>
      <Input />
    </Form.Item>
    <Form.Item name="phone" label="电话">
      <Input />
    </Form.Item>
    <Form.Item name="hourlyRate" label="默认课时费">
      <InputNumber min={0} precision={2} style={{ width: '100%' }} />
    </Form.Item>
  </>
);
```

- [ ] **Step 3: Verify pilot page**

Run:

```powershell
npm run build
```

Expected:

```text
Compiled successfully
```

Open `老师` page and verify:

```text
新增老师 opens a right drawer
编辑老师 opens the same right drawer
table height and actions remain usable
```

- [ ] **Step 4: Migrate StudentList with the same shell**

In `src/pages/StudentList.tsx`, import `DataPageLayout` and keep existing data logic. Use the same return shape, with:

```tsx
drawerTitle={editingStudent ? '编辑学生' : '新增学生'}
drawerWidth={560}
```

Keep student-specific form fields, payment relation displays, and existing delete confirmation behavior unchanged.

- [ ] **Step 5: Migrate CourseList and preserve status switch**

In `src/pages/CourseList.tsx`, import `DataPageLayout` and keep the inline status control added for “未结 / 已结课”. The status column must still call the existing course status update function directly from the table cell.

Use:

```tsx
drawerTitle={editingCourse ? '编辑课程' : '新增课程'}
drawerWidth={620}
```

Keep the sensitive refresh warning from the previous fee-detail work; do not change refresh behavior in this UI task.

- [ ] **Step 6: Verify management pilot group**

Run:

```powershell
npm run build
$env:UI_SMOKE_URL='http://localhost:3000'; npm run test:ui-smoke
```

Expected:

```text
Compiled successfully
UI smoke screenshots written to ...
```

- [ ] **Step 7: Commit management pilot**

```powershell
git add src/layout/DataPageLayout.tsx src/pages/TeacherList.tsx src/pages/StudentList.tsx src/pages/CourseList.tsx src/index.css
git commit -m "feat: migrate core resource pages to drawers"
```

---

## Task 6: Schedule Workbench Layout

**Files:**
- Create: `src/layout/WorkbenchLayout.tsx`
- Modify: `src/pages/ScheduleCalendar.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Create workbench layout**

Create `src/layout/WorkbenchLayout.tsx`:

```tsx
import React from 'react';
import { Button, Card } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';

type WorkbenchLayoutProps = {
  toolbar: React.ReactNode;
  sidebar: React.ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  canvas: React.ReactNode;
};

const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({
  toolbar,
  sidebar,
  sidebarCollapsed,
  onToggleSidebar,
  canvas,
}) => (
  <div className="workbench-layout">
    <Card size="small" className="workbench-layout__toolbar">
      {toolbar}
    </Card>
    <div
      className="workbench-layout__body"
      style={{ gridTemplateColumns: sidebarCollapsed ? '40px minmax(0, 1fr)' : '280px minmax(0, 1fr)' }}
    >
      <Card size="small" className="workbench-layout__sidebar">
        <Button
          className="workbench-layout__sidebar-toggle"
          icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={onToggleSidebar}
        />
        {sidebarCollapsed ? null : sidebar}
      </Card>
      <div className="workbench-layout__canvas">{canvas}</div>
    </div>
  </div>
);

export default WorkbenchLayout;
```

- [ ] **Step 2: Add workbench CSS**

Add:

```css
.workbench-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: calc(100vh - 112px);
}

.workbench-layout__toolbar,
.workbench-layout__sidebar {
  border: 1px solid var(--app-border-color);
}

.workbench-layout__body {
  display: grid;
  gap: 12px;
  min-height: 0;
}

.workbench-layout__sidebar {
  min-width: 0;
}

.workbench-layout__sidebar-toggle {
  width: 28px;
  height: 28px;
  margin-bottom: 8px;
}

.workbench-layout__canvas {
  min-width: 0;
  min-height: 0;
}
```

- [ ] **Step 3: Wrap ScheduleCalendar**

In `src/pages/ScheduleCalendar.tsx`, import:

```tsx
import WorkbenchLayout from '../layout/WorkbenchLayout';
```

Add state near the component root:

```tsx
const [coursePoolCollapsed, setCoursePoolCollapsed] = useState(false);
```

Identify the existing filter/date toolbar, left course pool/sidebar, and calendar canvas. Return them through:

```tsx
return (
  <WorkbenchLayout
    toolbar={calendarToolbar}
    sidebar={coursePoolSidebar}
    sidebarCollapsed={coursePoolCollapsed}
    onToggleSidebar={() => setCoursePoolCollapsed((value) => !value)}
    canvas={calendarCanvas}
  />
);
```

Keep these existing behavior functions unchanged:

```text
drag and drop scheduling
copy course schedule
right-click attendance and fee editing
refresh course info confirmation
student attendance status filtering
```

- [ ] **Step 4: Add stronger refresh warning copy**

Locate the refresh course information confirmation in `src/pages/ScheduleCalendar.tsx`. Ensure the visible copy includes:

```text
刷新课程信息可能覆盖当前排课的学生学费、老师课时费、出勤状态和课程明细。请确认只刷新你当前选中的排课范围。
```

Keep the existing final confirmation button.

- [ ] **Step 5: Verify schedule flows**

Run:

```powershell
npm run build
```

Manual verification in the app:

```text
课程池可折叠和展开
课程表画布宽度随课程池折叠变化
右键课程框仍可修改当前节次费用和出勤
非正常出勤仍不计入费用统计
刷新课程信息仍需要强提示确认
```

- [ ] **Step 6: Commit schedule workbench**

```powershell
git add src/layout/WorkbenchLayout.tsx src/pages/ScheduleCalendar.tsx src/index.css
git commit -m "feat: redesign schedule workbench layout"
```

---

## Task 7: Finance Reconciliation Layout

**Files:**
- Create: `src/layout/StatsPageLayout.tsx`
- Modify: `src/pages/RevenueStatistics.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Create stats layout**

Create `src/layout/StatsPageLayout.tsx`:

```tsx
import React from 'react';
import { Card, Col, Row } from 'antd';

type StatsPageLayoutProps = {
  filters: React.ReactNode;
  metrics: React.ReactNode[];
  summary: React.ReactNode;
  details: React.ReactNode;
};

const StatsPageLayout: React.FC<StatsPageLayoutProps> = ({
  filters,
  metrics,
  summary,
  details,
}) => (
  <div className="stats-page-layout">
    <Card size="small" className="stats-page-layout__filters">
      {filters}
    </Card>
    <Row gutter={[12, 12]}>
      {metrics.map((metric, index) => (
        <Col xs={24} sm={12} lg={6} key={index}>
          <Card size="small" className="stats-page-layout__metric">
            {metric}
          </Card>
        </Col>
      ))}
    </Row>
    <Card size="small" className="stats-page-layout__summary">
      {summary}
    </Card>
    <Card size="small" className="stats-page-layout__details">
      {details}
    </Card>
  </div>
);

export default StatsPageLayout;
```

Add CSS:

```css
.stats-page-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stats-page-layout__filters,
.stats-page-layout__metric,
.stats-page-layout__summary,
.stats-page-layout__details {
  border: 1px solid var(--app-border-color);
}
```

- [ ] **Step 2: Wrap RevenueStatistics**

In `src/pages/RevenueStatistics.tsx`, import:

```tsx
import StatsPageLayout from '../layout/StatsPageLayout';
```

Keep existing calls into `src/utils/financialDetails.ts`. Build metrics as:

```tsx
const metrics = [
  <Statistic title="总学费" value={totalStudentFee} precision={2} prefix="￥" />,
  <Statistic title="总课时费" value={totalTeacherFee} precision={2} prefix="￥" />,
  <Statistic title="净收入" value={netRevenue} precision={2} prefix="￥" />,
  <Statistic title="排课节次" value={scheduleCount} />,
];
```

Use the layout:

```tsx
return (
  <StatsPageLayout
    filters={filterControls}
    metrics={metrics}
    summary={summaryTable}
    details={detailTable}
  />
);
```

The detail table must still include:

```text
上课日期
时间段
科目
学生
老师
时长
单位
学生单价
总学费
老师单价
总课时费
出勤状态
```

- [ ] **Step 3: Verify finance correctness**

Run:

```powershell
npm run build
npm test
```

Manual verification:

```text
正常出勤计入费用统计
请假、旷课、取消和其他非正常状态不计入费用统计
右键课程框修改的当前节次学费和课时费在明细表中显示
课程管理默认价格不覆盖既有排课明细，除非用户明确执行刷新课程信息
```

- [ ] **Step 4: Commit finance layout**

```powershell
git add src/layout/StatsPageLayout.tsx src/pages/RevenueStatistics.tsx src/index.css
git commit -m "feat: redesign finance reconciliation layout"
```

---

## Task 8: Question Bank Compression

**Files:**
- Create: `src/pages/QuestionBankTools.tsx`
- Modify: `src/pages/QuestionBankImport.tsx`
- Modify: `src/pages/QuestionBankPreview.tsx`
- Modify: `src/pages/QuestionBankPaper.tsx`
- Modify: `src/components/QuestionBasket.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create QuestionBankTools shell**

Create `src/pages/QuestionBankTools.tsx`:

```tsx
import React from 'react';
import { Alert, Button, Card, Col, Row, Space, Tabs, Typography } from 'antd';
import { ImportOutlined, PartitionOutlined, ProfileOutlined, WarningOutlined } from '@ant-design/icons';
import QuestionBankImport from './QuestionBankImport';
import QuestionIssueQueue from '../components/question-bank/QuestionIssueQueue';

const { Text } = Typography;

const QuestionBankTools: React.FC = () => (
  <div className="question-bank-tools">
    <Alert
      type="info"
      showIcon
      message="题库工具聚合知识树、模型树、导入、统计和问题试题处理；正式组卷仍在独立页面完成。"
    />
    <Row gutter={[12, 12]} className="question-bank-tools__stats">
      <Col xs={24} md={6}>
        <Card size="small">
          <Space>
            <PartitionOutlined />
            <Text>知识树与模型树</Text>
          </Space>
        </Card>
      </Col>
      <Col xs={24} md={6}>
        <Card size="small">
          <Space>
            <ImportOutlined />
            <Text>导入任务</Text>
          </Space>
        </Card>
      </Col>
      <Col xs={24} md={6}>
        <Card size="small">
          <Space>
            <ProfileOutlined />
            <Text>题库统计</Text>
          </Space>
        </Card>
      </Col>
      <Col xs={24} md={6}>
        <Card size="small">
          <Space>
            <WarningOutlined />
            <Text>问题队列</Text>
          </Space>
        </Card>
      </Col>
    </Row>
    <Tabs
      items={[
        {
          key: 'import',
          label: '导入与树维护',
          children: <QuestionBankImport embedded />,
        },
        {
          key: 'issues',
          label: '问题试题',
          children: <QuestionIssueQueue issues={[]} onEdit={() => window.dispatchEvent(new CustomEvent('question-bank-open-library'))} />,
        },
        {
          key: 'stats',
          label: '统计',
          children: <Card size="small"><Button>刷新统计</Button></Card>,
        },
      ]}
    />
  </div>
);

export default QuestionBankTools;
```

- [ ] **Step 2: Add embedded mode to QuestionBankImport**

In `src/pages/QuestionBankImport.tsx`, change props:

```tsx
type QuestionBankImportProps = {
  embedded?: boolean;
};

const QuestionBankImport: React.FC<QuestionBankImportProps> = ({ embedded = false }) => {
```

When `embedded` is true, hide any page-level title card that duplicates the `QuestionBankTools` title. Keep import actions, tree editing, task drawer, and quality report content available.

- [ ] **Step 3: Rename visible preview flow as 试题库**

In `src/pages/QuestionBankPreview.tsx`, keep the component name for minimal churn but adjust visible page wording:

```text
预览中心 -> 试题库
审核 -> 问题标记
加入组卷 -> 加入试题篮
```

Move the edit action below the question stem/answer/analysis reading area. The edit action opens the existing large edit modal or drawer; do not use a narrow side panel for full question content editing.

- [ ] **Step 4: Remove independent audit entry**

In `src/App.tsx`, remove any `question-bank-audit` visible route from navigation. Keep a compatibility route:

```tsx
case 'question-bank-audit':
  return <QuestionBankTools />;
```

In problem handling, replace approval language with:

```text
标记问题
取消问题标记
删除试题
编辑修正
```

- [ ] **Step 5: Keep paper page independent**

In `src/pages/QuestionBankPaper.tsx`, update only shell spacing and title language. Preserve:

```text
试卷结构展示
题号调整
试题增删
分值设置
答案位置
导出设置
```

- [ ] **Step 6: Verify question-bank flows**

Run:

```powershell
npm run build
```

Manual verification:

```text
左侧导航只有 题库工具 / 试题库 / 组卷 三个题库入口
知识树和模型树仍可编辑
试题导入仍可执行
试题题干、答案和解析有足够宽度阅读
编辑从题干下方进入大弹窗或宽抽屉
问题试题可置顶提示、编辑修正、删除、取消标记
试题篮点击去组卷后进入独立组卷页
独立审核中心不再出现
```

- [ ] **Step 7: Commit question-bank compression**

```powershell
git add src/App.tsx src/pages/QuestionBankTools.tsx src/pages/QuestionBankImport.tsx src/pages/QuestionBankPreview.tsx src/pages/QuestionBankPaper.tsx src/components/QuestionBasket.tsx
git commit -m "feat: compress question bank workflow"
```

---

## Task 9: Remaining Management Pages and System Center

**Files:**
- Modify: `src/pages/InstitutionManager.tsx`
- Modify: `src/pages/SchoolManager.tsx`
- Modify: `src/pages/RoomManager.tsx`
- Modify: `src/pages/PaymentList.tsx`
- Modify: `src/pages/PermissionManager.tsx`
- Modify: `src/pages/AdminList.tsx`
- Modify: `src/pages/InviteeList.tsx`
- Modify: `src/pages/MenuManage.tsx`
- Modify: `src/pages/SystemParams.tsx`
- Modify: `src/pages/OperateLog.tsx`
- Modify: `src/pages/CloudSync.tsx`

- [ ] **Step 1: Apply DataPageLayout to institution, school, and room**

For each of these pages, import:

```tsx
import DataPageLayout from '../layout/DataPageLayout';
```

Use a toolbar with search and create actions, table in the main card, and drawer for create/edit forms. Preserve existing validation rules and delete confirmations.

- [ ] **Step 2: Apply DataPageLayout to payment records**

In `src/pages/PaymentList.tsx`, keep financial fields and existing save logic. Use drawer width:

```tsx
drawerWidth={620}
```

Manual verification:

```text
新增缴费记录 opens drawer
编辑缴费记录 preserves amount, student, payment date and note
删除 still requires confirmation
```

- [ ] **Step 3: Apply DataPageLayout to permission/admin/invitee**

Keep permission-sensitive actions visible but restrained. Destructive account actions continue using `Popconfirm` or the existing confirmation modal.

- [ ] **Step 4: Apply system page styling**

For `MenuManage`, `SystemParams`, `OperateLog`, and `CloudSync`, keep their current data logic. Wrap top controls in `.app-panel` or `DataPageLayout` depending on whether the page is table-first.

- [ ] **Step 5: Verify remaining pages**

Run:

```powershell
npm run build
$env:UI_SMOKE_URL='http://localhost:3000'; npm run test:ui-smoke
```

Expected:

```text
Compiled successfully
UI smoke screenshots written to ...
```

- [ ] **Step 6: Commit remaining pages**

```powershell
git add src/pages/InstitutionManager.tsx src/pages/SchoolManager.tsx src/pages/RoomManager.tsx src/pages/PaymentList.tsx src/pages/PermissionManager.tsx src/pages/AdminList.tsx src/pages/InviteeList.tsx src/pages/MenuManage.tsx src/pages/SystemParams.tsx src/pages/OperateLog.tsx src/pages/CloudSync.tsx
git commit -m "feat: align system and resource pages"
```

---

## Task 10: Visual Regression and Release

**Files:**
- Modify: `package.json`
- Generated: `dist/*`

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
npm run build
$env:UI_SMOKE_URL='http://localhost:3000'; npm run test:ui-smoke
```

Expected:

```text
npm test exits 0
Compiled successfully
UI smoke screenshots written to ...
```

- [ ] **Step 2: Manual screen checklist**

Check screenshots under:

```text
tmp/ui-smoke
```

Required visual outcomes:

```text
left sidebar navigation is visible and grouped
page headers use dark title text and fine borders
management pages use toolbar + table + right drawer
schedule page has collapsible course pool and large canvas
finance page shows metrics first and detail rows remain traceable
question bank has three entries only
question content area is wide enough for stem, answer and analysis
no button text is clipped
no table toolbar overlaps at 1440px desktop
```

- [ ] **Step 3: Bump package version for release**

Increment `package.json` from `5.0.8` to the next patch version:

```json
"version": "5.0.9"
```

If another release already used `5.0.9`, increment to the next unused patch version.

- [ ] **Step 4: Commit release code**

```powershell
git add -A
git commit -m "自动发布 2026-06-11"
```

- [ ] **Step 5: Push over SSH to all remotes**

Run:

```powershell
git remote -v
git push origin HEAD
git push gewu HEAD
```

Expected remote URLs must be SSH:

```text
git@github.com:YellMoon/scheduling-system.git
git@github.com:YellMoon/gewu-gongfang.git
```

Do not push to an `https://` remote.

- [ ] **Step 6: Build installer**

Run:

```powershell
npm run build
npx electron-builder --win
```

Expected:

```text
dist contains a Windows installer for the new package version
```

- [ ] **Step 7: Upload installer to Quark**

Run:

```powershell
node scripts/upload-quark-clean.js
```

Expected:

```text
installer uploaded to codex项目/2026-06-11/
```

Do not use `node scripts/upload-quark.js`.

---

## Self-Review

### Spec Coverage

- Overall style and left grouped navigation: Task 2 and Task 3.
- Page context toolbar: Task 3 through `PageHeaderBar`.
- Balanced compact density, dark titles, fine borders: Task 2 CSS and Ant Design theme.
- Management pages toolbar/table/right drawer: Task 5 and Task 9.
- Schedule workbench with collapsible course pool and large canvas: Task 6.
- Refresh course information warning: Task 6.
- Finance reconciliation based on schedule details: Task 7.
- Question bank compression to tools/library/paper: Task 8.
- Independent audit center removal: Task 8.
- Today aggregation page: Task 4.
- Visual screenshots and release flow: Task 1 and Task 10.

### Type Consistency

- `PageKey` is defined once in `src/navigation/appNavigation.tsx`.
- `AppShell` receives `PageKey`, `onPageChange`, and `children`.
- `QuestionIssueQueue` receives `QuestionIssue[]` and `onEdit`.
- Layout components receive React nodes and do not own business state.

### Release Constraints

- Plan and design-doc commits do not modify product code and do not require installer upload.
- Any actual code execution of this plan must follow the AGENTS.md release flow after code changes: version bump, commit `自动发布 2026-06-11`, SSH push to all remotes, build installer, upload with `node scripts/upload-quark-clean.js`.
