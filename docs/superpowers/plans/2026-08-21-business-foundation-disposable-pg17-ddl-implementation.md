# Business Foundation Disposable PG17 DDL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove an empty four-table cloud-business foundation and its independent DDL ledger in local disposable PostgreSQL 17, without source-row admission, importer code, business writers, or control-plane M1--M15 changes.

**Architecture:** A new `business` schema has a separate owner, migrator, verifier, immutable DDL ledger, manifest, and catalog boundary. It is deliberately separate from `vnext_control_plane` and its fifteen immutable migrations. Existing disposable handles are the only connection capability; source data, credentials, raw clients, and a generic business-migrator query facade never enter this boundary. The runtime exposes only a closed business-foundation DDL-plan capability that recognizes the one frozen manifest and records its one ledger entry.

**Tech Stack:** Node.js CommonJS, `node:assert`, existing `pg@8.23.0`, fixed PostgreSQL 17 Docker runtime, existing branded disposable runtime APIs.

---

## Files and boundaries

- Create `shared/vnext-pg17/businessFoundationManifest.js` and `.test.js`: immutable version-one business DDL manifest and static alignment tests.
- Create `shared/vnext-pg17/businessFoundationCatalogAssertion.js` and `.test.js`: branded apply/assert boundary and real disposable PostgreSQL tests.
- Modify `shared/vnext-pg17/disposableRuntime.js` and `.test.js`: add separate NOLOGIN business owner plus login business migrator/verifier and a closed DDL-plan capability; control-plane roles receive no business privileges.
- Modify `shared/vnext-pg17/runPg17IntegrationTests.js` and `.test.js`: register the local-only suite after the existing control-plane manifest/catalog cases.
- Modify `docs/vnext-source-data-dictionary.md` and `task.md`: record only local disposable DDL evidence.

Never modify `shared/vnext-pg17/migrationManifest.js`, `shared/vnext-pg17/catalogAssertion.js`, `MIGRATIONS`, or `vnext_control_plane.vnext_schema_migrations`. Do not create source readers, importers, batches, row ledgers, quarantine writers, seed data, APIs, RDS resources, NAS access, application/runtime business writers, procedures, sessions, or credentials. The business migrator can locally SET the business owner because it is the opaque disposable DDL principal; inherent owner DML is never exposed as application capability, source/import row DML, or a generic query facade. It is not a permitted purpose of `withVNextPg17SyntheticQuery`.

### Task 1: Add isolated business roles to the disposable runtime

**Files:**
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Modify: `shared/vnext-pg17/disposableRuntime.test.js`

- [x] **Step 1: Write failing role-isolation tests**

Test that every isolated handle has only a `business-verifier` facade purpose; attempting `withVNextPg17SyntheticQuery(handle, 'business-migrator', ...)` must fail. The closed runtime DDL-plan capability is the only route that may locally SET `vnext_pg17_business_owner`; it accepts only a valid exact snapshot plus a same-runtime open handle and rejects malformed/unknown snapshot data, cross-runtime handles, closed handles, and caller-supplied connection/query objects. Assert the only membership is business migrator to business owner, with inherit false, set true, and admin false. Assert an injected grant, role membership, or default ACL is detectable after setup.

```js
await assert.rejects(
  () => withVNextPg17SyntheticQuery(handle, 'business-migrator', facade => facade.query('SET LOCAL ROLE vnext_pg17_business_owner')),
  error => error.code === 'VNEXT_PG17_HANDLE_INVALID'
);
```

- [x] **Step 2: Run and verify RED**

Run: `node shared/vnext-pg17/disposableRuntime.test.js`

Expected: failure because no business role/facade exists.

- [x] **Step 3: Implement the minimum role surface**

Create `vnext_pg17_business_owner NOLOGIN NOINHERIT`, plus `vnext_pg17_business_migrator LOGIN NOINHERIT` and `vnext_pg17_business_verifier LOGIN NOINHERIT` with per-runtime random passwords. Grant only the owner role to business migrator with SET option and revoke inheritance. Keep the owner inaccessible to every control-plane login. Add only the business-verifier opaque facade; retain the business-migrator client inside the runtime WeakMap. Add a closed `executeBusinessFoundationDdlPlan(handle, snapshot)` runtime operation that owns the transaction, UTC setting, advisory lock, local owner switch, exact frozen manifest SQL, and ledger insert. It accepts no SQL, query callback, client, pool, connection option, or caller-selected migration. Close both private clients with each isolated handle.

- [x] **Step 4: Run and verify GREEN**

Run: `node shared/vnext-pg17/disposableRuntime.test.js`

Expected: `vNext PG17 disposable runtime checks passed`.

- [x] **Step 5: Commit**

```bash
git add -- shared/vnext-pg17/disposableRuntime.js shared/vnext-pg17/disposableRuntime.test.js
git commit -m "automatic-release-2026-08-21"
```

### Task 2: Freeze the independent business DDL manifest

**Files:**
- Create: `shared/vnext-pg17/businessFoundationManifest.js`
- Create: `shared/vnext-pg17/businessFoundationManifest.test.js`

