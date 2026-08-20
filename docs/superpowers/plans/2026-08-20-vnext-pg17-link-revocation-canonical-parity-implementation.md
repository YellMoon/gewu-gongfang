# PostgreSQL 17 Link-Revocation Canonical-Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove, using only local disposable PostgreSQL 17 reads, that the approved `account_device_link.revoke` command envelope can be recomputed exactly before any command-specific write mechanism is considered.

**Architecture:** A new closure-branded parity boundary accepts the same-handle opaque session assertion and an exact five-field command. It uses the existing AccessContext resolver and verifier query facade in a repeatable-read, read-only transaction to derive canonical request/result/audit/outbox vectors. Its test compares those values with the existing synthetic mutation's durable output; it grants no privilege and imports no write facade.

**Tech Stack:** Node.js CommonJS, existing `node:crypto` canonical SHA-256, existing sorted-key formatter, `pg@8.23.0`, disposable PostgreSQL 17 runtime, Node `assert`.

---

### Task 1: Define failing canonical-parity cases

**Files:**

- Create: `shared/vnext-pg17/accountDeviceLinkRevocationCanonicalParity.test.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`

- [ ] **Step 1: Build a synthetic fixture with an active actor, target link, policy, session and reauthentication event**

Reuse the existing account-device-link revocation fixture data but keep a separate fresh disposable handle for each case. Export a `runAccountDeviceLinkRevocationCanonicalParityCases(runtime)` test entry point, matching the existing aggregate-runner convention.

- [ ] **Step 2: Write the first red assertion for an accepted vector**

Call the wished-for API:

```js
const parity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
  runtime, handle, resolver, now: () => NOW,
});
const vector = await parity.inspect(actorAssertion, command());
assert.deepStrictEqual(vector, {
  requestJson: '{"expectedTargetRowVersion":1,"reasonCode":"device_lost","targetLinkId":"target-link-1","type":"account_device_link.revoke"}',
  requestSha256: EXPECTED_REQUEST_SHA256,
  resultJson: EXPECTED_ACCEPTED_RESULT_JSON,
  resultSha256: EXPECTED_ACCEPTED_RESULT_SHA256,
  auditContextSha256: EXPECTED_CONTEXT_SHA256,
  outboxPayloadJson: EXPECTED_OUTBOX_JSON,
  outboxPayloadSha256: EXPECTED_OUTBOX_SHA256,
  outcome: 'accepted',
  resultCode: 'ACCOUNT_DEVICE_LINK_REVOKED',
});
```

The expected values must be captured from a separately executed existing mutation fixture, not hand-copied from the new module.

- [ ] **Step 3: Run the new test and verify red**

Run: `node shared/vnext-pg17/accountDeviceLinkRevocationCanonicalParity.test.js`

Expected: failure because the parity module is absent.

### Task 2: Implement the read-only parity boundary

**Files:**

- Create: `shared/vnext-pg17/accountDeviceLinkRevocationCanonicalParity.js`
- Test: `shared/vnext-pg17/accountDeviceLinkRevocationCanonicalParity.test.js`

- [ ] **Step 1: Add exact configuration and command snapshots**

Accept only an own-data plain object with `runtime`, `handle`, `resolver`, and `now`; reject unknown, missing, inherited, accessor, symbol, Proxy and cross-handle values with `VNEXT_PG17_LINK_REVOCATION_PARITY_INVALID`. Snapshot only the command keys `type`, `targetLinkId`, `expectedTargetRowVersion`, `idempotencyKey`, `reasonCode`; normalize required text and require integer `expectedTargetRowVersion >= 1`.

- [ ] **Step 2: Bind an opaque resolver and canonical clock**

Require `isVNextPg17DisposableHandleForRuntime(runtime, handle)` and `isVNextPg17AccessContextResolverForHandle(resolver, handle)`. Resolve exactly once; map resolver, clock and catalog failures to `VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE`. Require canonical UTC time and desktop, `super_admin`, `device.revoke`, current reauthentication, and policy revision from the resolver context; never accept these facts from the command.

- [ ] **Step 3: Derive vectors in a verifier-only read transaction**

Use only `withVNextPg17SyntheticQuery(handle, 'verifier', ...)`. Begin `ISOLATION LEVEL REPEATABLE READ READ ONLY`; read active authority/account and target link. Derive these exact sorted-key JSON strings with the existing formatter and SHA-256 rule:

