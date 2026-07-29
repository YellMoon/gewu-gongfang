# Authority Architecture Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy desktop identity and sync paths with one host-authoritative command protocol, two-phase device activation, and a rehearsed migration cutover.

**Architecture:** The cloud is a control plane, the data host is the only canonical business writer, and desktop/miniapp are scoped projection plus explicit-outbox clients. LAN, relay WebSocket, and durable relay carry the identical signed command envelope and return the identical receipt. A device is active only after Electron has sealed its local vault and finalized a device-key receipt.

**Tech Stack:** Electron, React, Node.js CommonJS/ESM, Express, SQLite/better-sqlite3, WebSocket, Taro miniapp, packaged Electron UI checks.

---

## File map

- `shared/authorityProtocol.js`: canonical protocol name, envelope validation, stable hashing, receipt shape, and activation signing payloads used by host, cloud, and Electron.
- `shared/authorityProtocol.test.js`: protocol validation and cross-runtime deterministic-hash tests.
- `backend/src/schema.sql`: additive activation, command, receipt, projection, role, and migration-ledger schema.
- `backend/src/services/deviceActivationService.js`: pending/exchange/finalize/resume state machine; no active transition in exchange.
- `backend/src/services/desktopIdentityService.js`: narrow identity challenge ownership and delegate activation state transitions.
- `backend/src/services/authorityCommandService.js`: execute an accepted protocol envelope exactly once in a host transaction.
- `backend/src/services/hostCommandWorker.js`: independent durable command claim/renew/recovery lifecycle.
- `backend/src/routes/authorityProtocol.js`: one cloud/host protocol route family; no raw record mutation endpoints.
- `backend/src/routes/cloudRelay.js`, `backend/src/routes/cloudRelayHost.js`: adapters into the protocol route and worker only.
- `public/managedControlPlaneRequest.js`, `public/electron.js`, `public/preload.js`: a single restricted Electron identity/command bridge.
- `src/services/desktopAuthorityClient.mjs`: renderer-side facade; no mixed identity or sync transport calls.
- `src/services/desktopCommandOutbox.mjs`: encrypted local typed command outbox and receipt acknowledgement.
- `src/services/authorityTransports.mjs`: LAN WebSocket, relay WebSocket, and durable-relay adapters for the same envelope.
- `backend/src/services/authorityProjectionService.js`: host-side role-scoped projection rules.
- `backend/src/services/authorityMigrationService.js`: copy-only migration/parity rehearsal.
- `scripts/runtime-architecture-rehearsal.js`: disposable database migration report.
- `scripts/real-two-desktop-e2e.js`: isolated packaged host/client UI matrix for LAN, relay, restart, and receipt recovery.

### Task 1: Establish one shared authority protocol

**Files:**
- Create: `shared/authorityProtocol.js`
- Create: `shared/authorityProtocol.test.js`
- Modify: `backend/src/services/authorityCommandService.js`
- Modify: `backend/src/services/authorityCommandService.test.js`

- [ ] **Step 1: Write failing cross-runtime protocol tests**

```js
const { validateEnvelope, stableJson, PROTOCOL } = require('./authorityProtocol');
const envelope = {
  protocol: PROTOCOL, commandId: 'c1', idempotencyKey: 'k1',
  authorityId: 'a1', hostEpochId: 'e1',
  actor: { userId: 'u1', deviceId: 'd1', role: 'teacher' },
  lease: { id: 'l1', grantVersion: 3 }, type: 'schedule.update.v1', payload: { id: 's1' }
};
assert.equal(validateEnvelope(envelope).type, 'schedule.update.v1');
assert.equal(stableJson({ b: 1, a: 2 }), stableJson({ a: 2, b: 1 }));
assert.throws(() => validateEnvelope({ ...envelope, protocol: 'legacy' }), /AUTHORITY_PROTOCOL_INVALID/);
```

- [ ] **Step 2: Run RED**

Run: `node shared/authorityProtocol.test.js`

