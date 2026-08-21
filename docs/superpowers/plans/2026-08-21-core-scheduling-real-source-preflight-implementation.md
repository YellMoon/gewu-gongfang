# Core Scheduling Real-Source Read-Only Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an explicit read-only legacy SQLite preflight that produces normalized scheduling input and redacted evidence for the existing disposable shadow-admission boundary.

**Architecture:** The migration layer receives a closure-owned source grant, not a path, URL, environment fallback, or generic SQLite facade. It runs a fixed structure-and-row manifest in SQLite query-only mode, binds before/after source identity, normalizes with `coreSchedulingSourceContract`, and emits aggregate/hash-only evidence. The existing closed PostgreSQL shadow executor remains the sole target writer. This plan never starts RDS, HTTP, NAS, or a desktop runtime.

**Tech Stack:** Node.js CommonJS, `better-sqlite3` confined to `migration/vnext`, Node `crypto`, existing core scheduling normalization, and the disposable PostgreSQL 17 shadow runtime.

---

### Task 1: Create an opaque real-source read capability

**Files:**
- Create: `migration/vnext/coreSchedulingReadOnlySourceGrant.js`
- Create: `migration/vnext/coreSchedulingReadOnlySourceGrant.test.js`
- Modify: `migration/vnext/sourceTableCatalog.js`
- Modify: `migration/vnext/sourceTableCatalog.test.js`

- [ ] **Step 1: Write failing capability tests**

```js
assert.throws(
  () => createCoreSchedulingReadOnlySourceGrant({ databasePath: 'C:\\unsafe\\legacy.db' }),
  error => error?.code === 'MIGRATION_CORE_SCHEDULING_SOURCE_GRANT_INVALID'
);
```

Also assert Proxy/accessor/unknown-key input causes zero opener reads. Lock the exact eight scheduling relations; question and asset relations cannot enter the grant.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node migration/vnext/coreSchedulingReadOnlySourceGrant.test.js`

Expected: failure because the module does not exist.

- [ ] **Step 3: Implement the smallest private capability**

```js
function createCoreSchedulingReadOnlySourceGrant(value) {
  const input = exactDataObject(value, ['snapshotId', 'sourceIdentitySha256', 'openReadOnlyDatabase', 'readSourceIdentity']);
  if (!nonBlank(input.snapshotId) || !sha256(input.sourceIdentitySha256) || typeof input.openReadOnlyDatabase !== 'function' || typeof input.readSourceIdentity !== 'function') throw invalid();
  const grant = Object.freeze({}); grants.set(grant, Object.freeze({ ...input })); return grant;
}
```

Use a module-private `WeakMap`. Do not expose a raw path, DB constructor, database handle, arbitrary query callback, or string-to-grant minting API. Freeze the eight source relation names/field sets in the existing source catalog.

- [ ] **Step 4: Run focused tests and commit**

Run: `node migration/vnext/coreSchedulingReadOnlySourceGrant.test.js && node migration/vnext/sourceTableCatalog.test.js`

Expected: both exit 0.

Commit only the four listed files with the required automatic release message.

### Task 2: Add a fixed, read-only SQLite preflight manifest

**Files:**
- Create: `migration/vnext/coreSchedulingReadOnlyPreflight.js`
- Create: `migration/vnext/coreSchedulingReadOnlyPreflight.test.js`
- Modify: `migration/vnext/coreSchedulingReadOnlySourceGrant.js`
- Modify: `migration/vnext/coreSchedulingReadOnlySourceGrant.test.js`

- [ ] **Step 1: Write failing exact-query tests**

```js
const result = await preflightCoreSchedulingReadOnlySource({ grant, mapperVersion: 'core-scheduling-v1' });
assert.deepStrictEqual(result.queries, ['PRAGMA query_only = ON', 'BEGIN', ...CORE_SCHEDULING_STRUCTURE_QUERIES, ...CORE_SCHEDULING_ROW_QUERIES, 'COMMIT']);
assert.ok(result.queries.every(sql => !/\b(?:INSERT|UPDATE|DELETE|ATTACH|VACUUM|backup|load_extension)\b/i.test(sql)));
```

Use a temporary fictional SQLite fixture only. Add red tests for source identity drift, an unlisted relation, a missing relation, non-query-only connection, attempted attach, and source failure. Every failure must issue zero target SQL.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node migration/vnext/coreSchedulingReadOnlyPreflight.test.js`

Expected: failure because the preflight module does not exist.

- [ ] **Step 3: Implement fixed preflight reads**

```js
const before = source.readSourceIdentity();
const raw = readExactStructureAndRows(db, CORE_SCHEDULING_STRUCTURE_QUERIES, CORE_SCHEDULING_ROW_QUERIES);
const normalized = normalizeCoreSchedulingSource(raw);
if (before !== source.readSourceIdentity()) throw sourceChanged();
```

The manifest has structure metadata and ordered projections for every allowed relation. No `SELECT *`, count/sample/export query, dynamic SQL, question/asset table, or source-derived path may appear. Before/after identity comes from the private grant operation, never caller text.

- [ ] **Step 4: Run focused tests and commit**

