# Local Business Repository Synthetic Read Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a test-only, synthetic, read-only adapter whose `list` operation
matches the retained personal-asset-account repository without a database, file,
environment read, network request, or control-plane projection.

**Architecture:** The retained `personalAssetAccountService` is untouched and
not imported. A strict factory takes wholly fictional rows, snapshots them into
private module state, and returns an opaque brand. The branded adapter provides
the retained list semantics and frozen synthetic projections only. Its test
observes non-sensitive fixture fingerprint and operation-count evidence.

**Tech Stack:** Node.js CommonJS, `node:assert`, `node:crypto`, and
`node:util` (`types.isProxy`); no package, SQLite, PostgreSQL, filesystem,
network, environment, shell, Docker, or runtime changes.

---

## Fixed Scope

| Item | Fixed evidence |
| --- | --- |
| Retained owner | `backend/src/services/personalAssetAccountService.js` |
| Admitted operation | `list({ actor, authorityId, ownerUserId })` |
| Retained dependency | one local `asset_accounts` query; active rows; `created_at,account_id` order |
| Public errors | `ASSET_ACCOUNT_ACTOR_REQUIRED`, `ASSET_ACCOUNT_AUTHORITY_REQUIRED`, `ASSET_ACCOUNT_FORBIDDEN` |
| Existing test | `backend/src/services/personalAssetAccountService.test.js` |
| Current caller surface | `authorityHostRuntime` constructs the service; no in-tree production caller invokes `list`; this plan must add none. |
| Excluded | mutators, questions, exports, attachments, bulk sources, paths, snapshots, sync, relays, raw SQL |

The interface is low execution risk, not low data sensitivity. Fixture values
must be fictional/non-identifying only: zero balance and tokens such as
`MASK-ALPHA` are allowed; real names, identifiers, contact values, financial
values, account numbers, paths, and persistent rows are prohibited.

### Task 1: Record the static inventory

**Files:**
- Create: `docs/superpowers/inventories/2026-08-20-local-business-repository-synthetic-read-pilot.md`

- [ ] **Step 1: Write the exact inventory**

```markdown
# Local Business Repository Synthetic Read Pilot Inventory

- Retained owner: `backend/src/services/personalAssetAccountService.js`
- Admitted operation: `list({ actor, authorityId, ownerUserId })`
- Existing proof: `backend/src/services/personalAssetAccountService.test.js`
- Runtime caller change: none; no production import of the synthetic adapter.
- Intentionally not reused: the `asset_accounts` SQLite query.
- Synthetic dependency: only a closure-owned fictional fixture.
- Result: accountId, authorityId, ownerUserId, accountType, provider, label,
  maskedIdentifier, balance, currency, status, createdAt, updatedAt.
- Errors: ASSET_ACCOUNT_ACTOR_REQUIRED, ASSET_ACCOUNT_AUTHORITY_REQUIRED,
  ASSET_ACCOUNT_FORBIDDEN.
- Prohibited: real SQLite, file/path/environment access, network, cloud/PG,
  projection, sync, snapshots, exports, task dispatch, runtime wiring, mutators.
```

- [ ] **Step 2: Verify source evidence**

Run:

```powershell
rg -n "function list|ASSET_ACCOUNT_(ACTOR_REQUIRED|AUTHORITY_REQUIRED|FORBIDDEN)|SELECT \* FROM asset_accounts" backend/src/services/personalAssetAccountService.js
node backend/src/services/personalAssetAccountService.test.js
```

Expected: the source contract is present and the retained focused test exits `0`.

- [ ] **Step 3: Commit the inventory checkpoint**

```powershell
git add docs/superpowers/inventories/2026-08-20-local-business-repository-synthetic-read-pilot.md
$commitMessage = ([char[]](0x81EA,0x52A8,0x53D1,0x5E03) -join '') + ' 2026-08-20'
git commit -m $commitMessage
git push gewu HEAD:master
```

### Task 2: Add red tests for parity and escape prevention

**Files:**
- Create: `backend/src/services/personalAssetAccountSyntheticReadAdapter.test.js`
- Create: `backend/src/services/personalAssetAccountSyntheticReadAdapter.js`

- [ ] **Step 1: Create a fictional-only fixture in the test**

Import `assert` and the prospective adapter module only; do not import the
retained service, `better-sqlite3`, `pg`, `fs`, `path`, `http`, `https`, `net`,
or `child_process`. Use exactly these representative rows:

