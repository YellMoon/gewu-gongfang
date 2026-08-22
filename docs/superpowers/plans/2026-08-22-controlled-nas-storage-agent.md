# Controlled NAS Storage Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-authoritative storage agent that stores rich-media bytes on the reachable NAS while the cloud remains the sole authority for task state and business data.

**Architecture:** A Windows service on the machine that can reach the NAS polls the cloud for opaque storage tasks. Cloud tasks contain only object ID, immutable version, expected SHA-256, byte count and media type; they never contain a NAS path or bytes. This plan establishes the NAS boundary, cloud-owned task ledger and authenticated task client only. A later, separately specified source-transfer protocol must provide bytes before a worker may write or submit a receipt; until then a non-empty lease stops safely without a write or receipt. Desktop and miniapp clients never receive NAS credentials or paths.

**Tech Stack:** Node.js 24, PostgreSQL 17, existing cloud-business-api HTTP service, Windows Task Scheduler, NAS SMB share.

---

### Task 1: Agent configuration and read-only health boundary

**Files:**
- Create: `storage-agent/src/config.js`
- Create: `storage-agent/src/config.test.js`
- Create: `storage-agent/package.json`

- [ ] **Step 1: Write the failing configuration test**

```js
assert.throws(() => loadStorageAgentConfig({ NAS_STORAGE_ROOT: '../unsafe' }), /STORAGE_AGENT_CONFIG_INVALID/);
assert.deepStrictEqual(loadStorageAgentConfig(validEnv), {
  cloudBaseUrl: 'https://example.invalid/cloud-business',
  agentId: 'storage-agent-1',
  nasRoot: resolvedRoot,
  pollSeconds: 10,
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node storage-agent/src/config.test.js`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the minimum config loader**

```js
function loadStorageAgentConfig(env) {
  const nasRoot = path.resolve(required(env.NAS_STORAGE_ROOT));
  if (!path.isAbsolute(nasRoot) || !fs.existsSync(nasRoot)) throw failure('STORAGE_AGENT_CONFIG_INVALID');
  return Object.freeze({ cloudBaseUrl: httpsUrl(env.CLOUD_BUSINESS_BASE_URL), agentId: identifier(env.STORAGE_AGENT_ID), nasRoot, pollSeconds: boundedInteger(env.STORAGE_AGENT_POLL_SECONDS, 10, 5, 300) });
}
```

