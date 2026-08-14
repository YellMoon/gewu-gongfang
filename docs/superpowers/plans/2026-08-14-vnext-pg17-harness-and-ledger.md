# vNext PG17 Disposable Harness and Migration Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan sequentially in the current task. Each step uses checkbox (`- [ ]`) tracking and requires the stated verification before the next step.

**Goal:** Build the first PostgreSQL 17 target-engine slice: a branded disposable test runtime, an append-only migration ledger, and a fail-closed catalog assertion for the vNext control plane.

**Architecture:** SQLite V5 stays the semantic oracle. New `shared/vnext-pg17/` CommonJS modules operate only through closure-private, synthetic PostgreSQL handles created by a verified local Docker engine; raw `pg.Client` objects and connection strings never cross their public boundary. Each handle privately owns separate migrator, runtime, verifier, and fixture-provisioner connections; fixed-purpose facades prevent an operation from silently using the wrong identity. The catalog consumer is bound to exactly one runtime, so a copied/cross-runtime handle cannot issue SQL. This slice owns only one approved target relation, `vnext_control_plane.vnext_schema_migrations`, and no vNext authority, account, session, business record, API, or production connection.

**Tech Stack:** Node.js built-in `node:test`, exact-pinned `pg`, the locally installed Docker CLI through argument arrays, an official PostgreSQL 17 Linux image pinned by digest, PostgreSQL 17 catalog views, and `node:crypto` SHA-256.

---

## Locked scope and file structure

The test database is a fresh random database in one labelled local Docker container. Its one fixed schema is the internal constant `vnext_control_plane`; callers cannot provide a database name, schema name, host, port, connection string, image tag, or credential. Every relation/function/trigger is schema-qualified, and every test database is discarded at cleanup. This is not a RDS/ECS client and cannot discover, read, migrate, or modify real databases.

| File | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json` | Pin `pg` and expose the focused plus aggregate required test commands. |
| `shared/vnext-pg17/disposableRuntime.js` | Verified local Docker CLI lifecycle; fixed image; fresh/peer branded handles; fixed-purpose frozen query facades for synthetic tests. |
| `shared/vnext-pg17/disposableRuntime.test.js` | Strict config, loopback binding, exact PG17/image proof, handle branding, and cleanup tests. |
| `shared/vnext-pg17/migrationManifest.js` | The first immutable migration SQL/checksum and expected schema, owner, ACL, function, trigger, and ledger facts. |
| `shared/vnext-pg17/catalogAssertion.js` | Runtime-bound fresh-only ledger apply and readonly catalog assertion accepting only handles branded by that runtime. |
| `shared/vnext-pg17/catalogAssertion.test.js` | Fresh/reapply, ledger behavior, and catalog/ACL/owner/function/trigger drift regression tests. |
| `shared/vnext-pg17/runPg17IntegrationTests.js` | Injectable single-handle runner that normalizes failures and performs cleanup. |
| `shared/vnext-pg17/runPg17IntegrationTests.test.js` | Orchestrator ordering, one runtime lifecycle, and cleanup-on-every-error tests. |
| `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md` | Receives sanitized evidence only after the required target aggregate passes. |

The synthetic roles are fixed but exist only in the disposable container: provisioning admin is the generated container superuser and may only create the database/roles; `vnext_pg17_owner` is `NOLOGIN`; `vnext_pg17_migrator` has a generated test-only login/password, `NOINHERIT`, and owner membership with `SET TRUE`, `INHERIT FALSE`, and `ADMIN FALSE`; `vnext_pg17_runtime` has a different generated test-only login/password, `NOINHERIT`, and zero role membership; `vnext_pg17_verifier` has a third generated test-only login/password, `NOINHERIT`, no owner membership, and only catalog/ledger read grants. Runtime startup provisions those roles once. For each fresh database, private provisioning creates it with owner `vnext_pg17_owner` and revokes `PUBLIC CREATE` and `PUBLIC TEMPORARY` before exposing its handle. The first migration creates the dedicated schema and revokes schema/function access. A true runtime-identity connection must lack `TEMP`, DDL, `TRUNCATE`, trigger-disable, ownership, or bootstrap permissions. No production role name, secret, or configuration is reused.

### Task 1: Pin the image/client contract and package test gates

**Files:**
- Create: `shared/vnext-pg17/packageContract.test.js`
- Modify: `package.json:7-30`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the failing package contract test**

```js
'use strict';
const assert = require('assert');
const pkg = require('../../package.json');

