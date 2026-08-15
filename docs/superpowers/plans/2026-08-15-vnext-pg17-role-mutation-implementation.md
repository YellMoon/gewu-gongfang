# PostgreSQL 17 vNext Role Mutation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Execute inline in this worktree; do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synthetic-only PG17 role grant/revoke writer using the existing branded AccessContext boundary.

**Architecture:** One same-handle writer snapshots exact commands, serializes authority work with an advisory lock, and writes only existing M3/M9-M11 relations. It creates no migration, seed, API, runtime adapter, or production connection.

**Tech Stack:** Node.js, `node:crypto`, `node:util`, disposable PostgreSQL 17, catalog boundary, and PG17 AccessContext resolver.

---

### Task 1: Write failing writer cases

**Files:**
- Create: `shared/vnext-pg17/roleMutation.test.js`
- Reference: `shared/vnext-pg17/policyPublicationMutation.test.js`
- Reference: `shared/vNextRoleGrantMutationReference.js`

- [x] **Step 1: Build bootstrap-derived fixtures**

Apply M1-M15, run the existing first-authority bootstrap writer, and add synthetic target identity chains plus active online session and matching reauthentication. Build same-handle desktop resolver/assertion pairs for actor and target.

```js
function grantCommand(overrides = {}) {
  return Object.freeze({ type: 'role.grant', targetAccountId: 'target-1', role: 'teacher', expectedTargetRowVersion: 0, idempotencyKey: 'grant-1', reasonCode: 'reviewed', ...overrides });
}
function revokeCommand(grantId, overrides = {}) {
  return Object.freeze({ type: 'role.revoke', targetGrantId: grantId, expectedTargetRowVersion: 1, idempotencyKey: 'revoke-1', reasonCode: 'departure', ...overrides });
}
async function expectCode(action, code) { await assert.rejects(action, error => error?.code === code); }
```

- [x] **Step 2: Add semantic, replay, and authorization red cases**

Import the absent writer. Prove role grant creates one active grant, advances target auth/access/row only, and invalidates the target's old context. Prove revoke advances grant plus all four account vectors and invalidates the target context. Cover replay/no IDs, idempotency conflict, duplicate active role, missing target, stale revoke, noop, final-super-admin rejection, and replay after a later policy revision.

```js
const granted = await writer.execute(actorAssertion, grantCommand());
assert.deepStrictEqual(granted, { code: 'ROLE_GRANTED', grantId: 'role-grant-1', replayed: false, status: 'accepted' });
await assert.rejects(() => targetResolver.resolve(targetAssertion), error => error?.code === 'VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE');
assert.deepStrictEqual(await writer.execute(actorAssertion, grantCommand()), { ...granted, replayed: true });
```

- [x] **Step 3: Add companion and rollback red cases**

Snapshot target role/account/session and receipt/audit/outbox rows. For target, account, receipt, audit, and outbox hook stages, throw after the write and require the snapshot unchanged. Tamper an accepted outbox companion in a disposable fixture, restore its exact schema trigger, and require `IDEMPOTENCY_RECEIPT_INVALID` on replay.

```js
for (const stage of ['target', 'account', 'receipt', 'audit', 'outbox']) {
  const before = await targetSnapshot(handle);
  const writer = createVNextPg17RoleMutation({ runtime, handle, resolver, now: () => NOW, idFactory, testHooks: { afterWrite: ({ stage: actual }) => { if (actual === stage) throw new Error('stop'); } } });
  await expectCode(() => writer.execute(assertion, grantCommand({ idempotencyKey: `rollback-${stage}` })), 'ROLE_MUTATION_UNAVAILABLE');
  assert.deepStrictEqual(await targetSnapshot(handle), before);
}
```

- [x] **Step 4: Prove red state**

Run: `node shared/vnext-pg17/roleMutation.test.js`

Expected: `MODULE_NOT_FOUND` for `./roleMutation`.

### Task 2: Implement the PG17 writer

**Files:**
- Create: `shared/vnext-pg17/roleMutation.js`
- Test: `shared/vnext-pg17/roleMutation.test.js`

- [x] **Step 1: Implement strict boundary and authorization**