```js
const request = stable({
  type: command.type,
  targetLinkId: command.targetLinkId,
  expectedTargetRowVersion: command.expectedTargetRowVersion,
  reasonCode: command.reasonCode,
});
const context = { accountId: context.accountId, linkId: context.linkId, policyRevision: context.policyRevision };
const acceptedPayload = stable({
  authorityId: context.authorityId,
  linkAuthVersion: Number(target.auth_version) + 1,
  linkId: target.link_id,
  linkAccessVersion: Number(target.access_version) + 1,
  linkRowVersion: Number(target.row_version) + 1,
});
```

Generate accepted, noop, self, target-not-active and version-conflict result envelopes with the existing mutation's exact code/status/key sets. Commit on success; rollback and return only the stable boundary code on any fault.

- [ ] **Step 4: Run green accepted-vector test**

Run: `node shared/vnext-pg17/accountDeviceLinkRevocationCanonicalParity.test.js`

Expected: the accepted vector has byte-identical JSON and SHA-256 fields to the mutation's durable receipt/audit/outbox companions.

### Task 3: Complete the parity and safety matrix

**Files:**

- Modify: `shared/vnext-pg17/accountDeviceLinkRevocationCanonicalParity.test.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`

- [ ] **Step 1: Add golden vectors for replay, conflict and non-accepted outcomes**

For each fresh fixture, execute the existing synthetic mutation only through `fixture-provisioner` to establish the reference output, then compare it with the parity boundary:

- exact replay uses the stored receipt/result/audit/outbox values without allocating an ID;
- same idempotency key plus changed `reasonCode` returns `IDEMPOTENCY_KEY_CONFLICT`;
- stale expected row version returns `LINK_VERSION_CONFLICT` and no outbox vector;
- the actor's own link returns `SELF_LINK_REVOKE_FORBIDDEN` and no outbox vector;
- a missing/non-active target returns `TARGET_LINK_NOT_ACTIVE` and no outbox vector.

- [ ] **Step 2: Add authorization and input fail-closed tests**

Use a wrong or foreign assertion, miniapp surface, missing `super_admin`, missing `device.revoke`, absent/expired/future reauthentication, expired clock, invalid clock, fake resolver, cross-handle resolver, extra command key, accessor/Proxy command and cross-boundary value. Every case must return only the parity boundary error and leave an all-target-table logical snapshot unchanged.

- [ ] **Step 3: Add read-only trace tests**

Use the existing runtime trace facility to assert the exact `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` prefix, only `SELECT` statements thereafter, and a terminal `COMMIT` or `ROLLBACK`. Reject any observed INSERT, UPDATE, DELETE, TRUNCATE, ALTER, CREATE, DROP, `SET ROLE`, temporary-object or function-execution statement.

- [ ] **Step 4: Register the focused parity suite**

Add `runLinkRevocationParity` to the aggregate runner's injected dependencies and call it after the existing link-revocation mutation suite. The aggregate must still start one disposable runtime and stop it in `finally`.

- [ ] **Step 5: Run the full local gate**

Run:

```powershell
node shared/vnext-pg17/accountDeviceLinkRevocationCanonicalParity.test.js
npm.cmd run test:vnext-control-plane-target
git diff --check
```

Expected: all commands exit zero, with no M1-M15 migration or privilege change.

### Task 4: Record non-claims, review and publish

**Files:**

- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Modify: `task.md`
- Modify: this plan

- [ ] **Step 1: Record the admission gate**

State that parity demonstrates only local disposable, read-only compatibility. It neither grants writer DML nor creates a procedure/API/RDS connection. A future command-specific owner-owned procedure requires a new independent audit after every golden vector is proven.

- [ ] **Step 2: Run independent audit**

Ask 5.6-sol to assess necessity, cross-project safety, input/identity trust boundaries, SQL trace, parity test quality, local cost, and non-goals. Convert any finding into a failing regression before applying a minimal fix.

- [ ] **Step 3: Commit and push only this slice**

Run the target gate and `npm.cmd test`; record an unrelated pre-existing failure rather than changing unrelated business logic. Stage only parity source/test/runner/docs, use the repository-required dated commit format, then push `HEAD:master` to `gewu`. Do not package Electron, publish OSS, create cloud resources, or change real credentials.

## Plan self-review

- The plan creates a proof seam only; it neither adds M16 nor changes any M1-M15 SQL/checksum/schema metadata.
- The existing fixture provisioner remains test-only and is used only to create expected durable reference vectors; the new parity boundary itself uses verifier SELECTs exclusively.
- No role gains direct DML or function execution, and no real server, desktop database, NAS/removable-media, business data, API, or deployment surface is accessed.
