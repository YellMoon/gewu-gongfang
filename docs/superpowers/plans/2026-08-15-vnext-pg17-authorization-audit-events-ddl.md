# PostgreSQL 17 Authorization Audit Events Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task-by-task. Keep work inline; do not dispatch parallel agents.

**Goal:** Add only the V5 authorization-audit-events relation and its table-local append-only protections as ordered PostgreSQL 17 migration 10.

**Architecture:** Migration 10 appends a six-column receipt-bound audit record after the immutable M1-M9 ledger. It remains a generic evidence relation: it stores an opaque reason and writer-supplied context hash but creates no audit writer, outbox, policy, trust-root consumer, command vocabulary, or JSON payload contract.

**Tech Stack:** Node.js built-in assertions, exact-pinned `pg`, branded disposable Docker PostgreSQL 17, PostgreSQL catalog views, and the V5 SQLite reference schema as semantic oracle.

---

## Fixed scope

- Append migration 10 only. Create `vnext_control_plane.vnext_authorization_audit_events` with `event_id`, `authority_id`, `receipt_id`, `reason_code`, `context_sha256`, and `created_at`.
- Every text field uses `COLLATE "C"`, is nonblank, and is not interpreted as a command, reason taxonomy, actor, or context payload. `context_sha256` is lower-case 64 hex; `created_at` is finite `timestamptz`.
- Add the event primary key, `UNIQUE(authority_id, receipt_id)`, an authority RESTRICT foreign key, and a `(receipt_id, authority_id)` RESTRICT composite foreign key to the M9 receipt table. Do not add an accepted-outcome, reason-code, or context guard.
- Create exactly two owner-owned `SECURITY DEFINER` functions and `BEFORE UPDATE`/`BEFORE DELETE` triggers that raise `P0001`. Both functions use `SET search_path = pg_catalog, pg_temp`; PUBLIC, verifier, and runtime have no EXECUTE. Verifier receives SELECT only; runtime receives no table privilege.
- Preserve M1-M9 SQL/checksums byte-for-byte and leave schema meta tied to migration 2. Add zero seed data.
- Exclude outbox, policy publication, bootstrap marker, trust-root evidence, sessions, reauthentication, writers, APIs, runtime DML, real RDS/ECS, source/business data, D-drive/NAS data, imports, deployment, and packages.

### Task 1: Establish migration 10 with RED-GREEN manifest tests

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.test.js`
- Modify: `shared/vnext-pg17/migrationManifest.js`

- [x] **Step 1: Require M10 in the manifest test.**

  Import `AUTHORIZATION_AUDIT_EVENTS_MIGRATION`, require versions `[1,2,3,4,5,6,7,8,9,10]`, and assert the immutable hash, audit table, receipt composite foreign key, and exact append-only trigger names.

- [x] **Step 2: Run the manifest test and observe RED.**

  Run: `node shared/vnext-pg17/migrationManifest.test.js`

  Expected: failure because M10 and its functions are absent.

- [x] **Step 3: Append only the audit migration SQL.**

  Add the six approved columns, nonblank/hash/finite checks, PK, unique, RESTRICT FKs, verifier SELECT, and these two table-local trigger families:

  ```sql
  CREATE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp AS $$
  BEGIN
    RAISE EXCEPTION 'vNext authorization audit event is append-only' USING ERRCODE = 'P0001';
  END;
  $$;
  CREATE TRIGGER vnext_authorization_audit_events_no_update
  BEFORE UPDATE ON vnext_control_plane.vnext_authorization_audit_events
  FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update();
  ```

  Add the matching no-delete function/trigger, revoke PUBLIC EXECUTE, append the migration record, expected relation, function hashes, and trigger manifest. Do not alter M1-M9 SQL.

- [x] **Step 4: Run the manifest test and observe GREEN.**

  Run: `node shared/vnext-pg17/migrationManifest.test.js`

  Expected: `vNext PG17 migration manifest checks passed`.

### Task 2: Prove audit semantics and catalog exactness on PostgreSQL 17

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`

