# PostgreSQL 17 vNext Writer Zero-DML ACL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and verify a disposable PostgreSQL 17 deployment-writer identity that can read the exact vNext control-plane catalog but has no direct data-modification capability.

**Architecture:** The runtime creates a fifth synthetic login role, `vnext_pg17_writer`, with no memberships or elevated attributes. A separately hashed ACL manifest grants only schema `USAGE` and table `SELECT`; the catalog assertion validates this manifest alongside all existing M1-M15 catalog facts. This is deployment configuration, not migration 16, and it never changes the migration ledger.

**Tech Stack:** Node.js CommonJS, `pg@8.23.0`, disposable PostgreSQL 17 Docker runtime, existing catalog assertion and node `assert`.

---

### Task 1: Write failing writer-boundary tests

**Files:**
- Modify: `shared/vnext-pg17/disposableRuntime.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`

- [x] **Step 1: Add real writer-login red cases**

Create an isolated M1-M15 handle and apply the catalog. Invoke only a new `writer` facade. Require `SELECT` on `vnext_control_plane.vnext_authorities` to pass. Require every target table and each direct privilege (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) to fail with `42501`; also fail `CREATE TABLE`, `CREATE TEMP TABLE`, `SET ROLE`, and target-schema function invocation.

- [x] **Step 2: Add catalog-drift red cases**

On independent fresh handles mutate exactly one writer fact: `INHERIT`, a membership, schema `CREATE`, database `TEMPORARY`, table `INSERT`, function `EXECUTE`, and a default ACL. Each must produce `VNEXT_PG17_SCHEMA_DRIFT` and leave the M1-M15 ledger unchanged.

- [x] **Step 3: Run the red tests**

Run `node shared/vnext-pg17/disposableRuntime.test.js` and `node shared/vnext-pg17/catalogAssertion.test.js`. Expect failure because `writer` is not a recognized facade and the catalog has no writer facts.

### Task 2: Implement the zero-direct-DML identity and manifest

**Files:**
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`

- [x] **Step 1: Provision the exact role**

Provision `vnext_pg17_writer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` with a disposable random password and no memberships. Create one private writer client per opaque handle. Do not expose a password, connection string, raw client, admin facade, or DML API.

- [x] **Step 2: Apply a checked-in ACL manifest**

Create a versioned/hashable manifest listing only target-schema `USAGE` and `SELECT` on every exact M1-M15 relation. Grant those permissions through the existing synthetic setup path. Leave writer with no direct DML, no schema or database `CREATE`/`TEMPORARY`, no function execute and no default privileges. Do not add M16, change M1-M15 checksums, or change schema metadata.

- [x] **Step 3: Extend the single catalog core**

Compare writer role attributes, zero membership, schema/database/table/function privileges and default-ACL rows against the manifest in the existing catalog assertion. Any drift throws `VNEXT_PG17_SCHEMA_DRIFT`; do not duplicate the catalog assertion.

- [x] **Step 4: Run green tests**

Run both focused tests. Expect real disposable PG17 writer login behavior to pass while all M1-M15 ledger rows and checksums remain unchanged.

### Task 3: Document, audit and publish

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Modify: `task.md`
- Modify: this plan

- [x] **Step 1: Record non-claims**

Document that this identity is deliberately read-only. Direct write capability requires a later separate audit of command-specific owner procedures or limited SQL capabilities. Fixture-provisioner, owner, migrator, runtime, all mutations, RDS/ECS, APIs, desktop data, NAS and business data remain untouched.

- [x] **Step 2: Verify and re-audit**

Run `node shared/vnext-pg17/disposableRuntime.test.js`, `node shared/vnext-pg17/catalogAssertion.test.js`, `npm.cmd run test:vnext-control-plane-target`, and `git diff --check`. Ask 5.6-sol for a security/cost/quality audit. If it finds a defect, add a failing regression before the minimal fix. Run `npm.cmd test` as a wider check and record any unrelated failure rather than changing unrelated business code.

- [ ] **Step 3: Commit and push**

Stage only this slice, use the repository-required dated commit format, and push `HEAD:master` to `gewu`. Do not package Electron, publish OSS, create cloud resources, or change live credentials.

## Plan self-review

- The scope is limited to a local disposable identity and its zero-DML ACL evidence; existing mutation code cannot use it to write.
- No migration, schema metadata, API, runtime route, business relation, cloud resource, or production credential is introduced.

## Verification record (2026-08-20)

- Focused disposable runtime and catalog assertions passed, as did the complete control-plane target aggregate.
- The wider `npm.cmd test` suite reaches an unrelated pre-existing authority HTTP expectation failure in `backend/src/routes/authorityProtocolApp.http.test.js`: the case expects `202` but receives `403 DEVICE_LEASE_EXPIRED`. This slice does not import or modify that route, its lease logic, or any business/desktop database code; the failure is recorded rather than suppressed or changed here.
