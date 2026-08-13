# vNext Account Device Link Revocation Reference Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one existing-authority, current-context-only reference mutation that revokes another active account-device link and makes its captured sessions fail closed.

**Architecture:** The writer shares the policy publisher's injected exact V4 handle and resolver/database binding. It derives the actor entirely from a branded opaque assertion's current desktop AccessContext, CAS-revokes only a different active link, then commits target, receipt, audit and outbox in one transaction. Account-level versions deliberately remain unchanged; session invalidation follows current link status/vector checks.

**Tech Stack:** Node.js CommonJS, `better-sqlite3` `:memory:`, existing V4 kernel, trusted verifier boundary and AccessContext resolver.

---

### Task 1: Red tests and fixture

**Files:**
- Create: `shared/vNextAccountDeviceLinkRevocationMutationReference.test.js`
- Modify: `package.json`

- [x] Seed two active account-device links and a target link session, with a first V4 publication, active super-admin actor, `device.revoke` and recent reauthentication.
- [x] Add red tests for success, target-session failure after revocation, expected row-version CAS, self-revoke rejection, revoked noop/replay, idempotency conflict, capability/surface/reauth/assertion/resolver rejection, and injected rollback at each write boundary.
- [x] Add the focused test to `test:vnext-migration`; ran it and observed module-not-found before implementation.

### Task 2: Atomic revocation reference

**Files:**
- Create: `shared/vNextAccountDeviceLinkRevocationMutationReference.js`
- Test: `shared/vNextAccountDeviceLinkRevocationMutationReference.test.js`

- [x] Require exact factory `{ db, resolver, now, idFactory, testHooks }`, a same-database branded resolver and exact command `{ type, targetLinkId, expectedTargetRowVersion, idempotencyKey, reasonCode }`.
- [x] Resolve only the opaque assertion and require desktop `super_admin`, `device.revoke` and strictly future recent reauthentication.
- [x] Reject target link equal to context link; load target only from same authority. Reject stale/not-active cases and preserve target account versions.
- [x] CAS update link to `revoked`, increment target link auth/access/row versions, set timestamps, then atomically persist command receipt, receipt-bound audit and one `authorization.account_device_link_revoked` outbox intent.
- [x] Make revoked status an idempotent noop for a new key and strictly validate receipt/audit/outbox/link companions on replay.
- [x] Run focused, full migration suite and diff check.

### Task 3: Evidence and audit

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Modify: this plan

- [x] Record reference-only non-claims and account-version non-mutation semantics.
- [x] Request GPT-5.6-sol necessity then quality audit; fix all blocking findings and rerun verification.
- [ ] Commit task-only files with the project release convention and push `gewu/master`.