```js
const fictionalAccounts = [
  { account_id: 'synthetic-account-alpha', authority_id: 'synthetic-authority', owner_user_id: 'synthetic-owner-alpha', account_type: 'saving_card', provider: 'Fictional Provider', label: 'Synthetic Account', masked_identifier: 'MASK-ALPHA', balance: 0, currency: 'CNY', status: 'active', created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' },
  { account_id: 'synthetic-account-alpha-earlier', authority_id: 'synthetic-authority', owner_user_id: 'synthetic-owner-alpha', account_type: 'custom', provider: null, label: 'Earlier Synthetic Account', masked_identifier: null, balance: 0, currency: 'CNY', status: 'active', created_at: '2026-08-19T00:00:00.000Z', updated_at: '2026-08-19T00:00:00.000Z' },
  { account_id: 'synthetic-account-alpha-z', authority_id: 'synthetic-authority', owner_user_id: 'synthetic-owner-alpha', account_type: 'custom', provider: null, label: 'Tied Synthetic Account', masked_identifier: null, balance: 0, currency: 'CNY', status: 'active', created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' },
  { account_id: 'synthetic-account-beta', authority_id: 'synthetic-authority', owner_user_id: 'synthetic-owner-beta', account_type: 'wechat', provider: null, label: 'Synthetic Wallet', masked_identifier: null, balance: 0, currency: 'CNY', status: 'active', created_at: '2026-08-19T00:00:00.000Z', updated_at: '2026-08-19T00:00:00.000Z' },
  { account_id: 'synthetic-account-archived', authority_id: 'synthetic-authority', owner_user_id: 'synthetic-owner-alpha', account_type: 'custom', provider: null, label: 'Archived Synthetic Account', masked_identifier: null, balance: 0, currency: 'CNY', status: 'archived', created_at: '2026-08-18T00:00:00.000Z', updated_at: '2026-08-18T00:00:00.000Z' },
];
```

- [ ] **Step 2: Write failing domain-parity tests**

```js
const fixture = createSyntheticPersonalAssetAccountFixture({ accounts: fictionalAccounts });
const adapter = createSyntheticPersonalAssetAccountListAdapter({ fixture });
const own = adapter.list({ actor: { userId: 'synthetic-owner-alpha', roles: ['student'] }, authorityId: 'synthetic-authority' });
assert.deepStrictEqual(own.map(row => row.accountId), ['synthetic-account-alpha-earlier', 'synthetic-account-alpha', 'synthetic-account-alpha-z']);
assert.strictEqual(own[0].accountNumber, undefined);
assert.strictEqual(own[0].status, 'active');
assert.ok(Object.isFrozen(own));
assert.ok(Object.isFrozen(own[0]));
assert.deepStrictEqual(adapter.list({ actor: { userId: 'synthetic-admin', roles: ['super_admin'] }, authorityId: 'synthetic-authority', ownerUserId: 'synthetic-owner-beta' }).map(row => row.accountId), ['synthetic-account-beta']);
assert.deepStrictEqual(adapter.list({ actor: { id: 'synthetic-owner-alpha' }, authorityId: 'synthetic-authority' }).map(row => row.accountId), ['synthetic-account-alpha-earlier', 'synthetic-account-alpha', 'synthetic-account-alpha-z']);
assert.deepStrictEqual(adapter.list({ actor: { id: 'synthetic-admin', role: 'admin' }, authorityId: 'synthetic-authority', ownerUserId: 'synthetic-owner-beta' }).map(row => row.accountId), ['synthetic-account-beta']);
assert.throws(() => adapter.list({ actor: { userId: 'synthetic-owner-alpha', roles: ['student'] }, authorityId: 'synthetic-authority', ownerUserId: 'synthetic-owner-beta' }), error => error.code === 'ASSET_ACCOUNT_FORBIDDEN');
assert.deepStrictEqual(adapter.list({ actor: { userId: 'nobody' }, authorityId: 'synthetic-authority' }), []);
assert.throws(() => adapter.list({ actor: {}, authorityId: 'synthetic-authority' }), error => error.code === 'ASSET_ACCOUNT_ACTOR_REQUIRED');
assert.throws(() => adapter.list({ actor: { userId: 'synthetic-owner-alpha' } }), error => error.code === 'ASSET_ACCOUNT_AUTHORITY_REQUIRED');
```

Run `node backend/src/services/personalAssetAccountSyntheticReadAdapter.test.js`.
Expected: FAIL because the module is absent.

- [ ] **Step 3: Add failing boundary tests**

