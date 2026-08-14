# vNext PG17 Foundation Identity and Device DDL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the second immutable PostgreSQL 17 migration that establishes the V5 authority/account/device/installation/link foundation in disposable synthetic databases.

**Architecture:** The existing SQLite V5 reference kernel remains the semantic oracle. The already-shipped PG17 migration ledger stays migration 1; migration 2 adds only the seven foundation relations needed before roles, policies, sessions, trust-root evidence, or writers can be migrated. The catalog boundary applies the ordered checked-in migrations atomically and fail-closes on every missing, extra, owner, ACL, constraint, index, trigger, or ledger drift. No connection or DDL reaches RDS, ECS, desktop SQLite, NAS, removable media, or business data.

**Tech Stack:** Node.js built-in `node:test` style, exact-pinned `pg`, the existing branded local Docker PostgreSQL 17 runtime, PostgreSQL 17 constraints/FKs/catalog views, and the SQLite V5 reference kernel as the semantic source.

---

## Locked scope

This migration adds exactly these relations in the fixed `vnext_control_plane` schema:

1. `vnext_schema_meta`
2. `vnext_authorities`
3. `vnext_accounts`
4. `vnext_trusted_devices`
5. `vnext_device_installations`
6. `vnext_account_device_links`

Together with the existing `vnext_schema_migrations` ledger, the target catalog contains exactly seven relations after fresh apply. No other V5 relation may be added in this task. In particular, do not add verified contacts, roles, capabilities, scopes, profiles, sessions, reauthentication, receipts, audit, outbox, policy publications, bootstrap consumptions, trust-root evidence, any writer, any HTTP/API/runtime adapter, any production migration, or any business relation.

Migration 2 writes the singleton `vnext_schema_meta` row only; it never seeds an authority, account, device, installation, link, credential, session, policy, role, or super-admin. `schema_version=5` describes the source-semantic reference contract and is not the PostgreSQL migration ledger version.

Every new identifier is `text COLLATE "C" NOT NULL CHECK (btrim(column) <> '')`. Every version is `bigint NOT NULL CHECK (column >= 1)`. Every instant is `timestamptz NOT NULL` with explicit `infinity`/`-infinity` rejection; trusted migration inputs use canonical UTC text and the target transaction sets UTC. All FKs are explicit `ON UPDATE RESTRICT ON DELETE RESTRICT`. The migration owner is the existing synthetic non-login `vnext_pg17_owner`; verifier receives only `USAGE` and `SELECT` required for catalog assertion; runtime receives no DDL or table privilege.

## File structure

| File | Responsibility |
| --- | --- |
| `shared/vnext-pg17/migrationManifest.js` | Add the fixed migration-2 SQL, its parameterized schema-meta row statement, immutable ordered `MIGRATIONS`, checksum, and expanded expected catalog facts. |
| `shared/vnext-pg17/migrationManifest.test.js` | Prove migration ordering, checksum determinism, and the exact seven-relation target manifest. |
| `shared/vnext-pg17/catalogAssertion.js` | Apply all ordered migrations transactionally, insert only their checked-in metadata rows, and assert the expanded relation/column/constraint/index/owner/ACL catalog. |
| `shared/vnext-pg17/catalogAssertion.test.js` | Exercise real PG17 foundation FK, uniqueness, lifecycle/check, no-seed, reapply, and catalog-drift behavior with synthetic rows. |
| `shared/vnext-pg17/runPg17IntegrationTests.js` | Continue to run the manifest and catalog suites in one disposable runtime. |
| `shared/vnext-pg17/runPg17IntegrationTests.test.js` | Keep the single-runtime ordering/cleanup contract green after adding foundation cases. |
| `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md` | Receives sanitized evidence only after focused, aggregate, audit, and publish gates pass. |

