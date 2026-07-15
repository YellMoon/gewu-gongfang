# Miniapp Review Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent, server-enforced, data-isolated administrator/student review experience with sandboxed paper composition and DOCX/PDF export.

**Architecture:** The gateway issues short-lived synthetic review JWTs and routes them to static demo data plus an in-memory export sandbox. A review firewall rejects every non-sandbox mutation. The miniapp maps explicit review capabilities to existing pages and routes question-paper operations to the sandbox without changing normal-user behavior.

**Tech Stack:** Node.js, Express, jsonwebtoken, better-sqlite3 test fixtures, docx, pdfkit, React/Taro, CommonJS focused tests, existing release scripts.

---

## File map

- `gateway/src/services/reviewDemoSession.js`: code validation, claims, synthetic identity, token classification.
- `gateway/src/services/reviewDemoData.js`: deterministic fictional snapshots and questions.
- `gateway/src/services/reviewDemoSandbox.js`: validated, session-scoped in-memory tasks and artifacts.
- `gateway/src/middleware/reviewDemoGuard.js`: fail-closed mutation firewall.
- `gateway/src/routes/reviewDemo.js`: sandbox task and artifact HTTP surface.
- `miniapp/src/utils/reviewExperience.js`: review identity, cache keys, API routing, and cleanup helpers.
- `miniapp/src/components/ReviewDemoBanner.tsx`: shared read-only status banner.

### Task 1: Review session authentication

**Files:**
- Create: `gateway/src/services/reviewDemoSession.js`
- Create: `gateway/src/services/reviewDemoSession.test.js`
- Modify: `gateway/src/routes/auth.js`
- Modify: `gateway/src/middleware/auth.js`
- Modify: `gateway/src/routes/miniappPhoneLogin.http.test.js`

- [x] **Step 1: Write failing session tests**

Test missing/short configuration, wrong code, invalid role, correct admin/student claims, two-hour expiry, issuer/audience/token-use validation, and synthetic identities without phone/openid.

```js
assert.throws(() => issueReviewDemoToken({ code: 'wrong', role: 'admin' }, env), /REVIEW_DEMO_CODE_INVALID/);
const issued = issueReviewDemoToken({ code: env.MINIAPP_REVIEW_EXPERIENCE_CODE, role: 'student' }, env);
assert.deepStrictEqual([issued.user.user_type, issued.user.is_review_demo, issued.user.read_only], ['student', true, true]);
assert.strictEqual(parseReviewDemoToken(issued.token, env).token_use, 'review-demo');
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node gateway/src/services/reviewDemoSession.test.js`
Expected: module-not-found failure for `reviewDemoSession`.

- [x] **Step 3: Implement fail-closed session primitives**

Use timing-safe SHA-256 digest comparison, role allowlisting, random UUID session IDs, strict JWT options, and a synthetic identity factory. Export only focused functions used by routes and middleware.

- [x] **Step 4: Add the public login route and middleware branch**

Add `POST /api/auth/review-demo` behind a dedicated rate limiter. In `authMiddleware` and `optionalAuth`, accept a token as review-demo only after strict claim validation; otherwise follow the existing persisted-user lookup. Reject review tokens from `/api/auth/refresh`.

- [x] **Step 5: Verify focused and normal-login tests**

Run: `node gateway/src/services/reviewDemoSession.test.js && node gateway/src/routes/miniappPhoneLogin.http.test.js`
Expected: both exit 0; existing phone approval assertions remain unchanged.

- [x] **Step 6: Commit**

Run: `git add gateway/src/services/reviewDemoSession.js gateway/src/services/reviewDemoSession.test.js gateway/src/routes/auth.js gateway/src/middleware/auth.js gateway/src/routes/miniappPhoneLogin.http.test.js && git commit -m "automatic release 2026-07-14"`

### Task 2: Demo data, capabilities, and mutation firewall

