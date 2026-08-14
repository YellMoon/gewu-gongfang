# PostgreSQL 17 Profile Bindings Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not dispatch parallel agents.

**Goal:** Add only the V5 profile-bindings relation and its two active-row partial unique indexes as ordered PostgreSQL 17 migration 7.

**Architecture:** Migration 7 appends one immutable ledger entry after migrations 1–6. It creates `vnext_control_plane.vnext_profile_bindings`, which depends only on migration 2's composite account identity. Profile identity remains opaque and has no target business-table foreign key. The catalog grows from eleven to twelve relations while all preceding migration SQL, hashes, no-seed behavior, and ledger-only triggers remain frozen.

**Tech Stack:** Node.js built-in tests, exact-pinned `pg`, branded disposable Docker PostgreSQL 17, PostgreSQL catalog views, and the V5 SQLite reference schema as semantic oracle.

## Fixed scope

- Append migration 7 only, with one 11-column profile-bindings table and two active-row partial unique indexes.
- Keep binding, authority, account, profile identifiers, and evidence text under `COLLATE "C"`; require nonblank values but do not impose a hash shape on opaque evidence.
- Allow only `teacher|student` profile types and `active|revoked|pending` statuses.
- Enforce finite UTC times, positive `bigint` row versions, ordered timestamps, and the V5 lifecycle matrix.
- Use only the composite account foreign key with `RESTRICT`; do not reference any business profile relation.
- Add no seed data, triggers, functions, default binding, writer, API, runtime integration, business data, or real cloud connection.

## Task 1: Add the migration manifest through red-green tests

- [ ] Extend `shared/vnext-pg17/migrationManifest.test.js` first to require ordered migrations 1–7, a stable migration-7 ID/checksum, the new relation, its columns, composite account foreign key, and both exact partial unique indexes.
- [ ] Run the focused manifest test and confirm it fails because migration 7 is absent.
- [ ] Add only the migration-7 SQL and manifest data to `shared/vnext-pg17/migrationManifest.js`. Preserve migrations 1–6 byte-for-byte.
- [ ] Run the focused manifest test and confirm it passes.

## Task 2: Prove database behavior and catalog exactness

- [ ] Add failing disposable-PG tests first for both profile types, all lifecycle statuses, opaque non-SHA evidence, both distinct active uniqueness conflicts, distinct type validity, pending duplication, revoked-history replacement, and cross-authority account rejection.
- [ ] Add failing tests for blank values, enums, positive version, finite-time checks, ordered times, and lifecycle rules. Each check test must assert its exact PostgreSQL constraint name without a competing earlier violation.
- [ ] Add a migration-6-prefix test: migration application and assertion reject, the ledger stays exactly 1–6, and `vnext_profile_bindings` remains absent.
- [ ] Implement the smallest catalog extension in `shared/vnext-pg17/catalogAssertion.js`, including the exact target relation, columns, constraints, foreign key, two index definitions, owner, ACL, no-trigger expectation, and migration ledger values.
- [ ] Add fresh catalog-drift tests for each altered partial key or predicate, an extra ordinary index, removed composite account foreign key, widened same-name profile-type/status checks, an unexpected default, ACL drift, an extra trigger, and a public shadow relation.
- [ ] Run the focused disposable catalog test and the target aggregate until both pass and cleanup removes the disposable container.

## Task 3: Review, record evidence, and publish

- [ ] Run `npm.cmd run test:vnext-control-plane-target`, focused manifest/catalog tests, `git diff --check`, and inspect the worktree status and disposable-container cleanup.
- [ ] Request the required independent necessity and quality review. Resolve any finding with a targeted red test and re-run the affected verification.
- [ ] Mark this plan and the master control-plane plan only with verified synthetic evidence, stage only relevant files, commit using the repository-required date message, and push `gewu HEAD:master`. Do not stage output directories, package artifacts, or unrelated files.
