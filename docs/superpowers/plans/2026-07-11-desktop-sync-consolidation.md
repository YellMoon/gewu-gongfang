# Desktop Sync Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone complex sync page with a role-aware top-bar sync panel and move advanced sync configuration and maintenance into System Settings.

**Architecture:** Extract pure presentation rules and a shared desktop-sync controller/provider from the current `SyncSettings` page. `AppShell` consumes the shared controller through a compact popover; `SystemSettings` renders advanced controls. Legacy `cloud-sync` navigation resolves to `system-params` with sync context.

**Tech Stack:** React 18, TypeScript 4.9, Ant Design 5, existing CRDT sync engine and one-click sync service, Node test scripts.

---

### Task 1: Role-aware presentation contract

**Files:** Create `src/services/syncPresentation.mjs`; create `src/services/syncPresentation.test.js`.

- [ ] Write a failing test asserting that `desktop-client` produces an explicit bidirectional host-sync action and upload/download explanation, while `primary-host` produces request/conflict management labels and no client action.
- [ ] Run `node src/services/syncPresentation.test.js`; expect module-not-found failure.
- [ ] Implement `getSyncPresentation(nodeRole, status)` returning role, title, status text, primary label, helper text, and host/client action flags.
- [ ] Re-run the test; expect pass.

### Task 2: Shared sync controller

**Files:** Create `src/sync/DesktopSyncContext.tsx`; modify `src/App.tsx`; reuse existing one-click sync services.

- [ ] Extend the presentation test for empty, pending, offline, waiting, failed, and success summary copy; verify failure.
- [ ] Implement `DesktopSyncProvider` and `useDesktopSync` by extracting engine initialization, runtime config loading, status refresh, transport selection, preview confirmation, authorized upload, pull, bidirectional sync, and reset handlers.
- [ ] Preserve preview, explicit confirmation, authorization, queue retention, relay waiting, and destructive reset safeguards.
- [ ] Wrap the shell with the provider and re-run the presentation test; expect pass.

### Task 3: Compact top-bar sync panel

**Files:** Create `src/components/sync/SyncQuickPanel.tsx` and `.css`; modify `src/layout/AppShell.tsx` and `.css`.

- [ ] Add failing static UI regression assertions for explicit bidirectional copy, host labels, and removal of the old static sync tag.
- [ ] Implement a keyboard-reachable Ant Design `Popover` status entry with meaningful state color/text.
- [ ] Implement the client panel with pending count, last result/time, one primary action, approved helper text, loading, disabled, waiting, failure, and success states.
- [ ] Implement the host panel with request/conflict status and System Settings review navigation.
- [ ] Add responsive CSS and re-run `node src/uiRegression.test.js`; expect pass.

### Task 4: Merge advanced controls into System Settings

**Files:** Create `src/components/sync/SyncAdvancedSettings.tsx`; modify `src/pages/SystemSettings.tsx` and `src/pages/SyncSettings.tsx`.

- [ ] Add failing regression assertions for a data-sync section and collapsed advanced details in System Settings.
- [ ] Build `SyncAdvancedSettings` from protocol, engine diagnostics, upload-only, pull-only, conflict review, and reset controls.
- [ ] Render it in System Settings under stable anchor `sync-settings`; keep reset separated and confirmed.
- [ ] Reduce `SyncSettings.tsx` to a compatibility adapter so no duplicate controller remains; re-run regression and sync tests.

### Task 5: Navigation consolidation

**Files:** Modify `src/navigation/appNavigation.tsx`, `src/navigation/navigationContext.ts`, `src/App.tsx`, and `src/layout/AppShell.tsx`.

- [ ] Add failing assertions that `cloud-sync` is absent from visible navigation and legacy requests resolve to `system-params` sync context.
- [ ] Remove the visible standalone sync menu item while retaining only required compatibility metadata.
- [ ] Normalize legacy navigation and scroll/focus the `sync-settings` section.
- [ ] Run navigation/UI regression tests; expect pass.

### Task 6: Verification and visual QA

**Files:** Update `task.md`; keep temporary browser artifacts outside committed source.

- [ ] Run targeted presentation, one-click service, transport, and UI regression tests.
- [ ] Run `npm run build`; require success.
- [ ] Use the in-app Browser path to verify page identity, content, overlays, console health, client interaction, confirmation content, host/settings navigation, and advanced collapse.
- [ ] Capture desktop and narrow screenshots; check clipping, overlap, focus, contrast, loading, empty, offline/waiting, conflict, and destructive confirmation states that can be safely exercised.
- [ ] Run `git diff --check` and inspect the final diff for unrelated changes or fake controls.

### Task 7: Publish desktop update

**Files:** Version and release artifacts generated by project scripts.

- [ ] Run `npm test`; require pass.
- [ ] Commit focused implementation with `git add -A` and the project-standard automatic-release commit message.
- [ ] Push with `git push gewu master`; verify success.
- [ ] Run `npm run dist:win`; verify version bump, installer generation, Electron native rebuild, and restored Node native dependencies.
- [ ] Run `npm run publish:desktop-update`; verify OSS feed version and installer reference.
- [ ] Run post-package native and smoke checks; commit/push generated version changes if they occur after the first commit.
