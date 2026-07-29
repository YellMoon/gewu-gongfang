# Runtime Architecture Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move desktop, host, cloud relay, and miniapp authorization onto explicit authority-scoped grants, durable host commands, and host-authoritative projections without changing canonical business data during migration.

**Architecture:** Cloud retains account/device control records and a durable command inbox/receipt mirror; a primary host is the only business writer. Desktop and miniapp obtain scoped read projections and submit versioned commands with explicit confirmation. A local host worker polls independently from the renderer, while WebSocket only wakes it sooner.

**Tech Stack:** Electron, Node.js CommonJS/ESM, Express, SQLite/better-sqlite3, React, Taro miniapp, Playwright packaged Electron checks.

---

## File map

- `backend/src/schema.sql`: additive authority, account, grant, binding, command ledger, receipt, projection, and migration ledger tables.
- `backend/src/services/authorityAccessService.js`: normalize immutable user identity, explicit acting role, grant version, and server-side scopes.
- `backend/src/services/authorityCommandService.js`: validate, claim, execute, and receipt typed versioned commands exactly once.
- `backend/src/services/authorityProjectionService.js`: produce limited visitor/student/teacher/admin projections.
- `backend/src/services/authorityMigrationService.js`: copy-only rehearsal and legacy-role parity report.
- `backend/src/services/hostCommandWorker.js`: durable polling/claim/renew/recovery worker independent of React.
- `backend/src/websocket/hostTaskWakeup.js`: wake the worker only; keep no command semantics in the socket callback.
- `backend/src/routes/cloudRelay.js`, `gateway/src/routes/cloudRelay.js`: common envelope routing by authority id and active host epoch.
- `backend/src/routes/cloudRelayHost.js`: invoke the execution ledger rather than direct mutation replay.
- `src/services/desktopIdentityClient.mjs`: local unlock, cloud lease refresh, explicit role selection; no host dependency during login.
- `src/services/desktopCommandOutbox.mjs`: encrypted local typed-command outbox and receipt acknowledgement.
- `public/desktopBuildFlavor.js`, `public/electron.js`: immutable host capability manifest and fail-closed startup validation.
- `miniapp/src/utils/permission.ts`, `miniapp/src/utils/miniappAuthorizationRuntime.js`: projection-only visitor and explicit-role behavior.
- `scripts/runtime-architecture-rehearsal.js`: disposable database-copy migration and parity rehearsal.
- `scripts/real-desktop-architecture-e2e.js`: packaged two-Electron LAN/cloud/restart test evidence.

### Task 1: Freeze the authoritative migration contract

**Files:**
- Modify: `backend/src/schema.sql`
- Create: `backend/src/services/authorityAccessService.js`
- Create: `backend/src/services/authorityAccessService.test.js`

- [ ] **Step 1: Write failing scope tests**

```js
assert.deepStrictEqual(resolveActingScope({ userId: 'u1', actingRole: 'visitor', grants: [] }), { kind: 'visitor', userId: 'u1' });
assert.throws(() => resolveActingScope({ userId: 'u1', actingRole: 'admin', grants: [] }), /ACTING_ROLE_NOT_GRANTED/);
assert.deepStrictEqual(resolveActingScope({ userId: 'u1', actingRole: 'student', grants: [{ role: 'student', bindingId: 's1', status: 'active' }] }), { kind: 'student', userId: 'u1', studentId: 's1' });
```

- [ ] **Step 2: Run the test and observe RED**

Run: `node backend/src/services/authorityAccessService.test.js`

Expected: `MODULE_NOT_FOUND` for `authorityAccessService`.

- [ ] **Step 3: Add additive schema and minimal resolver**

```sql
CREATE TABLE IF NOT EXISTS authority_accounts (user_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS authority_role_bindings (binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL, grant_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS authority_migration_ledger (name TEXT PRIMARY KEY, source_fingerprint TEXT NOT NULL, applied_at TEXT NOT NULL, report_json TEXT NOT NULL);
```

```js
function resolveActingScope({ userId, actingRole = 'visitor', grants = [] } = {}) {
  if (actingRole === 'visitor') return { kind: 'visitor', userId };
  const grant = grants.find(item => item.role === actingRole && item.status === 'active');
  if (!grant) throw authorityError('ACTING_ROLE_NOT_GRANTED');
  if (actingRole === 'student') return { kind: 'student', userId, studentId: grant.bindingId };
  return { kind: actingRole, userId, authorityId: grant.authorityId || null };
}
```

