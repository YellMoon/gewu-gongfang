# PostgreSQL 17 vNext Production Verifier Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synthetic/disposable-only production-style verifier connection boundary that proves an injected read-only PostgreSQL 17 target has the exact M1-M15 vNext catalog, without exposing credentials or enabling writes.

**Architecture:** Extract the existing exact catalog assertion into a query-facade core shared by disposable tests and the new boundary. The boundary uses a closure-branded injected verifier-pool lease, one `REPEATABLE READ READ ONLY` transaction, local UTC/timeout/application settings, target identity/TLS checks, and the shared catalog core. It returns only a frozen non-sensitive readiness result and always terminates/releases the lease once.

**Tech Stack:** Node.js CommonJS, `pg@8.23.0`, existing disposable PostgreSQL 17 Docker runtime, M1-M15 manifest/catalog assertion, Node `assert`.

---

### Task 1: Create failing readiness contracts

**Files:**
- Create: `shared/vnext-pg17/productionVerifierReadiness.js`
- Create: `shared/vnext-pg17/productionVerifierReadiness.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`

- [x] **Step 1: Add exact configuration and opaque-result tests**

Use a real disposable verifier lease wrapped by a test pool adapter. Require an
exact own-data factory configuration with `databaseBinding`, `verifierPool`,
`expectedDatabase`, `expectedUser`, and `syntheticTlsBrand`. A success
must be the frozen exact object below:

```js
assert.deepStrictEqual(await readiness.check(), {
  migrationVersion: 15,
  ready: true,
  schemaVersion: 5,
});
```

Reject fake/cross-boundary TLS brands, raw pool/client objects, connection
strings, host/password/ssl keys, proxy/accessor/symbol/hidden/inherited/extra
configuration and a closed boundary. Every public failure is
only `VNEXT_PG17_PRODUCTION_VERIFIER_UNAVAILABLE` and contains no client,
credential, SQL, endpoint, or causal message.

- [x] **Step 2: Add transaction and cleanup tests**

Instrument each lease. Verify one checkout and exactly this transaction prefix:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY
SELECT set_config('TimeZone', 'UTC', true)
SELECT set_config('statement_timeout', '5000ms', true)
SELECT set_config('lock_timeout', '1000ms', true)
SELECT set_config('application_name', 'gewu-vnext-verifier-readiness', true)
```

Require one commit and release on success. For checkout, setup, identity, TLS,
catalog, commit, rollback, and release errors, require a sanitized failure,
one rollback after `BEGIN`, and one release or destroy. Two concurrent checks
must receive different leases.

- [x] **Step 3: Add catalog/read-only red cases and run them**

On fresh disposable M1-M15 targets, require success. In independent fixtures
introduce a ledger checksum, public shadow, verifier-ACL, function-ACL, or
trigger drift and require failure. Assert no query starts with `INSERT`,
`UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, `CREATE`, `DROP`, `SET ROLE`, or
`CREATE TEMP`.

Run: `node shared/vnext-pg17/productionVerifierReadiness.test.js`

Expected: FAIL because the readiness module and shared facade API are absent.

### Task 2: Extract the exact catalog query core

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.js`
- Test: `shared/vnext-pg17/catalogAssertion.test.js`

- [x] **Step 1: Add a facade-equivalence red test**

Require the current branded-handle assertion and a closure-branded verifier
query facade to return the same success and `VNEXT_PG17_SCHEMA_DRIFT` behavior.
A raw `{ query() {} }` object must fail before any query.

- [x] **Step 2: Implement the shared core minimally**

Keep all expected M1-M15 constants in `catalogAssertion.js`. Refactor the
existing assertion body into one private function receiving only a branded
`query(text, values)` capability. Preserve `catalog.assert(handle)` and add
`catalog.assertVerifierFacade(facade)`; both call the same private core. The
core must not start/commit/rollback a transaction.

- [x] **Step 3: Verify the catalog regression**

Run: `node shared/vnext-pg17/catalogAssertion.test.js`

Expected: `vNext PG17 catalog assertion checks passed`.

### Task 3: Implement the verifier-only readiness boundary

**Files:**
- Create: `shared/vnext-pg17/productionVerifierReadiness.js`
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Test: `shared/vnext-pg17/productionVerifierReadiness.test.js`
- Test: `shared/vnext-pg17/disposableRuntime.test.js`

- [x] **Step 1: Add a non-forgeable disposable TLS brand**

Export a runtime/handle-bound brand issuer and predicate. A copied object,
another runtime, or a closed handle fails. Do not add an insecure boolean,
environment flag, or caller-provided testing marker.

- [x] **Step 2: Implement strict boundary input and lifecycle**

The factory accepts only a closure-branded verifier pool adapter that privately
holds the raw `pg.Pool`; it never exposes the pool/client. Each `check()` gets
a new lease, runs the transaction prefix, checks `current_database()` and
`current_user`, then checks `pg_stat_ssl.ssl`. TLS false is allowed only for a
matching disposable brand. Pass the catalog-branded facade to the shared core,
commit only after success, return the frozen summary, and otherwise rollback
then release/destroy exactly once. Convert every internal failure to the fixed
public code.

- [x] **Step 3: Run focused green tests**

Run:

```powershell
node shared/vnext-pg17/productionVerifierReadiness.test.js
node shared/vnext-pg17/disposableRuntime.test.js
node shared/vnext-pg17/catalogAssertion.test.js
```

Expected: PASS without an RDS connection or business-data access.

### Task 4: Register, document, verify, and publish

**Files:**
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Modify: `task.md`
- Modify: this plan

- [x] **Step 1: Register once in the disposable runner**

Run readiness after catalog assertion and before mutations. Lock the order and
one runtime start/stop in the runner test. Supply only a runtime-issued
synthetic pool adapter/brand.

- [x] **Step 2: Record non-claims**

Document that this proves only a local disposable verifier-readiness seam. It
does not create writer ACL, execute a mutation, connect to RDS/ECS, create a
secret, expose an API, migrate business data, or prove deployment readiness.
The next dependency is a separately audited writer-role/ACL manifest and
negative-privilege suite.

- [x] **Step 3: Run full verification and an independent gate**

Run `node shared/vnext-pg17/productionVerifierReadiness.test.js`,
`node shared/vnext-pg17/runPg17IntegrationTests.test.js`,
`npm.cmd run test:vnext-control-plane-target`, `npm.cmd test`, `git diff --check`,
and `git status --short`. Ask 5.6-sol for a final feasibility, necessity,
security, and cost/scope review. Fix every finding by adding a failing
regression first, then rerun all commands.

- [x] **Step 4: Commit and push only the verified slice**

Stage only the files in this plan, implementation evidence, and `task.md`.
Use the repository-required dated commit message and push `HEAD:master` to
`gewu`. Do not package Electron or publish OSS artifacts.

## Plan self-review

- No DML authority, writer identity, RDS/ECS operation, HTTP/API, migration
  repair, business-data access, or desktop/miniapp behavior is introduced.
- Exact M1-M15 rules remain single-sourced in `catalogAssertion.js`.
- Production-shaped TLS is fail-closed; disposable plaintext uses only a
  private runtime/handle-bound brand.
- Every failure has an observable cleanup and no-write test; verification
  includes the existing aggregate gates.
