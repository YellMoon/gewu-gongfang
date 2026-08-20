# Business Foundation Shadow Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove with synthetic fixtures and disposable PostgreSQL 17 that the four approved business relations can enter an isolated shadow target with immutable batch provenance, row ledger, quarantine, reconciliation, replay safety, and recoverable teardown.

**Architecture:** Add `migration_admission` beside, never inside, `business` and `vnext_control_plane`. A private runtime-issued capability owns the only synthetic business-row transaction; it accepts strict own-data fixtures and exposes no SQLite, filesystem, source-path, generic writer, production, or RDS capability.

**Tech Stack:** Node.js CommonJS, `node:assert`, existing `pg@8.23.0`, existing disposable PostgreSQL 17 runtime, and business-foundation manifest/catalog patterns.

---

### Task 1: Freeze the admission schema contract

**Files:**

- Create: `shared/vnext-pg17/businessFoundationAdmissionManifest.js`
- Create: `shared/vnext-pg17/businessFoundationAdmissionManifest.test.js`
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Test: `shared/vnext-pg17/disposableRuntime.test.js`

- [ ] **Step 1: Write the failing manifest test**

Require a missing module and assert exactly one migration named `business-foundation-admission-1`, an independently written literal SHA-256, and full ordered SQL. Assert exactly these relations:

```js
[
  'migration_admission.migration_batches',
  'migration_admission.migration_row_ledger',
  'migration_admission.migration_quarantine',
]
```

Lock append-only functions as owner-owned `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, dynamic-SQL-free, and not executable by PUBLIC. Reject control-plane SQL, `better-sqlite3`, filesystem imports, source paths, RDS, or application-writer grants.

- [ ] **Step 2: Run RED**

Run: `node shared/vnext-pg17/businessFoundationAdmissionManifest.test.js`

Expected: non-zero because the module is absent.

- [ ] **Step 3: Implement immutable migration SQL**

Create `migration_admission` with a new NOLOGIN owner. Add `migration_batches` with nonblank `batch_id`; finite timestamp; the closed states `prepared`, `running`, `reconciled`, `quarantined`, `rolled_back`, `failed`, `abandoned`; and six exact lowercase SHA-256 facts: source snapshot, source catalog, business manifest, mapper set, consent, and result.

Add `migration_row_ledger` with primary key `(batch_id, source_relation, source_primary_key_sha256)`, closed relation values `tenants|institutions|schools|rooms`, source/target hashes, target ID, outcome `admitted|quarantined`, normalized outcome code, and a restrictive batch FK. Add `migration_quarantine` keyed by the identical tuple with only a closed reason code and optional sealed-artifact-reference SHA-256; never persist original values. Attach no-update/no-delete and transition-checked batch triggers. Grant only verifier metadata reads; no business PII or DML. Keep clients private in runtime WeakMaps and add no generic migrator facade.

- [ ] **Step 4: Run GREEN**

Run:

```powershell
node shared/vnext-pg17/businessFoundationAdmissionManifest.test.js
node shared/vnext-pg17/disposableRuntime.test.js
```

Expected: both exit 0 and public runtime keys/facade purposes remain closed.

- [ ] **Step 5: Commit**

```powershell
git add -- shared/vnext-pg17/businessFoundationAdmissionManifest.js shared/vnext-pg17/businessFoundationAdmissionManifest.test.js shared/vnext-pg17/disposableRuntime.js shared/vnext-pg17/disposableRuntime.test.js
git commit -m "automatic release 2026-08-21"
```

### Task 2: Add exact admission catalog and private DDL capability

**Files:**

- Create: `shared/vnext-pg17/businessFoundationAdmissionCatalog.js`
- Create: `shared/vnext-pg17/businessFoundationAdmissionCatalog.test.js`
- Modify: `shared/vnext-pg17/disposableRuntime.js`

- [ ] **Step 1: Write failing boundary tests**

Require:

```js
const boundary = createBusinessFoundationAdmissionCatalogBoundary(runtime);
await boundary.apply(handle, { appliedAt, appliedBy });
await boundary.assert(handle);
await boundary.assertZeroSeed(handle);
```

Reject Proxy/accessor/unknown-key/invalid-UTC/blank signer/cross-runtime/closed inputs before SQL. Lock exact relation, column, constraint, index, function, trigger, owner, role-membership, default-ACL, and privilege fingerprints. Assert no control-plane or business ledger change. Add independent drifts for PUBLIC function execute, verifier INSERT, PII read, owner membership, altered row-ledger FK, disabled trigger, and public shadow.

- [ ] **Step 2: Run RED**

Run: `node shared/vnext-pg17/businessFoundationAdmissionCatalog.test.js`

Expected: non-zero because the boundary is absent.

- [ ] **Step 3: Implement the closed DDL operation**

Implement `executeBusinessFoundationAdmissionDdlPlan(runtime, handle, snapshot)`. It uses a distinct advisory lock, `BEGIN`, UTC, local admission-owner role, frozen SQL, ledger insert, and `COMMIT`. A handle-local busy flag rejects a concurrent call before SQL. An uncertain `COMMIT` or `ROLLBACK` poisons and closes the client; a confirmed schema-drift rollback remains reusable.

`assert` uses only verifier `REPEATABLE READ READ ONLY`; `assertZeroSeed` remains separate. A runtime-issued fresh/reapply trace must exactly match a static command manifest and reject control-plane SQL, business row DML, semicolon chaining, and public query/callback input.

- [ ] **Step 4: Run GREEN**

Run:

```powershell
node shared/vnext-pg17/businessFoundationAdmissionCatalog.test.js
node shared/vnext-pg17/businessFoundationCatalogAssertion.test.js
node shared/vnext-pg17/disposableRuntime.test.js
```

Expected: all exit 0; existing business foundation and control catalogs pass after admission apply/reapply.

- [ ] **Step 5: Commit**

```powershell
git add -- shared/vnext-pg17/businessFoundationAdmissionCatalog.js shared/vnext-pg17/businessFoundationAdmissionCatalog.test.js shared/vnext-pg17/disposableRuntime.js
git commit -m "automatic release 2026-08-21"
```

### Task 3: Implement synthetic four-relation shadow admission

**Files:**

- Create: `shared/vnext-pg17/businessFoundationShadowAdmission.js`
- Create: `shared/vnext-pg17/businessFoundationShadowAdmission.test.js`
- Modify: `shared/vnext-pg17/disposableRuntime.js`

- [ ] **Step 1: Write failing fixture tests**

Use only closure-owned fictional data:

```js
{
  batch: { batchId, sourceSnapshotSha256, sourceCatalogSha256, businessManifestSha256, mapperSetSha256, consentSha256, createdAt },
  tenants: [], institutions: [], schools: [], rooms: []
}
```

Require exact descriptors and red tests for Proxy/accessor values, unknown field, blank ID, invalid UTC/boolean/integer, missing tenant, duplicate target ID, duplicate source key hash, same source key with changed canonical hash, nonempty target, catalog drift, and every write-stage interruption. Assert zero fixture mutation, no filesystem/network/source-SQLite activity, and an exact closed runtime trace.

- [ ] **Step 2: Run RED**

Run: `node shared/vnext-pg17/businessFoundationShadowAdmission.test.js`

Expected: non-zero because the boundary is absent.

- [ ] **Step 3: Implement admission and replay**

Export:

```js
const boundary = createBusinessFoundationShadowAdmissionBoundary(runtime);
await boundary.admit(handle, fixture);
await boundary.reconcile(handle, { batchId });
await boundary.rollbackSyntheticTarget(handle);
```

Validate every row before the first target insert. Insert in dependency order `tenants`, `institutions`, `schools`, `rooms`; write the ledger record in the same transaction as each target row. An exact same `(batch, relation, source-key-hash, canonical-hash)` replay returns stored outcome with zero second target insert. Same key with changed hash returns `CANONICAL_HASH_CONFLICT`; validation/dependency failures write only allowed quarantine metadata.

The executor is same-runtime, same-handle, single-flight, and terminal-uncertainty-safe. It may use fixture-provisioner only behind the runtime closure for a frozen INSERT/SELECT manifest; it exposes no client, facade, SQL, source adapter, or database option.

- [ ] **Step 4: Add reconciliation and teardown checks**

Run reconciliation in a separate `REPEATABLE READ READ ONLY` transaction. Compare source and target per relation by count, sorted stable-key-set SHA-256, and canonical logical SHA-256. Require mismatch to fail closed. For all four inserts, ledger write, quarantine write, post-read mismatch, COMMIT-after-send, and ROLLBACK-after-send, assert confirmed rollback or poisoned target teardown. `rollbackSyntheticTarget` may destroy only the whole disposable target, never become a generic target-row delete API.

- [ ] **Step 5: Commit**

```powershell
git add -- shared/vnext-pg17/businessFoundationShadowAdmission.js shared/vnext-pg17/businessFoundationShadowAdmission.test.js shared/vnext-pg17/disposableRuntime.js
git commit -m "automatic release 2026-08-21"
```

### Task 4: Register local evidence and preserve the real-source gate

**Files:**

- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`
- Modify: `docs/superpowers/inventories/2026-08-21-vnext-cloud-authority-delivery-readiness.md`
- Modify: `task.md`

