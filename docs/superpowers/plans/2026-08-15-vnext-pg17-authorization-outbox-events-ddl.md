# PostgreSQL 17 Authorization Outbox Events Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task-by-task. Keep work inline; do not dispatch parallel agents.

**Goal:** Add only the V5 authorization-outbox-events relation and its table-local append-only protections as ordered PostgreSQL 17 migration 11.

**Architecture:** Migration 11 appends generic, receipt-bound outbox evidence after the immutable M1-M10 ledger. It deliberately stores opaque event and aggregate fields plus writer-supplied canonical JSON/hash; it does not dispatch messages, define payload vocabulary, or create an outbox writer.

**Tech Stack:** Node.js built-in assertions, exact-pinned `pg`, branded disposable Docker PostgreSQL 17, PostgreSQL catalog views, and the V5 SQLite reference schema as semantic oracle.

---

## Fixed scope

- Append migration 11 only. Create `vnext_control_plane.vnext_authorization_outbox_events` with `event_id`, `authority_id`, `receipt_id`, `event_type`, `aggregate_kind`, `aggregate_id`, `aggregate_version`, `canonical_payload_json`, `payload_sha256`, and `occurred_at`.
- All text columns use `COLLATE "C"` and nonblank checks. `aggregate_version` is a positive bigint; canonical payload is generic JSON text with unique keys; payload hash is lower-case 64 hex; occurred time is finite `timestamptz`.
- Add the event primary key, `UNIQUE(authority_id, receipt_id, event_type, aggregate_kind, aggregate_id)`, an authority RESTRICT foreign key, and a `(receipt_id, authority_id)` RESTRICT composite foreign key to M9 receipts. Do not define event, aggregate, or payload semantics.
- Create exactly two owner-owned `SECURITY DEFINER` functions and `BEFORE UPDATE`/`BEFORE DELETE` triggers raising `P0001`. Both functions use `SET search_path = pg_catalog, pg_temp`; PUBLIC, verifier, and runtime have no EXECUTE. Verifier receives SELECT only; runtime has no table privilege.
- Keep M1-M10 bytes/checksums unchanged, leave schema meta tied to migration 2, and create zero rows.
- Exclude policy publications, bootstrap marker, trust evidence, sessions, reauthentication, writers, dispatchers, APIs, queues, real RDS/ECS, source/business data, D-drive/NAS, imports, deployment, and packages.

### Task 1: Establish migration 11 with RED-GREEN manifest tests

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.test.js`
- Modify: `shared/vnext-pg17/migrationManifest.js`

- [x] **Step 1: Write failing M11 manifest assertions.**

  Import `AUTHORIZATION_OUTBOX_EVENTS_MIGRATION`, require semantic versions `[1,2,3,4,5,6,7,8,9,10,11]`, and assert the immutable hash, outbox table, receipt composite foreign key, and exact trigger names.

- [x] **Step 2: Run the manifest test and observe RED.**

  Run: `node shared/vnext-pg17/migrationManifest.test.js`

  Expected: failure because migration 11 and its functions are absent.

- [x] **Step 3: Append only the M11 SQL.**

  Add the ten approved columns, checks, primary/unique keys, RESTRICT foreign keys, verifier SELECT, two append-only functions/triggers, PUBLIC function-execute revocation, migration record, expected relation, function hashes, and trigger manifest. Do not alter M1-M10 SQL.

- [x] **Step 4: Run the manifest test and observe GREEN.**

  Run: `node shared/vnext-pg17/migrationManifest.test.js`

  Expected: `vNext PG17 migration manifest checks passed`.

### Task 2: Prove outbox semantics and catalog exactness on PostgreSQL 17

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`

- [x] **Step 1: Add behavior tests before catalog facts.**

  With a real M9 receipt fixture, prove generic object/array/scalar JSON acceptance; positive aggregate version; primary and five-field uniqueness; each parent FK; all six text nonblank checks; JSON/hash/time/version rejection; verifier-write/runtime-read denial; and zero seed.

- [x] **Step 2: Add append-only tests.**

  Update and delete one valid event. Each must return `P0001` and the selected logical row before/after must match exactly.

- [x] **Step 3: Add M10-prefix RED coverage.**

  Manually apply M1-M10, require catalog apply/assert to fail closed, retain ledger `[1..10]`, and prove the outbox table and both function regprocedures are absent.

- [x] **Step 4: Run the catalog test and observe RED.**

  Run: `node shared/vnext-pg17/catalogAssertion.test.js`

  Expected: `VNEXT_PG17_SCHEMA_DRIFT` before M11 facts are registered.

- [x] **Step 5: Add exact catalog facts and isolated drift cases.**

  Freeze all ten columns, fourteen constraints, two indexes, both FK definitions, owner/ACL/function/trigger facts, ledger entry, and exact object sets. In fresh handles require `VNEXT_PG17_SCHEMA_DRIFT` for unique/FK/check/default/nullability/collation/index/owner/ACL/function/trigger/public-shadow drift.

- [x] **Step 6: Run focused and aggregate target verification.**

  Run:

  ```text
  node shared/vnext-pg17/catalogAssertion.test.js
  npm.cmd run test:vnext-control-plane-target
  ```

  Expected: both exit zero and no `vnext-pg17-runtime=true` container remains.

### Task 3: Independent audit, evidence, and publication

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-vnext-pg17-authorization-outbox-events-ddl.md`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [x] **Step 1: Obtain independent necessity and quality review.**

  Submit the scoped diff to the existing audit task. Convert each valid finding into a failing regression before the smallest correction.

- [x] **Step 2: Run fresh evidence.**

  Run manifest, catalog, aggregate, `git diff --check`, and the Docker label query. Require zero exits, silent diff check, and no labeled container.

- [x] **Step 3: Record synthetic-only evidence and commit only six files.**

  Record that no real RDS/ECS, payload data, writer, dispatcher, API, or deployment was used. Stage the two plans plus four PG17 implementation/test files, commit with the repository-required dated message, and push `gewu HEAD:master`; exclude output and unrelated artifacts.

## Self-review

- M11 depends only on existing authority and receipt records, so it is smaller than policy publication and does not manufacture a queue runtime.
- JSON remains canonical text supplied by a future trusted writer; PostgreSQL validates syntax and unique keys but never recomputes bytes or hashes.
- All validation is synthetic and disposable; production control-plane DDL, data migration, dispatch, and deployment remain separately authorized.

## Evidence

- Independent review found and closed the M10-prefix zero-write, parent-FK/tuple-boundary, and M11 catalog-drift coverage gaps before acceptance.
- Fresh local evidence on 2026-08-15: `node shared/vnext-pg17/migrationManifest.test.js`, `node shared/vnext-pg17/catalogAssertion.test.js`, `npm.cmd run test:vnext-control-plane-target`, and `git diff --check` exited successfully. The disposable runtime left no `vnext-pg17-runtime=true` container.
- The work used only synthetic values and a disposable local PostgreSQL 17 container. It did not connect to RDS/ECS or handle real payload data, writers, dispatchers, APIs, business data, desktop data, NAS, removable media, imports, or deployment.
