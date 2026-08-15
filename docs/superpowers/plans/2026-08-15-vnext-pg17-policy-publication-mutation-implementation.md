# PostgreSQL 17 vNext Policy Publication Mutation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Execute inline in this worktree; do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synthetic-only existing-authority PG17 policy-publication writer with same-handle AccessContext authorization, atomic receipt/audit/outbox effects, CAS, and durable replay validation.

**Architecture:** The writer consumes a same-handle branded resolver and opaque assertion, canonicalizes the manifest with the pure policy contract, and serializes authority-local publication with an advisory lock. It reuses M9 receipts, M10 audit, M11 outbox, and M13 publications without adding DDL, seed data, a production adapter, or runtime integration.

**Tech Stack:** Node.js, `node:crypto`, `node:util`, disposable PostgreSQL 17, catalog boundary, PG17 AccessContext resolver, and `vNextAuthorizationPolicyReference`.

---

### Task 1: Write failing writer cases

**Files:**
- Create: `shared/vnext-pg17/policyPublicationMutation.test.js`
- Reference: `shared/vnext-pg17/accessContextResolver.test.js`
- Reference: `shared/vnext-pg17/firstAuthorityBootstrapMutation.test.js`

- [ ] **Step 1: Build one bootstrap-derived fixture**

Apply M1-M15, use the existing bootstrap mutation to establish revision one, insert an active online session plus matching reauthentication, and expose a same-handle trusted assertion and resolver.

```js
function command(overrides = {}) {
  return Object.freeze({
    type: 'authorization_policy.publish', expectedPolicyRevision: 1,
    idempotencyKey: 'policy-key-2', reasonCode: 'policy-update',
    manifest: nextManifest(), ...overrides,
  });
}
async function expectCode(action, code) {
  await assert.rejects(action, error => error?.code === code);
}
```

- [ ] **Step 2: Add accepted, replay, rejected, and noop expectations**

Import the not-yet-existing writer. A desktop super-admin with `access.manage` and fresh reauthentication publishes revision two. Assert one new publication/receipt/audit/outbox row, no account/device/installation/link/session mutation, exact replay with zero new IDs, same-key conflict, revision-zero rejection, stale CAS rejection, adjacent unchanged noop, and A-to-B-to-A later revision.

```js
const accepted = await writer.execute(assertion, command());
assert.deepStrictEqual(accepted, { code: 'POLICY_PUBLISHED', policyRevision: 2, replayed: false, status: 'accepted' });
assert.deepStrictEqual(await writer.execute(assertion, command()), { ...accepted, replayed: true });
await expectCode(() => writer.execute(assertion, command({ expectedPolicyRevision: 0, idempotencyKey: 'first' })), 'FIRST_POLICY_BOOTSTRAP_REQUIRED');
```

- [ ] **Step 3: Add authorization, input, companion, and rollback red cases**

Use independent fixtures to reject fake/cross-handle assertions, miniapp, missing capability, expired reauthentication, accessor/proxy manifests, and a policy that removes active desktop `access.manage` from super-admin. Snapshot all M1-M15 target rows before/after. Add hook failures after receipt, publication, audit, and outbox; each must roll back completely. Preconstruct malformed receipt/publication/audit/outbox companions and require exact replay to fail closed.

```js
for (const stage of ['receipt', 'publication', 'audit', 'outbox']) {
  const before = await targetRowsSnapshot(handle);
  const writer = createVNextPg17PolicyPublicationMutation({
    runtime, handle, resolver, now: () => NOW, idFactory,
    testHooks: { afterWrite: ({ stage: actual }) => { if (actual === stage) throw new Error('stop'); } },
  });
  await expectCode(() => writer.execute(assertion, command({ idempotencyKey: `rollback-${stage}` })), 'POLICY_PUBLICATION_UNAVAILABLE');
  assert.deepStrictEqual(await targetRowsSnapshot(handle), before);
}
```

- [ ] **Step 4: Prove red state**

Run: `node shared/vnext-pg17/policyPublicationMutation.test.js`

Expected: `MODULE_NOT_FOUND` for `./policyPublicationMutation`.