- [ ] **Step 1: Write runner-order RED test**

Inject admission-manifest and shadow-admission case stubs. Require this order:

```js
['business-foundation-manifest', 'business-foundation-catalog', 'business-admission-manifest', 'business-shadow-admission', 'production-verifier-readiness']
```

An admission failure must report a sanitized code, skip later cases, stop once, and return `1`.

- [ ] **Step 2: Run RED**

Run: `node shared/vnext-pg17/runPg17IntegrationTests.test.js`

Expected: non-zero because admission suites are not registered.

- [ ] **Step 3: Register local suites and update evidence**

Register only the two synthetic suites. State in delivery evidence and `task.md` that there is only local synthetic batch/row provenance, quarantine, reconciliation, and disposable teardown evidence; no D-path read, source snapshot/export, RDS, NAS, production writer, business API, cutover, or release occurred.

- [ ] **Step 4: Run full verification**

Run:

```powershell
node shared/vnext-pg17/businessFoundationAdmissionManifest.test.js
node shared/vnext-pg17/businessFoundationAdmissionCatalog.test.js
node shared/vnext-pg17/businessFoundationShadowAdmission.test.js
node shared/vnext-pg17/runPg17IntegrationTests.test.js
npm.cmd run test:vnext-control-plane-target
node scripts/check_cloud_business_authority_contract.test.js
git diff --check
```

Expected: all commands exit 0, no process-owned disposable container remains, and `output/` stays unstaged.

- [ ] **Step 5: Audit, commit, and push**

Run primary self-audit and independent necessity-then-quality review. Resolve each finding with a regression, rerun the full list, commit only named files, then push `gewu/master`.