- [x] **Step 1: Write failing static contract tests**

Require the missing manifest. Assert one frozen migration exactly: `business-foundation-1`, semantic version `1`, an independently written literal `EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256`, and complete frozen SQL text/statement order. Do not use only `manifestSha256 === sha256(sql)`, because that lets a changed SQL string and recomputed hash pass together. Import `SOURCE_TABLE_CATALOG`; assert only `tenants`, `institutions`, `schools`, and `rooms` are mapped. Lock every approved source-to-target field pair. Reject imports of `better-sqlite3`, source paths, raw connection configuration, or source-row values.

```js
assert.deepStrictEqual(BUSINESS_FOUNDATION_MIGRATIONS.map(m => [m.migrationId, m.semanticVersion]), [
  ['business-foundation-1', 1],
]);
assert.strictEqual(BUSINESS_FOUNDATION_MIGRATIONS[0].manifestSha256, EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256);
assert.strictEqual(sha256(BUSINESS_FOUNDATION_MIGRATIONS[0].sql), EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256);
assert.deepStrictEqual(expectedBusinessFoundationCatalog.relations, [
  'business.business_schema_migrations', 'business.institutions', 'business.rooms', 'business.schools', 'business.tenants',
]);
```

- [x] **Step 2: Run and verify RED**

Run: `node shared/vnext-pg17/businessFoundationManifest.test.js`

Expected: non-zero exit because the manifest does not exist.

- [x] **Step 3: Implement the manifest**

Create schema `business` owned by `vnext_pg17_business_owner`, revoke `CREATE` from PUBLIC, and create only these relations:

1. `business.business_schema_migrations`: nonblank text primary-key migration ID; positive unique integer version; lowercase SHA-256; finite `applied_at`; nonblank `applied_by`.
2. `business.tenants`: source-preserved text ID, name, legacy status/plan/archive/deleted fields, finite created/updated timestamps, and `updated_at >= created_at`.
3. `business.institutions`: source-preserved text ID and tenant ID, name, restricted legacy contact person/phone, exact `numeric` revenue share, notes, legacy deleted state, finite timestamps, and tenant FK.
4. `business.schools`: source-preserved text ID and tenant ID, name, nullable integer legacy count, legacy deleted state, finite timestamps, and tenant FK.
5. `business.rooms`: source-preserved text ID and tenant ID, name, nullable address and integer legacy count, legacy deleted state, finite timestamps, and tenant FK.

Use `COLLATE "C"` for IDs, nonblank checks for IDs/names, strict finite timestamps, explicit `ON UPDATE RESTRICT ON DELETE RESTRICT`, and one nonunique supporting index per tenant FK. Do not infer school-to-institution or room-to-school relations. Add only three DDL-ledger triggers/functions: INSERT permits only the next consecutive semantic version and a well-formed SHA-256; UPDATE and DELETE always fail. The database trigger must not attempt to self-validate the migration SQL hash. `apply` inserts the fixed manifest hash, and catalog assertion reads the ledger and compares every row to the fixed immutable manifest. Functions are `SECURITY DEFINER`, owner-owned, fully qualified, `SET search_path = pg_catalog, pg_temp`, dynamic-SQL-free, and have PUBLIC execution revoked. Grant business verifier schema USAGE, ledger SELECT, and column-only `SELECT (id)` on the four business tables. Do not grant it table-wide SELECT or any contact/note column.

- [x] **Step 4: Run and verify GREEN**

Run: `node shared/vnext-pg17/businessFoundationManifest.test.js`

Expected: `vNext business foundation manifest checks passed`.

- [x] **Step 5: Commit**

```bash
git add -- shared/vnext-pg17/businessFoundationManifest.js shared/vnext-pg17/businessFoundationManifest.test.js
git commit -m "automatic-release-2026-08-21"
```

### Task 3: Apply and assert the business catalog in disposable PG17

**Files:**
- Create: `shared/vnext-pg17/businessFoundationCatalogAssertion.js`
- Create: `shared/vnext-pg17/businessFoundationCatalogAssertion.test.js`

- [x] **Step 1: Write failing boundary tests**

Require `createBusinessFoundationCatalogBoundary(runtime)` with `apply(handle, { appliedAt, appliedBy })` and `assert(handle)`. Inputs must be exact own-data objects; reject proxy/accessor/unknown key/invalid UTC/blank signer/raw object/cross-runtime/closed handle before SQL. Fresh apply returns `{ applied: true }`; exact reapply returns `{ applied: false }`.

- [x] **Step 2: Run and verify RED**

Run: `node shared/vnext-pg17/businessFoundationCatalogAssertion.test.js`

Expected: non-zero exit because the boundary does not exist.

- [x] **Step 3: Implement the bounded apply/assert API**