### Task 1: Freeze migration 2 and its exact foundation catalog

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.js`
- Modify: `shared/vnext-pg17/migrationManifest.test.js`

- [x] **Step 1: Write the failing manifest expectations**

Add the following assertions before changing the manifest implementation:

```js
assert.deepStrictEqual(MIGRATIONS.map(migration => migration.semanticVersion), [1, 2]);
assert.strictEqual(FOUNDATION_IDENTITY_DEVICE_MIGRATION.migrationId, 'vnext-pg17-foundation-identity-device-2');
assert.match(FOUNDATION_IDENTITY_DEVICE_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
assert.strictEqual(
  sha256(FOUNDATION_IDENTITY_DEVICE_MIGRATION.sql),
  FOUNDATION_IDENTITY_DEVICE_MIGRATION.manifestSha256,
);
assert.deepStrictEqual(expectedCatalog.relations, [
  'vnext_control_plane.vnext_account_device_links',
  'vnext_control_plane.vnext_accounts',
  'vnext_control_plane.vnext_authorities',
  'vnext_control_plane.vnext_device_installations',
  'vnext_control_plane.vnext_schema_meta',
  'vnext_control_plane.vnext_schema_migrations',
  'vnext_control_plane.vnext_trusted_devices',
]);
```

- [x] **Step 2: Confirm the manifest test is red**

Run: `node shared/vnext-pg17/migrationManifest.test.js`

Expected: nonzero because migration 2 and the seven-relation catalog do not exist yet.

- [x] **Step 3: Add the exact migration objects**

Keep `FIRST_MIGRATION` unchanged and export it for compatibility. Define and freeze:

```js
const FOUNDATION_IDENTITY_DEVICE_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-foundation-identity-device-2',
  semanticVersion: 2,
  sql: FOUNDATION_IDENTITY_DEVICE_SQL,
  manifestSha256: sha256(FOUNDATION_IDENTITY_DEVICE_SQL),
  postApply: Object.freeze({
    text: `INSERT INTO vnext_control_plane.vnext_schema_meta
      (schema_key, schema_version, applied_at) VALUES ($1, $2, $3)`,
    values: appliedAt => ['control-plane-reference', '5', appliedAt],
  }),
});
const MIGRATIONS = Object.freeze([FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION]);
```

`FOUNDATION_IDENTITY_DEVICE_SQL` must contain only schema-qualified DDL plus grants/revokes. Its tables must be exactly:

```sql
CREATE TABLE vnext_control_plane.vnext_schema_meta (
  schema_key text COLLATE "C" PRIMARY KEY
    CHECK (btrim(schema_key) <> '' AND schema_key = 'control-plane-reference'),
  schema_version bigint NOT NULL CHECK (schema_version = 5),
  applied_at timestamptz NOT NULL
    CHECK (applied_at <> 'infinity'::timestamptz AND applied_at <> '-infinity'::timestamptz)
);

CREATE TABLE vnext_control_plane.vnext_authorities (
  authority_id text COLLATE "C" PRIMARY KEY CHECK (btrim(authority_id) <> ''),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active','disabled','revoked')),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  CHECK (updated_at >= created_at)
);