**Files:**
- Create: `gateway/src/services/reviewDemoData.js`
- Create: `gateway/src/services/reviewDemoData.test.js`
- Create: `gateway/src/middleware/reviewDemoGuard.js`
- Create: `gateway/src/middleware/reviewDemoGuard.test.js`
- Modify: `gateway/src/services/authorizationPolicy.js`
- Modify: `gateway/src/services/authorizationPolicy.test.js`
- Modify: `gateway/src/routes/permissions.js`
- Modify: `gateway/src/routes/cloudRelay.js`
- Modify: `gateway/src/routes/cloudRelay.http.test.js`
- Modify: `gateway/src/app.js`

- [x] **Step 1: Write failing isolation tests**

Assert that administrator and student snapshots are deterministic, contain no phone/openid/real host identifiers, student data is linked-student scoped, and review capabilities exclude all real writes.

```js
const admin = buildReviewSnapshot('admin');
const student = buildReviewSnapshot('student');
assert.ok(admin.students.length > student.students.length);
assert.ok(!JSON.stringify(admin).match(/phone|openid|13732250653/));
assert.deepStrictEqual(reviewCapabilities('admin').sort(), ['question-bank:view','review-demo:admin','review-demo:paper-export','review-demo:read'].sort());
```

- [x] **Step 2: Confirm RED**

Run: `node gateway/src/services/reviewDemoData.test.js && node gateway/src/middleware/reviewDemoGuard.test.js`
Expected: missing modules.

- [x] **Step 3: Implement static data and explicit capabilities**

Create obvious fictional schools, students, teachers, courses, schedules, payments, assets, and at least four question previews. Include answers, knowledge points, explanations, and safe formula text for export.

- [x] **Step 4: Implement and mount the firewall**

The guard must allow GET/HEAD/OPTIONS and `/api/review-demo/*`, but reject every other review mutation with `{ success:false, code:'REVIEW_DEMO_READ_ONLY' }`. Mount it after authentication classification and before protected/optional route handlers so modified clients cannot reach real writes.

- [x] **Step 5: Route review reads without real database access**

Return review capabilities from `/api/permissions/my`. In cloud snapshot and question-preview handlers, branch before database reads when `req.authz.isReviewDemo` is true and return demo data plus `sandboxAvailable:true`.

- [x] **Step 6: Verify isolation and HTTP behavior**

Run: `node gateway/src/services/reviewDemoData.test.js && node gateway/src/middleware/reviewDemoGuard.test.js && node gateway/src/services/authorizationPolicy.test.js && node gateway/src/routes/cloudRelay.http.test.js`
Expected: all exit 0, including a test that a review session cannot POST a real cloud task.

- [x] **Step 7: Commit**

Stage only Task 2 files and commit `automatic release 2026-07-14`.

### Task 3: In-memory paper/export sandbox

**Files:**
- Create: `gateway/src/services/reviewDemoSandbox.js`
- Create: `gateway/src/services/reviewDemoSandbox.test.js`
- Create: `gateway/src/routes/reviewDemo.js`
- Create: `gateway/src/routes/reviewDemo.http.test.js`
- Modify: `gateway/src/app.js`
- Modify: `gateway/package.json`
- Modify: `package.json`

- [x] **Step 1: Write failing sandbox tests**

Cover allowed task/formula/answer values, unknown question rejection, maximum question count, sanitized filename, DOCX ZIP signature, PDF signature, task ownership, cross-session rejection, cancel, and expiry.

```js
const word = await sandbox.create(sessionA, validWordRequest);
assert.strictEqual(word.artifact.buffer.subarray(0, 2).toString(), 'PK');
const pdf = await sandbox.create(sessionA, validPdfRequest);
assert.strictEqual(pdf.artifact.buffer.subarray(0, 4).toString(), '%PDF');
assert.throws(() => sandbox.getArtifact(sessionB, word.artifact.id), /NOT_FOUND/);
```

- [x] **Step 2: Confirm RED**

Run: `node gateway/src/services/reviewDemoSandbox.test.js`
Expected: missing module.

- [x] **Step 3: Add runtime dependencies**

Add `docx` and `pdfkit` to `gateway/package.json`; add any direct root test dependency only when a root test imports it. Install without committing ignored lockfiles.

