# Desktop Business Draft Cloud Submit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route confirmed desktop business drafts to existing cloud business REST authority contracts and fail closed for types without an approved cloud contract.

**Architecture:** The encrypted outbox retains stable typed drafts. Electron main invokes cloud business methods through the desktop identity client. Update/delete drafts carry the observed `updated_at`; session tokens exist only for the IPC call.

**Tech Stack:** Electron main/preload, React/TypeScript, Node ESM/CJS, cloud-business-api REST, Node assert tests.

---

### Task 1: Freeze the business draft mapping contract

**Files:**
- Create: `src/services/desktopCloudBusinessDraft.test.js`
- Create: `src/services/desktopCloudBusinessDraft.mjs`

- [x] Write failing tests for student, teacher, room, course lifecycle and schedule update snake_case mappings.
- [x] Run `node src/services/desktopCloudBusinessDraft.test.js` and observe the expected missing-module/function failure.
- [x] Implement minimal command sealing, version validation, contact mapping, dispatch, and stable receipts.
- [x] Re-run the test and confirm it passes.

### Task 2: Connect the runtime to cloud business authority

**Files:**
- Modify: `public/desktopAuthorityRuntime.js`
- Modify: `public/desktopAuthorityRuntime.test.js`
- Modify: `src/services/desktopAuthorityClient.mjs`
- Modify: `src/services/desktopAuthorityClient.test.js`
- Modify: `package.json`

- [x] Write failing tests proving business confirmation requires a session, calls only `/api/business/**`, never calls `/api/authority/commands`, and unsupported business types fail closed.
- [x] Run focused tests and observe the expected failures.
- [x] Instantiate the desktop identity client in main and inject the business adapter; expand business type recognition and remove business fallback.
- [x] Re-run focused tests and confirm they pass.

### Task 3: Capture optimistic-concurrency baselines

**Files:**
- Modify: `src/services/browserDatabase.ts`
- Modify: `src/services/browserDatabaseSyncCapture.test.js`

- [x] Write failing assertions that update/delete operations preserve prior `updated_at` as `baseVersion`.
- [x] Run `node src/services/browserDatabaseSyncCapture.test.js` and observe the expected failure.
- [x] Minimally update mutation methods and schedule batch changes, preserving versionless create semantics.
- [x] Re-run the test and confirm it passes.

### Task 4: Unify session input and UI regression coverage

**Files:**
- Modify: `src/components/AuthorityOutboxPanel.tsx`
- Modify: `src/components/AuthorityOutboxPanel.cloudQuestion.test.js`
- Modify: `src/custom.d.ts`

- [x] Write a failing test that both business and question drafts obtain the current desktop authorization token.
- [x] Run the focused test and observe the expected failure.
- [x] Replace the question-only helper with a cloud-draft submission helper without persisting tokens.
- [x] Re-run the test and confirm it passes.

### Task 5: Verify and audit boundaries

**Files:**
- Modify: `task.md`

- [x] Run all new and focused runtime, outbox, browser database, and panel tests.
- [x] Run `npm run test:authority-architecture`, `npm run test:desktop-identity`, `npm --prefix cloud-business-api test`, miniapp type checks, and the root build.
- [x] Prove known business drafts cannot call `/api/authority/commands`; record restricted types.
- [x] Update task status, rollback evidence, and multi-end release limitations.

### Task 6: Commit, push, and desktop update

**Files:**
- Modify: `package.json` only through the version workflow.

- [ ] Verify the diff excludes user-owned `output/` directories and unrelated changes.
- [ ] After fresh final verification, stage only this phase's files while explicitly excluding protected user-owned `output/` directories, commit with the required release message, and push `gewu master`.
- [ ] Determine the version bump, build Windows artifacts, publish OSS update metadata, and verify installer plus `latest.yml`.
- [ ] Restore and verify Node native dependencies. Report only partial release if any applicable endpoint remains undeployed or externally blocked.