Expected: `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement protocol constants, validation, and stable receipt type**

```js
const PROTOCOL = 'gewu.authority-command.v1';
function validateEnvelope(input = {}) {
  if (input.protocol !== PROTOCOL) throw protocolError('AUTHORITY_PROTOCOL_INVALID');
  if (!input.commandId || !input.idempotencyKey || !input.authorityId || !input.hostEpochId) {
    throw protocolError('AUTHORITY_ENVELOPE_INVALID');
  }
  if (!input.actor?.userId || !input.actor?.deviceId || !input.lease?.id) {
    throw protocolError('AUTHORITY_ACTOR_OR_LEASE_REQUIRED');
  }
  if (!/^[a-z][a-z0-9_.-]*\.v[1-9][0-9]*$/.test(String(input.type || ''))) {
    throw protocolError('AUTHORITY_COMMAND_TYPE_INVALID');
  }
  return Object.freeze({ ...input, payload: input.payload && typeof input.payload === 'object' ? input.payload : {} });
}
```

- [ ] **Step 4: Make command service consume the shared validated envelope**

Replace its private envelope parser with `validateEnvelope`; preserve the unique `(actor_user_id, device_id, idempotency_key)` receipt replay transaction.

- [ ] **Step 5: Verify GREEN**

Run: `node shared/authorityProtocol.test.js; node backend/src/services/authorityCommandService.test.js`

Expected: both pass and an envelope from a second require path has the same payload hash.

### Task 2: Replace one-step authorization exchange with two-phase device activation

**Files:**
- Create: `backend/src/services/deviceActivationService.js`
- Create: `backend/src/services/deviceActivationService.test.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/services/desktopIdentityService.js`
- Modify: `backend/src/services/desktopIdentityService.test.js`
- Modify: `backend/src/routes/desktopIdentity.js`
- Modify: `src/services/desktopIdentityClient.mjs`
- Modify: `src/services/desktopIdentityClient.test.js`
- Modify: `public/electron.js`
- Modify: `public/desktopIdentityVault.js`

- [ ] **Step 1: Write failing activation-order tests**

```js
const exchanged = service.exchange({ challengeId: 'c1', proof: validProof });
assert.equal(exchanged.activation.status, 'activation_pending');
assert.equal(findAuthorization('d1').status, 'pending');
assert.throws(() => issueLease('d1'), /DEVICE_ACTIVATION_REQUIRED/);
vault.commit(exchanged.package);
const active = service.finalize({ activationId: exchanged.activation.id, receipt: vaultReceipt });
assert.equal(active.authorization.status, 'active');
assert.equal(service.resume({ activationId: exchanged.activation.id, receipt: vaultReceipt }).replayed, true);
```

- [ ] **Step 2: Run RED**

Run: `node backend/src/services/deviceActivationService.test.js; node backend/src/services/desktopIdentityService.test.js`

Expected: missing service and current exchange test observes `active` too early.

- [ ] **Step 3: Add additive activation records and state machine**

```sql
CREATE TABLE IF NOT EXISTS desktop_device_activations (
  id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL UNIQUE, authorization_id TEXT NOT NULL,
  package_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('activation_pending','active','expired','cancelled')),
  expires_at TEXT NOT NULL, finalized_at TEXT, receipt_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

`exchange` validates challenge/device proof, creates `activation_pending`, and returns the complete sealed-vault package. `finalize` verifies a device-key signature over the package hash, atomically records the receipt, activates the authorization, and issues the lease. `resume` returns the original package only while pending and verifies/replays the same receipt only after finalization.

- [ ] **Step 4: Restrict Electron flow to validate → seal → finalize**

Make Electron main-process IPC reject an incomplete package before vault mutation. Persist a pending activation marker only after the vault is sealed; then call finalize. On startup retry `resume` with the signed receipt. The renderer receives only stable error codes and never an activation package, private key, password, or raw cloud response.

- [ ] **Step 5: Remove active transition from legacy exchange**

Delete the `desktop_device_authorizations.status='active'` update from `exchangeChallenge`. Make legacy exchange route return `DESKTOP_ACTIVATION_PROTOCOL_REQUIRED` once the new route has cut over.

- [ ] **Step 6: Verify GREEN and crash recovery**

Run: `node backend/src/services/deviceActivationService.test.js; node backend/src/services/desktopIdentityService.test.js; node src/services/desktopIdentityClient.test.js; node public/desktopIdentityVault.test.js; node public/electronRuntimeContracts.test.js`

Expected: no device reaches active before finalize; repeated finalize/resume writes one receipt; a simulated crash after vault seal can recover without a second approval.

### Task 3: Route every host mutation through durable command and receipt handling