- [x] **Step 4: Implement bounded memory storage and generation**

Use injected clock/TTL for tests, per-session ownership, opportunistic cleanup, maximum 50 tasks and 16 MiB artifacts per process, deterministic safe content, and no filesystem/database calls.

- [x] **Step 5: Implement HTTP routes**

Add create/result/cancel/artifact routes under `/api/review-demo`. Require an authenticated review session and `review-demo:paper-export`; set attachment filename, content type, no-store, and content length on downloads.

- [x] **Step 6: Verify service and HTTP routes**

Run: `node gateway/src/services/reviewDemoSandbox.test.js && node gateway/src/routes/reviewDemo.http.test.js`
Expected: all assertions pass and database task count remains unchanged.

- [x] **Step 7: Commit**

Stage Task 3 files and commit `automatic release 2026-07-14`.

### Task 4: Miniapp review runtime and login

**Files:**
- Create: `miniapp/src/utils/reviewExperience.js`
- Create: `miniapp/src/utils/reviewExperience.test.js`
- Modify: `miniapp/src/utils/miniappAuthorizationRuntime.js`
- Modify: `miniapp/src/utils/miniappAuthorizationRuntime.test.js`
- Modify: `miniapp/src/utils/miniappAuthorizationSession.js`
- Modify: `miniapp/src/utils/api.ts`
- Modify: `miniapp/src/pages/login/index.tsx`
- Modify: `miniapp/src/pages/login/index.scss`
- Modify: `src/uiRegression.test.js`

- [x] **Step 1: Write failing runtime/UI source tests**

Test review identity detection, admin/student module maps, distinct cache keys, API path selection, cleanup keys, and permanent login-page source markers for the code field and both role controls.

- [x] **Step 2: Confirm RED**

Run: `node miniapp/src/utils/reviewExperience.test.js && node miniapp/src/utils/miniappAuthorizationRuntime.test.js && node src/uiRegression.test.js`
Expected: review helpers/markers absent.

- [x] **Step 3: Implement review helpers and authorization mapping**

Map `review-demo:admin` to existing administrator read pages and `review-demo:student` to scheduling/question-bank. Ensure `canReviewUsers=false`, `canEditQuestionBank=false`, and review business-cache keys include session identity.

- [x] **Step 4: Add review API methods and login controls**

Add `authApi.reviewDemo(code, role)` and sandbox methods. The login page stores only the returned token and verified synthetic identity, clears old caches, and relaunches. Error copy distinguishes invalid/disabled/rate-limited review access.

- [x] **Step 5: Verify focused tests and TypeScript build**

Run: focused Node tests above, then `npm --prefix miniapp run build:weapp`.
Expected: all exit 0.

- [x] **Step 6: Commit**

Stage Task 4 files and commit `automatic release 2026-07-14`.

### Task 5: Read-only UI, sandbox workflow, and exit

**Files:**
- Create: `miniapp/src/components/ReviewDemoBanner.tsx`
- Modify: `miniapp/src/components/shared.scss`
- Modify: `miniapp/src/pages/index/index.tsx`
- Modify: `miniapp/src/pages/question-bank/index.tsx`
- Modify: `miniapp/src/pages/question-bank/index.scss`
- Modify: `miniapp/src/pages/settings/index.tsx`
- Modify: `miniapp/src/pages/admin/users/index.tsx`
- Modify: `miniapp/src/pages/assets/index.tsx`
- Modify: `miniapp/src/pages/schedule/edit/index.tsx`
- Modify: `miniapp/src/utils/miniappUiPageInventory.js`
- Modify: `miniapp/src/utils/miniappUiCoverage.test.js`
- Modify: `src/uiRegression.test.js`

- [x] **Step 1: Add failing UI coverage assertions**

Require the shared banner, review-only disabled-write copy, sandbox task-cache key, direct sandbox artifact download path, and exit cleanup action.

- [x] **Step 2: Confirm RED**

Run: `node miniapp/src/utils/miniappUiCoverage.test.js && node src/uiRegression.test.js`
Expected: review UI contract failures.

