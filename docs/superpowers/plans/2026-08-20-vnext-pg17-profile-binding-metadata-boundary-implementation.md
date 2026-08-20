# PG17 vNext Profile-Binding Metadata Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opaque profile-binding metadata to the synthetic copy rehearsal without copying business profiles or activating authorization.

**Architecture:** Replay the existing nine-relation closure into an empty disposable PG17 target, then use runtime-issued static SQL to insert and reread `vnext_profile_bindings`. Exact source validation and source/target canonical hash equality are required before commit.

**Tech Stack:** Node.js CommonJS, in-memory better-sqlite3, pg 8.23.0, disposable PostgreSQL 17 runtime, node assert.

---

### Task 1: Red tests

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [ ] Add active, pending, and revoked profile-binding fixtures; assert target counts, actual hashes, and zero active authorization.
- [ ] Run focused test; it must reject nonempty `profileBindings` before target writes.
- [ ] Add red cases for exact fields, FKs, enums, versions, instants, lifecycle, two active keys, excluded rows, post-read mismatch, and profile-stage rollback.

### Task 2: Source and report mapping

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`

- [ ] Add the exact eleven-field validator, V5 lifecycle, opaque text rules, and the narrow deferred gate.
- [ ] Add profile source/target logical hashes and actual counts; mismatch must roll back.
- [ ] Run focused rehearsal test to green.

### Task 3: Runtime SQL closure

**Files:**
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Modify: `shared/vnext-pg17/disposableRuntime.test.js`

- [ ] Add only static profile INSERT/reread entries behind the opaque facade.
- [ ] Add opaque `profileBindings` and `postReadProfileMismatch` fault stages.
- [ ] Verify trace closure and focused runtime/rehearsal tests.

### Task 4: Audit and publish

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-vnext-pg17-control-plane-copy-only-rehearsal-implementation.md`
- Modify: this plan

- [ ] Update the current-boundary record without weakening non-claims.
- [ ] Obtain independent necessity and quality audit; turn every finding into a red test and minimal fix.
- [ ] Run focused, catalog, aggregate, and diff checks; commit and push only after all pass.