`apply` verifies the runtime brand and delegates only to `executeBusinessFoundationDdlPlan(handle, snapshot)`. The runtime owns the business-migrator transaction, UTC setting, dedicated advisory lock, local owner switch, public-shadow rejection, exact frozen manifest SQL, and independent DDL-ledger insert; the catalog boundary never receives its query facade. Lock a runtime-issued trace to the exact DDL manifest and ledger INSERT; it must contain no `INSERT`, `UPDATE`, or `DELETE` against `business.tenants`, `business.institutions`, `business.schools`, or `business.rooms`. Any failure rolls back and emits only `VNEXT_PG17_SCHEMA_DRIFT`, migration-input, or invalid-handle codes.

`assert` uses only business-verifier in `REPEATABLE READ READ ONLY`. Query `pg_catalog` directly. Verify exact schemas/relations, ownership, columns/order/types/nullability/collation/no defaults, checks/PK/unique/FKs/index definitions, ledger function/trigger owner/security/search path/body hash/ACL/enabled state, default ACL absence, and privilege matrix. Query `pg_auth_members` exactly: only business migrator may be a member of business owner, with inherit false, set true, and admin false; no business verifier or control-plane login may have a business-owner membership. It is a permanent schema/ACL assertion and never treats a nonempty business table as schema drift. Export a separate initialization-only `assertZeroSeed(handle)` that uses the verifier's column-only ID reads and fails if any foundation table has a row. Do not grant generic business-table SELECT; business verifier may read only safe IDs to prove zero seed, never contact/notes fields.

- [x] **Step 4: Add behavioral and drift RED cases**

Before each fresh business apply/reapply, snapshot and hash `vnext_control_plane.vnext_schema_migrations`, then run the existing control catalog assertion. After business apply/reapply, require the same control ledger hash and rerun the control assertion. Require the closed DDL-plan trace to equal the frozen business manifest statements plus the fixed business-ledger insert sequence and to contain no `vnext_control_plane` statement. Use only `fixture-provisioner` after apply to prove fictional tenant then fictional institution/school/room success; each missing tenant, blank ID/name, invalid boolean, `infinity`, reversed time, and fractional legacy count fails exactly. Before inserts, require `assertZeroSeed(handle)` to pass. After inserts, require `assertZeroSeed(handle)` to reject with an initialization-seed error while `assert(handle)` remains successful; this proves row presence is not catalog drift. On isolated handles, introduce one structural/ACL drift at a time: extra relation/index, changed FK action, missing FK/index, default, relaxed check, bad owner, PUBLIC function execute, changed function security/path, disabled trigger, public shadow, default ACL, business verifier DML, contact/note-column SELECT by business verifier, business verifier or control-plane login membership in business owner, or any control-plane role business schema/table privilege. Each structural/ACL drift must return `VNEXT_PG17_SCHEMA_DRIFT`.

- [x] **Step 5: Run and verify GREEN**

Run: `node shared/vnext-pg17/businessFoundationCatalogAssertion.test.js`

Expected: `vNext business foundation catalog checks passed` and the process-owned disposable container label returns to baseline.

- [ ] **Step 6: Commit**

```bash
git add -- shared/vnext-pg17/businessFoundationManifest.js shared/vnext-pg17/businessFoundationManifest.test.js shared/vnext-pg17/businessFoundationCatalogAssertion.js shared/vnext-pg17/businessFoundationCatalogAssertion.test.js
git commit -m "automatic-release-2026-08-21"
```

### Task 4: Register evidence without widening the migration boundary

**Files:**
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`
- Modify: `docs/vnext-source-data-dictionary.md`
- Modify: `task.md`

- [x] **Step 1: Write the runner RED test**

Inject runner stubs and require order: source isolation, existing control-plane manifest/catalog, business manifest/catalog, then readiness and semantic suites. Business failure must report a sanitized code, skip later suites, stop once, and return `1`.

- [x] **Step 2: Run and verify RED**

Run: `node shared/vnext-pg17/runPg17IntegrationTests.test.js`

Expected: non-zero exit because no business suite is registered.

- [x] **Step 3: Register only the local suite and update bounded evidence**

Add the two case imports/calls. Update docs to state only that the four empty business tables apply/reapply and fail closed on drift in a local disposable PG17 target. Preserve explicit non-completion of source admission, source importer, migration batch/row ledger/quarantine, RDS, NAS, and cutover.

- [x] **Step 4: Run full verification**

```bash
node shared/vnext-pg17/disposableRuntime.test.js
node shared/vnext-pg17/businessFoundationManifest.test.js
node shared/vnext-pg17/businessFoundationCatalogAssertion.test.js
node shared/vnext-pg17/runPg17IntegrationTests.test.js
npm.cmd run test:vnext-control-plane-target
node scripts/check_cloud_business_authority_contract.test.js
node scripts/check_project_status_doc.test.js
git diff --check
```

Expected: all commands exit 0, no process-owned container remains, and no `output/` directory is staged.

- [ ] **Step 5: Audit, commit, and push**

Complete primary necessity review and independent quality review. Fix every P1 with a red regression, rerun Step 4, then stage only named files, commit using the repository-required dated automatic-release message, and push `gewu master`. Do not build a desktop installer or publish OSS for local test-only schema evidence.
