# Unified Role and Data Scope Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace obsolete invitation/module permissions with one enforced super-admin/admin/teacher/student authorization model, teacher-scoped business data and sync, host-desktop-only committed-question deletion, and matching desktop/miniapp review workbenches.

**Architecture:** Add small pure policy modules at the authoritative backend and relay boundaries, then make database, snapshot, mutation, and question-storage services call those modules before returning or changing data. UI clients consume role/approval APIs and present capabilities but never make authorization decisions. Schema changes are additive and preceded by a verified database backup.

**Tech Stack:** Node.js, Express, better-sqlite3, React 18, Ant Design 5, Taro/React miniapp, Electron, Node `assert` tests, Playwright/browser runtime verification.

---

## File map

- `backend/src/services/authorizationPolicy.js`: canonical roles, fixed super-admin phone, capability checks, teacher binding and data-scope helpers.
- `backend/src/services/authorizationPolicy.test.js`: pure policy and migration behavior.
- `backend/src/schema.sql`, `backend/src/database.js`: additive user binding/provenance/review schema and persistence methods.
- `backend/src/routes/adminUsers.js`: desktop/local-host user review API guarded by super-admin capability.
- `backend/src/middleware/auth.js`, `backend/src/routes/permissions.js`: construct authoritative authorization context and expose effective capabilities.
- `gateway/src/services/authorizationPolicy.js`, `gateway/src/routes/admin.js`, `gateway/src/middleware/permission.js`: cloud-side mirror of the same role contract and review enforcement.
- `gateway/src/db/schema.sql`: relay user role, teacher binding and review audit fields; remove runtime dependence on invitation/module grants.
- `gateway/src/routes/cloudRelay.js`: teacher-scoped snapshot publication and retrieval.
- `backend/src/services/syncScopeService.js`: authoritative mutation ownership and provenance validation.
- `backend/src/database.js`, `src/services/syncEngine.ts`, `src/services/mutationQueue.ts`: persist and transport actor/device/source metadata.
- `backend/src/services/questionBankStorageService.js`, `backend/src/routes/questionBank.js`: question storage state and committed-delete hard gate.
- `src/pages/PermissionManager.tsx`, `src/pages/PermissionManager.css`: desktop user review workbench.
- `src/App.tsx`, `src/navigation/appNavigation.tsx`, `src/pages/MenuManage.tsx`: remove menu manager, invitee and local invitation surfaces.
- `miniapp/src/utils/permission.ts`, `miniapp/src/utils/api.ts`, `miniapp/src/pages/admin/users/index.tsx`, `miniapp/src/pages/admin/users/index.scss`: miniapp role policy and review workbench.
- `miniapp/src/app.config.ts`, `miniapp/src/pages/admin/invitations/*`: unregister and remove obsolete invitation UI.
- `src/uiRegression.test.js`, `miniapp/src/utils/miniappAccessPolicy.test.js`, `miniapp/src/utils/miniappUiCoverage.test.js`: residual-surface and role UI regression gates.

### Task 1: Back up the authoritative database and establish the canonical role policy

**Files:**
- Create: `backend/src/services/authorizationPolicy.js`
- Create: `backend/src/services/authorizationPolicy.test.js`
- Modify: `task.md`

- [ ] **Step 1: Locate and verify the current database path without mutating it**

Run:

```powershell
node -e "const db=require('./backend/src/database'); console.log(db.getDatabasePath ? db.getDatabasePath() : 'inspect-constructor')"
```

Expected: an absolute path under the configured local host data directory, or `inspect-constructor` followed by a bounded inspection of the constructor that reveals the exact path.

- [ ] **Step 2: Create a timestamped backup using the existing backup/database mechanism**

Run the existing backup method found in Step 1; if the database class exposes `backupDatabase`, use:

```powershell
node -e "const db=require('./backend/src/database'); Promise.resolve(db.backupDatabase('pre-unified-auth')).then(console.log)"
```

Expected: a printed absolute backup path. Record the path and file size in `task.md`; verify `Test-Path` and ensure size is greater than zero.

- [ ] **Step 3: Write failing pure-policy tests**