- [x] **Step 1: Add behavior tests before catalog facts.**

  With a real M9 receipt fixture, insert one valid audit row. Prove primary-key and authority/receipt uniqueness, missing authority and receipt FKs, cross-authority receipt rejection, all four nonblank checks, short/uppercase context hashes, both infinite timestamps, verifier write denial, runtime read denial, and zero seed.

- [x] **Step 2: Add append-only tests.**

  Update one valid audit reason and delete the same row. Each must return `P0001`; a selected logical row snapshot before/after must match exactly.

- [x] **Step 3: Add M9-prefix RED coverage.**

  Apply M1-M9 only, then require catalog apply/assert to fail closed while the ledger remains exactly `[1..9]`, `to_regclass('vnext_control_plane.vnext_authorization_audit_events')` is null, and both audit function regprocedures are null.

- [x] **Step 4: Run the catalog test and observe RED.**

  Run: `node shared/vnext-pg17/catalogAssertion.test.js`

  Expected: `VNEXT_PG17_SCHEMA_DRIFT` before M10 catalog facts are registered.

- [x] **Step 5: Add exact catalog facts.**

  Register all six columns, owner, ten constraints, two indexes, both RESTRICT FK definitions, verifier/runtime ACL, both function hashes/security/search path/EXECUTE denials, exact triggers, M10 ledger entry, and exact relation/function/trigger sets. Use a temporary disposable-only diagnostic that runs the same ordered catalog queries, then delete it before commit.

- [x] **Step 6: Add isolated drift regressions.**

  Use fresh handles to prove `VNEXT_PG17_SCHEMA_DRIFT` for a changed unique key; each FK removal; widened hash and finite-time checks; unexpected default or nullability; extra index; wrong table owner; verifier/runtime table rights; changed function body, SECURITY INVOKER, owner, search path, verifier/runtime/PUBLIC EXECUTE; missing/extra/wrong-event trigger; public shadow; and extra target relation/function.

- [x] **Step 7: Run focused and aggregate target verification.**

  Run:

  ```text
  node shared/vnext-pg17/catalogAssertion.test.js
  npm.cmd run test:vnext-control-plane-target
  ```

  Expected: both exit zero and disposable cleanup leaves no `vnext-pg17-runtime=true` container.

### Task 3: Audit, evidence, and publication

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-vnext-pg17-authorization-audit-events-ddl.md`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [x] **Step 1: Run fresh scoped evidence.**

  Run `node shared/vnext-pg17/migrationManifest.test.js`, `node shared/vnext-pg17/catalogAssertion.test.js`, `npm.cmd run test:vnext-control-plane-target`, `git diff --check`, and the Docker label query. Require zero exit codes, silent diff check, and no labeled container.

- [x] **Step 2: Request and address independent quality review.**

  Submit the scoped diff to the existing audit task. Turn each finding into a failing regression before the smallest correction, then rerun focused and aggregate verification.

- [x] **Step 3: Record synthetic-only evidence.**

  Mark completed plan steps and append an M10 evidence entry to the master control-plane plan. It must explicitly say no real RDS/ECS, audit data, audit writer, API, or production deployment was used.

- [ ] **Step 4: Commit and push only the six scope files.**

  Stage the two plan files plus the four PG17 implementation/test files, use the repository's required dated commit message, and push `gewu HEAD:master`; exclude output directories and unrelated artifacts.

## Self-review

- The plan preserves generic audit evidence semantics and does not prematurely define writer or reason vocabulary behavior.
- M10 has only the M9 receipt dependency, so it remains the smallest valid successor rather than an audit/outbox/policy bundle.
- Every verification uses synthetic disposable PostgreSQL 17; production control-plane DDL and data migration remain later, separately authorized work.