```js
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: fictionalAccounts, database: {} }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
assert.throws(() => createSyntheticPersonalAssetAccountListAdapter({ fixture, allowNetwork: false }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_ADAPTER_INVALID');
let getterReads = 0;
const accessorInput = { authorityId: 'synthetic-authority', actor: { userId: 'synthetic-owner-alpha' } };
Object.defineProperty(accessorInput, 'ownerUserId', { enumerable: true, get() { getterReads += 1; return 'synthetic-owner-alpha'; } });
assert.throws(() => adapter.list(accessorInput), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_INPUT_INVALID');
assert.strictEqual(getterReads, 0);
const accessorActor = { userId: 'synthetic-owner-alpha' };
Object.defineProperty(accessorActor, 'role', { enumerable: true, get() { getterReads += 1; return 'admin'; } });
assert.throws(() => adapter.list({ actor: accessorActor, authorityId: 'synthetic-authority' }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_INPUT_INVALID');
assert.strictEqual(getterReads, 0);
assert.throws(() => adapter.list({ actor: new Proxy({ userId: 'synthetic-owner-alpha' }, {}), authorityId: 'synthetic-authority' }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_INPUT_INVALID');
const hostileRoles = new Proxy(['student'], { get() { getterReads += 1; throw new Error('must not read roles'); } });
assert.throws(() => adapter.list({ actor: { userId: 'synthetic-owner-alpha', roles: hostileRoles }, authorityId: 'synthetic-authority' }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_INPUT_INVALID');
assert.strictEqual(getterReads, 0);
const accessorRow = { ...fictionalAccounts[0] };
Object.defineProperty(accessorRow, 'label', { enumerable: true, get() { getterReads += 1; return 'Synthetic Account'; } });
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: [accessorRow] }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
assert.strictEqual(getterReads, 0);
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: [new Proxy(fictionalAccounts[0], {})] }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: new Proxy(fictionalAccounts, {}) }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
const sparseAccounts = []; sparseAccounts[1] = fictionalAccounts[0];
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: sparseAccounts }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
const accessorAccounts = [];
Object.defineProperty(accessorAccounts, '0', { enumerable: true, get() { getterReads += 1; return fictionalAccounts[0]; } });
accessorAccounts.length = 1;
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: accessorAccounts }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
assert.strictEqual(getterReads, 0);
const missingRowField = { ...fictionalAccounts[0] }; delete missingRowField.currency;
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: [missingRowField] }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: [{ ...fictionalAccounts[0], unexpected: true }] }), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
const before = adapter.inspect();
assert.throws(() => JSON.stringify(own), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_SERIALIZATION_FORBIDDEN');
assert.throws(() => JSON.stringify(own[0]), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_SERIALIZATION_FORBIDDEN');
assert.strictEqual(Reflect.set(own[0], 'label', 'changed'), false);
assert.deepStrictEqual(adapter.inspect(), before);
```

Before importing the adapter, temporarily intercept `Module._load` and fail for
`better-sqlite3`, `pg`, `fs`, `node:fs`, `path`, `node:path`, `net`,
`node:net`, `http`, `node:http`, `https`, `node:https`, `child_process`, and
`node:child_process`; always restore it in `finally`.

- [ ] **Step 4: Commit the red-test checkpoint**

```powershell
git add backend/src/services/personalAssetAccountSyntheticReadAdapter.test.js
$commitMessage = ([char[]](0x81EA,0x52A8,0x53D1,0x5E03) -join '') + ' 2026-08-20'
git commit -m $commitMessage
git push gewu HEAD:master
```

### Task 3: Implement the strict synthetic adapter

**Files:**
- Create: `backend/src/services/personalAssetAccountSyntheticReadAdapter.js`
- Modify: `backend/src/services/personalAssetAccountSyntheticReadAdapter.test.js`

- [ ] **Step 1: Add private fixture state and descriptor validation**

Use only `node:crypto` and `node:util` (`types.isProxy`):

```js
const crypto = require('crypto');
const { types } = require('util');
const fixtures = new WeakMap();

function syntheticError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function ownPlainData(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || types.isProxy(value)) throw syntheticError(code);
  const copy = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw syntheticError(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw syntheticError(code);
    copy[key] = descriptor.value;
  }
  return copy;
}
```

`createSyntheticPersonalAssetAccountFixture` accepts exact own-data
`{ accounts }`. Reject proxies, accessors, symbols, non-enumerable values,
array holes/accessors, unknown/missing row fields, absolute paths, URLs, long
digit runs, and nonzero balances. Descriptor-snapshot each allowed row, sort by
`created_at,account_id`, freeze copied rows/array, retain them only in the
`WeakMap`, and return a frozen empty brand. Use error
`SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID`.

