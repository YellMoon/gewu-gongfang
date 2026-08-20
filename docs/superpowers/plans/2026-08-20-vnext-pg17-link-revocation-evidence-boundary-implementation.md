# PG17 vNext Link-Revocation Evidence Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy and structurally verify synthetic historical link-revocation receipt, audit, and accepted-only outbox evidence.

**Architecture:** Extend the completed identity/lifecycle source with source-only canonical revoke envelopes. The source validates exact request/result/companion semantics before static target INSERTs and rereads canonical hashes before commit.

**Tech Stack:** Node.js CommonJS, in-memory better-sqlite3, pg 8.23.0, disposable PostgreSQL 17 runtime, node assert.

---

### Task 1: Evidence red tests

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [ ] Add accepted, noop, and rejected revoke evidence fixtures and verify receipt/audit/outbox counts and hashes.
- [ ] Run focused test; nonempty receipts/audit/outbox must currently reject before target writes.
- [ ] Add red cases for unknown commands, canonical request/hash mismatch, wrong target state/version, companion tampering, outbox on noop/rejected, and each evidence write-stage rollback.

### Task 2: Exact source evidence validation

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`

- [ ] Freeze source-only revoke envelope and exact receipt/audit/outbox field manifests.
- [ ] Recreate canonical request/result/payload hashes, validate accepted/noop/rejected state rules, and add reread report hashes.
- [ ] Keep every other command and evidence type fail-closed.

### Task 3: Runtime static SQL and audit

**Files:**
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [ ] Add only fixed receipt/audit/outbox INSERT/reread entries and opaque fault stages.
- [ ] Verify trace closure, rollback, terminal poison, catalog, and aggregate gates.
- [ ] Obtain independent review, update the boundary record, then commit and push only after all pass.
