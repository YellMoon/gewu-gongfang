# vNext PG17 Role Grants DDL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add ordered PostgreSQL 17 migration 3 for the V5 role-grant relation and its single active-role partial unique index, with exact disposable catalog validation.

**Architecture:** Migration 3 extends migration 1/2 without changing either SQL string or checksum. It creates only vnext_control_plane.vnext_role_grants; both its account and nullable grantor foreign keys use the migration-2 account tuple. The verifier-only catalog grows from seven to eight relations and rejects role-grant constraint, index, trigger, ACL, ledger, or public-shadow drift.

**Tech Stack:** Node.js built-in tests, exact-pinned pg, the branded disposable local Docker PostgreSQL 17 runtime, PostgreSQL 17 catalog views, and the V5 SQLite reference kernel as semantic source.

---

## Fixed scope and invariants

- Migration 3 only: migration_id=vnext-pg17-role-grants-3, semantic_version=3, checksum from the exact checked-in SQL.
- Keep migrations 1 and 2 byte-for-byte, including their checksums and the migration-2 schema-meta companion row.
- Add exactly vnext_control_plane.vnext_role_grants and vnext_control_plane.vnext_role_grants_one_active_role.
- Exact table columns are grant_id, authority_id, account_id, role, status, grant_version, row_version, starts_at, ends_at, revoked_at, granted_by_account_id, created_at, updated_at.
- IDs use text COLLATE "C"; present IDs reject blanks. Versions are positive bigint; times are finite timestamptz. Roles are super_admin, teacher, student; statuses are active, revoked, expired.
- Both (account_id,authority_id) and nullable (granted_by_account_id,authority_id) are RESTRICT composite foreign keys to vnext_accounts(account_id,authority_id).
- The exact partial unique index is UNIQUE(authority_id,account_id,role) WHERE status='active'. Revoked history remains legal.
- Lifecycle checks require updated_at >= created_at, an end strictly after start, active null revocation, revoked non-null revocation, and expired non-null end plus null revocation.
- Only vnext_pg17_verifier receives SELECT. Runtime receives no table or schema privilege. Migration 3 adds no trigger, so the target trigger set remains only the three ledger triggers.
- Never add contacts, capabilities/overrides, scope/profile bindings, sessions/reauth, receipts/audit/outbox/policy/trust-root state, any role/default seed, writer/API, real RDS/ECS connection, desktop database access, NAS/removable-media access, or business data.

## File map

| File | Change |
| --- | --- |
| shared/vnext-pg17/migrationManifest.js | Add frozen migration 3 SQL/object, append it to MIGRATIONS, and extend expected relations. |
| shared/vnext-pg17/migrationManifest.test.js | Assert ordered three-migration manifest and role index/table contract. |
| shared/vnext-pg17/catalogAssertion.js | Extend relation, column, constraint, partial-index, ACL, trigger, public-shadow, and ledger assertions to role grants. |
| shared/vnext-pg17/catalogAssertion.test.js | Test real role semantics, no seed, fresh-only migration behavior, and drift failures. |
| docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md | Append sanitized evidence only after final review. |

### Task 1: Add the migration-3 manifest using TDD

**Files:**
- Modify: shared/vnext-pg17/migrationManifest.test.js
- Modify: shared/vnext-pg17/migrationManifest.js

- [x] **Step 1: Write the failing manifest contract**

Add assertions that migration semantic versions equal [1, 2, 3], the third migration is vnext-pg17-role-grants-3, expected relations include vnext_control_plane.vnext_role_grants, and its SQL includes the exact active-role partial-index name.

- [x] **Step 2: Confirm the focused manifest test is red**

Run node shared/vnext-pg17/migrationManifest.test.js. Expected: it fails because migration 3 has not yet been defined.

- [x] **Step 3: Implement the minimal immutable migration object**

Create ROLE_GRANTS_SQL with the table, finite-time and lifecycle checks, both composite RESTRICT foreign keys, exact partial unique index, and verifier-only SELECT grant. Create immutable ROLE_GRANTS_MIGRATION with semanticVersion 3 and manifestSha256 sha256(ROLE_GRANTS_SQL), then append it after FOUNDATION_IDENTITY_DEVICE_MIGRATION in MIGRATIONS.

- [x] **Step 4: Verify the manifest test is green**

Run node shared/vnext-pg17/migrationManifest.test.js. Expected: vNext PG17 migration manifest checks passed.

### Task 2: Make role semantics and catalog drift fail closed