- [ ] **Step 4: Run the scope test and focused legacy compatibility tests**

Run: `node backend/src/services/authorityAccessService.test.js; node backend/src/services/userRoleGrantService.test.js`

Expected: both pass; legacy scalar roles remain read-only inputs.

### Task 2: Make the cloud command contract durable and exactly-once

**Files:**
- Create: `backend/src/services/authorityCommandService.js`
- Create: `backend/src/services/authorityCommandService.test.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/routes/cloudRelayHost.js`

- [ ] **Step 1: Write failing ledger tests**

```js
const first = service.execute({ commandId: 'c1', idempotencyKey: 'k1', actor: actor(), type: 'schedule.update.v1', payload: { id: 's1' } });
const replay = service.execute({ commandId: 'c2', idempotencyKey: 'k1', actor: actor(), type: 'schedule.update.v1', payload: { id: 's1' } });
assert.strictEqual(first.receipt.resultHash, replay.receipt.resultHash);
assert.strictEqual(writes, 1);
```

- [ ] **Step 2: Run RED**

Run: `node backend/src/services/authorityCommandService.test.js`

Expected: `MODULE_NOT_FOUND`.

- [ ] **Step 3: Add command/receipt tables and transactional service**

```sql
CREATE TABLE IF NOT EXISTS authority_command_ledger (command_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, device_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, command_type TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL, result_hash TEXT, created_at TEXT NOT NULL, committed_at TEXT, UNIQUE(actor_user_id, device_id, idempotency_key));
CREATE TABLE IF NOT EXISTS authority_command_receipts (command_id TEXT PRIMARY KEY, result_hash TEXT NOT NULL, result_payload TEXT NOT NULL, completed_at TEXT NOT NULL);
```

Implement `execute` inside one SQLite immediate transaction: return a matching receipt before invoking the domain handler; write `committed` ledger and receipt after the handler; reject same key with a different payload hash.

- [ ] **Step 4: Route only typed commands through the ledger**

Replace `desktop-sync` direct mutation replay with `authorityCommandService.execute`; reject unknown command versions with `COMMAND_TYPE_UNSUPPORTED`.

- [ ] **Step 5: Verify green and crash replay**

Run: `node backend/src/services/authorityCommandService.test.js; node backend/src/routes/desktopCloudSync.test.js`

Expected: all pass; a simulated throw after commit returns the stored receipt without a second domain write.

### Task 3: Decouple normal desktop login from host availability

**Files:**
- Modify: `src/services/desktopIdentityClient.mjs`
- Modify: `src/services/desktopIdentityClient.test.js`
- Modify: `backend/src/routes/desktopIdentity.js`
- Create: `backend/src/services/deviceLeaseService.js`
- Create: `backend/src/services/deviceLeaseService.test.js`

- [ ] **Step 1: Write failing login tests**

```js
const state = await client.unlock({ password: 'p', online: true, cloudBaseUrl: 'https://cloud.invalid', hostBaseUrl: 'http://host.invalid' });
assert.equal(state.gateState.kind, 'online-unlocked');
assert.equal(hostCalls, 0);
```

- [ ] **Step 2: Run RED**

Run: `node src/services/desktopIdentityClient.test.js`

Expected: it attempts relay session exchange or returns `online-authentication-required`.

- [ ] **Step 3: Add lease issuing and local-unlock behavior**

Create a 14-day offline read license plus cloud access lease with 15-60 minute expiry, device/grant versions, and signature. Make `unlock` accept a valid cloud lease without contacting a primary host; a host is contacted only by command submission/execution.

- [ ] **Step 4: Require explicit role selection**

Make `preferredActiveRole` return only a requested valid role or `visitor`; remove privilege-order selection. Preserve previous requested role only when it remains granted.

- [ ] **Step 5: Verify green**

Run: `node src/services/desktopIdentityClient.test.js; node backend/src/services/deviceLeaseService.test.js; node backend/src/routes/desktopIdentity.http.test.js`

