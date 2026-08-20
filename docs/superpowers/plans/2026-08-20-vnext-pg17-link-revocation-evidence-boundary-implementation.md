# PG17 vNext Link-Revocation Evidence Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy and structurally verify synthetic historical link-revocation receipt, audit, and accepted-only outbox evidence.

**Architecture:** Extend the completed identity/lifecycle source with a source-only canonical revoke envelope exactly `{ type, targetLinkId, expectedTargetRowVersion, idempotencyKey, reasonCode }`. Use the existing stable link-revoke canonical JSON algorithm to validate request bytes and SHA-256; validate exact receipt result, audit context, and accepted-only outbox companion semantics before static target INSERTs and rereads.

**Tech Stack:** Node.js CommonJS, in-memory better-sqlite3, pg 8.23.0, disposable PostgreSQL 17 runtime, node assert.

---

### Task 1: Evidence red tests

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [x] Add accepted, noop, and rejected revoke evidence fixtures and verify receipt/audit/outbox counts and hashes.
- [x] Run focused test; nonempty receipts/audit/outbox must currently reject before target writes.
- [x] Add red cases for unknown commands, canonical request/hash mismatch, wrong target state/version, companion tampering, outbox on noop/rejected, and each evidence write-stage rollback.

### Task 2: Exact source evidence validation

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`

- [x] Freeze source-only revoke envelope and exact receipt/audit/outbox field manifests.
- [x] Require `actor_key=account:${actor_account_id}`, same-authority actor/context/target, exact `{accountId,linkId,policyRevision}` audit context, accepted `ACCOUNT_DEVICE_LINK_REVOKED`, noop `ACCOUNT_DEVICE_LINK_ALREADY_REVOKED`, and null committed versions for non-accepted outcomes.
- [x] Keep every other command and evidence type fail-closed.

### Task 3: Runtime static SQL and audit

**Files:**
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [x] Add only fixed receipt/audit/outbox INSERT/reread entries and opaque fault stages.
- [x] Verify trace closure, rollback, terminal poison, catalog, and aggregate gates.
- [x] Obtain independent review, update the boundary record, then commit and push only after all pass.