assert.strictEqual(pkg.scripts['test:vnext-pg17'], 'node shared/vnext-pg17/runPg17IntegrationTests.js');
assert.strictEqual(
  pkg.scripts['test:vnext-control-plane-target'],
  'npm run test:vnext-migration && npm run test:vnext-pg17',
);
assert.match(pkg.devDependencies.pg, /^\d+\.\d+\.\d+$/);
assert.ok(!pkg.devDependencies.pg.startsWith('^') && !pkg.devDependencies.pg.startsWith('~'));
console.log('vNext PG17 package contract checks passed');
```

- [ ] **Step 2: Confirm the test fails before the package change**

Run: `node shared/vnext-pg17/packageContract.test.js`

Expected: nonzero because the commands/dependency do not exist.

- [ ] **Step 3: Resolve the exact client version and PG17 Linux image digest**

Run:

```powershell
npm view pg version --json
docker manifest inspect --verbose postgres:17 | Select-String 'Digest|architecture|os'
```

Select one official Linux/amd64 PostgreSQL 17.x manifest digest and save a literal `postgres@sha256:<64-lowercase-hex>` checked-in internal constant in `disposableRuntime.js`; public factory arguments never accept an image value. Save the exact `pg` version without `^`/`~`. If manifest inspection cannot find a Linux PostgreSQL 17 digest, stop this implementation slice as unavailable; do not use a mutable tag.

- [ ] **Step 4: Add exactly one client dependency and two commands**

Save the verified package version as `$pgVersion`, then add it with:

```powershell
$pgVersion = npm view pg version --json | ConvertFrom-Json
npm install --save-dev --save-exact "pg@$pgVersion" --package-lock-only
npm install --ignore-scripts
```

Add these scripts:

```json
"test:vnext-pg17": "node shared/vnext-pg17/runPg17IntegrationTests.js",
"test:vnext-control-plane-target": "npm run test:vnext-migration && npm run test:vnext-pg17"
```

No `testcontainers` dependency is installed: this plan uses an explicit Docker argument-vector runner so `-p 127.0.0.1::5432` is auditable. No image is pulled in this task.

- [ ] **Step 5: Verify and commit the package boundary**

Run: `node shared/vnext-pg17/packageContract.test.js`

Expected: `vNext PG17 package contract checks passed`.

Do not commit this partial task. The one scoped commit occurs only after Task 5 has fresh target-gate and dual-audit PASS evidence.

### Task 2: Build an opaque, loopback-only disposable PG17 runtime

**Files:**
- Create: `shared/vnext-pg17/disposableRuntime.js`
- Create: `shared/vnext-pg17/disposableRuntime.test.js`

- [ ] **Step 1: Write failing strict-boundary tests**

The factory accepts no caller configuration and rejects any argument without reading it:

```js
function createDisposablePg17Runtime() {}
```

Required negative cases:

```js
assert.throws(() => createDisposablePg17Runtime({ forbidden: true }), invalid);
assert.throws(() => createDisposablePg17Runtime(new Proxy({}, {})), invalid);
assert.throws(() => createDisposablePg17Runtime(Object.defineProperty({}, 'x', {
  enumerable: true, get() { throw new Error('getter must not run'); },
})), invalid);
```

`invalid` accepts only error code `VNEXT_PG17_RUNTIME_CONFIG_INVALID`. Also assert fake `{}`, copied handle, cross-runtime handle, and raw `pg.Client` are rejected by every runtime-bound catalog consumer before it executes SQL.

- [ ] **Step 2: Confirm the focused test fails**

Run: `node shared/vnext-pg17/disposableRuntime.test.js`

Expected: nonzero because the module is absent.

- [ ] **Step 3: Implement strict snapshots, private branding, and Docker lifecycle**

Implement this public surface:

```js
function createDisposablePg17Runtime() {
  return Object.freeze({ start, createIsolatedHandle, createPeerHandle, disposeHandle, stop });
}
function isVNextPg17DisposableHandle(handle) {}
async function withVNextPg17SyntheticQuery(handle, purpose, callback) {}
module.exports = {
  createDisposablePg17Runtime,
  isVNextPg17DisposableHandle,
  withVNextPg17SyntheticQuery,
};
```

`start()` first rejects populated `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_TLS_VERIFY`, or `DOCKER_CERT_PATH`, then invokes only an explicit local host: `npipe:////./pipe/docker_engine` on Windows and `unix:///var/run/docker.sock` on Unix. Every Docker invocation uses `child_process.spawn`, `shell:false`, an argument array, a timeout, bounded stdout/stderr, and a sanitized environment without `DOCKER_*` overrides. It provisions the five synthetic identities once. `createIsolatedHandle()` uses private provisioning credentials to create one random database with `OWNER vnext_pg17_owner`, apply database ACL revokes, then establish separate private clients as migrator, runtime, verifier, and fixture provisioner. It returns a frozen opaque handle with no own keys. `createPeerHandle(handle)` verifies the original handle and returns a separately connected opaque verifier peer for its same database; it rejects handles from another runtime. `disposeHandle(handle)` closes only that handle's private clients, drops only its synthetic database after confirming no live peer uses it, and invalidates its brand; every isolated test case must call it in `finally`. A module-private `WeakMap` binds each handle to its four private clients, container ID, unique label, exact database name, fixed schema `vnext_control_plane`, pinned image proof, and port inspection facts. Every `pg.Client` receives explicit `host`, `port`, `user`, `password`, `database`, and `ssl:false` values from that private state; no `PG*` environment fallback is permitted. Do not return a connection string, password, client, host, port, database name, or schema name. `withVNextPg17SyntheticQuery` verifies handle/runtime facts and permits only the literal purposes `migrator`, `runtime`, `verifier`, and `fixture-provisioner`; it gives its callback only a frozen `{ query(text, values) }` facade, never a raw client. Checked-in catalog code may use only `migrator` for apply and `verifier` for assertion; runtime-negative tests use only `runtime`; controlled drift fixtures use only `fixture-provisioner`. `stop()` closes every remaining private client/database then removes only the verified container.

