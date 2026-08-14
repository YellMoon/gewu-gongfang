# PostgreSQL 17 Authorization Command Receipts Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not dispatch parallel agents.

**Goal:** Add only the V5 authorization-command-receipts relation and its own append-only protections as ordered PostgreSQL 17 migration 9.

**Architecture:** Migration 9 appends one immutable ledger entry after migrations 1-8. It creates generic idempotency receipt storage plus two SECURITY DEFINER functions and no-update/no-delete triggers. It deliberately does not recognize a command vocabulary, parse any command-specific result, create a writer, or add an outbox/audit/policy/trust-root consumer.

**Tech Stack:** Node.js built-in tests, exact-pinned `pg`, branded disposable Docker PostgreSQL 17, PostgreSQL catalog views, and the V5 SQLite reference schema as semantic oracle.

---

## Fixed scope

- Append migration 9 only. It creates the 19-column `vnext_control_plane.vnext_authorization_command_receipts` relation and exactly two append-only trigger/function pairs.
- Use `COLLATE "C"` nonblank text for receipt, authority, actor, idempotency, command, target, and result-code fields. `actor_account_id` is nullable; it has no bootstrap/recovery interpretation in this migration.
- Require lower-case 64-character SHA-256 strings for both canonical SHA fields. Keep `canonical_result_json` as canonical `text`, with `IS JSON WITH UNIQUE KEYS`; do not store JSONB, reserialize text, or make PostgreSQL recompute the hash.
- Permit generic JSON object, array, and scalar results. Only later command-specific consumers may impose exact object shape or result bindings.
- Allow `accepted|rejected|noop`; `expected_row_version` is null or nonnegative bigint; the four committed versions are null or positive bigint; `created_at` is finite.
- Add receipt PK, `(receipt_id,authority_id)` unique, `(authority_id,actor_key,idempotency_key)` unique, authority RESTRICT FK, nullable composite actor-account RESTRICT FK, verifier-only SELECT, and runtime-zero table privilege.
- Functions are owned by `vnext_pg17_owner`, are `SECURITY DEFINER`, set `search_path = pg_catalog, pg_temp`, contain no dynamic SQL, and deny PUBLIC/verifier/runtime execution. No triggers/functions outside this receipt table are added.
- Do not add sessions/reauth/audit/outbox/policy/bootstrap/evidence, seed rows, writer/API/runtime DML, actual contact/business data, real RDS/ECS work, or source migration/import/deployment operations. Migrations 1-8 and schema meta remain unchanged.

### Task 1: Establish the migration manifest with RED-GREEN tests

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.test.js`
- Modify: `shared/vnext-pg17/migrationManifest.js`

- [x] **Step 1: Require migration 9 in the manifest test.**

  Import `AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION`; require semantic versions `[1,2,3,4,5,6,7,8,9]`; assert its stable checksum, table, two function definitions, and exact update/delete trigger names.

- [x] **Step 2: Run the focused manifest test and observe RED.**

  Run: `node shared/vnext-pg17/migrationManifest.test.js`

  Expected: failure because migration 9 and receipt append-only functions are absent.

- [x] **Step 3: Add only the immutable receipt SQL.**

  Create the 19 approved columns, all named data checks, both unique constraints, two RESTRICT FKs, `IS JSON WITH UNIQUE KEYS`, verifier SELECT grant, and the two `BEFORE UPDATE`/`BEFORE DELETE` triggers using owner-owned SECURITY DEFINER functions. Append the immutable migration record, expected relation, function hashes, and trigger manifest without altering previous SQL bytes.

- [x] **Step 4: Run the focused manifest test and observe GREEN.**

  Run: `node shared/vnext-pg17/migrationManifest.test.js`

  Expected: `vNext PG17 migration manifest checks passed`.

### Task 2: Prove real database semantics and catalog exactness

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`

- [x] **Step 1: Add receipt behavior tests before catalog facts.**

  Add a generic receipt fixture. Prove accepted/rejected/noop, ordinary and null actor accounts, JSON object/array/scalar acceptance, row-version null/zero and committed-version null/positive behavior, both uniqueness constraints, authority/account FK rejection, zero seed, verifier write denial, and runtime read denial.

- [x] **Step 2: Add exact negative tests.**

  Use independent fixtures to assert exact constraint names for every blank required value, invalid outcome, malformed/duplicate-key JSON, non-lowercase or short SHA, negative/fractional expected version, zero/fractional each committed version, and finite created time. Ensure no earlier constraint or unique rule masks the target check.

- [x] **Step 3: Add append-only behavior tests.**

  Insert a valid receipt, attempt a single-field update and delete, and assert both fail. The row must remain byte-for-byte logically equal after each attempt.

- [x] **Step 4: Add migration-8 prefix failure coverage.**

  Apply only migrations 1-8 and ledger rows, call catalog apply/assert, and require ledger `[1,2,3,4,5,6,7,8]`, receipt table absence, and both receipt functions absence.

- [x] **Step 5: Run the focused catalog test and observe RED.**

  Run: `node shared/vnext-pg17/catalogAssertion.test.js`

  Expected: failure because the receipt relation, functions, triggers, and ledger facts are absent.

- [x] **Step 6: Add exact catalog facts.**

  Add all receipt columns/nullability, exact named constraints/indexes/FKs, owner and precise ACLs, the two function source/security/search-path hashes, and both exact trigger definitions. Update target trigger/function catalogs and migration ledger values. Generate catalog row hashes with a temporary local diagnostic matching assertion query ordering and remove it before commit.

- [x] **Step 7: Add isolated catalog drift regressions.**

  In one-fresh-handle fixtures, assert drift for extra/altered indexes, removed FK, widened outcome/version/JSON constraints, unexpected default, verifier/runtime ACL, changed function source/security/search-path/execution grant, altered/missing/extra trigger, public shadow, and unexpected target relation/function.

- [x] **Step 8: Run focused catalog and target aggregate tests.**

  Run: `node shared/vnext-pg17/catalogAssertion.test.js`

  Run: `npm.cmd run test:vnext-control-plane-target`

  Expected: both pass and disposable PG17 cleanup leaves no labeled container.

### Task 3: Review, evidence, and publication

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-vnext-pg17-authorization-command-receipts-ddl.md`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [x] **Step 1: Run fresh scoped verification.**

  Run `node shared/vnext-pg17/migrationManifest.test.js`, `node shared/vnext-pg17/catalogAssertion.test.js`, `npm.cmd run test:vnext-control-plane-target`, `git diff --check`, and the disposable Docker label query. Require zero exit codes, a silent diff check, and no labeled container.

- [x] **Step 2: Request and address independent quality review.**

  Submit the scoped diff to the existing audit task. Each finding requires a failing regression before its smallest correction, then focused plus aggregate rerun.

- [x] **Step 3: Record verified synthetic evidence.**

  Mark completed steps and append an M9 entry to the master control-plane plan. State disposable synthetic PG17 evidence only; do not claim real RDS/ECS, real receipt data, writer, API, or production deployment.

- [x] **Step 4: Commit and push only scope files.**

  Stage the two plan files and four PG17 implementation/test files, use the repository-required dated commit message, and push `gewu HEAD:master`. Exclude output directories, package artifacts, and unrelated files.

## Self-review

- The plan covers the approved table, generic JSON boundary, append-only protections, security-definer/ACL obligations, prefix failure, and exact-catalog behavior without importing any consumer relation.
- Receipt command and result semantics remain intentionally uncommitted; only later writers/consumers may define them.
- All proof requires real disposable PostgreSQL 17 rather than static SQL inspection.
