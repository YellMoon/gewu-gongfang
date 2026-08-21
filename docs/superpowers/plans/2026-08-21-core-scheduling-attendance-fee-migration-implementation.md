# Core Scheduling Attendance and Fee Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a local disposable shadow admission for teachers, students, courses, schedules, and structured attendance/fee facts.

**Architecture:** Extend the frozen business foundation with a second, independently catalogued migration. Normalize course defaults and schedule overrides before closed shadow SQL, reconcile effective roster/attendance/amount facts, and quarantine copied sentinel schedules. The admission ledger tracks only real source rows (`teachers`, `students`, `courses`, `schedules`): course pricing and schedule overrides are derived JSON details included in their parent row's logical hash, never invented as separate legacy source relations.

**Tech Stack:** Node.js CommonJS, PostgreSQL 17 disposable runtime, existing business/admission ledgers, and an authorized read-only SQLite source stage only.

---

### Task 1: Freeze the core scheduling source contract

**Files:**
- Modify: `migration/vnext/sourceTableCatalog.js`
- Modify: `migration/vnext/sourceTableCatalog.test.js`
- Create: `shared/vnext-pg17/coreSchedulingSourceContract.js`
- Create: `shared/vnext-pg17/coreSchedulingSourceContract.test.js`

- [x] Write failing tests for exact teachers/students/courses/schedules field mappings, closed status sets, explicit override precedence, course-default fallback, no-roster schedules, and `__institution_unbound__` quarantine.
- [x] Implement only the own-data contract validator and source normalizer; reject Proxy/accessor input, unknown fields, malformed JSON structures, foreign-key gaps, and non-finite/scale-losing amounts.
- [x] Run `node shared/vnext-pg17/coreSchedulingSourceContract.test.js && node migration/vnext/sourceTableCatalog.test.js`.
- [x] Commit the source contract only.

### Task 2: Add the second business DDL migration and catalog proof

**Files:**
- Modify: `shared/vnext-pg17/businessFoundationManifest.js`
- Modify: `shared/vnext-pg17/businessFoundationManifest.test.js`
- Modify: `shared/vnext-pg17/businessFoundationCatalogAssertion.js`
- Modify: `shared/vnext-pg17/businessFoundationCatalogAssertion.test.js`
- Modify: `shared/vnext-pg17/disposableRuntime.js`

- [x] Write failing manifest/catalog tests for `teachers`, `students`, `courses`, `course_student_pricings`, `schedules`, and `schedule_student_overrides`.
- [x] Add semantic version 2 with exact constraints, tenant/FK checks, numeric amounts, lifecycle/time checks, restricted PII columns, no application DML grants, and literal manifest SHA locking.
- [x] Extend the closed business DDL executor to apply the complete immutable foundation only to an empty disposable target, and to permit only exact full-ledger reapply; reject a partial historical prefix rather than inventing an unneeded upgrade path or exposing a generic DML facade.
- [x] Extend fresh/reapply/drift/ACL/default-ACL/membership assertions without changing the existing foundation migration bytes.
- [x] Run the focused manifest/catalog tests and commit.

### Task 3: Extend closed synthetic shadow admission

**Files:**
- Modify: `shared/vnext-pg17/businessFoundationShadowAdmission.js`
- Modify: `shared/vnext-pg17/businessFoundationShadowAdmission.test.js`
- Modify: `shared/vnext-pg17/businessFoundationAdmissionManifest.js`
- Modify: `shared/vnext-pg17/businessFoundationAdmissionManifest.test.js`
- Modify: `shared/vnext-pg17/businessFoundationAdmissionCatalog.js`
- Modify: `shared/vnext-pg17/businessFoundationAdmissionCatalog.test.js`
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`

- [x] Write failing admission-ledger tests for the four added real source relations and the two closed sentinel quarantine outcomes, then add only immutable admission semantic version 2. Course pricing and schedule overrides remain embedded, deterministic parts of their parent logical hashes.
- [x] Write failing integration tests that freeze fixed SQL, parent-before-child order, target re-read hashes, effective-roster counts, exact replay, source conflict, both generic and exact-18 sentinel quarantine cases, terminal poison, and target teardown.
- [x] Implement only fixed shadow SQL for teachers/students/courses/schedules and their derived pricing/override rows; no real source path, no generic writer facade, no paging/queue/staging/COPY layer, and no control-plane SQL.
- [x] Reconcile explicit overrides first, course-default schedules second, and no-roster schedules third. Require the immutable, snapshot-bound 18-schedule exception manifest to produce `USER_DECLARED_OBSOLETE_LEGACY_SCHEDULE`; any other sentinel row produces `LEGACY_COPY_UNBOUND_PARTICIPANT` quarantine.
- [x] Run the aggregate target test and commit.

### Task 4: Gate the separate 3013 local-draft intake

**Files:**
- Create: `docs/superpowers/specs/2026-08-21-legacy-local-draft-intake-admission-design.md`
- Create: `docs/superpowers/plans/2026-08-21-legacy-local-draft-intake-implementation.md`

- [x] Record that the 3013 count has no persisted proof in the approved SQLite snapshot.
- [x] Define a separately authorized read-only device-local source, command-level idempotency, online session validation, impact preview, user confirmation, and no raw-row cloud writes for schedule create/change/delete, attendance, and fee updates.
- [x] Do not implement that intake until its source root and command contract are approved.

### Task 5: Verify and publish the bounded slice

- [x] Run `npm.cmd run test:vnext-control-plane-target && node scripts/check_cloud_business_authority_contract.test.js && git diff --check`.
- [x] Stage only this slice; leave `output/locks/` and `output/release-matrix/` unstaged.
- [x] Commit with an automatic release message and push `gewu master`. Do not package or deploy because no user-facing runtime changed.