Use `child_process.spawn` with `shell:false`, a fixed argument array, timeout, and bounded output equivalent to:

```text
docker run --rm --detach --label <unique-label> --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=512m
  --env POSTGRES_USER=<random> --env POSTGRES_PASSWORD=<random> --env POSTGRES_DB=<random>
  --publish 127.0.0.1::5432 <postgres@sha256:...>
```

Immediately inspect only that returned container ID. Require `HostConfig.PortBindings['5432/tcp']` to have exactly one binding with `HostIp === '127.0.0.1'`; otherwise stop it and throw unavailable. Once a verified container ID exists, every failure in inspect, readiness, role provisioning, database creation, or peer-client setup invokes ID/label-limited cleanup before rethrowing. `stop()` is idempotent and may run only `docker rm --force <verified-container-id>`; final sweeping lists by the unique label and never deletes by image/name. Docker daemon/image/readiness failures become the one stable code `VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE` without including command arguments, passwords, paths, or Docker stderr in the public message.

- [ ] **Step 4: Add real runtime proof**

After `start()`, use only the private test bridge to verify:

```sql
SELECT current_setting('server_version_num')::int >= 170000
   AND current_setting('server_version_num')::int < 180000 AS is_pg17;
SELECT current_database() ~ '^vnextpg17_[a-z0-9]+$' AS isolated_database;
```

Also inspect the container: require `Config.Image` exactly equals the checked-in image literal, its image `RepoDigests` contains that literal, and container image ID equals that inspected image ID. Do not use `inet_server_addr()` to infer host binding. Verify `Object.isFrozen(handle)` and `Reflect.ownKeys(handle)` equals `[]`. Add injected failures after run, inspect, readiness, role provisioning, and create-database; every path must clean only its verified ID/label. In `finally`, close private facades/clients then the container.

- [ ] **Step 5: Verify and commit the runtime**

Run: `node shared/vnext-pg17/disposableRuntime.test.js`

Expected when runtime is prepared: strict-input, brand, exact PG17/image, inspect-loopback, and cleanup checks pass. Expected when Docker/image is unavailable: one nonzero `VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE` report; no test may claim `PASS`/`SKIP`.

Do not commit this partial task. The one scoped commit occurs only after Task 5 has fresh target-gate and dual-audit PASS evidence.

### Task 3: Define the first immutable migration, roles, schema, and ledger guard

**Files:**
- Create: `shared/vnext-pg17/migrationManifest.js`
- Create: `shared/vnext-pg17/migrationManifest.test.js`

- [ ] **Step 1: Write the failing deterministic manifest tests**

```js
assert.strictEqual(FIRST_MIGRATION.semanticVersion, 1);
assert.match(FIRST_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
assert.deepStrictEqual(expectedCatalog.relations, ['vnext_control_plane.vnext_schema_migrations']);
assert.deepStrictEqual(expectedCatalog.triggers, [
  'vnext_schema_migrations_insert_guard',
  'vnext_schema_migrations_no_delete',
  'vnext_schema_migrations_no_update',
]);
assert.strictEqual(sha256(FIRST_MIGRATION.sql), FIRST_MIGRATION.manifestSha256);
```