- [ ] **Step 2: Implement retained `list` behavior without a DB import**

Use this projection exactly:

```js
function project(row) {
  return Object.freeze({
    accountId: row.account_id, authorityId: row.authority_id,
    ownerUserId: row.owner_user_id, accountType: row.account_type,
    provider: row.provider || null, label: row.label,
    maskedIdentifier: row.masked_identifier || null, balance: Number(row.balance),
    currency: row.currency, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at,
  });
}
```

The adapter factory must descriptor-snapshot exact `{ fixture }` before reading
it and reject an unbranded fixture. `list` must snapshot its input before any
property read; only own-data `actor`, `authorityId`, and optional `ownerUserId`
are allowed. Malformed input gets `SYNTHETIC_ASSET_ACCOUNT_INPUT_INVALID`.
Missing actor/authority and non-admin cross-owner access use the retained three
errors. Both retained actor-ID forms (`userId` and `id`) and both role forms
(`roles` and `role`) are required compatibility cases. `admin` and
`super_admin` are the only admin roles. Return active rows matching
authority/owner in `created_at,account_id` order.

Attach a non-enumerable `toJSON` that throws
`SYNTHETIC_ASSET_ACCOUNT_SERIALIZATION_FORBIDDEN` before freezing every result
array and projected row. `inspect()` must return only frozen
`{ fixtureSha256, operationCount }`; it never exposes a row, input, handle, or
result. The hash is deterministic JSON of copied fictional rows.

- [ ] **Step 3: Verify focused behavior**

```powershell
node backend/src/services/personalAssetAccountSyntheticReadAdapter.test.js
node backend/src/services/personalAssetAccountService.test.js
git diff --check
```

Expected: both tests exit `0`; no whitespace errors. Do not alter the retained
service/test, runtime registration, `package.json`, or any migration.

- [ ] **Step 4: Commit the implementation checkpoint**

```powershell
git add backend/src/services/personalAssetAccountSyntheticReadAdapter.js backend/src/services/personalAssetAccountSyntheticReadAdapter.test.js
$commitMessage = ([char[]](0x81EA,0x52A8,0x53D1,0x5E03) -join '') + ' 2026-08-20'
git commit -m $commitMessage
git push gewu HEAD:master
```

### Task 4: Lock non-capability evidence and review

**Files:**
- Modify: `backend/src/services/personalAssetAccountSyntheticReadAdapter.test.js`
- Modify: `docs/superpowers/plans/2026-08-20-vnext-local-business-repository-synthetic-read-adapter-implementation.md`

- [ ] **Step 1: Lock exact exports and prohibited source tokens**

```js
assert.deepStrictEqual(Object.keys(require('./personalAssetAccountSyntheticReadAdapter')).sort(), [
  'createSyntheticPersonalAssetAccountFixture',
  'createSyntheticPersonalAssetAccountListAdapter',
].sort());
```

After module behavior checks finish, inspect checked-in adapter source and fail
if it contains `better-sqlite3`, `require('pg')`, `fetch(`, `http`, `https`,
`fs`, `path`, `process.env`, `child_process`, `INSERT`, `UPDATE`, `DELETE`,
`CREATE`, `ALTER`, `DROP`, `COPY`, `sync`, `projection`, or `snapshot`.

- [ ] **Step 2: Record bounded execution evidence**

Append an `## Execution Evidence` section after green checks. It must say this
is one process-local fictional read boundary, not a retained-repository
replacement, real-data reader, local DB adapter, PG17 source, projection, sync
feature, cloud release, or desktop release.

- [ ] **Step 3: Final verification and review**

```powershell
node backend/src/services/personalAssetAccountService.test.js
node backend/src/services/personalAssetAccountSyntheticReadAdapter.test.js
npm.cmd run test:vnext-control-plane-target
git diff --check
git status --short
```

Review must confirm no real row, SQLite handle, filesystem path, environment
fallback, network, PG17 operation, runtime import, or control-plane write; that
the admitted errors/results match; and fixture/result mutation or serialization
cannot affect later calls.

- [ ] **Step 4: Commit and push verified evidence**

```powershell
git add -A
$commitMessage = ([char[]](0x81EA,0x52A8,0x53D1,0x5E03) -join '') + ' 2026-08-20'
git commit -m $commitMessage
git push gewu HEAD:master
git ls-remote gewu refs/heads/master
```

Expected: remote `master` equals the local commit. Do not package Electron,
update OSS, deploy, or claim a multi-endpoint release.
