# PostgreSQL 17 vNext Account-Device-Link Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a disposable-PG17, existing-authority writer that revokes one other active account-device link and makes that link's existing sessions fail closed.

**Architecture:** The writer consumes a same-handle opaque AccessContext assertion, holds an authority advisory lock, and changes only the target link's status and link vectors. It records receipt/audit/outbox companions in the same transaction and revalidates all durable state on replay. The existing resolver invalidates sessions through parent-link status and vectors; the writer never rewrites sessions or account versions.

**Tech Stack:** Node.js CommonJS, `pg`, disposable PostgreSQL 17 runtime, exact M1-M15 catalog, branded AccessContext resolver.

---

### Task 1: Create failing link-revocation cases

**Files:**
- Create: `shared/vnext-pg17/accountDeviceLinkRevocationMutation.test.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`

- [ ] **Step 1: Build a synthetic authority fixture**

Use `createVNextPg17FirstAuthorityBootstrapMutation` to create the actor chain,
then create one separate active target account/device/installation/link and one
target session. Insert actor and target online sessions plus an actor
reauthentication record. Use a canonical policy manifest that grants
`super_admin` the desktop `device.revoke` capability.

- [ ] **Step 2: Write red semantic tests**

```js
const accepted = await writer.execute(actorAssertion, {
  type: 'account_device_link.revoke',
  targetLinkId: 'target-link-1',
  expectedTargetRowVersion: 1,
  idempotencyKey: 'revoke-link-1',
  reasonCode: 'device_lost',
});
assert.deepStrictEqual(accepted, {
  code: 'ACCOUNT_DEVICE_LINK_REVOKED',
  linkId: 'target-link-1',
  replayed: false,
  status: 'accepted',
});
await expectCode(() => targetResolver.resolve(targetAssertion), 'VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE');
```

Also require self-target rejection, stale version conflict, revoked noop and
exact replay, changed same-key conflict, fake/cross-handle assertion rejection,
miniapp/capability/reauth denial, and proxy/accessor/extra command rejection.

- [ ] **Step 3: Run the red focused test**

Run: `node shared/vnext-pg17/accountDeviceLinkRevocationMutation.test.js`

Expected: fail because the writer module does not exist.

### Task 2: Implement the writer with rollback and replay checks

**Files:**
- Create: `shared/vnext-pg17/accountDeviceLinkRevocationMutation.js`
- Test: `shared/vnext-pg17/accountDeviceLinkRevocationMutation.test.js`

- [ ] **Step 1: Add strict input and authorization boundary**

Require exact own-data factory and command snapshots. Require
`isVNextPg17DisposableHandleForRuntime(runtime, handle)` and
`isVNextPg17AccessContextResolverForHandle(resolver, handle)`. Resolve the
opaque assertion once; require desktop, `super_admin`, `device.revoke`, and a
strictly future canonical `reauthenticatedUntil`.

- [ ] **Step 2: Add one lock-ordered transaction**

Assert the exact catalog, start a transaction, acquire
`pg_advisory_xact_lock(hashtextextended('vnext:link:' || authorityId, 0))`, and
lock the active authority, actor account, target link, and target sessions.
Reject a self-target. For an active matching target version, issue exactly:

```sql
UPDATE vnext_control_plane.vnext_account_device_links
SET status='revoked', auth_version=auth_version+1,
    access_version=access_version+1, row_version=row_version+1,
    revoked_at=$1, updated_at=$1
WHERE authority_id=$2 AND link_id=$3 AND status='active' AND row_version=$4
```

Require one row; otherwise roll back with the stable conflict code. Do not
update `vnext_accounts` or `vnext_sessions`.

- [ ] **Step 3: Add immutable receipt/audit/outbox writes and replay**

Persist a frozen execution context in canonical receipt result JSON. Accepted
results use an `authorization.account_device_link_revoked` outbox payload with
only authority, target link, and resulting link-vector values. Rejected/noop
results write receipt/audit only. On replay, validate receipt request/result
hashes and shape, frozen audit hash, target-link durable values, and exact
outbox event/payload/hash before returning `replayed: true`.

- [ ] **Step 4: Add rollback and tamper red-green cases**

Inject throws after target, receipt, audit, and outbox writes; each must leave
the link plus all companion counts unchanged. In separate disposable fixtures,
tamper the accepted outbox event and audit context only while their append-only
trigger is disabled, restore the exact trigger, then require
`IDEMPOTENCY_RECEIPT_INVALID` on replay.

- [ ] **Step 5: Run focused tests**

Run: `node shared/vnext-pg17/accountDeviceLinkRevocationMutation.test.js`

Expected: `vNext PG17 account-device-link revocation mutation checks passed`.

### Task 3: Integrate, verify, and publish

**Files:**
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Modify: this plan

- [ ] **Step 1: Register the focused suite once**

Run the new cases after role mutation in the one disposable runtime. Update the
runner test to lock the order and its `finally` cleanup.

- [ ] **Step 2: Run verification**

Run:

```powershell
node shared/vnext-pg17/accountDeviceLinkRevocationMutation.test.js
node shared/vnext-pg17/runPg17IntegrationTests.test.js
npm.cmd run test:vnext-control-plane-target
git diff --check
npm.cmd test
```

Record only fresh observed results. Do not package a desktop build or publish
OSS artifacts for this synthetic-only control-plane change.

- [ ] **Step 3: Commit and push task-only files**

Use the repository-required dated commit message, then push `gewu HEAD:master`.

## Plan self-review

- The plan preserves the approved link-revocation semantics: link-only vector
  change, no account-wide version change, no session rewrite, and resolver-side
  fail-closed session invalidation.
- No task modifies M1-M15 DDL, creates real credentials or data, or adds cloud,
  API, runtime, desktop, NAS, removable-media, or business-data access.
- Every fresh write boundary, idempotency outcome, authorization boundary, and
  durable companion has an executable test requirement.