Run: `node migration/vnext/coreSchedulingReadOnlyPreflight.test.js && node shared/vnext-pg17/coreSchedulingSourceContract.test.js`

Expected: both exit 0; DB closes once and no target resource is reached. Commit only Task 2 files.

### Task 3: Emit semantic and privacy-safe evidence

**Files:**
- Create: `migration/vnext/coreSchedulingPreflightReport.js`
- Create: `migration/vnext/coreSchedulingPreflightReport.test.js`
- Modify: `migration/vnext/coreSchedulingReadOnlyPreflight.js`
- Modify: `shared/vnext-pg17/coreSchedulingLegacyExceptionManifest.js`
- Modify: `shared/vnext-pg17/coreSchedulingLegacyExceptionManifest.test.js`

- [ ] **Step 1: Write failing redaction and semantic tests**

```js
assert.deepStrictEqual(Object.keys(report).sort(), ['admittedCounts', 'exceptionCounts', 'mapperVersion', 'quarantineCodeCounts', 'relationLogicalSha256', 'snapshotStable', 'sourceIdentitySha256', 'sourceInventorySha256']);
assert.doesNotMatch(JSON.stringify(report), /Synthetic Student|phone|wechat|parent|notes|C:\\|legacy\.db/i);
assert.strictEqual(report.exceptionCounts.USER_DECLARED_OBSOLETE_LEGACY_SCHEDULE, 18);
```

Add isolated red tests for unknown students, invalid Shanghai wall clocks, non-decimal money, tenant mismatch, altered sentinel hash, and attempted output of a primary key/contact/notes field.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node migration/vnext/coreSchedulingPreflightReport.test.js`

Expected: failure because the report module does not exist.

- [ ] **Step 3: Implement the aggregate-only report**

```js
return Object.freeze({ admittedCounts: relationCounts(input.admitted), exceptionCounts: codeCounts(input.exceptions), quarantineCodeCounts: codeCounts(input.quarantines), relationLogicalSha256: logicalHashes(input.admitted), sourceIdentitySha256: input.sourceIdentitySha256, sourceInventorySha256: input.sourceInventorySha256, mapperVersion: input.mapperVersion, snapshotStable: input.beforeSha256 === input.afterSha256 });
```

Keep the obsolete schedule exception bound to source inventory and canonical row hashes. Return counts, fixed codes and hashes only; never names, raw IDs, dates, display text, paths, contacts, notes, tokens or source rows.

- [ ] **Step 4: Run focused tests and commit**

Run: `node migration/vnext/coreSchedulingPreflightReport.test.js && node shared/vnext-pg17/coreSchedulingLegacyExceptionManifest.test.js`

Expected: both exit 0 and every failure is sanitized. Commit only Task 3 files.

### Task 4: Adapt only verified preflight output to disposable shadow admission

**Files:**
- Create: `migration/vnext/coreSchedulingRealShadowBoundary.js`
- Create: `migration/vnext/coreSchedulingRealShadowBoundary.test.js`
- Modify: `shared/vnext-pg17/businessFoundationShadowAdmission.js`
- Modify: `shared/vnext-pg17/businessFoundationShadowAdmission.test.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`

- [ ] **Step 1: Write failing verified-preflight-only tests**

```js
await assert.rejects(() => admitPreflightToDisposableShadow({ runtime, handle, preflight: { coreScheduling: fixture.coreScheduling } }), error => error?.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const result = await admitPreflightToDisposableShadow({ runtime, handle, preflight: verifiedPreflight });
assert.strictEqual(result.replayed, false);
```

Add red cases for changed source identity/mapper version, target tampering, replay, source conflict, every write-stage failure, terminal uncertainty, and teardown. Assert exact closed SQL, catalog checks, empty target after failure, and no source row/PII/path in results or errors.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node migration/vnext/coreSchedulingRealShadowBoundary.test.js`

Expected: failure because the boundary does not exist.

- [ ] **Step 3: Implement the private adapter**

```js
async function admitPreflightToDisposableShadow({ runtime, handle, preflight }) {
  const approved = requireVerifiedPreflight(preflight);
  if (!approved.snapshotStable) throw inputInvalid();
  return createBusinessFoundationShadowAdmissionBoundary(runtime).admit(handle, buildClosedFixture(approved));
}
```

`buildClosedFixture` accepts only normalized rows and immutable hashes from verified preflight; it cannot accept a raw SQLite handle, path, mapper, generic SQL, cloud connection or business writer. The existing synthetic boundary stays intact so automated tests never read a user source.

- [ ] **Step 4: Run aggregate verification, commit and push**

Run: `node migration/vnext/coreSchedulingRealShadowBoundary.test.js && node shared/vnext-pg17/businessFoundationShadowAdmission.test.js && npm.cmd run test:vnext-control-plane-target && node scripts/check_cloud_business_authority_contract.test.js && git diff --check`

Expected: all exit 0; no RDS/API/NAS/desktop runtime or user source root is accessed.

Commit only Task 4 files with the required automatic release message and push `gewu master`. Do not package, deploy, open a user source, create cloud resources, or call this a real migration. A separately approved user-visible source authorization and run record are required before a real grant can be minted.
