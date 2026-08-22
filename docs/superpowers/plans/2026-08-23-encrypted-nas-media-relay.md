# Encrypted NAS Media Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move rich-media bytes to NAS through an end-to-end encrypted, expiring cloud relay without creating a second business or media authority.

**Architecture:** A shared cryptographic envelope makes encrypted bytes portable without exposing plaintext or the content key to cloud code. The NAS worker may only complete a storage task after it decrypts the leased relay, verifies its plaintext descriptor, writes through the immutable object store and reads it back. Cloud relay persistence and source upload remain a second task because an authenticated cloud question-asset command does not exist yet.

**Tech Stack:** Node.js `crypto` X25519, HKDF-SHA-256, AES-256-GCM, existing Node CommonJS tests and storage-agent object store.

---

### Task 1: Implement the sealed relay envelope

**Files:**
- Create: `shared/encryptedNasRelay.js`
- Create: `shared/encryptedNasRelay.test.js`
- Modify: `storage-agent/package.json`

- [ ] **Step 1: Write the failing envelope test**

```js
const encrypted = sealForAgent({ agentPublicKey, binding, plaintext: Buffer.from('media') });
assert.deepStrictEqual(openForAgent({ agentPrivateKey, binding, envelope: encrypted.envelope, ciphertext: encrypted.ciphertext }), Buffer.from('media'));
assert.throws(() => openForAgent({ agentPrivateKey, binding: 'other', envelope: encrypted.envelope, ciphertext: encrypted.ciphertext }), /RELAY_ENVELOPE_AUTH_FAILED/);
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `node shared/encryptedNasRelay.test.js`

Expected: failure because `shared/encryptedNasRelay.js` does not exist.

- [ ] **Step 3: Add the minimal sealed-envelope implementation**

Use an ephemeral X25519 key pair, derive a wrapping key with `crypto.hkdfSync('sha256', secret, salt, 'gewu-nas-relay-wrap-v1', 32)`, and apply AES-256-GCM twice: once to wrap the random 32-byte content key and once to encrypt the media with task-binding AAD. Reject malformed DER/base64url/key/nonce/tag fields before decryption.

- [ ] **Step 4: Run the envelope test and agent suite**

Run: `node shared/encryptedNasRelay.test.js; npm --prefix storage-agent test`

- [ ] **Step 5: Commit the focused cryptographic base**

```bash
git add shared/encryptedNasRelay.js shared/encryptedNasRelay.test.js storage-agent/package.json
git commit -m "automatic release 2026-08-23"
```

### Task 2: Make NAS completion depend on decrypt and immutable write

**Files:**
- Modify: `storage-agent/src/worker.js`
- Modify: `storage-agent/src/worker.test.js`
- Modify: `storage-agent/src/cloudClient.js`
- Modify: `storage-agent/src/cloudClient.test.js`

- [ ] **Step 1: Write failing worker behavior tests**

```js
const result = await worker.runOnce();
assert.deepStrictEqual(result, { state: 'verified', taskId: 'task_12345678' });
assert.deepStrictEqual(events, ['lease', 'download', 'putVerified', 'complete']);
```

Add a second row whose ciphertext hash or encrypted binding is changed. Assert `putVerified` and `complete` are never called.

- [ ] **Step 2: Run worker test and confirm the old blocked result fails the new expectation**

Run: `node storage-agent/src/worker.test.js`

- [ ] **Step 3: Add the minimal leased download interface and worker integration**

Extend the cloud client with `download(task)` that accepts only the exact relay response. The worker must call `download`, decrypt using the local agent private key, invoke `putVerified` with `{ objectId, version: objectVersion, sha256: expectedSha256, bytes: expectedBytes }`, then call `complete`. Any download/decrypt/hash/write error must escape without a receipt.

- [ ] **Step 4: Run worker/client/object-store tests**

Run: `npm --prefix storage-agent test`

- [ ] **Step 5: Commit the NAS receive path**

```bash
git add storage-agent/src/worker.js storage-agent/src/worker.test.js storage-agent/src/cloudClient.js storage-agent/src/cloudClient.test.js
git commit -m "automatic release 2026-08-23"
```

### Task 3: Add cloud relay persistence only with a cloud question-asset command

**Files:**
- Create: `cloud-business-api/sql/20260823-encrypted-storage-relay.sql`
- Create: `cloud-business-api/src/encryptedStorageRelayRepository.js`
- Create: `cloud-business-api/src/encryptedStorageRelayRepository.test.js`
- Modify: `cloud-business-api/src/storageTaskRepository.js`
- Modify: `cloud-business-api/src/storageAgentService.js`
- Modify: `cloud-business-api/src/app.js`

- [ ] **Step 1: First migrate question text/asset metadata ownership to the cloud, then write repository failure tests**

The test fixture must create a cloud-owned question asset metadata row, attach an opaque encrypted relay payload to its storage task, lease it, and assert that completion deletes payload rows in the same transaction. Do not accept raw filesystem paths, plaintext bytes or a local SQLite question id.

- [ ] **Step 2: Verify the tests fail before adding the repository**

Run: `npm --prefix cloud-business-api test`

- [ ] **Step 3: Implement expiry, leased download and transactional deletion**

The relay table stores only envelope fields/ciphertext chunks/expiry. Lease output includes opaque relay data only for the correct agent and current lease. Completion atomically writes the immutable receipt and deletes every relay chunk. A cleanup statement deletes expired, retry-abandoned and quarantined payload rows.

- [ ] **Step 4: Run cloud and storage integration tests**

Run: `npm --prefix cloud-business-api test; npm --prefix storage-agent test`

- [ ] **Step 5: Back up, deploy and verify only after Task 3 is complete**

Create cloud database/code backups, deploy the version, confirm health and test invalid agent access plus an approved encrypted transfer. Do not declare NAS media delivery complete before an actual configured NAS agent produces its receipt.