**Files:**
- Modify: `backend/src/services/authorityCommandService.js`
- Modify: `backend/src/services/hostCommandWorker.js`
- Modify: `backend/src/routes/cloudRelay.js`
- Modify: `backend/src/routes/cloudRelayHost.js`
- Create: `backend/src/routes/authorityProtocol.js`
- Create: `backend/src/routes/authorityProtocol.http.test.js`
- Modify: `backend/src/websocket/hostTaskWakeup.js`

- [ ] **Step 1: Write failing direct/relay equivalence tests**

```js
const direct = await submitLan(envelope);
const relay = await submitDurableRelay({ ...envelope, commandId: 'c2', idempotencyKey: 'k2' });
assert.deepStrictEqual(stripTransport(direct.receipt), stripTransport(relay.receipt));
assert.equal(await worker.processOnce(), 1);
```

- [ ] **Step 2: Run RED**

Run: `node backend/src/routes/authorityProtocol.http.test.js; node backend/src/services/hostCommandWorker.test.js`

Expected: current direct sync accepts raw changes or the route is missing.

- [ ] **Step 3: Implement protocol route family and lease/scope gate**

```js
router.post('/commands', requireActiveLease, requireAuthorityScope, async (req, res) => {
  const command = validateEnvelope(req.body);
  const queued = await commandInbox.enqueue(command);
  res.status(202).json({ success: true, command: queued });
});
router.get('/commands/:id/receipt', requireCommandOwner, async (req, res) => {
  res.json({ success: true, receipt: await receiptStore.find(req.params.id) });
});
```

The LAN host adapter calls the same command executor; the relay stores the envelope unchanged. The worker claims envelopes, validates lease/scope again, executes once, and publishes the same receipt.

- [ ] **Step 4: Make WebSocket wake-only**

Keep WebSocket messages to `worker.wake()` and receipt/projection notifications. Do not execute HTTP tasks or domain mutations from a socket callback. Polling must reclaim expired claims.

- [ ] **Step 5: Verify GREEN without WebSocket**

Run: `node backend/src/routes/authorityProtocol.http.test.js; node backend/src/services/hostCommandWorker.test.js; node backend/src/websocket/hostTaskWakeup.test.js; node backend/src/routes/cloudRelayHostCycle.test.js`

Expected: the worker commits exactly once with WebSocket disabled, then returns the persisted receipt after a simulated restart.

### Task 4: Replace desktop transport branching with one facade and outbox

**Files:**
- Create: `src/services/desktopCommandOutbox.mjs`
- Create: `src/services/desktopCommandOutbox.test.js`
- Create: `src/services/desktopAuthorityClient.mjs`
- Create: `src/services/desktopAuthorityClient.test.js`
- Create: `src/services/authorityTransports.mjs`
- Create: `src/services/authorityTransports.test.js`
- Modify: `src/services/oneClickSyncService.mjs`
- Modify: `src/services/oneClickSyncTransports.mjs`
- Modify: `src/services/desktopSessionRelayClient.mjs`
- Modify: `src/pages/CloudSync.tsx`
- Modify: `src/pages/SyncSettings.tsx`

- [ ] **Step 1: Write failing selection and consent tests**

```js
const queued = await outbox.append(draft('schedule.update.v1'));
assert.equal(queued.status, 'awaiting_confirmation');
assert.equal(await client.submit(queued.id), undefined);
const receipt = await client.confirmAndSubmit(queued.id);
assert.equal(receipt.command.type, 'schedule.update.v1');
assert.equal(transports.used, 'lan');
```

- [ ] **Step 2: Run RED**

Run: `node src/services/desktopCommandOutbox.test.js; node src/services/authorityTransports.test.js; node src/services/desktopAuthorityClient.test.js`

Expected: missing modules and current sync path sends raw `changes`.

- [ ] **Step 3: Implement encrypted outbox and transport adapters**

```js
const candidates = [lanTransport, relayWebSocketTransport, durableRelayTransport];
for (const transport of candidates) {
  if (await transport.isReady(envelope)) return transport.submit(envelope);
}
throw authorityClientError('HOST_TRANSPORT_UNAVAILABLE');
```

All adapters submit the shared envelope. They may differ only in reachability and delivery mechanics. Receipt acknowledgement marks the same outbox item complete; conflicting receipts preserve the item and show a stable conflict state.

- [ ] **Step 4: Delete session relay as a normal login/sync dependency**

`desktopSessionRelayClient` becomes a migration-only rejection adapter. Normal unlock uses the local vault plus cloud lease; command submission uses `desktopAuthorityClient` only. Remove raw `/api/sync` calls from the React sync views.

