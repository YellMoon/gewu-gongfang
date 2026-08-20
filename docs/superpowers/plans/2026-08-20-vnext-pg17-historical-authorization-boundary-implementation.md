# PostgreSQL 17 vNext Historical Authorization Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synthetic, non-activating historical-authorization rehearsal closure to the existing disposable PG17 target.

**Architecture:** The existing five-relation identity topology remains first. The second segment uses only a runtime-issued static SQL manifest to write capability catalog rows plus revoked or expired role grants, capability overrides, and data-scope grants. Any active authorization, profile/contact/session/receipt/audit/outbox source row fails closed. The report rereads nine target relations and compares their canonical logical hash before commit.

**Tech Stack:** Node.js CommonJS, in-memory better-sqlite3, pg 8.23.0, disposable PostgreSQL 17 runtime, node assert.

---

### Task 1: Write historical source and SQL-manifest red tests

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`
- Modify: `shared/vnext-pg17/disposableRuntime.test.js`

- [x] **Step 1: Add one complete historical-authorization source**

Build the existing authority/account/device/installation/link source, then add one active and one retired capability, revoked and expired rows for every historical authorization relation. Require `boundary-verified`, matching source/target logical SHA-256 for nine relations, and all three active authorization counts, session/reauth counts, and dispatched outbox count to be zero.

- [x] **Step 2: Add source fail-closed cases**

Each fresh source must throw `VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID` for active role/override/scope, missing override capability, cross-authority account, version below one, revoked lifecycle missing `revoked_at`, expired lifecycle missing `ends_at`, noncanonical timestamp, or nonempty profile/contact/receipt/audit/outbox. A nonempty opaque `scope_value_hash` must remain valid; do not impose a SHA-256 format.

- [x] **Step 3: Add nine-stage rollback cases**

Use runtime-issued fault plans for `authorities`, `accounts`, `trustedDevices`, `installations`, `links`, `capabilityCatalog`, `roleGrants`, `capabilityOverrides`, and `dataScopeGrants`. Every interruption must roll back all 19 target data relations and preserve the source fingerprint. Keep the existing unknown-COMMIT/ROLLBACK poisoning tests.

- [x] **Step 4: Verify RED**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

Expected: the complete source is rejected by the current deferred-collection gate, not by Docker or a real-data path.

### Task 2: Validate four historical collections in the source factory

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`

- [x] **Step 1: Freeze exact row manifests**

Add exact own-data field lists and stable keys for `capabilityCatalog`, `roleGrants`, `capabilityOverrides`, and `dataScopeGrants`. Validate account/authority FKs, closed role/effect/scope enums, positive versions, canonical instants, and only `revoked|expired` lifecycles. Capability catalog permits `active|retired`, but no default capability is generated.

- [x] **Step 2: Narrow the deferred-collection gate**

Permit only the four historical collections. Keep nonempty `profileBindings`, `verifiedContacts`, `receipts`, `auditEvents`, and `outboxEvents` rejected.

- [x] **Step 3: Verify source GREEN**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

Expected: source failures pass; the positive case remains red until the runtime manifest exists.

### Task 3: Extend the runtime-issued manifest and target proof

**Files:**
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Modify: `shared/vnext-pg17/disposableRuntime.test.js`

- [x] **Step 1: Add static relation entries**

Add only checked-in INSERT/read entries for `vnext_capability_catalog`, `vnext_role_grants`, `vnext_capability_overrides`, and `vnext_data_scope_grants`. The callback receives collection names and source-validated rows only; it never receives SQL, table names, columns, or a fixture client.

- [x] **Step 2: Extend fixed post-write reads and trace**

Reread nine relations with fully qualified `SELECT row_to_json(...)`, sorted by stable key. Allow trace entries only for fixed BEGIN, catalog/empty/read SELECT, nine manifest INSERTs, and COMMIT/ROLLBACK. Reject DDL, DCL, SET ROLE, TEMP, CALL, and COPY by construction.

- [x] **Step 3: Add opaque runtime fault stages**

Add the four historical collection names to the fault-stage allow-list. They interrupt only after their fixed INSERT has been issued; terminal uncertainty continues to poison and close the target.

- [x] **Step 4: Verify runtime GREEN**

Run: `node shared/vnext-pg17/disposableRuntime.test.js; node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

Expected: positive mapping, trace, and nine rollback cases pass.

### Task 4: Report, audit, verify, and publish

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`
- Modify: `docs/superpowers/plans/2026-08-20-vnext-pg17-control-plane-copy-only-rehearsal-implementation.md`
- Modify: this plan

- [x] **Step 1: Freeze the actual-target report**

Include actual capability/role/override/scope counts and source/target nine-relation logical SHA-256. A mismatch throws `VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH` inside the transaction. The report exposes no rows, business identifiers, credentials, or SQL.

- [x] **Step 2: Run independent gates**

Request a 5.6-sol necessity review, then a security/quality review of source exactness, SQL closure, catalog/empty target, lifecycle, hash, rollback, terminal poison, and test coverage. Turn every finding into an observable red test before a minimal fix.

- [ ] **Step 3: Verify and publish**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js; node shared/vnext-pg17/disposableRuntime.test.js; node shared/vnext-pg17/catalogAssertion.test.js; npm.cmd run test:vnext-control-plane-target; git diff --check`

After all green checks and both gates pass, commit only this boundary's rehearsal/runtime/test/plan files with the repository-required date message, then run `git push gewu HEAD:master`. Do not package Electron, publish OSS, or connect to RDS/ECS or real data.

## Non-claims

This plan does not migrate or activate profile/contact/session/reauth/token/device-grant/offline-license data. It does not implement receipts/audit/outbox/policy, writer DML/EXECUTE, a procedure/identity bridge, HTTP/API/CLI, or a real source adapter. `scope_value_hash` remains an opaque nonblank value under the approved V5/M6 contract.
