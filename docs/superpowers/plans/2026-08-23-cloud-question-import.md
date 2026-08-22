# Cloud-Authoritative Question Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy Word-import dual write path with cloud-owned import tasks, NAS-only originals/media, and explicit-confirmation question drafts.

**Architecture:** Cloud PostgreSQL owns import-task transitions, candidate text, validation, and final question commands. Desktop encrypts an original for the storage agent and prepares local encrypted command drafts only after explicit confirmation. The storage agent writes immutable NAS bytes and parses verified originals; it never writes business rows or decides permissions.

**Tech Stack:** Node.js 24, PostgreSQL 17, Express, Electron bridge, encrypted storage relay, controlled NAS storage agent, Python Word parser.

---

### Task 1: Add import authority regression tests

**Files:**
- Create: `cloud-business-api/src/questionImportTaskRepository.test.js`
- Create: `cloud-business-api/src/questionImportTaskService.test.js`
- Create: `src/pages/QuestionBankImport.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

```js
await assert.rejects(() => tasks.prepareDrafts(unconfirmedInput), /CLOUD_QUESTION_IMPORT_NOT_CONFIRMABLE/);
assert.strictEqual(await countQuestions(), 0);
assert.doesNotMatch(pageSource, /\/api\/question-bank\/(parse-word|imports|storage\/status)/);
assert.doesNotMatch(pageSource, /forceLocal|local question-bank import/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node cloud-business-api/src/questionImportTaskRepository.test.js && node cloud-business-api/src/questionImportTaskService.test.js && node src/pages/QuestionBankImport.test.js`

Expected: missing files and legacy route assertions fail.

- [ ] **Step 3: Add the tests to `test:authority-architecture`**

The page gate permits local encrypted drafts only after a cloud task returns `candidates_ready`; it forbids direct legacy commits and local fallbacks.

- [ ] **Step 4: Run the authority gate**

Run: `npm run test:authority-architecture`

Expected: the new regression cases are discovered.

- [ ] **Step 5: Commit**

```bash
git add cloud-business-api/src/questionImportTaskRepository.test.js cloud-business-api/src/questionImportTaskService.test.js src/pages/QuestionBankImport.test.js package.json
git commit -m "automatic publish 2026-08-23"
```

### Task 2: Add import-task and source-object schema

**Files:**
- Create: `cloud-business-api/sql/20260823-cloud-question-import-tasks.sql`
- Create: `cloud-business-api/sql/cloud-question-import-tasks.test.js`
- Modify: `cloud-business-api/sql/20260823-encrypted-storage-relay.sql`
- Modify: `cloud-business-api/sql/encrypted-storage-relay.test.js`

- [ ] **Step 1: Write failing migration checks**

```js
assert.match(sql, /CREATE TABLE business\.question_import_tasks/);
assert.match(sql, /CREATE TABLE business\.question_import_items/);
assert.match(sql, /CREATE TABLE business\.import_source_objects/);
assert.doesNotMatch(sql, /nas_path|plaintext|source_bytes/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node cloud-business-api/sql/cloud-question-import-tasks.test.js`

Expected: migration file is missing.

- [ ] **Step 3: Add constrained tables**

```sql
business.question_import_tasks(task_id, tenant_id, account_id, idempotency_key,
 source_type, source_file_name, source_mime_type, source_sha256, source_size_bytes,
 metadata_json, source_storage_task_id, status, phase, request_hash, created_at, updated_at)
business.import_source_objects(import_task_id, object_id, object_version, storage_task_id,
 expected_sha256, expected_bytes, mime_type, storage_state, verified_at)
business.question_import_items(item_id, import_task_id, item_index, content_hash,
 candidate_json, validation_json, media_manifest_json, status, version, created_at, updated_at)
```

Use task/tenant/storage foreign keys, unique owner idempotency and item indexes, JSON checks, and least-privilege grants. Relay ownership must target exactly one question asset or import source object; no source plaintext, media bytes, or NAS path is persisted.

- [ ] **Step 4: Run SQL tests**

Run: `node cloud-business-api/sql/cloud-question-import-tasks.test.js && node cloud-business-api/sql/encrypted-storage-relay.test.js`

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add cloud-business-api/sql/20260823-cloud-question-import-tasks.sql cloud-business-api/sql/cloud-question-import-tasks.test.js cloud-business-api/sql/20260823-encrypted-storage-relay.sql cloud-business-api/sql/encrypted-storage-relay.test.js
git commit -m "automatic publish 2026-08-23"
```

### Task 3: Implement cloud task state machine and API

**Files:**
- Create: `cloud-business-api/src/questionImportTaskRepository.js`
- Create: `cloud-business-api/src/questionImportTaskService.js`
- Modify: `cloud-business-api/src/app.js`
- Modify: `cloud-business-api/src/app.test.js`
- Modify: `cloud-business-api/server.js`

- [ ] **Step 1: Write failing repository cases**

```js
const task = await repository.createSource({ tenantId, actor, idempotencyKey, request, relay });
assert.equal(task.status, 'awaiting_source_storage');
await assert.rejects(() => repository.storeCandidates({ taskId: task.taskId, candidates: [] }), /CLOUD_QUESTION_IMPORT_SOURCE_UNVERIFIED/);
await assert.rejects(() => repository.createSource({ tenantId, actor, idempotencyKey, request: changedRequest, relay }), /CLOUD_QUESTION_IMPORT_CONFLICT/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node cloud-business-api/src/questionImportTaskRepository.test.js`

Expected: module-not-found failure.

- [ ] **Step 3: Implement exact transitions**

`createSource` validates online actor role, extension/MIME, checksum, metadata, and relay envelope, then atomically creates task/source/storage task/relay. `markSourceVerified` changes only a matching receipt to `queued_for_parse`. `storeCandidates` accepts agent-authenticated normalized text/manifests only after source verification. `prepareDrafts` is owner-scoped/idempotent and returns normalized payloads without question-table SQL.

- [ ] **Step 4: Add routes**

```text
GET  /api/desktop/question-imports/relay-key
POST /api/desktop/question-imports
GET  /api/desktop/question-imports/:taskId
POST /api/desktop/question-imports/:taskId/validate
POST /api/desktop/question-imports/:taskId/prepare-drafts
POST /api/storage-agent/question-imports/:taskId/candidates
```

Desktop routes require canonical online session. Agent route requires the configured agent token and a verified source receipt. `prepare-drafts` returns 409 before `candidates_ready` and never writes `business.questions`.

- [ ] **Step 5: Run cloud tests**

Run: `npm.cmd --prefix cloud-business-api test`

Expected: all cloud tests pass.

- [ ] **Step 6: Commit**

```bash
git add cloud-business-api/src/questionImportTaskRepository.js cloud-business-api/src/questionImportTaskRepository.test.js cloud-business-api/src/questionImportTaskService.js cloud-business-api/src/questionImportTaskService.test.js cloud-business-api/src/app.js cloud-business-api/src/app.test.js cloud-business-api/server.js
git commit -m "automatic publish 2026-08-23"
```

### Task 4: Bind NAS relays and receipts to import sources

**Files:**
- Modify: `cloud-business-api/src/encryptedStorageRelayRepository.js`
- Modify: `cloud-business-api/src/encryptedStorageRelayRepository.test.js`
- Modify: `cloud-business-api/src/storageTaskRepository.js`
- Modify: `cloud-business-api/src/storageTaskRepository.test.js`

- [ ] **Step 1: Write failing relay tests**

```js
await relay.createImportSource(validSource);
await assert.rejects(() => relay.createImportSource({ ...validSource, ciphertext: tampered }), /ENCRYPTED_RELAY_INPUT_INVALID/);
await storage.complete(receiptForImportSource);
assert.equal(await taskStatus(importTaskId), 'queued_for_parse');
```

- [ ] **Step 2: Run and confirm failure**

Run: `node cloud-business-api/src/encryptedStorageRelayRepository.test.js && node cloud-business-api/src/storageTaskRepository.test.js`

Expected: source relay method fails.

- [ ] **Step 3: Implement source relay**

Add a dedicated source-relay method. Bind encryption to `taskId:objectId:version`, retain the 64 MiB/expiry/canonical-base64 validation, include source relays in lease/download/cleanup, and delete ciphertext after a verified receipt. Expired relay quarantines the import task; parsing cannot start.

- [ ] **Step 4: Run storage tests**

Run: `npm.cmd --prefix cloud-business-api test`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add cloud-business-api/src/encryptedStorageRelayRepository.js cloud-business-api/src/encryptedStorageRelayRepository.test.js cloud-business-api/src/storageTaskRepository.js cloud-business-api/src/storageTaskRepository.test.js
git commit -m "automatic publish 2026-08-23"
```

### Task 5: Add controlled parser capability to storage agent

**Files:**
- Create: `storage-agent/src/questionImportParser.js`
- Create: `storage-agent/src/questionImportParser.test.js`
- Modify: `storage-agent/src/cloudClient.js`
- Modify: `storage-agent/src/cloudClient.test.js`
- Modify: `storage-agent/src/worker.js`
- Modify: `storage-agent/src/worker.test.js`

- [ ] **Step 1: Write failing parser cases**

```js
const parsed = await parser.parseVerifiedSource(descriptor);
assert.equal(parsed.candidates[0].assets[0].bytes, expectedImageBytes);
await assert.rejects(() => parser.parseVerifiedSource(unverifiedDescriptor), /QUESTION_IMPORT_SOURCE_NOT_VERIFIED/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node storage-agent/src/questionImportParser.test.js && node storage-agent/src/worker.test.js`

Expected: module-not-found failure.

- [ ] **Step 3: Implement isolated parsing**

Run the existing Python parser only on an already verified NAS descriptor, using a private temporary directory and fixed arguments. The bounded protocol contains candidate text/formulas and media manifests; extracted bytes remain inside the agent. Cloud validates candidate text, authorizes derived media objects, and the agent writes them only when hash/length match. The parser never emits NAS paths, credentials, or question commands.

- [ ] **Step 4: Run agent suite**

Run: `npm.cmd --prefix storage-agent test`

Expected: all tests pass; malicious parser output or bad checksum yields no derived-media write.

- [ ] **Step 5: Commit**

```bash
git add storage-agent/src/questionImportParser.js storage-agent/src/questionImportParser.test.js storage-agent/src/cloudClient.js storage-agent/src/cloudClient.test.js storage-agent/src/worker.js storage-agent/src/worker.test.js
git commit -m "automatic publish 2026-08-23"
```

### Task 6: Replace desktop page APIs and create confirmed drafts only

**Files:**
- Create: `src/services/desktopQuestionImportClient.mjs`
- Create: `src/services/desktopQuestionImportClient.test.js`
- Create: `src/services/questionImportDraftBuilder.ts`
- Create: `src/services/questionImportDraftBuilder.test.ts`
- Modify: `src/services/desktopIdentityClient.mjs`
- Modify: `src/electron/DesktopIdentityGate.*`
- Modify: `src/custom.d.ts`
- Modify: `src/pages/QuestionBankImport.tsx`
- Modify: `src/pages/QuestionBankImport.test.js`

- [ ] **Step 1: Write failing desktop cases**

```js
await assert.rejects(() => client.createImport({ online: false, file }), /CLOUD_ONLINE_IDENTITY_REQUIRED/);
const rows = await builder.prepare({ task: candidatesReadyTask, db });
assert.equal(rows.length, 2);
assert.equal(await db.countQuestions(), 0);
assert.equal(await db.countOutboxType('question.create.v1'), 2);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node src/services/desktopQuestionImportClient.test.js && npx tsx src/services/questionImportDraftBuilder.test.ts && node src/pages/QuestionBankImport.test.js`

Expected: client/builder is missing.

- [ ] **Step 3: Implement client and bridge**

The client gets the cloud agent key, encrypts the file in memory, creates/polls an idempotent task, and never calls the legacy API base. The bridge exposes only create/read/validate/prepare operations scoped to the current session.

- [ ] **Step 4: Replace page behavior**

Replace legacy upload, batch commit, fallback, task-detail fallback, and hard-disk status gate. Retain the editor UI but bind it to cloud items. Explicit confirmation calls cloud `prepare-drafts`, then creates encrypted local drafts through existing provenance rules. Remove browser media authority and all automatic/local writes.

- [ ] **Step 5: Run desktop checks**

Run: `npm run test:authority-architecture && npm run test:question-deletion && npx tsc --noEmit`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/desktopQuestionImportClient.mjs src/services/desktopQuestionImportClient.test.js src/services/questionImportDraftBuilder.ts src/services/questionImportDraftBuilder.test.ts src/services/desktopIdentityClient.mjs src/electron src/custom.d.ts src/pages/QuestionBankImport.tsx src/pages/QuestionBankImport.test.js
git commit -m "automatic publish 2026-08-23"
```

### Task 7: Deploy only after complete evidence

**Files:**
- Create: `scripts/check-question-import-release.js`
- Create: `scripts/check-question-import-release.test.js`
- Modify: `scripts/check_cloud_business_authority_contract.test.js`

- [ ] **Step 1: Write failing release cases**

```js
assert.throws(() => verifyImportRelease({ task: { status: 'candidates_ready' }, questionWrites: 1 }), /QUESTION_IMPORT_RELEASE_INVALID/);
assert.throws(() => verifyImportRelease({ sourceReceipt: null }), /QUESTION_IMPORT_RELEASE_INVALID/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node scripts/check-question-import-release.test.js`

Expected: checker is missing.

- [ ] **Step 3: Implement evidence gate and deploy in order**

Require version match, source/derived-media receipts, candidate state, zero writes before confirmation, and one successful user-confirmed command receipt. Back up cloud code/database, apply migration, deploy cloud and agent, and run internal/public health. Do not publish the OSS desktop feed or miniapp until the later 5.6sol audit passes the complete version matrix.

- [ ] **Step 4: Run complete verification**

Run: `npm run test:authority-architecture && npm.cmd --prefix cloud-business-api test && npm.cmd --prefix storage-agent test && node scripts/check-question-import-release.js`

Expected: all pass without a legacy dependency or premature question write.

- [ ] **Step 5: Commit and push**

```bash
git add scripts/check-question-import-release.js scripts/check-question-import-release.test.js scripts/check_cloud_business_authority_contract.test.js
git commit -m "automatic publish 2026-08-23"
git push gewu master
```

## Self-review

- Cloud text authority, NAS media boundary, online source creation, explicit confirmation, idempotency, receipt order, local-fallback removal, and release evidence each map to a task.
- The protocol names are consistent: `question_import_tasks`, `import_source_objects`, `question_import_items`, `createSource`, `markSourceVerified`, `storeCandidates`, and `prepareDrafts`.