The loader must not read question-bank files, expose the root in remote requests, or accept a client-provided path.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node storage-agent/src/config.test.js`

Expected: `storage agent config checks passed`.

- [ ] **Step 5: Commit**

```bash
git add storage-agent
git commit -m "feat: add storage agent configuration boundary"
```

### Task 2: Immutable NAS object writer

**Files:**
- Create: `storage-agent/src/objectStore.js`
- Create: `storage-agent/src/objectStore.test.js`

- [ ] **Step 1: Write the failing object-store tests**

```js
await store.putVerified({ objectId: 'obj_1', version: 1, sha256: HASH, bytes: 3 }, Buffer.from('abc'));
await assert.rejects(() => store.putVerified({ objectId: 'obj_1', version: 1, sha256: HASH, bytes: 3 }, Buffer.from('abd')), /STORAGE_OBJECT_HASH_MISMATCH/);
assert.throws(() => store.objectPath({ objectId: '../escape', version: 1, sha256: HASH }), /STORAGE_OBJECT_INVALID/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node storage-agent/src/objectStore.test.js`

Expected: module-not-found failure.

- [ ] **Step 3: Implement atomic content-addressed writes**

```js
const target = path.join(nasRoot, 'objects', objectId, String(version), sha256);
assertInsideRoot(target, nasRoot);
await fs.promises.writeFile(`${target}.${random}.partial`, bytes);
await verifyHash(partial, sha256, expectedBytes);
await fs.promises.rename(partial, target);
```

Existing object versions must be re-hashed and accepted only when identical; conflicting bytes must be quarantined locally without replacing the immutable target.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node storage-agent/src/objectStore.test.js`

Expected: `storage object store checks passed`.

- [ ] **Step 5: Commit**

```bash
git add storage-agent/src/objectStore.js storage-agent/src/objectStore.test.js
git commit -m "feat: add verified NAS object storage"
```

### Task 3: Cloud-owned storage task ledger and restricted agent API

**Files:**
- Create: `cloud-business-api/sql/20260822-storage-agent-tasks.sql`
- Create: `cloud-business-api/sql/storage-agent-tasks.test.js`
- Create: `cloud-business-api/src/storageTaskRepository.js`
- Create: `cloud-business-api/src/storageTaskRepository.test.js`
- Modify: `cloud-business-api/server.js`

- [ ] **Step 1: Write failing SQL and repository tests**

```js
assert.match(sql, /CREATE TABLE business\.storage_object_tasks/);
await assert.rejects(() => repository.complete({ taskId, sha256: wrongHash }), /STORAGE_TASK_RECEIPT_MISMATCH/);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node cloud-business-api/sql/storage-agent-tasks.test.js && node cloud-business-api/src/storageTaskRepository.test.js`

Expected: missing migration/repository failure.

- [ ] **Step 3: Implement cloud task ownership**

The SQL must create append-only task and receipt records with states `queued`, `leased`, `verified`, `failed_retryable`, and `quarantined`. The cloud service exposes only agent-authenticated poll, lease, download-grant, and completion routes. Every grant is bound to one agent, object ID, version, expected hash, and expiry; no route accepts a NAS path or permits a storage agent to alter business rows, accounts, roles, or permissions.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm.cmd --prefix cloud-business-api test`

Expected: all cloud-business-api tests pass.

- [ ] **Step 5: Commit**

```bash
git add cloud-business-api
git commit -m "feat: add cloud-owned storage task ledger"
```

### Task 4: Safe polling foundation without a media source

**Files:**
- Create: `storage-agent/src/cloudClient.js`
- Create: `storage-agent/src/worker.js`
- Create: `storage-agent/src/worker.test.js`

- [ ] **Step 1: Write the failing worker tests**

```js
assert.deepStrictEqual(await worker.runOnce(), { state: 'idle' });
assert.deepStrictEqual(await worker.runOnce(), { state: 'blocked_missing_source', taskId: 'task_12345678' });
assert.deepStrictEqual(events, ['lease', 'lease']);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node storage-agent/src/worker.test.js`

Expected: missing worker failure.

- [ ] **Step 3: Implement the non-writing polling guard**

The worker fetches one leased task. A null lease returns `{ state: 'idle' }`. Any non-null task returns `{ state: 'blocked_missing_source', taskId }` and must not invoke the object store or completion route. No installation script is added in this plan: an installed poller is deferred until the separately specified source-transfer protocol exists. It must not start any business or desktop host service.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node storage-agent/src/worker.test.js && npm.cmd --prefix storage-agent test`

Expected: both suites pass.

- [ ] **Step 5: Commit**

```bash
git add storage-agent/src/worker.js storage-agent/src/worker.test.js storage-agent/package.json
git commit -m "feat: add safe storage agent polling guard"
```

### Task 5: Deployment, health evidence, and unified release receipt

**Files:**
- Modify: `scripts/release-matrix.js`
- Create: `scripts/check-storage-agent-health.js`
- Create: `scripts/check-storage-agent-health.test.js`
- Modify: `docs/superpowers/specs/2026-08-13-cloud-authority-vnext-design.md`

- [ ] **Step 1: Write failing health tests**

```js
assert.throws(() => verifyHealth({ writableAuthority: true }), /STORAGE_AGENT_AUTHORITY_VIOLATION/);
assert.deepStrictEqual(verifyHealth(validHealth), validHealth);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/check-storage-agent-health.test.js`

Expected: missing health checker failure.

- [ ] **Step 3: Implement evidence-only health verification**

The checker validates agent ID, exact release version, reachable configured root, immutable write/read hash rehearsal in a dedicated health namespace, and absence of business-authority capability. It records a `storage_proxy` release receipt only after cloud health, agent health, and cleanup of the rehearsal object all pass.

- [ ] **Step 4: Run release validation**

Run: `npm.cmd run test:release-matrix && npm.cmd run test:cloud-business-authority-contract`

Expected: both pass; desktop publication remains rejected until cloud business, storage proxy, and miniapp receipts are all exact-version verified.

- [ ] **Step 5: Commit**

```bash
git add scripts/release-matrix.js scripts/check-storage-agent-health.js scripts/check-storage-agent-health.test.js docs/superpowers/specs/2026-08-13-cloud-authority-vnext-design.md
git commit -m "feat: verify controlled NAS storage release"
```