- [ ] **Step 2: Confirm it fails**

Export `runManifestCases(runtime)` with no side effect at `require` time; use `if (require.main === module)` only for this focused command. Run: `node shared/vnext-pg17/migrationManifest.test.js`

Expected: nonzero because the manifest module is absent.

- [ ] **Step 3: Implement the ordered fresh-only SQL**

`FIRST_MIGRATION.sql` is one fixed, schema-qualified string. The private migrator connection begins a transaction and executes `SET LOCAL ROLE vnext_pg17_owner` before applying it, so it creates `vnext_control_plane AUTHORIZATION vnext_pg17_owner` and its functions/tables are genuinely owned by the non-login owner; rollback/commit restores the migrator identity. The provisioning admin had already created the owner/migrator/runtime/verifier roles, created the database with owner `vnext_pg17_owner`, and applied database-level `PUBLIC CREATE`/`PUBLIC TEMPORARY` revokes before a handle was exposed:

```sql
CREATE TABLE vnext_control_plane.vnext_schema_migrations (
  migration_id text COLLATE "C" PRIMARY KEY CHECK (btrim(migration_id) <> ''),
  semantic_version bigint NOT NULL UNIQUE CHECK (semantic_version > 0),
  manifest_sha256 text COLLATE "C" NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL CHECK (applied_at <> 'infinity'::timestamptz AND applied_at <> '-infinity'::timestamptz),
  applied_by text COLLATE "C" NOT NULL CHECK (btrim(applied_by) <> '')
);
```

Create exactly three `SECURITY DEFINER` functions owned by `vnext_pg17_owner`, with `SET search_path = pg_catalog, pg_temp` and no dynamic SQL:

```sql
vnext_schema_migrations_insert_guard()
vnext_schema_migrations_no_update()
vnext_schema_migrations_no_delete()
```

The insert guard rejects a row unless `NEW.semantic_version = COALESCE(MAX(semantic_version), 0) + 1`, so version 1 is the only first row and later versions are contiguous. Attach before-insert/update/delete triggers to the fully-qualified table. In this same transaction, grant only `USAGE` on schema `vnext_control_plane` and `SELECT` on table `vnext_control_plane.vnext_schema_migrations` to `vnext_pg17_verifier`; grant it no function execute, insert, update, delete, temporary, or owner membership. Revoke `PUBLIC` execute on the functions and `PUBLIC CREATE` on the `vnext_control_plane` and `public` schemas. Test ledger writes use a private migrator identity; true runtime-identity connections have no `TEMP`, DDL, `TRUNCATE`, alter-ownership, trigger-disable, or owner-role privilege. The owner cannot login. Do not use `IF NOT EXISTS`, unqualified vNext names, mutable schema input, seed DML, or any relation beyond this ledger.

Export frozen expected facts for schema name; database/schema/table/function owner; table columns/PK/unique/checks; owner/migrator/runtime/verifier login and inheritance flags; exact migrator-to-owner membership options; runtime/verifier zero owner membership; database/schema/table/function ACL; verifier-only schema `USAGE` plus ledger `SELECT`; verifier/runtime/migrator absence of unintended ledger DML/function permissions; `PUBLIC TEMPORARY` revoke; `prosecdef`; exact function source SHA-256; exact `proconfig`; trigger enabled state; and zero other vNext relations.

- [ ] **Step 4: Add ledger behavior tests before catalog implementation**

Against a real fresh handle, prove version 1 inserts once; duplicate, zero, first-version 2, post-1 version 3, update, and delete reject; each rejection leaves sorted ledger rows unchanged. Connect using the actual generated `vnext_pg17_runtime` login (not `SET ROLE` from a superuser) and prove it cannot execute DDL, `TRUNCATE`, `ALTER TABLE ... DISABLE TRIGGER`, create a temporary table, or invoke schema-owner identity. Connect as verifier and prove ledger SELECT succeeds while every ledger DML/function execution attempt fails.

- [ ] **Step 5: Verify and commit the manifest**

Run: `node shared/vnext-pg17/migrationManifest.test.js`

Expected: deterministic hash, exact owner/ACL facts, ordered ledger, and append-only behavior pass.

Do not commit this partial task. The one scoped commit occurs only after Task 5 has fresh target-gate and dual-audit PASS evidence.

