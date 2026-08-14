# PostgreSQL 17 Capability Catalog Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not dispatch parallel agents.

**Goal:** Add the V5 capability catalog as the only relation in ordered PostgreSQL 17 migration 4, with disposable-PG catalog drift checks and zero seeded capability data.

**Architecture:** Migration 4 appends one immutable ledger entry after migrations 1–3 and creates only `vnext_control_plane.vnext_capability_catalog`. The table is global, has no policy behavior, and is read only by `vnext_pg17_verifier`. The frozen manifest and assertion grow from eight to nine relations while preserving migration 1–3 SQL/checksums and the three-ledger-trigger set.

**Tech Stack:** Node.js built-in tests, exact-pinned `pg`, branded disposable local Docker PostgreSQL 17 runtime, PostgreSQL catalog views, and the V5 SQLite reference kernel as semantic oracle.

---

## Fixed scope and invariants

- Migration 4 is `vnext-pg17-capability-catalog-4`, semantic version 4, with SHA-256 from its exact checked-in SQL.
- It creates only `vnext_control_plane.vnext_capability_catalog(capability_id,status,surface_mask,created_at)`.
- `capability_id` and `surface_mask` are nonblank `text COLLATE "C"`; `status` is exactly `active|retired`; `created_at` is finite `timestamptz`.
- `capability_id` is the only key. No extra index, FK, trigger, function, authority ID, JSON rule, surface grammar, policy/default mapping, or capability seed is allowed.
- Only `vnext_pg17_verifier` gets table `SELECT`; runtime has no schema or table privilege. Migrations 1–3 remain byte-for-byte unchanged. A migration-3 prefix must fail closed rather than append migration 4.
- Never add overrides, contacts, scope/profile rows, sessions/reauth, receipt/audit/outbox/policy/trust-root state, writer/API, real RDS/ECS access, desktop/SQLite/NAS/removable-media reads, business data, or any seed.

## File map

| File | Responsibility |
| --- | --- |
| `shared/vnext-pg17/migrationManifest.js` | Define and append migration 4; list the ninth relation. |
| `shared/vnext-pg17/migrationManifest.test.js` | Lock metadata, checksum, relation, and no-seed contract. |
| `shared/vnext-pg17/catalogAssertion.js` | Lock exact catalog columns, constraints, ACL, shadow, ledger, and trigger facts. |
| `shared/vnext-pg17/catalogAssertion.test.js` | Exercise synthetic PG semantics and fail-closed drift. |
| `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md` | Append sanitized evidence only after review. |
| This file | Track implementation, verification, and gates. |

### Task 1: Lock manifest before DDL

**Files:** Modify `shared/vnext-pg17/migrationManifest.test.js`, then `shared/vnext-pg17/migrationManifest.js`.

- [x] **Step 1: Write a failing ordered-manifest test.** Assert semantic versions `[1, 2, 3, 4]`; migration 4 ID is `vnext-pg17-capability-catalog-4`; checksum is `sha256(sql)`; expected relations include `vnext_control_plane.vnext_capability_catalog`; and its SQL contains the exact table name.

- [x] **Step 2: Run `node shared/vnext-pg17/migrationManifest.test.js`.** It must fail because the current manifest ends at version 3.

- [x] **Step 3: Add exactly this DDL contract.** Add a table with `capability_id text COLLATE "C" PRIMARY KEY CHECK (btrim(capability_id) <> '')`; `status text COLLATE "C" NOT NULL CHECK (status IN ('active','retired'))`; `surface_mask text COLLATE "C" NOT NULL CHECK (btrim(surface_mask) <> '')`; and finite non-null `created_at timestamptz`. Add only `GRANT SELECT` to `vnext_pg17_verifier`. Export the descriptor, append after migration 3, and add the fully qualified ninth relation in deterministic order.

- [x] **Step 4: Re-run the manifest test.** Expected output: `vNext PG17 migration manifest checks passed`.

### Task 2: Add exact disposable catalog coverage

**Files:** Modify `shared/vnext-pg17/catalogAssertion.test.js`, then `shared/vnext-pg17/catalogAssertion.js`.

- [x] **Step 1: Add failing semantic and drift tests.** Cover blank ID/surface, invalid status, `infinity` and `-infinity`, duplicate ID, valid active/retired rows, runtime `SELECT` denial, verifier `INSERT` denial, an extra table trigger, a `public.vnext_capability_catalog` shadow table, default or altered status constraint, and migration-3 prefix rejection by both `apply` and `assert`.

- [x] **Step 2: Run `node shared/vnext-pg17/catalogAssertion.test.js`.** It must fail until migration 4 and its catalog facts exist.

- [x] **Step 3: Extend relation, column, constraint, ownership, ACL, public-shadow, no-extra-trigger, and ledger checks.** Freeze PostgreSQL 17 catalog hashes only after inspecting a disposable database produced from the exact SQL. Do not add a table index or trigger.

- [x] **Step 4: Re-run the catalog test.** Expected output: `vNext PG17 catalog assertion checks passed`; no disposable resource remains.

### Task 3: Verify narrow scope and publish after gates

**Files:** Modify `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md` and this plan.

- [x] **Step 1: Run focused and aggregate checks.** Run the manifest and catalog focused checks, `npm.cmd run test:vnext-control-plane-target`, and `git diff --check`. All must exit 0, and the disposable PG17 Docker label must have no container.

- [x] **Step 2: Complete independent gates.** Necessity confirms only catalog/ledger/test/evidence changes. Quality checks exact migration/checksum order, constraints, zero seed, ACL, no trigger/index, prefix drift, and cleanup. Every finding gets a focused regression and full rerun.

- [x] **Step 3: Record only verified evidence, then publish scoped files.** Stage only this plan, control-plane evidence, and changed `shared/vnext-pg17` files; never stage `output/locks/` or `output/release-matrix/`. Commit with the project-required date message and push `gewu HEAD:master`.

### Plan self-review

- Tasks 1–2 cover every approved catalog field and check; task 3 covers scope, verification, and reviews.
- No task permits overrides, role defaults, seeds, runtime behavior, or real resources.
- `surface_mask` remains opaque nonblank text and capability IDs remain `C`-collated opaque text.
- There are no unspecified implementation objects, test commands, or approval conditions.