Accept exact own-data `{ runtime, handle, resolver, now, idFactory, testHooks? }`, only a resolver branded for the identical handle, and exact own-data commands. Resolve the opaque assertion once and require canonical time, desktop, formal super-admin, `access.manage`, and fresh reauthentication.

```js
if (!settings || !isVNextPg17DisposableHandleForRuntime(settings.runtime, settings.handle) || !isVNextPg17AccessContextResolverForHandle(settings.resolver, settings.handle)) throw failure('ROLE_MUTATION_WRITER_INVALID');
const context = await settings.resolver.resolve(assertion);
if (!contextAllowed(context, timestamp)) throw failure('ROLE_MUTATION_UNAUTHORIZED');
```

- [x] **Step 2: Implement lock-ordered grant and revoke CAS**

Assert M1-M15, begin a transaction, lock `hashtextextended('vnext:role:' || authorityId, 0)`, then lock receipt, authority, actor, target account, target grant, and active super-admin set in stable order. Grant inserts active grant version one and CAS-updates target auth/access/row. Revoke prevents the final active super-admin, CAS-revokes the grant, and CAS-updates target auth/access/revocation/row.

```js
const changed = await facade.query("UPDATE vnext_control_plane.vnext_role_grants SET status='revoked', grant_version=grant_version+1, row_version=row_version+1, revoked_at=$1, updated_at=$1 WHERE authority_id=$2 AND grant_id=$3 AND status='active' AND grant_version=$4 AND row_version=$5", [timestamp, authorityId, command.targetGrantId, grant.grant_version, grant.row_version]);
if (changed.rowCount !== 1) throw failure('ROLE_GRANT_VERSION_CONFLICT');
```

- [x] **Step 3: Implement immutable companions and replay**

Use canonical request/result JSON plus SHA-256. Rejected/noop commands write receipt plus audit. Accepted grant/revoke commands write receipt, audit, then outbox, calling the hook after target/account/receipt/audit/outbox. The canonical result permanently stores the execution account/link/policy-revision context; replay validates that frozen context against audit rather than recomputing it from a newer policy. Replay validates exact receipt fields, result hash/shape, target grant/account state, audit, and outbox before returning `replayed: true`.

```js
const payload = stable({ accountId: targetAccountId, grantId, role, authVersion: versions.authVersion, accessVersion: versions.accessVersion });
await facade.query("INSERT INTO vnext_control_plane.vnext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES($1,$2,$3,'authorization.role_granted','role_grant',$4,$5,$6,$7,$8)", [outboxId, authorityId, receiptId, grantId, grantVersion, payload, sha256(payload), timestamp]);
```

- [x] **Step 4: Verify focused writer suite**

Run: `node shared/vnext-pg17/roleMutation.test.js`

Expected: `vNext PG17 role mutation checks passed`.

### Task 3: Integrate and publish

**Files:**
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Modify: `docs/superpowers/plans/2026-08-15-vnext-pg17-role-mutation-implementation.md`

- [x] **Step 1: Register runner execution**

Import `runRoleMutationCases` and execute it immediately after policy publication. Update the runner test to require the new call order.

```js
await runPolicyPublication(runtime);
await runRoleMutation(runtime);
```

- [x] **Step 2: Record verified evidence**

Document only tested same-handle authorization, final-super-admin protection, CAS, session invalidation, replay, rollback, and synthetic-only boundaries. Mark completed checkboxes only.

- [x] **Step 3: Run scoped verification and publish**

Ran `node shared/vnext-pg17/roleMutation.test.js`, `node shared/vnext-pg17/runPg17IntegrationTests.test.js`, `npm.cmd run test:vnext-control-plane-target`, `git diff --check`, and `npm.cmd test` on 2026-08-15. Stage only role writer/test/runner/docs files, use the repository-required dated commit message, and push `gewu HEAD:master`. Do not package desktop software or publish OSS artifacts.

## Plan self-review

- Every approved design point has an implementation and test task: boundary, role rules, lock order, CAS, evidence, replay, rollback, and session invalidation.
- No task changes M1-M15 schema, introduces roles/capabilities, touches business records, connects to cloud, or adds API/runtime wiring.
- All named files, functions, error codes, and runner position are fixed above; there is no implementation placeholder.