### Task 4: Apply the ledger and assert catalog drift through branded handles only

**Files:**
- Create: `shared/vnext-pg17/catalogAssertion.js`
- Create: `shared/vnext-pg17/catalogAssertion.test.js`

- [ ] **Step 1: Write failing branded-handle and real-PG drift tests**

```js
const catalog = createVNextPg17CatalogBoundary(runtime);
await assert.rejects(
  () => catalog.assert({}),
  error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
);
await assert.rejects(
  () => catalog.assert(rawClient),
  error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
);
await assert.rejects(
  () => catalog.assert(crossRuntimeHandle),
  error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
);
await assert.rejects(
  () => catalog.assert(handle),
  error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
);
await catalog.apply(handle, {
  appliedAt: '2026-08-14T00:00:00.000Z', appliedBy: 'pg17-test',
});
await assert.doesNotReject(() => catalog.assert(handle));
```

In isolated fresh databases, deliberately add an `unexpected_column`; make a same-named `public` relation; change owner, role-login flag, function `search_path`, function source, function ACL, schema/database `PUBLIC CREATE`, verifier schema/table SELECT ACL, or trigger enabled state; grant verifier ledger DML; drop a ledger unique/check; add an unknown checksum; and add an extra privileged trigger. Each must produce `VNEXT_PG17_SCHEMA_DRIFT` with no repair.

- [ ] **Step 2: Confirm the focused test fails**

Export `runCatalogAssertionCases(runtime)` with no side effect at `require` time; use `if (require.main === module)` only for this focused command. Run: `node shared/vnext-pg17/catalogAssertion.test.js`

Expected: nonzero because the module is absent, or required unavailable code when Docker cannot start.

- [ ] **Step 3: Implement strictly branded apply/assert functions**

```js
function createVNextPg17CatalogBoundary(runtime) {
  return Object.freeze({ apply, assert });
}
```

`createVNextPg17CatalogBoundary` verifies the runtime’s private brand once and closes over it. Its `apply` and `assert` each first verify the handle belongs to that exact runtime before issuing SQL. `apply` exact-snapshots `{ appliedAt, appliedBy }`, rejects noncanonical UTC/blank data, uses only the private migrator facade, begins one transaction with UTC timezone plus the ledger advisory lock, executes `SET LOCAL ROLE vnext_pg17_owner`, rejects any pre-existing unknown target object/checksum, executes `FIRST_MIGRATION.sql`, and inserts only the checked-in version-one checksum. Exact reapply is a deterministic no-DDL/no-write return; any different checksum/version/object throws `VNEXT_PG17_SCHEMA_DRIFT`. It never executes `ALTER`, `CREATE IF NOT EXISTS`, repair DDL, or a caller-provided identifier.

`assert` is read-only and uses only the verifier facade in a caller-owned `BEGIN READ ONLY`. It reads `pg_namespace`, `pg_class`, `pg_attribute`, `pg_constraint`, `pg_index`, `pg_trigger`, `pg_proc`, `pg_roles`, `pg_database`, `information_schema.role_*_grants`, `pg_get_functiondef`, and ACL catalog facts. Compare normalized facts to the immutable expected catalog. Reject any missing, extra, owner, ACL, login, inheritance, membership-option, `PUBLIC TEMPORARY`, function-definition, `prosecdef`, `proconfig`, enabled-trigger, relation, constraint, index, checksum, or public-shadow drift.

- [ ] **Step 4: Prove readonly behavior and exact reapply**

Call assertion in a caller-owned `BEGIN READ ONLY`; before/after require `txid_current_if_assigned()` to remain `NULL`, and after `ROLLBACK` compare sorted catalog and ledger snapshots through `runtime.createPeerHandle(handle)`. Reapply the exact migration and assert zero DDL/zero ledger-row changes. Assert a peer from another runtime/database is rejected by the same catalog boundary.

- [ ] **Step 5: Verify and commit the catalog slice**

Run: `node shared/vnext-pg17/catalogAssertion.test.js`

Expected when available: fresh apply, exact reapply, ledger behavior, all drift cases, and readonly assertion pass. Expected when unavailable: one nonzero unavailable report.

Do not commit this partial task. The one scoped commit occurs only after Task 5 has fresh target-gate and dual-audit PASS evidence.

### Task 5: Build the single-lifecycle runner, perform dual audit, and publish evidence