Create `backend/src/services/authorizationPolicy.test.js` with assertions equivalent to:

```js
const assert = require('assert');
const policy = require('./authorizationPolicy');

assert.equal(policy.roleForUser({ phone: '137 3225 0653', role: 'admin' }), 'super_admin');
assert.equal(policy.canReviewUsers({ phone: '13732250653', role: 'admin' }), true);
assert.equal(policy.canReviewUsers({ phone: '18257136756', role: 'admin' }), false);
assert.deepEqual(policy.resolveTeacherBinding({ phone: '13800000000' }, [
  { id: 't1', phone: '13800000000', deleted: 0 },
]), { ok: true, teacherId: 't1' });
assert.equal(policy.resolveTeacherBinding({ phone: '13800000000' }, [
  { id: 't1', phone: '13800000000', deleted: 0 },
  { id: 't2', phone: '13800000000', deleted: 0 },
]).code, 'TEACHER_PHONE_NOT_UNIQUE');
assert.equal(policy.scopeForUser({ role: 'teacher', teacher_id: 't1' }).teacherId, 't1');
assert.equal(policy.scopeForUser({ role: 'pending' }).kind, 'none');
```

- [ ] **Step 4: Run the policy test and observe RED**

Run: `node backend/src/services/authorizationPolicy.test.js`

Expected: FAIL with `Cannot find module './authorizationPolicy'`.

- [ ] **Step 5: Implement the minimal canonical policy**

Create exports with these stable signatures:

```js
const SUPER_ADMIN_PHONE = '13732250653';
const ROLES = Object.freeze(['super_admin', 'admin', 'teacher', 'student', 'pending']);
const normalizePhone = value => String(value || '').replace(/\D/g, '');
function roleForUser(user = {}) {
  if (normalizePhone(user.phone) === SUPER_ADMIN_PHONE) return 'super_admin';
  const storedRole = user.role || user.user_type;
  return ROLES.includes(storedRole) ? storedRole : 'pending';
}
function canReviewUsers(user) { return roleForUser(user) === 'super_admin'; }
function resolveTeacherBinding(user, teachers) {
  const matches = teachers.filter(row => !row.deleted && normalizePhone(row.phone) === normalizePhone(user.phone));
  if (matches.length !== 1) return { ok: false, code: matches.length ? 'TEACHER_PHONE_NOT_UNIQUE' : 'TEACHER_NOT_FOUND' };
  return { ok: true, teacherId: matches[0].id };
}
function scopeForUser(user) {
  const role = roleForUser(user);
  if (role === 'super_admin' || role === 'admin') return { kind: 'all' };
  if (role === 'teacher' && user.teacher_id) return { kind: 'teacher', teacherId: user.teacher_id };
  if (role === 'student' && user.student_id) return { kind: 'student', studentId: user.student_id };
  return { kind: 'none' };
}
module.exports = { SUPER_ADMIN_PHONE, ROLES, normalizePhone, roleForUser, canReviewUsers, resolveTeacherBinding, scopeForUser };
```

- [ ] **Step 6: Run GREEN and record the backup path**

Run: `node backend/src/services/authorizationPolicy.test.js`

Expected: exit 0. Update the Task 1 status and exact backup path in `task.md` using `apply_patch`.

- [ ] **Step 7: Commit**

```powershell
git add backend/src/services/authorizationPolicy.js backend/src/services/authorizationPolicy.test.js task.md
git commit -m "建立统一角色权限策略"
```

### Task 2: Add additive user review, teacher binding, and provenance persistence

