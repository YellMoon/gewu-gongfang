# PostgreSQL 17 Data Scope Grants Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not dispatch parallel agents.

**Goal:** Add only the V5 data-scope-grants relation and its active-row partial unique index as ordered PostgreSQL 17 migration 6.

**Architecture:** Migration 6 appends one immutable ledger entry after migrations 1–5. It creates `vnext_control_plane.vnext_data_scope_grants`, which depends only on migration 2's composite account identity. The catalog grows from ten to eleven relations while all preceding migration SQL, hashes, no-seed behavior, and ledger-only triggers remain frozen.

**Tech Stack:** Node.js built-in tests, exact-pinned `pg`, branded disposable Docker PostgreSQL 17, PostgreSQL catalog views, and the V5 SQLite reference schema as semantic oracle.

## Fixed scope

- Append migration 6 only, with one 13-column `vnext_data_scope_grants` table and one active-row partial unique index.
- Keep IDs and equal-value text under `COLLATE "C"`; require nonblank scope grant, authority, account, and opaque scope-value hash values.
- Keep scope values opaque: do not require a SHA-256 shape and do not reference business entities.
- Allow only the V5 scope types, `allow|deny` effects, and `active|revoked|expired` statuses.
- Enforce finite UTC times, positive `bigint` row versions, ordered timestamps, and the V5 lifecycle matrix.
- Use only the composite account foreign key with `RESTRICT`; the partial unique key intentionally excludes `effect`.
- Add no seed data, triggers, functions, policy defaults, resolver, writer, API, runtime integration, business data, or real cloud connection.

## Task 1: Add the migration manifest through red-green tests

- [x] Extend `shared/vnext-pg17/migrationManifest.test.js` first to require ordered migrations 1–6, a stable migration-6 ID/checksum, the new relation, its columns, composite account foreign key, and its exact partial unique index.
- [x] Run the focused manifest test and confirm it fails because migration 6 is absent.
- [x] Add only the migration-6 SQL and manifest data to `shared/vnext-pg17/migrationManifest.js`. Preserve migrations 1–5 byte-for-byte.
- [x] Run the focused manifest test and confirm it passes.

## Task 2: Prove database behavior and catalog exactness

- [x] Add failing disposable-PG tests first for all five scope types, both effects, all lifecycle statuses, opaque non-SHA scope values, active tuple uniqueness regardless of effect, historical revoked rows followed by a new active row, valid distinct type/value rows, and cross-authority account rejection.
- [x] Add failing tests for blank values, enums, positive version, finite-time checks, ordered times, and the lifecycle matrix. Each check test must assert its exact PostgreSQL constraint name without a competing earlier violation.
- [x] Add a migration-5-prefix test: migration application and assertion reject, the ledger stays exactly 1–5, and `vnext_data_scope_grants` remains absent.
- [x] Implement the smallest catalog extension in `shared/vnext-pg17/catalogAssertion.js`, including the exact target relation, columns, constraints, foreign key, index, owner, ACL, no-trigger expectation, and migration ledger values.
- [x] Add fresh catalog-drift tests for an extra ordinary index, altered partial predicate, removed composite account foreign key, widened same-name scope-type/status checks, an unexpected default, ACL drift, an extra trigger, and a public shadow relation.
- [x] Run the focused disposable catalog test and the target aggregate until both pass and cleanup removes the disposable container.

## Task 3: Review, record evidence, and publish

- [x] Run `npm.cmd run test:vnext-control-plane-target`, focused manifest/catalog tests, `git diff --check`, and inspect the worktree status and disposable-container cleanup.
- [x] Request the required independent necessity and quality review. Resolve any finding with a targeted red test and re-run the affected verification.
- [x] Mark this plan and the master control-plane plan only with verified synthetic evidence, stage only relevant files, commit using the repository-required date message, and push `gewu HEAD:master`. Do not stage output directories, package artifacts, or unrelated files.