- [x] **Step 3: Implement the shared banner and write restrictions**

Render the banner on role entry pages. Hide or disable user review, finance import, and schedule edit actions for verified review identities while preserving normal role behavior.

- [x] **Step 4: Route paper tasks to the sandbox**

For review identities, load demo previews, create/read/cancel sandbox tasks, use a review-specific cache key, download from the gateway with the bearer token, and open DOCX/PDF. Never call host endpoints or save real task IDs.

- [x] **Step 5: Implement exit cleanup**

Clear `auth_token`, `user_info`, permission state, business caches, and review task cache, then relaunch login. Normal logout behavior remains intact.

- [x] **Step 6: Verify UI and miniapp build**

Run: `node miniapp/src/utils/miniappUiCoverage.test.js && node src/uiRegression.test.js && npm --prefix miniapp run build:weapp`
Expected: all exit 0.

- [x] **Step 7: Commit**

Stage Task 5 files and commit `automatic release 2026-07-14`.

### Task 6: Review material, readiness, and security smoke

**Files:**
- Modify: `docs/miniapp-review-guide.md`
- Modify: `scripts/check_miniapp_review_readiness.js`
- Modify: `scripts/check_miniapp_review_readiness.test.js`
- Create: `scripts/check_review_demo.js`
- Create: `scripts/check_review_demo.test.js`
- Modify: `scripts/deployEnv.test.js`
- Modify: `task.md`

- [ ] **Step 1: Write failing readiness/smoke tests**

Require the permanent entry copy, both roles, read-only and sandbox statements, a code placeholder, strong environment validation without secret output, and public smoke checks for admin/student login, permissions, snapshot, sandbox export, and write denial.

- [ ] **Step 2: Confirm RED**

Run: `node scripts/check_miniapp_review_readiness.test.js && node scripts/check_review_demo.test.js`
Expected: missing review contracts/smoke script.

- [ ] **Step 3: Update documentation and checks**

Use accurate Chinese review notes: admin reads sanitized examples, student reads a linked sample, paper/export uses an isolated sandbox, and no real writes occur. Keep the actual code outside Git.

- [ ] **Step 4: Implement secret-safe public smoke**

Read the code from environment, never print it, redact response bodies, and fail if either role cannot log in, if the review JWT accesses real writes, or if DOCX/PDF signatures are invalid.

- [ ] **Step 5: Verify focused checks**

Run both tests plus `node scripts/check_project_status_doc.test.js`.
Expected: all exit 0.

- [ ] **Step 6: Commit**

Stage Task 6 files and commit `automatic release 2026-07-14`.

### Task 7: Full verification and unified release

**Files:**
- Modify through version tooling: `package.json`, `src/generated/version.ts`, miniapp visible version references.
- Add verification evidence under `docs/` and excluded `output/` artifacts.

- [ ] **Step 1: Run local verification**

Run `npm test`, production React build, miniapp production build/release check, gateway dependency install smoke, and packaged dependency/ABI checks. Every command must exit 0.

- [ ] **Step 2: Bump one patch version**

Use the project version tool once after implementation is stable. Verify all generated version references match.

- [ ] **Step 3: Commit and push**

Stage tracked changes only, preserve `.codex-task-handoff`, `.playwright-cli`, `output`, and `scripts/inspect-paper-template.py`, commit `automatic release 2026-07-14`, and push `gewu master`.

- [ ] **Step 4: Back up and deploy cloud**

Back up backend/gateway code and SQLite databases with integrity checks, configure a strong review code without logging it, deploy, restart, and verify health plus `scripts/check_review_demo.js` against the public endpoint.

- [ ] **Step 5: Publish applicable clients**

Build/upload the miniapp development version, upgrade the local data host while preserving D/I-drive configuration, publish the OSS desktop update, and verify feed hash/size plus local health/ABI.

- [ ] **Step 6: Submit review or record platform blocker**

Attempt the supported review submission path. If OpenAPI error 86000 remains, record the exact external blocker and provide the valid private review note for manual submission. Do not report the miniapp as publicly released until WeChat approval and publication are confirmed.
