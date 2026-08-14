# PostgreSQL 17 Capability Overrides Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not dispatch parallel agents.

**Goal:** Add only the V5 capability-overrides relation and its active-row partial unique index as ordered PostgreSQL 17 migration 5.

**Architecture:** Migration 5 appends a single immutable ledger entry after migrations 1–4. It creates `vnext_control_plane.vnext_capability_overrides`, whose composite account foreign key references migration 2 and capability foreign key references migration 4. The verifier-only catalog grows from nine to ten relations while preserving all previous migration SQL/checksums, zero seeds, and the ledger-only trigger set.

**Tech Stack:** Node.js built-in tests, exact-pinned `pg`, branded disposable Docker PostgreSQL 17, PostgreSQL catalog views, and the V5 SQLite kernel as semantic oracle.

---

## Fixed scope and invariants

- Migration 5 is `vnext-pg17-capability-overrides-5`, semantic version 5, with SHA-256 from exact checked-in SQL.
- Create only `vnext_capability_overrides` and `vnext_capability_overrides_one_active_capability`.
- Required C-collated nonblank IDs: `override_id`, `authority_id`, `account_id`, `capability_id`; `effect` is `allow|deny`; `status` is `active|revoked|expired`; `row_version` is positive `bigint`.
- `starts_at`, `created_at`, and `updated_at` are finite non-null timestamps. `ends_at` and `revoked_at` are finite when non-null. Enforce updated-not-before-created, end-after-start, and V5 active/revoked/expired lifecycle state.
- Use RESTRICT composite `(account_id,authority_id)` and global capability FKs. Unique active records are `(authority_id,account_id,capability_id) WHERE status='active'`; revoked history remains legal.
- A retired capability remains structurally referenceable. Its policy meaning is deferred; no status trigger or cross-table currentness rule is allowed.
- Only verifier gets SELECT; runtime gets no table/schema privilege. Add no seed, trigger, function, authority/policy mapping, writer/API, scope/profile/session/receipt/trust relation, business data, real RDS/ECS access, desktop data access, or deployment.

### Task 1: Lock the migration contract before DDL

**Files:** Modify `shared/vnext-pg17/migrationManifest.test.js`, then `shared/vnext-pg17/migrationManifest.js`.

- [x] **Step 1: Write the failing manifest contract.** Require semantic versions `[1,2,3,4,5]`, frozen migration ID `vnext-pg17-capability-overrides-5`, checksum equality, expected tenth relation, and SQL containing the exact partial-index name and both foreign-key columns.

- [x] **Step 2: Run `node shared/vnext-pg17/migrationManifest.test.js`.** It must fail because the current manifest ends at version 4.

- [x] **Step 3: Add the one migration.** Define all twelve columns, finite timestamps, nonblank IDs, closed effect/status checks, positive row version, lifecycle/time checks, RESTRICT account/capability FKs, the one active partial unique index, and verifier SELECT grant. Export/append migration 5 and exactly one tenth expected relation.

- [x] **Step 4: Re-run the manifest test.** Expected: `vNext PG17 migration manifest checks passed`.

### Task 2: Assert semantics and fail-closed catalog drift

**Files:** Modify `shared/vnext-pg17/catalogAssertion.test.js`, then `shared/vnext-pg17/catalogAssertion.js`.

- [x] **Step 1: Add failing PG17 behavior tests.** Cover valid allow/deny and active/revoked/expired rows; retired capability reference; duplicate active rejection; revoked history/new-active acceptance; cross-authority account and unknown capability rejection; all ID/enum/version/time/lifecycle checks with exact constraints; migration-4 prefix apply/assert rejection plus ledger `[1,2,3,4]` and no override table.

- [x] **Step 2: Run `node shared/vnext-pg17/catalogAssertion.test.js`.** It must fail until override relation and catalog expectations exist.

- [x] **Step 3: Add catalog facts and drift tests.** Extend exact columns, constraints, primary/partial indexes, owner, ACL, public-shadow, all-target trigger, and ledger assertions. Freeze PG17-derived catalog hashes. Test ACL/default/extra-index/partial-predicate/FK/status-constraint/extra-trigger/public-shadow drift and verifier-write/runtime-read denial.

- [x] **Step 4: Re-run the catalog test.** Expected: `vNext PG17 catalog assertion checks passed`; disposable resources are gone.

### Task 3: Gate, evidence, and scoped publication

**Files:** Modify `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md` and this plan.

- [x] **Step 1: Run focused checks, `npm.cmd run test:vnext-control-plane-target`, `git diff --check`, and the disposable-container cleanup check.** All must exit 0.

- [x] **Step 2: Run independent necessity and quality review.** Necessity must reject scope expansion; quality must validate migration order/checksum, retired-capability structural reference, lifecycle/partial-index/FK/ACL/trigger/prefix/zero-seed drift tests, and cleanup. Repair every finding with a focused regression and rerun.

- [x] **Step 3: Append only verified synthetic evidence, stage only the plan/evidence/changed PG17 files, commit with the required date message, and push `gewu HEAD:master`.** Never stage output directories.

### Plan self-review

- Tasks cover all approved override columns, constraints, FKs, partial uniqueness, access control, prefix behavior, and review gates.
- No task permits a policy/default mapping, capability seed, cross-table retired-state behavior, runtime writer, or real resource.
- Every boundary uses exact names and test commands; no deferred object or implementation decision is left open.