Expected: correct password unlocks a paired device while the host is unavailable; command capability remains unavailable until the host is reachable.

### Task 4: Make host processing an independent recoverable worker

**Files:**
- Create: `backend/src/services/hostCommandWorker.js`
- Create: `backend/src/services/hostCommandWorker.test.js`
- Modify: `backend/src/websocket/hostTaskWakeup.js`
- Modify: `public/electron.js`

- [ ] **Step 1: Write failing worker recovery tests**

```js
worker.start();
await clock.tick(5000);
assert.equal(claimed, 1);
worker.stop();
assert.equal(clock.cleared, true);
```

- [ ] **Step 2: Run RED**

Run: `node backend/src/services/hostCommandWorker.test.js`

Expected: `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement worker lifecycle**

The worker starts after the local backend is listening, polls durable pending commands, renews claims, reclaims expired claims, and records health counters. `hostTaskWakeup` calls `worker.wake()` only; it has no HTTP execution knowledge.

- [ ] **Step 4: Verify WebSocket-independent processing**

Run: `node backend/src/services/hostCommandWorker.test.js; node backend/src/websocket/hostTaskWakeup.test.js; node backend/src/websocket/client.test.js`

Expected: a task is processed with the WebSocket client disconnected; no manual local endpoint is needed.

### Task 5: Enforce projection scopes and role application boundaries

**Files:**
- Create: `backend/src/services/authorityProjectionService.js`
- Create: `backend/src/services/authorityProjectionService.test.js`
- Modify: `backend/src/services/authorizationPolicy.js`
- Modify: `backend/src/services/userRoleGrantService.js`
- Modify: `backend/src/routes/miniappApplications.js`
- Modify: `miniapp/src/utils/permission.ts`
- Modify: `miniapp/src/utils/miniappAuthorizationRuntime.js`

- [ ] **Step 1: Write failing projections**

```js
assert.equal(project({ role: 'visitor', userId: 'v1' }, fixture).questionPreviews.length, 10);
assert.equal(project({ role: 'student', userId: 'u1', studentId: 's1' }, fixture).lessonPay, undefined);
assert.deepStrictEqual(project({ role: 'teacher', userId: 'u2', teacherId: 't1' }, fixture).courses.map(x => x.id), ['course-t1']);
```

- [ ] **Step 2: Run RED**

Run: `node backend/src/services/authorityProjectionService.test.js`

Expected: `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement strict host-side projection**

Return only ten sanitized question previews for visitor. Student receives own schedule/tuition only; teacher receives only bound-course detail and fees; admin gets authority-wide scope; super admin alone may review role applications. Never include payment-card numbers in asset projections.

- [ ] **Step 4: Add grant/application rules**

Add visitor as the default, allow teacher/student applications only, forbid self-service admin, and separate binding records from grants. Retain legacy scalar role only for migration parity reads.

- [ ] **Step 5: Verify host and miniapp policy tests**

Run: `node backend/src/services/authorityProjectionService.test.js; node backend/src/services/userRoleGrantService.test.js; node miniapp/src/utils/miniappAuthorizationRuntime.test.js; node miniapp/src/utils/miniappAccessPolicy.test.js`

Expected: scope is enforced before UI filtering, including visitor and finance boundaries.

### Task 6: Fail closed on package capability mismatch

**Files:**
- Modify: `public/desktopBuildFlavor.js`
- Create: `public/desktopBuildFlavor.test.js`
- Modify: `public/electron.js`
- Create: `public/primaryHostStartupValidation.test.js`

- [ ] **Step 1: Write failing packaged-metadata tests**

```js
assert.throws(() => validatePrimaryHostStartup({ manifest: { flavor: 'primary-host' }, runtimeFlavor: 'desktop-client' }), /PRIMARY_HOST_CAPABILITY_MISMATCH/);
assert.equal(resolveDesktopBuildFlavor({ isPackaged: true, metadata: { desktopBuildFlavor: 'primary-host' }, env: { GEWU_DESKTOP_BUILD_FLAVOR: 'desktop-client' } }), 'primary-host');
```

- [ ] **Step 2: Run RED**

Run: `node public/desktopBuildFlavor.test.js; node public/primaryHostStartupValidation.test.js`