CREATE TABLE vnext_control_plane.vnext_accounts (
  account_id text COLLATE "C" PRIMARY KEY CHECK (btrim(account_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active','disabled','revoked')),
  auth_version bigint NOT NULL CHECK (auth_version >= 1),
  access_version bigint NOT NULL CHECK (access_version >= 1),
  revocation_version bigint NOT NULL CHECK (revocation_version >= 1),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  UNIQUE (account_id, authority_id),
  FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (updated_at >= created_at)
);
```

Continue the same exact style for the three relationship tables:

```sql
CREATE TABLE vnext_control_plane.vnext_trusted_devices (
  device_id text COLLATE "C" PRIMARY KEY CHECK (btrim(device_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active','risk_limited','revoked','retired')),
  hardware_evidence_hash text COLLATE "C" CHECK (hardware_evidence_hash IS NULL OR hardware_evidence_hash ~ '^[0-9a-f]{64}$'),
  risk_code text COLLATE "C" CHECK (risk_code IS NULL OR btrim(risk_code) <> ''),
  credential_version bigint NOT NULL CHECK (credential_version >= 1),
  risk_version bigint NOT NULL CHECK (risk_version >= 1),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  UNIQUE (device_id, authority_id),
  FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR (status <> 'revoked' AND revoked_at IS NULL))
);

CREATE TABLE vnext_control_plane.vnext_device_installations (
  installation_id text COLLATE "C" PRIMARY KEY CHECK (btrim(installation_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  device_id text COLLATE "C" NOT NULL CHECK (btrim(device_id) <> ''),
  installation_public_key text COLLATE "C" NOT NULL CHECK (btrim(installation_public_key) <> ''),
  key_fingerprint text COLLATE "C" NOT NULL CHECK (key_fingerprint ~ '^[0-9a-f]{64}$'),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active','revoked','retired')),
  credential_version bigint NOT NULL CHECK (credential_version >= 1),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  UNIQUE (installation_id, device_id, authority_id),
  UNIQUE (authority_id, key_fingerprint),
  FOREIGN KEY (device_id, authority_id)
    REFERENCES vnext_control_plane.vnext_trusted_devices(device_id, authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR (status <> 'revoked' AND revoked_at IS NULL))
);

CREATE TABLE vnext_control_plane.vnext_account_device_links (
  link_id text COLLATE "C" PRIMARY KEY CHECK (btrim(link_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  account_id text COLLATE "C" NOT NULL CHECK (btrim(account_id) <> ''),
  device_id text COLLATE "C" NOT NULL CHECK (btrim(device_id) <> ''),
  installation_id text COLLATE "C" NOT NULL CHECK (btrim(installation_id) <> ''),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active','revoked','expired')),
  auth_version bigint NOT NULL CHECK (auth_version >= 1),
  access_version bigint NOT NULL CHECK (access_version >= 1),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  UNIQUE (authority_id, account_id, installation_id),
  UNIQUE (link_id, authority_id, account_id, device_id, installation_id),
  FOREIGN KEY (account_id, authority_id)
    REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (device_id, authority_id)
    REFERENCES vnext_control_plane.vnext_trusted_devices(device_id, authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (installation_id, device_id, authority_id)
    REFERENCES vnext_control_plane.vnext_device_installations(installation_id, device_id, authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR (status = 'expired' AND revoked_at IS NULL) OR status = 'active')
);
```

End the migration with only these privileges:

```sql
GRANT SELECT ON TABLE
  vnext_control_plane.vnext_schema_meta,
  vnext_control_plane.vnext_authorities,
  vnext_control_plane.vnext_accounts,
  vnext_control_plane.vnext_trusted_devices,
  vnext_control_plane.vnext_device_installations,
  vnext_control_plane.vnext_account_device_links
TO vnext_pg17_verifier;
```

Do not grant any DML or function execute privilege to runtime/verifier. Extend `expectedCatalog` with the full column order, constraint names/definitions, indexes, owner facts, and verifier-only table read privileges for all seven relations.

- [x] **Step 4: Verify the manifest turns green**

Run: `node shared/vnext-pg17/migrationManifest.test.js`

Expected: `vNext PG17 migration manifest checks passed`.

### Task 2: Apply ordered migrations and extend exact catalog assertion

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.js`
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`

- [x] **Step 1: Write failing fresh-apply and reapply expectations**

Before modifying `catalogAssertion.js`, add a real-PG test that expects fresh apply to write two ledger rows and exactly one schema-meta row, while preserving the existing API shape:

```js
await catalog.apply(handle, migrationInput);
const rows = await withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query(
  'SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version',
));
assert.deepStrictEqual(rows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }]);
const meta = await withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query(
  'SELECT schema_key, schema_version::text AS schema_version FROM vnext_control_plane.vnext_schema_meta',
));
assert.deepStrictEqual(meta.rows, [{ schema_key: 'control-plane-reference', schema_version: '5' }]);
assert.deepStrictEqual(await catalog.apply(handle, migrationInput), { applied: false });
```

- [x] **Step 2: Confirm the focused catalog suite is red**

Run: `node shared/vnext-pg17/catalogAssertion.test.js`

Expected: nonzero because fresh apply currently creates only ledger migration 1.

- [x] **Step 3: Apply `MIGRATIONS` under one transaction**

Replace the single-migration branch with an ordered loop that runs only after verifying the fresh target has no relation in `vnext_control_plane` and no `public.vnext_schema_migrations` shadow:

```js
for (const migration of MIGRATIONS) {
  await facade.query(migration.sql);
  if (migration.postApply) {
    const post = migration.postApply;
    await facade.query(post.text, post.values(snapshot.appliedAt));
  }
  await facade.query(
    'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
    [migration.migrationId, migration.semanticVersion, migration.manifestSha256, snapshot.appliedAt, snapshot.appliedBy],
  );
}
```

For an existing target, select all ledger rows ordered by `semantic_version::bigint`; require exact count, ID, decimal-string semantic version, and checksum equality with `MIGRATIONS`, then run the complete readonly assertion and return `{ applied: false }`. A missing, extra, reordered, altered, or unknown ledger row must yield `VNEXT_PG17_SCHEMA_DRIFT`; never repair it. Keep `BEGIN`, advisory lock, `SET LOCAL TIME ZONE 'UTC'`, `SET LOCAL ROLE vnext_pg17_owner`, commit, and rollback in one transaction.

Expand the assertion to compare every foundation table's owner, columns, named constraints through `pg_get_constraintdef`, `pg_index`, composite FK definitions, and exact verifier/runtime privileges. Reject any unapproved target-schema relation, any public shadow with a vNext foundation name, unknown checksum, altered owner, missing verifier `SELECT`, verifier/runtime DML grant, or runtime DDL/TEMP/trigger-disable privilege.

- [x] **Step 4: Verify apply/assert behavior is green**

Run: `node shared/vnext-pg17/catalogAssertion.test.js`

Expected: fresh two-row apply, exact reapply, and every existing drift case pass.

### Task 3: Add foundation semantic and drift regressions

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`

- [x] **Step 1: Write failing foundation constraint tests**

Use only `fixture-provisioner` against one fresh applied handle. Insert one authority/account/device/installation/link chain with UTC values and versions `1`, then add these rejection cases with before/after logical-row snapshots:

```js
await assert.rejects(() => insertAccount({ authorityId: 'other-authority' }));
await assert.rejects(() => insertInstallation({ keyFingerprint: existingFingerprint }));
await assert.rejects(() => insertLink({ authorityId: 'other-authority' }));
await assert.rejects(() => insertDevice({ status: 'revoked', revokedAt: null }));
await assert.rejects(() => insertInstallation({ status: 'active', revokedAt: timestamp }));
await assert.rejects(() => insertLink({ status: 'expired', revokedAt: timestamp }));
await assert.rejects(() => insertAccount({ authVersion: '0' }));
await assert.rejects(() => insertAuthority({ authorityId: '   ' }));
await assert.rejects(() => insertInstallation({ keyFingerprint: 'A'.repeat(64) }));
```

Also assert that fresh apply has zero rows in authority/account/device/installation/link tables and that only the schema-meta row is migration-created.

- [x] **Step 2: Confirm the tests are red**

Run: `node shared/vnext-pg17/catalogAssertion.test.js`

Expected: nonzero until migration 2 and its catalog facts exist.

- [x] **Step 3: Add only the missing PG test helpers and catalog cases**

Add `foundationFixture(facade)` returning fixed synthetic IDs and canonical UTC instants, plus `snapshotFoundation(facade)` that returns sorted logical rows for all six foundation tables. Keep SQL fully schema-qualified and bind all values as parameters. Do not expose a raw client or add any production-facing helper.

Add catalog-drift cases that each create a new synthetic database and must return `VNEXT_PG17_SCHEMA_DRIFT` without repair:

```sql
ALTER TABLE vnext_control_plane.vnext_accounts DROP CONSTRAINT vnext_accounts_authority_id_fkey;
ALTER TABLE vnext_control_plane.vnext_device_installations DROP CONSTRAINT vnext_device_installations_authority_id_key_fingerprint_key;
GRANT INSERT ON vnext_control_plane.vnext_account_device_links TO vnext_pg17_verifier;
GRANT SELECT ON vnext_control_plane.vnext_accounts TO vnext_pg17_runtime;
CREATE TABLE public.vnext_accounts (id integer);
CREATE TABLE vnext_control_plane.unapproved_foundation_relation (id integer);
```

Use each handle's `finally` disposal path so every test database and private client is released before the next case.

- [x] **Step 4: Verify foundation semantics and drift behavior**

Run: `node shared/vnext-pg17/catalogAssertion.test.js`

Expected: `vNext PG17 catalog assertion checks passed`.

### Task 4: Run the integration gate, audit scope, and publish evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [x] **Step 1: Verify the focused modules and aggregate**

Run:

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

Expected: all commands pass with a local disposable PG17 runtime; unavailable Docker/image yields one nonzero `VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE` and cannot be treated as success.

- [x] **Step 2: Complete required reviews before evidence**

Perform two independent read-only checks against the current diff:

1. Necessity: migration 2 remains only identity/device foundation DDL and does not add session, authorization, policy, business, API, RDS/ECS, data import, or real environment access.
2. Quality: verify exact migration/ledger order, no authority seed, all source-contracted checks/FKs/unique keys, owner/ACL boundaries, catalog drift tests, disposable-handle cleanup, and no raw client/connection disclosure.

Any finding requires a new failing regression, a minimal repair, and a full rerun of Step 1. Do not record a pass or commit until both checks pass.

- [x] **Step 3: Record only sanitized evidence and publish one scoped commit**

Append a dated subsection describing migration 2, the six foundation relations, zero authority seed, the disposable PG17 test gate, and explicit non-goals. Do not include connection strings, passwords, host paths, raw Docker output, production DDL, or business rows.

Then run:

```powershell
git add package.json package-lock.json shared/vnext-pg17 docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md docs/superpowers/plans/2026-08-15-vnext-pg17-foundation-identity-device-ddl.md
$commitMessage = (-join (0x81EA,0x52A8,0x53D1,0x5E03 | ForEach-Object { [char]$_ })) + ' 2026-08-15'
git commit -m $commitMessage
git push gewu HEAD:master
```

Do not stage `output/locks/` or `output/release-matrix/`. This control-plane schema test slice does not package Electron or publish an OSS desktop update.

## Self-review

- **Spec coverage:** Task 1 maps exactly the six base V5 relations plus required source metadata; Task 2 preserves ordered, append-only migration semantics and expands exact catalog drift checks; Task 3 proves the critical FK/unique/lifecycle/no-seed behaviors in real disposable PG17; Task 4 supplies the aggregate, dual review, evidence, and scoped publish gate.
- **Intentional deferrals:** contacts, roles, capability/scope/profile, sessions/reauth, receipt/audit/outbox/policy/trust-root, target writers, PostgreSQL concurrency mutations, real RDS verification, all desktop/business migration, and deployment remain outside this plan.
- **Placeholder scan:** all identifiers, migration ID/version, table names, status sets, FK targets, test commands, and error-code expectations are fixed. No task accepts a caller-provided database/schema/connection, mutable target identifier, or production secret.
- **Type consistency:** migration 2 remains a checked-in manifest object consumed by the existing `MIGRATIONS` loop; `catalog.apply(handle, { appliedAt, appliedBy })` keeps its established external API and returns `{ applied: true|false }`; all bigint query assertions use PostgreSQL decimal strings rather than JavaScript number conversion.
