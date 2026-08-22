# Miniapp Cloud Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace old miniapp accounts and JWTs with new cloud accounts created after WeChat phone verification.

**Architecture:** A separate cloud account service verifies a one-time WeChat phone proof, hashes it in-process, atomically creates or reads a cloud account, and returns a dedicated short-lived two-part miniapp ticket. The configured bootstrap-phone HMAC is the only source of the initial `super_admin` role. The miniapp uses only this service; legacy gateway login is never a fallback.

**Tech Stack:** Node.js, Express, PostgreSQL, WeChat phone verification, Taro/React, node:assert.

---

### Task 1: Cloud identity service

**Files:** Create `cloud-business-api/src/miniappCloudAccountService.js`; test `cloud-business-api/src/miniappCloudAccountService.test.js`; modify `cloud-business-api/package.json`.

- [ ] Write a failing service test: call `login({ phoneCode: 'admin-proof' })`, assert the role is `super_admin`, then assert a three-part legacy JWT passed to `context` rejects with `CLOUD_MINIAPP_IDENTITY_REJECTED`.
- [ ] Run `node cloud-business-api/src/miniappCloudAccountService.test.js`; expect module-not-found failure.
- [ ] Export `createMiniappCloudAccountService({ now, phoneVerifier, phoneHmac, bootstrapAdminPhoneHmac, accountRepository, ticketSecret })`. Accept only `{ phoneCode }`; issue only `{v:1,kind:'miniapp-cloud',accountId,expiresAt}` signed two-part tickets; reject malformed, expired, wrong-kind and three-part legacy JWTs. Assign `super_admin` only when the HMAC matches; every other new account is `pending_authorization` with no role.
- [ ] Run `node cloud-business-api/src/miniappCloudAccountService.test.js`; expect exit 0.
- [ ] Commit service and test: `git add cloud-business-api/src/miniappCloudAccountService.* cloud-business-api/package.json && git commit -m "feat: add cloud miniapp account service"`.

### Task 2: Cloud persistence and HTTP boundary

**Files:** Create `cloud-business-api/sql/20260822-miniapp-cloud-accounts.sql`; modify `cloud-business-api/server.js`, `cloud-business-api/src/app.js`, and `cloud-business-api/src/app.test.js`.

- [ ] Write a failing HTTP test for `POST /api/miniapp/cloud-login` with exactly `{phoneCode}` and a 403 rejection when `/api/business/schedules` receives `Bearer old.jwt.token`.
- [ ] Run `node cloud-business-api/src/app.test.js`; expect the new endpoint assertion to fail.
- [ ] Add constrained account and role-grant tables. In `server.js`, build a parameterized repository and load only `CLOUD_MINIAPP_TICKET_SECRET`, `CLOUD_MINIAPP_PHONE_PEPPER`, and `CLOUD_MINIAPP_BOOTSTRAP_ADMIN_PHONE_HMAC`. No raw phone reaches SQL or logs. Add the login endpoint and reconstruct the miniapp context server-side before authorizing routes.
- [ ] Run `npm.cmd --prefix cloud-business-api test`; expect exit 0.
- [ ] Commit: `git add cloud-business-api/sql/20260822-miniapp-cloud-accounts.sql cloud-business-api/server.js cloud-business-api/src/app.js cloud-business-api/src/app.test.js && git commit -m "feat: add miniapp cloud login endpoint"`.

### Task 3: Miniapp login replacement

**Files:** Modify `miniapp/src/pages/login/index.tsx`, `miniapp/src/pages/login/manualPhoneLoginRuntime.ts`, `miniapp/src/pages/login/manualPhoneLoginRuntime.test.js`, and `miniapp/src/utils/miniappApiRoutingRuntime.test.js`.

- [ ] Write source-contract tests which require `/api/miniapp/cloud-login` and reject both `/api/auth/wechat-login` and `normalizeManualPhone` in the login page.
- [ ] Run `node miniapp/src/pages/login/manualPhoneLoginRuntime.test.js`; expect an old-route contract failure.
- [ ] Use `Taro.login()` plus supported WeChat phone authorization to obtain `phoneCode`; post exactly `{phoneCode}` to the new endpoint; atomically commit returned `{token,identity}`. Render `pending_authorization` for an unassigned account. Remove manual phone input and never call the legacy login URL.
- [ ] Run `node miniapp/src/pages/login/manualPhoneLoginRuntime.test.js; node miniapp/src/utils/miniappApiRoutingRuntime.test.js; npm.cmd --prefix miniapp run typecheck`; expect exit 0.
- [ ] Commit: `git add miniapp/src/pages/login miniapp/src/utils/miniappApiRoutingRuntime.test.js && git commit -m "feat: switch miniapp to new cloud accounts"`.

### Task 4: Isolation and final gate

**Files:** Modify `docs/superpowers/specs/2026-08-22-miniapp-new-cloud-account-design.md`; verify `docs/release-version-matrix.md`.

- [ ] Add integration tests for bootstrap admin, new pending account, phone-proof replay rejection, old-token rejection, account disablement, and client-supplied role/account rejection.
- [ ] Run `npm.cmd --prefix cloud-business-api test; npm.cmd --prefix miniapp run typecheck; npm.cmd run test:cloud-schedule; git diff --check`; expect all commands to exit 0.
- [ ] Commit and push source only. Do not deploy cloud code, publish desktop updates, upload a miniapp build, submit review, or release production. Those actions require the entire goal to pass an independent 5.6-sol audit.
