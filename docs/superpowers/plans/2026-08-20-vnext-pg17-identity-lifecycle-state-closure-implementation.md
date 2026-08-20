# PG17 vNext Identity Lifecycle-State Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map approved identity lifecycle states through the synthetic copy rehearsal without adding tables or activating credentials.

**Architecture:** Keep the ten-relation current closure and static runtime SQL unchanged except for value validation. Source fixtures exercise permitted state values; exact source/target reread hashes prove state preservation before commit.

**Tech Stack:** Node.js CommonJS, in-memory better-sqlite3, pg 8.23.0, disposable PostgreSQL 17 runtime, node assert.

---

### Task 1: Lifecycle red tests

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [ ] Add a complete fixture containing disabled/revoked accounts, risk-limited/revoked/retired devices, revoked/retired installations, and revoked/expired links; assert exact target hashes.
- [ ] Run the focused test; current active-only source validation must fail before target writes.
- [ ] Add red cases for every bad state/revoked-time pairing and active profile binding against a non-active account.

### Task 2: Source validation and report

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`

- [ ] Replace active-only checks with the frozen state sets and exact lifecycle rules.
- [ ] Preserve all existing versions, FKs, unique constraints, source snapshots, logical rereads, and zero-authorization assertions.
- [ ] Run the focused rehearsal test to green.

### Task 3: Audit, verify, and publish

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-vnext-pg17-control-plane-copy-only-rehearsal-implementation.md`
- Modify: this plan

- [ ] Update the current-boundary record accurately.
- [ ] Obtain independent necessity and quality review; add a red test for every finding.
- [ ] Run focused, runtime, catalog, aggregate, and diff checks; commit and push only after all pass.
