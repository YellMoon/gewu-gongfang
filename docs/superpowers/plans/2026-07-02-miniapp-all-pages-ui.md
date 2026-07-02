# Miniapp All Pages UI Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize every WeChat miniapp page in 格物工坊 across admin, student, guest, empty, offline, forbidden, and limited-write states.

**Architecture:** Keep the existing Taro page structure and use shared SCSS primitives for warm-neutral surfaces, deep-teal navigation, restrained admin density, student-friendly learning surfaces, and no emoji-as-assets. Add a page inventory plus automated coverage test so completion cannot be claimed from homepage-only QA.

**Truthfulness Constraint:** Every visible function entry, button, menu label, metric, status, and explanatory copy must be grounded in a real route, API, task type, permission module, local data field, or implemented flow in this repository. Do not invent product features or fake clickable entries for visual polish.

**Tech Stack:** Taro 3, React 18, SCSS, Node-based inventory tests, H5/WeApp builds, Playwright screenshot smoke.

---

### Task 1: Completion Gate And Page Inventory

**Files:**
- Modify: `AGENTS.md`
- Create: `miniapp/src/utils/miniappUiPageInventory.js`
- Create: `miniapp/src/utils/miniappUiCoverage.test.js`
- Modify: `package.json`
- Create: `docs/miniapp-ui-page-inventory-2026-07-02.md`

- [ ] **Step 1: Persist the rule**
  Add rules that every miniapp UI completion claim must cover all registered routes, the registered `pages/forbidden/index` state page, admin and student role paths, screenshots/check records, and the `miniappUiCoverage` test.

- [ ] **Step 2: Encode the inventory**
  Add one inventory entry per route with `route`, `title`, `registered`, `roleViews`, `surface`, `visualStatus`, `verificationStates`, `screenshotRequired`, and `files`.

- [ ] **Step 3: Add the test**
  Parse `miniapp/src/app.config.ts`, compare registered pages to inventory, assert admin/student/guest coverage, assert all entries are optimized, assert all source/style files exist, and scan UI source for emoji assets.

- [ ] **Step 4: Wire the test**
  Add `node miniapp/src/utils/miniappUiCoverage.test.js` to the root `npm test` chain after the existing miniapp visual test.

### Task 2: Shared Design System

**Files:**
- Modify: `miniapp/src/app.config.ts`
- Modify: `miniapp/src/app.scss`
- Modify: `miniapp/src/components/shared.tsx`
- Modify: `miniapp/src/components/shared.scss`
- Modify: `miniapp/src/custom-tab-bar/index.tsx`
- Modify: `miniapp/src/custom-tab-bar/index.scss`

- [ ] **Step 1: Switch global chrome**
  Use `#f7f4ee` page background, `#172033` text, `#1f6f68` primary, warm off-white cards, subdued borders, no negative letter spacing, and stable rpx dimensions.

- [ ] **Step 2: Replace emoji icons**
  Use compact Chinese mark badges such as `空`, `离`, `首`, `课`, `生`, `账`, `我` instead of emoji or rough text glyphs.

- [ ] **Step 3: Normalize shared components**
  Make `EmptyState`, `NetworkStatus`, `StatCard`, loading rows, tabbar icons, cards, tags, and buttons visually consistent across every page.

### Task 3: Admin Surfaces

**Files:**
- Modify: `miniapp/src/pages/students/index.tsx`
- Modify: `miniapp/src/pages/students/index.scss`
- Modify: `miniapp/src/pages/courses/index.tsx`
- Modify: `miniapp/src/pages/courses/index.scss`
- Modify: `miniapp/src/pages/teachers/index.tsx`
- Modify: `miniapp/src/pages/teachers/index.scss`
- Modify: `miniapp/src/pages/payments/index.tsx`
- Modify: `miniapp/src/pages/payments/index.scss`
- Modify: `miniapp/src/pages/stats/index.tsx`
- Modify: `miniapp/src/pages/stats/index.scss`
- Modify: `miniapp/src/pages/assets/index.tsx`
- Modify: `miniapp/src/pages/assets/index.scss`
- Modify: `miniapp/src/pages/admin/users/index.tsx`
- Modify: `miniapp/src/pages/admin/users/index.scss`
- Modify: `miniapp/src/pages/admin/invitations/index.tsx`
- Modify: `miniapp/src/pages/admin/invitations/index.scss`

- [ ] **Step 1: Add admin page rhythm**
  Use compact headers, segmented filters, list rows, finance summaries, permission panels, and consistent tags suitable for repeated operational use.

- [ ] **Step 2: Remove old bright-blue/gray styling**
  Replace `#1890ff`-dominant UI with deep teal, amber, green, indigo, and semantic red used sparingly.

- [ ] **Step 3: Preserve existing behavior**
  Keep search, filters, tab switching, task submission, permission granting, revocation, and navigation behavior intact.

### Task 4: Student And Shared Role Surfaces

**Files:**
- Modify: `miniapp/src/pages/login/index.tsx`
- Modify: `miniapp/src/pages/login/index.scss`
- Modify: `miniapp/src/pages/index/index.tsx`
- Modify: `miniapp/src/pages/index/index.scss`
- Modify: `miniapp/src/pages/schedule/index.tsx`
- Modify: `miniapp/src/pages/schedule/index.scss`
- Modify: `miniapp/src/pages/schedule/detail/index.tsx`
- Modify: `miniapp/src/pages/schedule/detail/detail.scss`
- Modify: `miniapp/src/pages/schedule/edit/index.tsx`
- Modify: `miniapp/src/pages/schedule/edit/edit.scss`
- Modify: `miniapp/src/pages/student-detail/index.tsx`
- Modify: `miniapp/src/pages/student-detail/index.scss`
- Modify: `miniapp/src/pages/question-bank/index.tsx`
- Modify: `miniapp/src/pages/question-bank/index.scss`
- Modify: `miniapp/src/pages/settings/index.tsx`
- Modify: `miniapp/src/pages/settings/index.scss`
- Modify: `miniapp/src/pages/forbidden/index.tsx`
- Modify: `miniapp/src/pages/forbidden/index.scss`

- [ ] **Step 1: Make student role feel intentional**
  Keep home, schedule, question bank, settings, and linked detail pages calmer and clearer than admin pages, with read-only/limited-write boundaries visible.

- [ ] **Step 2: Modernize status pages**
  Upgrade login, forbidden, missing record, empty, and schedule-edit limitation screens so they are not leftover utility pages.

- [ ] **Step 3: Remove visible emoji**
  Replace login toasts, empty-state icons, network symbols, settings symbols, and footer labels with native text or badge marks.

### Task 5: Verification, Record, Commit

**Files:**
- Create: `docs/verification-2026-07-02-miniapp-ui.md`

- [ ] **Step 1: Run static checks**
  Run `node miniapp/src/utils/miniappUiCoverage.test.js`, `node miniapp/src/utils/miniappHomeVisual.test.js`, and `git diff --check`.

- [ ] **Step 2: Build the miniapp**
  Run `npm --prefix miniapp run build:h5` for screenshot QA and `npm run miniapp:release-check` for WeApp release readiness.

- [ ] **Step 3: Capture all-page screenshots**
  Use Browser plugin first when viable; if localStorage/API mocking blocks it, record the fallback and use Playwright. Save screenshots outside the repo and list them in the verification doc.

- [ ] **Step 4: Run project tests**
  Run `npm test`.

- [ ] **Step 5: Commit and push**
  Run `git add -A`, `git commit -m "自动发布 2026-07-02"`, and `git push gewu master`.