**Files:**
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Create: `backend/src/databaseAuthorization.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write a failing database migration and persistence test**

The test must create a temporary database, initialize schema, and assert:

```js
assert.ok(columnNames('users').includes('teacher_id'));
assert.ok(columnNames('users').includes('review_status'));
assert.ok(columnNames('users').includes('reviewed_by'));
assert.ok(columnNames('users').includes('reviewed_at'));
assert.ok(tableNames().includes('authorization_audit_log'));
assert.ok(tableNames().includes('sync_rejections'));
assert.equal(db.getMiniappUserByPhone('13732250653').role, 'super_admin');
assert.equal(db.reviewUser({ actorPhone: '18257136756', userId, role: 'teacher' }).code, 'SUPER_ADMIN_REQUIRED');
assert.equal(db.reviewUser({ actorPhone: '13732250653', userId, role: 'teacher' }).teacher_id, teacherId);
```

- [ ] **Step 2: Run RED**

Run: `node backend/src/databaseAuthorization.test.js`

Expected: FAIL because the new columns/methods do not exist.

- [ ] **Step 3: Add schema columns and audit/rejection tables**

Add to `users`: `teacher_id TEXT`, `review_status TEXT DEFAULT 'pending'`, `reviewed_by TEXT`, `reviewed_at TEXT`. Add `authorization_audit_log` with actor, target, action, before/after JSON and timestamp. Add `sync_rejections` with operation, actor, device, table, record, stable reason code, payload JSON and timestamp.

- [ ] **Step 4: Add idempotent runtime migration and review methods**

Use the existing `addColumn` pattern in `database.js`. Implement:

```js
reviewUser({ actorPhone, userId, role })
listAuthorizationUsers({ status, role, search })
getAuthorizationContextByUserId(userId, device = {})
recordAuthorizationAudit(entry)
recordSyncRejection(entry)
```

`reviewUser` must call `canReviewUsers`; for `teacher`, it must query active teachers by normalized phone and require exactly one match. Migrating `invited`, `invitee`, unknown roles or unmatched teachers must yield `pending`; the fixed phone must always yield `super_admin`.

- [ ] **Step 5: Run GREEN and the existing database safety tests**

Run:

```powershell
node backend/src/databaseAuthorization.test.js
node backend/src/databaseMiniappAdminSeed.test.js
node backend/src/databaseImportSafety.test.js
```

Expected: all exit 0.

- [ ] **Step 6: Add the new test to `test:backend` and commit**

```powershell
git add backend/src/schema.sql backend/src/database.js backend/src/databaseAuthorization.test.js package.json
git commit -m "持久化用户审核与老师绑定"
```

### Task 3: Enforce super-admin-only review in local backend and cloud gateway

**Files:**
- Create: `backend/src/routes/adminUsers.js`
- Create: `backend/src/routes/adminUsers.test.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/middleware/auth.js`
- Modify: `backend/src/routes/permissions.js`
- Create: `gateway/src/services/authorizationPolicy.js`
- Create: `gateway/src/services/authorizationPolicy.test.js`
- Modify: `gateway/src/db/schema.sql`
- Modify: `gateway/src/routes/admin.js`
- Modify: `gateway/src/middleware/permission.js`

- [ ] **Step 1: Write failing route and gateway policy tests**

Cover `GET /api/admin/users`, `PATCH /api/admin/users/:id/review`, and `GET /api/permissions/my`. Assert ordinary admin review receives HTTP 403 `SUPER_ADMIN_REQUIRED`, fixed-phone super admin can assign `admin|teacher|student`, pending receives no capabilities, teacher capabilities include full question-bank edit but no committed delete.

- [ ] **Step 2: Run RED**

Run:

```powershell
node backend/src/routes/adminUsers.test.js
node gateway/src/services/authorizationPolicy.test.js
```

Expected: both fail because the canonical review route/policy is absent.

- [ ] **Step 3: Construct authorization context from authenticated state**

Extend auth middleware to attach:

```js
req.authz = {
  userId: user.id,
  phone: user.phone,
  role: roleForUser(user),
  teacherId: user.teacher_id || null,
  studentId: user.student_id || null,
  deviceId: req.get('x-device-id') || null,
  clientType: req.get('x-client-type') || 'unknown',
  isPrimaryHost: req.get('x-node-role') === 'primary-host',
};
```

Ignore role, teacher and host claims from request bodies.

- [ ] **Step 4: Implement review/list endpoints and effective capabilities**

Return capability keys such as `users:review`, `business:all`, `business:teacher-scope`, `question-bank:edit`, `question-bank:delete-committed`. Only compute the last capability when both `isPrimaryHost` and `clientType === 'desktop'` are true; role alone is insufficient.

- [ ] **Step 5: Mirror the role contract in gateway and stop consulting invitation/module grants**

Add `teacher_id`, `review_status`, `reviewed_by`, `reviewed_at` to gateway users. Make gateway admin review require the canonical fixed-phone super admin. Keep old tables readable for rollback, but remove their use from authentication and authorization.

- [ ] **Step 6: Run GREEN and route syntax checks**

Run:

```powershell
node backend/src/routes/adminUsers.test.js
node gateway/src/services/authorizationPolicy.test.js
node --check backend/src/routes/adminUsers.js
node --check gateway/src/routes/admin.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add backend/src gateway/src
git commit -m "统一两端用户审核权限"
```

### Task 4: Enforce teacher data scope before reads and aggregation

**Files:**
- Create: `backend/src/services/dataScopeService.js`
- Create: `backend/src/services/dataScopeService.test.js`
- Modify: `gateway/src/routes/cloudRelay.js`
- Modify: `gateway/src/routes/cloudRelay.test.js`
- Modify: `backend/src/routes/cloudRelay.js`
- Modify: `backend/src/routes/cloudRelayHost.js`
- Modify: `src/utils/financialDetails.test.js`

- [ ] **Step 1: Write failing scope tests with two teachers**

Build fixtures `t1/c1/s1` and `t2/c2/s2`. Assert teacher `t1` receives only `c1`, its schedules, directly related students, consumptions, payments needed for those students, and `owner_user_id === u1` personal records. Assert aggregation input contains no `t2` rows. Assert question records remain unfiltered.

- [ ] **Step 2: Run RED**

Run:

```powershell
node backend/src/services/dataScopeService.test.js
node gateway/src/routes/cloudRelay.test.js
```

Expected: teacher scope exports are missing or snapshot contains `t2` data.

- [ ] **Step 3: Implement dependency-aware snapshot filtering**

Expose:

```js
scopeBusinessSnapshot(snapshot, { kind: 'teacher', teacherId, userId })
assertRecordReadable(tableName, record, authz, lookup)
assertRecordWritable(tableName, record, authz, lookup)
```

Filter courses first, derive course IDs, schedule IDs and student IDs, then filter dependent tables. Do not filter `questions`, question metadata or question assets by teacher.

- [ ] **Step 4: Apply scope before serialization and aggregation**

Make both backend and gateway snapshot paths call `scopeBusinessSnapshot` before JSON serialization. Financial calculations must receive the already-scoped arrays; add an assertion fixture proving totals exclude `t2` tuition, teacher fee and assets.

- [ ] **Step 5: Run GREEN**

Run:

```powershell
node backend/src/services/dataScopeService.test.js
node gateway/src/routes/cloudRelay.test.js
node src/utils/financialDetails.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add backend/src/services backend/src/routes gateway/src/routes src/utils/financialDetails.test.js
git commit -m "按老师身份隔离业务数据"
```

### Task 5: Scope synchronization and persist actor/device provenance

**Files:**
- Create: `backend/src/services/syncScopeService.js`
- Create: `backend/src/services/syncScopeService.test.js`
- Modify: `backend/src/database.js`
- Modify: `backend/src/routes/sync.js`
- Modify: `backend/src/routes/cloudRelayHost.js`
- Modify: `src/services/syncEngine.ts`
- Modify: `src/services/mutationQueue.ts`
- Modify: `src/services/browserDatabase.ts`
- Modify: `src/services/oneClickSyncTransports.mjs`
- Modify: `src/services/oneClickSyncTransports.test.js`

- [ ] **Step 1: Write failing provenance and mutation-validation tests**

Assert a teacher mutation with body `teacher_id: t2` but authz `teacherId: t1` is rejected as `TEACHER_SCOPE_VIOLATION`; a valid `t1` mutation records `actor_user_id`, `actor_teacher_id`, `source_device_id`, and `source_operation_id`; ownership-unknown and version-conflict mutations enter review/conflict storage instead of business tables.

- [ ] **Step 2: Run RED**

Run:

```powershell
node backend/src/services/syncScopeService.test.js
node src/services/oneClickSyncTransports.test.js
```

Expected: missing validator/provenance fields.

- [ ] **Step 3: Extend the operation transport contract**

Add optional transport fields but populate them from authenticated runtime state:

```ts
actorUserId: string;
actorTeacherId?: string;
sourceDeviceId: string;
sourceOperationId: string;
```

Do not let callers pass a different actor than the current session.

- [ ] **Step 4: Validate against current host relationships**

`validateSyncMutation(operation, authz, lookup)` must fetch the authoritative course/schedule/owner relationship. Return stable allow/reject/review decisions. Persist rejection detail without applying payload; persist version conflicts in `sync_conflicts`.

- [ ] **Step 5: Scope downloads and retain explicit upload confirmation**

Apply Task 4 scope to pull responses. Verify the existing one-click workflow still previews and asks for confirmation before push; do not introduce background mutation uploads.

- [ ] **Step 6: Run GREEN and existing sync suites**

Run:

```powershell
node backend/src/services/syncScopeService.test.js
node backend/src/services/syncIncremental.test.js
node src/services/oneClickSyncService.test.js
node src/services/oneClickSyncTransports.test.js
node src/services/oneClickSyncHostBackground.test.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add backend/src src/services
git commit -m "校验同步数据范围并记录来源"
```

### Task 6: Protect host-committed question deletion

**Files:**
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `backend/src/services/questionBankStorageService.js`
- Modify: `backend/src/services/questionBankStorageService.test.js`
- Modify: `backend/src/routes/questionBank.js`
- Create: `backend/src/routes/questionBankDeletionPolicy.test.js`
- Modify: `src/services/questionLocalStore.ts`
- Modify: `miniapp/src/pages/question-bank/index.tsx`

- [ ] **Step 1: Write failing deletion matrix tests**

Cover these exact cases:

```js
assert.equal(canDelete(localDraft, clientDesktop), true);
assert.equal(canDelete(hostCommitted, primaryHostDesktop), true);
assert.equal(canDelete(hostCommitted, clientDesktopSuperAdmin), false);
assert.equal(canDelete(hostCommitted, primaryHostMiniappSuperAdmin), false);
assert.equal(canDelete(hostCommitted, cloudRelay), false);
```

Also assert rejected deletion does not remove the database row, question asset, or file on the question-bank drive.

- [ ] **Step 2: Run RED**

Run:

```powershell
node backend/src/routes/questionBankDeletionPolicy.test.js
node backend/src/services/questionBankStorageService.test.js
```

Expected: committed storage state or caller-context gate is missing.

- [ ] **Step 3: Add storage state and trusted deletion context**

Add `storage_state TEXT DEFAULT 'local_draft'`, `committed_at`, and `committed_by_device_id` to question records through additive migration. Derive trusted deletion context from headers/runtime config validated by the host, not the request body.

- [ ] **Step 4: Enforce the hard gate in both route and storage service**

Return HTTP 403 with `HOST_DESKTOP_REQUIRED_FOR_COMMITTED_DELETE` unless `isPrimaryHost && clientType === 'desktop'`. Re-check inside `questionBankStorageService` immediately before deleting files.

- [ ] **Step 5: Keep local drafts device-local and remove misleading remote delete controls**

Local desktop drafts may be changed or deleted before sync. Miniapp and client desktop must not render a committed-delete control; API denial remains authoritative.

- [ ] **Step 6: Run GREEN and question-bank suites**

Run:

```powershell
node backend/src/routes/questionBankDeletionPolicy.test.js
node backend/src/services/questionBankStorageService.test.js
node backend/src/services/questionBankService.test.js
```

Expected: all pass and temporary fixture files are cleaned up.

- [ ] **Step 7: Commit**

```powershell
git add backend/src src/services/questionLocalStore.ts miniapp/src/pages/question-bank/index.tsx
git commit -m "限制已入库试题仅主机桌面删除"
```

### Task 7: Remove menu management and obsolete permission systems

**Files:**
- Delete: `src/pages/MenuManage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/navigation/appNavigation.tsx`
- Modify: `src/uiRegression.test.js`
- Delete: `miniapp/src/pages/admin/invitations/index.tsx`
- Delete: `miniapp/src/pages/admin/invitations/index.scss`
- Delete: `miniapp/src/pages/admin/invitations/index.config.ts`
- Modify: `miniapp/src/app.config.ts`
- Modify: `miniapp/src/utils/miniappUiPageInventory.js`
- Modify: `miniapp/src/utils/miniappUiCoverage.test.js`

- [ ] **Step 1: Add failing residual-surface tests**

Assert source/navigation/config do not contain runtime references to `menu-manage`, `MenuManage`, `invitee`, `invited`, `invite_codes_geworks`, `permissions_data`, invitation page route, or module grant/revoke controls. Allow these strings only in migration tests/spec documentation.

- [ ] **Step 2: Run RED**

Run:

```powershell
node src/uiRegression.test.js
node miniapp/src/utils/miniappUiCoverage.test.js
```

Expected: FAIL listing existing menu/invitation/permission surfaces.

- [ ] **Step 3: Remove navigation, render branches, files, and inventory records**

Use `apply_patch` for TypeScript/config edits and exact-file deletion patches. Keep legacy browser storage keys untouched on disk but remove all reads/writes. Remove invitation API use and module grant/revoke use; do not delete database tables during this release.

- [ ] **Step 4: Run GREEN and bounded residual search**

Run:

```powershell
node src/uiRegression.test.js
node miniapp/src/utils/miniappUiCoverage.test.js
rg -n -S "menu-manage|MenuManage|invite_codes_geworks|permissions_data|pages/admin/invitations" src miniapp/src
```

Expected: tests pass; `rg` has no runtime matches.

- [ ] **Step 5: Commit**

```powershell
git add -A src miniapp/src
git commit -m "删除旧菜单与邀请权限体系"
```

### Task 8: Build the desktop super-admin review workbench

**Files:**
- Create: `src/services/authorizationApi.ts`
- Create: `src/services/authorizationPresentation.mjs`
- Create: `src/services/authorizationPresentation.test.js`
- Rewrite: `src/pages/PermissionManager.tsx`
- Create: `src/pages/PermissionManager.css`
- Modify: `src/uiRegression.test.js`

- [ ] **Step 1: Write failing presentation tests**

Test role labels, pending/binding-error states, capability-controlled actions, teacher binding text and empty/error copy. Ordinary admin input must produce `canReview: false`; fixed super admin must produce `canReview: true`.

- [ ] **Step 2: Run RED**

Run: `node src/services/authorizationPresentation.test.js`

Expected: missing presentation module.

- [ ] **Step 3: Implement API and pure presentation model**

Expose `listUsers`, `reviewUser`, `disableUser`, and `getMyCapabilities`. Presentation rows must include normalized `roleLabel`, `statusLabel`, `teacherBindingLabel`, `canReview`, and a stable error/empty state.

- [ ] **Step 4: Replace the local permission matrix with a user review workbench**

Build a calm admin layout with summary counts, search, role/status filters, responsive user table/list, selected-user detail, and a confirmation dialog for role changes. Only render review controls when `users:review` is present. Include loading, empty, fetch error, pending, teacher-not-found, duplicate-teacher-phone, saving and disabled states. Use native buttons/inputs through Ant Design with visible labels and keyboard focus.

- [ ] **Step 5: Run GREEN and desktop build**

Run:

```powershell
node src/services/authorizationPresentation.test.js
node src/uiRegression.test.js
npm run build
```

Expected: all pass; build has no TypeScript errors.

- [ ] **Step 6: Commit**

```powershell
git add src/services src/pages/PermissionManager.tsx src/pages/PermissionManager.css src/uiRegression.test.js
git commit -m "重建桌面用户审核工作台"
```

### Task 9: Align miniapp teacher capabilities and review workbench

**Files:**
- Modify: `miniapp/src/utils/permission.ts`
- Modify: `miniapp/src/utils/miniappAccessPolicy.test.js`
- Modify: `miniapp/src/utils/api.ts`
- Modify: `miniapp/src/pages/admin/users/index.tsx`
- Modify: `miniapp/src/pages/admin/users/index.scss`
- Modify: `miniapp/src/utils/miniappUiPageInventory.js`

- [ ] **Step 1: Write failing role-policy tests**

Assert super admin has `users:review`; ordinary admin has full business modules but not review; teacher has all business modules, question-bank edit, teacher data scope and no committed-delete capability; student retains current linked-student modules and tasks; pending has none.

- [ ] **Step 2: Run RED**

Run: `node miniapp/src/utils/miniappAccessPolicy.test.js`

Expected: FAIL because current policy treats non-student roles inconsistently and exposes module grants.

- [ ] **Step 3: Implement the shared role contract in miniapp policy**

Consume backend `permissions/my` effective capabilities. Use cached capabilities only for rendering; API authorization remains authoritative. Make teacher and desktop capability names identical.

- [ ] **Step 4: Replace grant/revoke UI with review UI**

Use the same role/status filters and binding/error states as desktop. Only super admin sees review actions. Ordinary admin sees read-only classification. Teacher/student users cannot navigate to the review workbench. Remove arbitrary permission IDs, expiry grant controls and invitation wording.

- [ ] **Step 5: Run GREEN, typecheck and miniapp build**

Run:

```powershell
node miniapp/src/utils/miniappAccessPolicy.test.js
npm --prefix miniapp run typecheck
npm --prefix miniapp run build:weapp
node miniapp/src/utils/miniappUiCoverage.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add miniapp/src
git commit -m "统一小程序角色与审核体验"
```

### Task 10: Full verification, runtime UI evidence, push and desktop release

**Files:**
- Modify: `task.md`
- Create: `docs/verification-2026-07-11-unified-authorization.md`
- Create: runtime screenshots under the project’s existing verification artifact location
- Modify: version/release artifacts generated by project scripts

- [ ] **Step 1: Run the full automated verification suite**

Run:

```powershell
npm test
npm run build
npm --prefix miniapp run typecheck
npm run miniapp:release-check
```

Expected: all exit 0 with no unhandled warnings or native ABI errors.

- [ ] **Step 2: Run the completion residual audit**

Search runtime code for obsolete roles, invitation authorization, local permission storage and menu manager. Inspect every match and document why any migration-only occurrence remains. Verify the tests actually exercise fixed super admin, ordinary admin denial, teacher data isolation, student scope, pending denial and the question deletion matrix.

- [ ] **Step 3: Verify desktop UI in the real runtime**

Start the app, open permission management as super admin and ordinary admin, capture desktop and narrow screenshots, exercise search/filter/review confirmation/binding failure/empty/error states, and inspect console output. Verify menu manager and invitee routes are unreachable.

- [ ] **Step 4: Verify miniapp UI in a real supported runtime**

Use the miniapp H5/dev runtime or WeChat Developer Tools. Capture super-admin and ordinary-admin review states plus teacher/student navigation and forbidden states at normal and narrow widths. Verify teacher question-bank edit controls and absence of committed-delete controls.

- [ ] **Step 5: Write the verification record and update `task.md`**

Record commands, exit codes, screenshot paths, role fixtures, primary interactions, console results, database backup path, and any limitations. Mark checklist items complete only where evidence exists.

- [ ] **Step 6: Commit and push the verified implementation**

```powershell
git add -A
git commit -m "自动发布 2026-07-11"
git push gewu master
```

Expected: push succeeds and remote `gewu/master` points to the commit.

- [ ] **Step 7: Build and publish the desktop update**

Run:

```powershell
npm run dist:win
npm run publish:desktop-update
```

Expected: semantic patch version is increased automatically, Windows installer and `latest.yml` are generated, OSS publication succeeds, and `dist:win` finishes with `npm run rebuild:node`.

- [ ] **Step 8: Verify release artifacts and Node native ABI**

Run the packaged smoke test when supported, inspect the feed version and installer filename, then run:

```powershell
npm run rebuild:node
node -e "require('better-sqlite3'); console.log('better-sqlite3 node ABI ok')"
```

Expected: packaged smoke succeeds or a precisely documented environment limitation; native require prints `better-sqlite3 node ABI ok`.

- [ ] **Step 9: Commit and push generated release metadata if changed**

```powershell
git add -A
git commit -m "自动发布 2026-07-11"
git push gewu master
```

Expected: clean worktree and updated remote branch.