- [ ] **Step 5: Verify GREEN**

Run: `node src/services/desktopCommandOutbox.test.js; node src/services/authorityTransports.test.js; node src/services/desktopAuthorityClient.test.js; node src/services/oneClickSyncService.test.js; node src/pages/SyncSettingsAuthorization.test.js`

Expected: a pending offline edit cannot submit without confirmation; LAN, relay WebSocket, and durable relay yield a uniform receipt.

### Task 5: Complete user subject, roles, profiles, projections, and assets

**Files:**
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/services/authorityAccessService.js`
- Modify: `backend/src/services/authorityProjectionService.js`
- Modify: `backend/src/services/authorizationPolicy.js`
- Create: `backend/src/services/roleApplicationService.js`
- Create: `backend/src/services/roleApplicationService.test.js`
- Create: `backend/src/services/personalAssetAccountService.js`
- Create: `backend/src/services/personalAssetAccountService.test.js`
- Modify: `backend/src/routes/miniappApplications.js`
- Modify: `miniapp/src/pages/login/index.tsx`
- Modify: `miniapp/src/pages/my/index.tsx`
- Modify: `src/pages/IdentityDeviceCenter.tsx`

- [ ] **Step 1: Write failing role and projection tests**

```js
assert.deepStrictEqual(resolveActingScope({ userId: 'u1', actingRole: 'visitor' }), { kind: 'visitor', userId: 'u1' });
assert.equal(project(studentScope, fixture).lessonPay, undefined);
assert.equal(project(visitorScope, fixture).questionPreviews.length, 10);
assert.throws(() => applications.submit({ role: 'admin' }), /ROLE_APPLICATION_FORBIDDEN/);
assert.equal(assets.list({ userId: 'u1' }).every(row => row.userId === 'u1'), true);
```

- [ ] **Step 2: Run RED**

Run: `node backend/src/services/authorityProjectionService.test.js; node backend/src/services/roleApplicationService.test.js; node backend/src/services/personalAssetAccountService.test.js`

Expected: missing application/asset services and legacy role fields are still used as authority inputs.

- [ ] **Step 3: Implement additive grants, optional bindings, and asset ownership**

Add roles as `user_roles`, optional teacher/student business bindings, reviewable teacher/student applications, and user-owned asset accounts. Super admin alone approves requests; administrator is host-reviewed only. Keep old scalar role fields read-only until parity migration passes.

- [ ] **Step 4: Implement server-side projections and miniapp visitor registration**

Manual phone entry creates an account with visitor scope. The My page submits a role application. Host review produces a signed grant mirror. Projection endpoints omit forbidden course, peer, finance, and card details before data reaches either UI.

- [ ] **Step 5: Verify GREEN across roles and clients**

Run: `node backend/src/services/authorityAccessService.test.js; node backend/src/services/authorityProjectionService.test.js; node backend/src/services/roleApplicationService.test.js; node backend/src/services/personalAssetAccountService.test.js; npm --prefix miniapp test -- --runInBand`

Expected: visitor, student, teacher, admin, super admin, combined roles, denied/revoked grants, and account isolation all pass server-side and in both clients.

### Task 6: Rehearse migration, cut over, and delete legacy paths

**Files:**
- Create: `backend/src/services/authorityMigrationService.js`
- Create: `backend/src/services/authorityMigrationService.test.js`
- Modify: `scripts/runtime-architecture-rehearsal.js`
- Modify: `scripts/desktop-architecture-cutover.test.js`
- Modify: `backend/src/routes/cloudRelay.js`
- Modify: `backend/src/routes/desktopIdentity.js`
- Delete after cutover: `src/services/desktopSessionRelayClient.mjs`
- Delete after cutover: `src/services/oneClickSyncTransports.mjs`
- Delete after cutover: legacy raw-sync and single-user pairing tests/routes identified by the cutover inventory

- [ ] **Step 1: Write failing copy-only rehearsal tests**

```js
const report = await rehearse({ sourceDb: fixtureDb, copyDb: disposableDb });
assert.equal(report.sourceFingerprintBefore, report.sourceFingerprintAfter);
assert.equal(report.parityFailures.length, 0);
assert.equal(report.legacyRoutesSafeToRemove, true);
```

- [ ] **Step 2: Run RED**

Run: `node backend/src/services/authorityMigrationService.test.js; node scripts/runtime-architecture-rehearsal.js --self-test`

Expected: migration/rehearsal cannot yet produce a complete ledger and parity report.

- [ ] **Step 3: Implement copy-only rehearsal and explicit cutover marker**

Copy the selected database, apply additive schema, build source-audited grants and bindings, compare legacy and new scopes, replay command fixtures, and write a report with source/copy fingerprints. The script must reject the authority database as its copy target. Only a passing report can write `authority_protocol_v1_cutover` to the migration ledger.

- [ ] **Step 4: Gate and remove legacy behavior**

Before the marker, legacy routes only serve migration reads and never mutate. After the marker, old direct sync, desktop-session relay, long-poll command processing, and single-user pairing return terminal `AUTHORITY_PROTOCOL_MIGRATED`; delete their implementation and tests in the same change.

- [ ] **Step 5: Verify migration and absence of legacy authority decisions**

Run: `node backend/src/services/authorityMigrationService.test.js; node scripts/runtime-architecture-rehearsal.js --self-test; node scripts/desktop-architecture-cutover.test.js; rg -n "singleUser|desktop-session|/api/sync|user\.role" backend src public miniapp`

Expected: rehearsal leaves source unchanged; any remaining legacy hit is confined to explicit migration reporting and not an authorization or command path.

### Task 7: Run the real isolated two-desktop matrix and release only after it is green

**Files:**
- Modify: `scripts/real-two-desktop-e2e.js`
- Modify: `scripts/realTwoDesktopE2e.test.js`
- Modify: `scripts/isolated-desktop-identity-cloud.js`
- Modify: `task.md`

- [ ] **Step 1: Write matrix assertions**

```js
assert.equal(results.identity.activationFinalized, true);
assert.equal(results.lan.forward.receiptVerified, true);
assert.equal(results.lan.reverse.receiptVerified, true);
assert.equal(results.relay.forward.receiptVerified, true);
assert.equal(results.relay.reverse.receiptVerified, true);
assert.equal(results.websocketDisabled.durableWorkerProcessed, true);
assert.equal(results.restart.pendingActivationRecovered, true);
assert.equal(results.authorityDataTouched, false);
```

- [ ] **Step 2: Run RED**

Run: `node scripts/realTwoDesktopE2e.test.js`

Expected: current test has no finalization and uniform-receipt assertions.

- [ ] **Step 3: Implement a disposable, UI-driven matrix**

Launch an isolated packaged primary-host app and an isolated packaged ordinary app. Use UI actions for host activation, ordinary registration, host approval, local-password completion, and explicit sync confirmation. The test harness may automate the disposable phone verification but must not use a cloud endpoint to approve the desktop device or submit a host mutation directly.

- [ ] **Step 4: Execute local, cloud-relay, restart, and failure paths**

Run: `node scripts/real-two-desktop-e2e.js --lan --cloud-relay --restart --websocket-disabled --no-authority-data`

Expected: both transports carry the same envelope; bidirectional command/receipt and scoped projections complete; restart recovers pending activation; host polling succeeds without WebSocket; the authority database fingerprint is unchanged.

- [ ] **Step 5: Full verification and release sequence**

Run focused tests from Tasks 1–7, then `npm test`, `npm run build`, host/ordinary packaged smoke checks, miniapp build/upload verification, cloud backup/deploy/health checks, and OSS feed verification. Only after all matrix entries are green: `git add -A`, commit, push `gewu/master`, run the version bump, `npm run dist:win`, `npm run publish:desktop-update`, restore Node native dependencies, and verify `latest.yml` plus the published artifact.

## Review checklist

- [ ] No cloud, host, Electron main, or renderer path can activate a device before a local-vault receipt finalizes it.
- [ ] No business mutation route accepts raw table changes; every mutation has one protocol envelope and one receipt.
- [ ] LAN, relay WebSocket, and durable relay differ only in delivery, not authorization, payload, idempotency, or receipt semantics.
- [ ] The host remains the only canonical writer and continues processing when Electron UI and WebSocket are unavailable.
- [ ] User subject, grants, optional profiles, personal asset accounts, and projections satisfy the documented role boundaries.
- [ ] Migration is copy-only until its cutover marker, has a rollback gate, and permanently removes legacy authority code after cutover.
- [ ] No deployment, OSS update, or release claim occurs before the isolated two-desktop matrix and all applicable multi-end tests are green.
