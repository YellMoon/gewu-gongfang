# Core Scheduling Attendance and Fee Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a local disposable shadow admission for teachers, students, courses, schedules, and structured attendance/fee facts.

**Architecture:** Extend the frozen business foundation with a second, independently catalogued migration. Normalize course defaults and schedule overrides before closed shadow SQL, reconcile effective roster/attendance/amount facts, and quarantine copied sentinel schedules.

**Tech Stack:** Node.js CommonJS, PostgreSQL 17 disposable runtime, existing business/admission ledgers, and an authorized read-only SQLite source stage only.

---

### Task 1: Freeze the core scheduling source contract

**Files:**
- Modify: `migration/vnext/sourceTableCatalog.js`
- Modify: `migration/vnext/sourceTableCatalog.test.js`
- Create: `shared/vnext-pg17/coreSchedulingSourceContract.js`
- Create: `shared/vnext-pg17/coreSchedulingSourceContract.test.js`

- [ ] Write failing tests for exact teachers/students/courses/schedules field mappings, closed status sets, explicit override precedence, course-default fallback, no-roster schedules, and `__institution_unbound__` quarantine.
- [ ] Implement only the own-data contract validator and source normalizer; reject Proxy/accessor input, unknown fields, malformed JSON structures, foreign-key gaps, and non-finite/scale-losing amounts.
- [ ] Run `node shared/vnext-pg17/coreSchedulingSourceContract.test.js && node migration/vnext/sourceTableCatalog.test.js`.
- [ ] Commit the source contract only.

### Task 2: Add the second business DDL migration and catalog proof

**Files:**
- Modify: `shared/vnext-pg17/businessFoundationManifest.js`
- Modify: `shared/vnext-pg17/businessFoundationManifest.test.js`
- Modify: `shared/vnext-pg17/businessFoundationCatalogAssertion.js`
- Modify: `shared/vnext-pg17/businessFoundationCatalogAssertion.test.js`

- [ ] Write failing manifest/catalog tests for `teachers`, `students`, `courses`, `course_student_pricings`, `schedules`, and `schedule_student_overrides`.
- [ ] Add semantic version 2 with exact constraints, tenant/FK checks, numeric amounts, lifecycle/time checks, restricted PII columns, no application DML grants, and literal manifest SHA locking.
- [ ] Extend fresh/reapply/drift/ACL/default-ACL/membership assertions without changing the existing foundation migration bytes.
- [ ] Run the focused manifest/catalog tests and commit.

### Task 3: Extend closed synthetic shadow admission

**Files:**
- Modify: `shared/vnext-pg17/businessFoundationShadowAdmission.js`
- Modify: `shared/vnext-pg17/businessFoundationShadowAdmission.test.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`

- [ ] Write failing integration tests that freeze full SQL trace, parent-before-child order, target re-read hashes, effective-roster counts, exact replay, source conflict, quarantine, terminal poison, and target teardown.
- [ ] Implement only fixed shadow SQL for the six additional relations; no real source path, no generic writer facade, and no control-plane SQL.
- [ ] Reconcile explicit overrides first, course-default schedules second, and no-roster schedules third. Require the immutable, snapshot-bound 18-schedule exception manifest to produce `USER_DECLARED_OBSOLETE_LEGACY_SCHEDULE`; any other sentinel row produces `LEGACY_COPY_UNBOUND_PARTICIPANT` quarantine.
- [ ] Run the aggregate target test and commit.

### Task 4: Gate the separate 3013 local-draft intake

**Files:**
- Create: `docs/superpowers/specs/2026-08-21-legacy-local-draft-intake-admission-design.md`
- Create: `docs/superpowers/plans/2026-08-21-legacy-local-draft-intake-implementation.md`

- [ ] Record that the 3013 count has no persisted proof in the approved SQLite snapshot.
- [ ] Define a separately authorized read-only device-local source, command-level idempotency, online session validation, impact preview, user confirmation, and no raw-row cloud writes for schedule create/change/delete, attendance, and fee updates.
- [ ] Do not implement that intake until its source root and command contract are approved.

### Task 5: Verify and publish the bounded slice

- [ ] Run `npm.cmd run test:vnext-control-plane-target && node scripts/check_cloud_business_authority_contract.test.js && git diff --check`.
- [ ] Stage only this slice; leave `output/locks/` and `output/release-matrix/` unstaged.
- [ ] Commit with an automatic release message and push `gewu master`. Do not package or deploy because no user-facing runtime changed.