### Task 2: Implement the narrow writer

**Files:**
- Create: `shared/vnext-pg17/policyPublicationMutation.js`
- Test: `shared/vnext-pg17/policyPublicationMutation.test.js`

- [ ] **Step 1: Implement strict factory and snapshots**

Implement exact own-data config and command snapshots; recursively clone only plain own-data manifests; validate canonical UTC time; hash canonical JSON. The factory accepts only `runtime`, `handle`, `resolver`, `now`, `idFactory`, and optional exact `{ afterWrite }`. Require branded runtime/handle and resolver for the identical handle.

```js
const settings = configSnapshot(config);
if (!settings || !isVNextPg17DisposableHandleForRuntime(settings.runtime, settings.handle)
  || !isVNextPg17AccessContextResolverForHandle(settings.resolver, settings.handle)) {
  throw failure('POLICY_PUBLICATION_WRITER_INVALID');
}
```

- [ ] **Step 2: Implement authorization and self-lock checks**

Resolve the opaque assertion once. Require desktop, formal super-admin, `access.manage`, and `reauthenticatedUntil > now`; load active authority/actor inside the transaction. Canonicalize the policy manifest and require active desktop `access.manage` in super-admin defaults. Reject malformed input and revision-zero bootstrap fallback with stable domain errors before writes.

```js
const context = await settings.resolver.resolve(assertion);
if (context.surface !== 'desktop' || !context.roles.includes('super_admin')
  || !context.capabilityIds.includes('access.manage')
  || !context.reauthenticatedUntil || Date.parse(context.reauthenticatedUntil) <= nowMillis) {
  throw failure('POLICY_PUBLICATION_UNAUTHORIZED');
}
```

- [ ] **Step 3: Implement one advisory-lock transaction**

Call `catalog.assert(handle)`, then `BEGIN` and take `pg_advisory_xact_lock(hashtextextended('vnext:policy:' || authorityId, 0))`. Lock the idempotency receipt row `FOR UPDATE`; validate exact replay companions. Fresh execution locks/reloads active authority and highest policy revision, then writes rejected/noop receipt+audit or accepted receipt→publication→audit→outbox in dependency order. Call the hook after every durable write. Roll back all failure paths and expose only stable policy/idempotency errors.

```js
await facade.query('BEGIN');
await facade.query("SELECT pg_advisory_xact_lock(hashtextextended('vnext:policy:' || $1, 0))", [authorityId]);
// exact replay or current-revision CAS
await facade.query('COMMIT');
```

- [ ] **Step 4: Verify focused writer suite**

Run: `node shared/vnext-pg17/policyPublicationMutation.test.js`

Expected: `vNext PG17 policy publication mutation checks passed`.

### Task 3: Integrate, evidence, and scoped publish

**Files:**
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [ ] **Step 1: Register one-runtime execution**

Import and run `runPolicyPublicationMutationCases(runtime)` after AccessContext and before shutdown. Require the runner sequence:

```js
// manifest -> catalog -> bootstrap -> recovery -> trusted-session-boundary -> access-context -> policy-publication-mutation -> stop
```

- [ ] **Step 2: Add verified evidence**

Record only tested facts: same-handle opaque authorization, desktop super-admin/capability/reauth requirements, CAS and durable companions, exact replay, self-lock protection, rollback, and synthetic-only scope. Explicitly exclude RDS/ECS, API, runtime adapter, business/source/desktop data, NAS, removable media, and deployment.

- [ ] **Step 3: Run verification and publish**

Run the focused writer and runner tests, `npm.cmd run test:vnext-control-plane-target`, `git diff --check`, and `npm.cmd test`. Report any unrelated date-sensitive lease failure exactly. Turn valid review findings into regression tests, then stage only writer/test/runner/docs files, use the repository-required dated commit message, and push `gewu HEAD:master`. Do not package or publish desktop software.

## Plan self-review

- The tasks cover same-handle authorization, strict inputs, canonical policy, no bootstrap bypass, authority-local CAS, durable replay/companions, rollback, and scope boundaries.
- The plan changes no M1-M15 catalog semantics and creates no target DDL.