**Files:**
- Create: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Create: `shared/vnext-pg17/runPg17IntegrationTests.test.js`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [ ] **Step 1: Write the runner’s failing orchestration test**

Export `run({ runtimeFactory, runManifest, runCatalog, report })` with no process side effect on `require`; the two case modules export `runManifestCases(runtime)` and `runCatalogAssertionCases(runtime)` as defined above. Stub calls and require:

```js
['start', 'manifest', 'catalog', 'stop']
```

For errors in `start`, `manifest`, and `catalog`, assert `stop` runs exactly once after runtime construction, even if `start()` fails before a handle exists; report exactly one sanitized nonzero outcome. An unavailable error runs no manifest/catalog callback. Add separate injected start failures after Docker run, inspect, readiness, role provisioning, and database creation; each verifies ID/label-limited cleanup.

- [ ] **Step 2: Confirm the test fails**

Run: `node shared/vnext-pg17/runPg17IntegrationTests.test.js`

Expected: nonzero because the runner module is absent.

- [ ] **Step 3: Implement the CLI-safe orchestrator**

Use `if (require.main === module)` to invoke the exported `run()`. Construct one runtime, enter `try/finally` immediately, start one container, pass that same runtime to manifest then catalog cases, and call `runtime.stop()` exactly once from `finally`; each case obtains a fresh branded handle through `runtime.createIsolatedHandle()` and releases it through `runtime.disposeHandle()` in its own `finally`. Map all expected runtime/validation/catalog errors to sanitized stderr plus a nonzero exit; never throw a raw child-process/database error or print connection strings, passwords, local paths, or Docker output.

- [ ] **Step 4: Run the complete target gate**

```powershell
node shared/vnext-pg17/packageContract.test.js
node shared/vnext-pg17/disposableRuntime.test.js
node shared/vnext-pg17/migrationManifest.test.js
node shared/vnext-pg17/catalogAssertion.test.js
node shared/vnext-pg17/runPg17IntegrationTests.test.js
npm run test:vnext-control-plane-target
git diff --check
git status --short
```

Expected: all commands pass only with an available local disposable PG17 runtime. If Docker/image is unavailable, `test:vnext-pg17` and the aggregate exit nonzero with the stable unavailable code; they are not passing/skipped. Preserve user-owned `output/locks/` and `output/release-matrix/`.

- [ ] **Step 5: Run the mandatory release audits before evidence/commit**

Request the required dual gate after fresh commands: first necessity (scope remains harness/ledger only), then quality (real-PG TDD tests, no real environment access, all strict-handle/loopback/ACL/drift cases). Address every finding with a new failing regression, rerun the full target gate, and repeat quality audit until it reports PASS. Do not write success evidence or commit while PG17 is unavailable or any audit is REVISE.

- [ ] **Step 6: Record sanitized evidence and publish scoped files**

Only after the aggregate and both audits pass, append a dated subsection to `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`. Record only the image digest, exact `pg` version, sanitized pass/fail codes, drift cases, and the fact that validation was disposable/synthetic—not raw logs, connection strings, passwords, host paths, RDS DDL, import, or deployment.

```powershell
git add package.json package-lock.json shared/vnext-pg17 docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md
$commitMessage = (-join (0x81EA,0x52A8,0x53D1,0x5E03 | ForEach-Object { [char]$_ })) + ' 2026-08-14'
git commit -m $commitMessage
git push gewu master
```

Do not stage `output/locks/` or `output/release-matrix/`. This control-plane test slice does not run Electron packaging or publish an OSS desktop update.

## Self-review

- **Spec coverage:** Tasks 1–2 implement the required local PG17, exact-image, loopback, private-handle runtime. Task 3 implements only the approved target-only migration ledger plus its owner/ACL/append-only guard. Task 4 implements fresh-only migration/canonical catalog drift; Task 5 makes it a non-skippable aggregate and enforces the two required audits. The other V5 relations, writers, concurrency mutations, RDS test, production deployment, and data migration remain deferred.
- **Placeholder scan:** Exact current `pg` and PostgreSQL 17 image digest are explicitly resolved and pinned before the first install/pull. The database/schema/roles, public function names, errors, tests, and cleanup rules are fixed in this plan; there is no caller-selected identifier or production secret.
- **Type consistency:** `createDisposablePg17Runtime` creates only opaque handles; `withVNextPg17SyntheticQuery` consumes a handle without exposing a raw client; `createVNextPg17CatalogBoundary(runtime).apply/assert` accept only a handle from that exact runtime. No public input accepts a connection option or raw `pg.Client`.