**Files:**
- Modify: shared/vnext-pg17/catalogAssertion.test.js
- Modify: shared/vnext-pg17/catalogAssertion.js

- [x] **Step 1: Write real-PG failing behavior tests**

In a fresh branded disposable database, apply all migrations and insert only synthetic authority/account fixtures. Cover duplicate active role rejection, revoked history plus a later active grant, nullable grantor success, cross-authority account/grantor rejection, blank ID/role, invalid role/status, zero/fractional version, end at or before start, active with revocation, revoked without revocation, and expired without end.

Add fresh catalog drifts for a changed or missing partial-index predicate, removed composite FK, verifier INSERT, runtime SELECT, an added role-table trigger, altered check/default, and public.vnext_role_grants. Every case must return VNEXT_PG17_SCHEMA_DRIFT without repair.

- [x] **Step 2: Confirm the focused catalog test is red**

Run node shared/vnext-pg17/catalogAssertion.test.js. Expected: it fails until the manifest and catalog facts include migration 3.

- [x] **Step 3: Expand catalog facts exactly**

Extend frozen relation metadata, ownership, constraint fingerprint and selected definitions, index fingerprint, all-target-table trigger enumeration, public-shadow detection, verifier/runtime privilege matrix, and exact ledger comparison. The expected trigger list stays exactly the three ledger triggers, so any role-table trigger is drift.

- [x] **Step 4: Verify the focused catalog test is green**

Run node shared/vnext-pg17/catalogAssertion.test.js. Expected: vNext PG17 catalog assertion checks passed.

### Task 3: Verify fresh-only ordering and zero seed

**Files:**
- Modify: shared/vnext-pg17/catalogAssertion.test.js

- [x] **Step 1: Add zero-seed and prefix-rejection coverage**

After fresh apply, assert ledger versions [1,2,3], one schema-meta row, and zero role grants/foundation rows before fixtures. Build a migration-2-only synthetic prefix, then require apply and assert to return VNEXT_PG17_SCHEMA_DRIFT without appending migration 3.

- [x] **Step 2: Verify focused behavior**

Run node shared/vnext-pg17/catalogAssertion.test.js. Expected: fresh apply is atomic, reapply returns applied=false, and the old prefix is not repaired.

### Task 4: Mandatory review, verification, evidence, and publish

**Files:**
- Modify: docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md
- Modify: docs/superpowers/plans/2026-08-15-vnext-pg17-role-grants-ddl.md

- [x] **Step 1: Run complete verification**

Run:
    node shared/vnext-pg17/packageContract.test.js
    node shared/vnext-pg17/disposableRuntime.test.js
    node shared/vnext-pg17/migrationManifest.test.js
    node shared/vnext-pg17/catalogAssertion.test.js
    node shared/vnext-pg17/runPg17IntegrationTests.test.js
    npm run test:vnext-control-plane-target
    npm test
    git diff --check

Expected: every command exits zero. A missing Docker/image runtime is a nonzero VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE, never a skipped success. The local disposable runtime leaves no labelled container.

- [x] **Step 2: Complete the required read-only gates**

Necessity must confirm migration 3 contains only role grants and no forbidden relation, seed, writer, runtime, real-environment, or business-data access. Quality must check exact migration/checksum order, FKs/checks/partial index, zero seed, no role trigger, ACL/catalog drift coverage, and disposable cleanup. Any finding requires a focused regression, minimal repair, and a full rerun before evidence or publication.

- [x] **Step 3: Record sanitized evidence and publish scoped files**

Append dated evidence describing migration 3’s one-table scope, zero role/default seed, partial unique/lifecycle/FK coverage, disposable-only validation, and deferred non-goals. Do not include secrets, connection strings, raw Docker output, host paths, production deployment, or business rows.

Run:
    git add shared/vnext-pg17 docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md docs/superpowers/plans/2026-08-15-vnext-pg17-role-grants-ddl.md
    git commit -m <required-date-message>
    git push gewu HEAD:master

Do not stage output/locks or output/release-matrix. This contract-test slice does not package Electron or publish an OSS desktop update.

## Self-review

- **Spec coverage:** The plan preserves every approved role-grant column, nullable grantor, authority-scoped FK, lifecycle/version/time check, and active-role uniqueness rule.
- **Scope check:** Capability catalog/overrides, contacts, scopes, profiles, sessions, receipts, policies, and trust-root state remain deferred; no runtime writer is introduced.
- **Ambiguity check:** Only active rows participate in the unique index, so revoked grant history is preserved. Any role-table trigger is unexpected catalog drift in this DDL-only slice.