Expected: missing validator or a silent client rewrite.

- [ ] **Step 3: Implement manifest validation**

Read package metadata from `app.getAppPath()/package.json` when packaged, validate immutable host capability files before runtime configuration, and stop startup with a diagnostic if metadata/config differ. An ordinary package may write client configuration; a host-capable package must never be downgraded silently.

- [ ] **Step 4: Verify packaged build evidence**

Run: `node public/desktopBuildFlavor.test.js; node public/primaryHostStartupValidation.test.js; npm run build`

Expected: unit tests pass; subsequent packaged-host smoke test logs primary-host role and host port.

### Task 6b: Make Windows LAN access explicit and narrowly scoped

**Files:**
- Create: `public/windowsHostFirewall.js`
- Create: `public/windowsHostFirewallElevated.ps1`
- Create: `public/windowsHostFirewall.test.js`
- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Modify: `src/pages/SystemSettings.tsx`
- Modify: `package.json`
- Modify: `electron-builder.host.config.cjs`

- [x] **Step 1: Write failing firewall-plan tests**

Reject ordinary clients, unpacked builds, and temporary executable paths. Require a packaged primary-host process, private profile, local subnet, exact executable, and a single TCP host port.

- [x] **Step 2: Run RED**

Run: `node public/windowsHostFirewall.test.js`

Expected: `MODULE_NOT_FOUND`.

- [x] **Step 3: Add auditable one-time rule flow**

Expose a read-only rule audit to the renderer. On an explicit data-host action only, launch a packaged elevated helper that creates or verifies one rule. Never invoke elevation at startup. The helper must refuse temporary/unpacked paths, avoid altering a conflicting rule, and only remove a rule it owns.

- [x] **Step 4: Verify package inclusion and safe UI behavior**

Run: `node public/windowsHostFirewall.test.js; node src/pages/SystemSettings.test.js`

Expected: ordinary desktop packages never offer this action; the primary-host package reports the rule state and can request exactly one administrator approval.

### Task 7: Rehearse migration and run the complete real two-desktop matrix

**Files:**
- Create: `scripts/runtime-architecture-rehearsal.js`
- Create: `scripts/real-desktop-architecture-e2e.js`
- Modify: `task.md`

- [ ] **Step 1: Write a disposable-copy rehearsal test**

```js
const report = await rehearse({ sourceDb: fixtureDb, copyDb: disposableDb });
assert.equal(report.sourceMutated, false);
assert.equal(report.parityFailures, 0);
```

- [ ] **Step 2: Run RED**

Run: `node scripts/runtime-architecture-rehearsal.js --self-test`

Expected: script missing.

- [ ] **Step 3: Implement additive copy-only rehearsal**

Copy the selected database to a disposable path, apply schema, seed source-audited grants, compare legacy and new scopes, and emit a JSON report with fingerprints. Do not run it against the authority database in place.

- [ ] **Step 4: Execute local rehearsal and package builds**

Run: `node scripts/runtime-architecture-rehearsal.js --self-test; npm run build; npx electron-builder --win --dir --config electron-builder.host.config.cjs --config.directories.output=tmp-architecture-host; npx electron-builder --win --dir --config.directories.output=tmp-architecture-client`

Expected: rehearsal has no parity failures and both artifacts build.

- [ ] **Step 5: Execute real isolated desktop matrix**

Run: `node scripts/real-desktop-architecture-e2e.js --lan --cloud --restart --no-manual-host-endpoint`

Expected: packaged host and ordinary app prove binding, normal login with host temporarily unavailable, explicit LAN sync, cloud-relay bidirectional projection after restart, polling fallback with WebSocket disabled, and no duplicate after simulated crash before receipt.

## Review checklist

- [ ] `rg -n "user\\.role|user_type" backend gateway src miniapp` has only documented compatibility adapters and migration tests, never new authority decisions.
- [ ] Any command affecting canonical data has an authority id, active host epoch, command type/version, actor/device id, idempotency key, payload hash, and receipt.
- [ ] The migration rehearsal uses a copied database and leaves its source fingerprint unchanged.
- [ ] Real test artifacts use isolated test profiles and synthetic data only.
- [ ] Do not commit, deploy, push, publish OSS, or claim release completion until every Task 7 gate is green.
