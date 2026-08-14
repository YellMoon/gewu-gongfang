# vNext Single-Owner Bootstrap and Emergency-Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add isolated V5 contracts that bootstrap the sole authority once from a deployment-bound installation proof and later perform an explicitly authorized owner recovery without changing business data.

**Architecture:** V5 adds an immutable bootstrap marker and receipt-bound trust-root evidence to the injected SQLite reference kernel. A private WeakMap assertion boundary feeds a one-time bootstrap writer and an event-bound recovery writer. All tests use synthetic `:memory:` SQLite; no component has a path, environment fallback, runtime route, token issuer, network client, deployment operation, source-data reader, or NAS/removable-storage access.

**Tech Stack:** Node.js CommonJS, `better-sqlite3`, `node:crypto`, `node:util`, Node built-in test runner.

---

## Files

- Modify: `shared/vNextControlPlaneReferenceKernel.js` and `.test.js` for V5 exact DDL and drift tests.
- Create: `shared/vNextTrustRootVerifierBoundaryReference.{js,test.js}` for opaque bootstrap/recovery assertions.
- Create: `shared/vNextFirstAuthorityBootstrapReference.{js,test.js}` for the empty-control-plane transaction.
- Create: `shared/vNextEmergencyRecoveryReference.{js,test.js}` for recovery of an existing authority.
- Modify: `package.json`, `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`, and the approved recovery design.

## Frozen version matrix

| Operation | Created rows | Changed rows | Version result |
|---|---|---|---|
| Bootstrap | authority, account, device, installation, link, role grant, receipt, evidence, policy publication, audit, outbox, marker | none | every created version is `1`; policy revision `1`; no session |
| Recovery | new account/device/installation/link, replacement grant, receipt, evidence, audit, outbox | every active old super-admin grant, each distinct old-admin account, every active session | old grant version/row +1; each old-admin account auth/access/revocation/row +1 once; each session row +1; new versions `1` |

Recovery always creates new replacement account/device/installation/link IDs supplied by the trusted assertion. It preserves old accounts, ordinary grants, profile bindings, scopes, business rows, questions, assets, and authority identity. The final state has exactly one active `super_admin`, on the replacement account.

### Task 1: V5 kernel contract

**Files:**

- Modify: `shared/vNextControlPlaneReferenceKernel.js:1-161`
- Modify: `shared/vNextControlPlaneReferenceKernel.test.js`

- [ ] **Step 1: Add red V5 tests**

Add `:memory:` tests requiring schema version `5`, zero rows in both V5 tables, V4 DB fail-close, invalid/duplicate marker rejection, invalid evidence backup shape rejection, marker/evidence update/delete rejection, foreign-named trigger drift, and injected DDL rollback.

```js
assert.equal(db.prepare("SELECT schema_version FROM vNext_schema_meta").get().schema_version, 5);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM vNext_bootstrap_consumptions").get().n, 0);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM vNext_trust_root_evidence").get().n, 0);
assert.throws(() => bootstrapVNextControlPlaneReference(v4Db), error => error.code === 'VNEXT_REFERENCE_SCHEMA_DRIFT');
```

- [ ] **Step 2: Confirm the test fails before implementation**

Run: `node shared/vNextControlPlaneReferenceKernel.test.js`

Expected: V4 lacks the new tables and V5 version.

- [ ] **Step 3: Implement exact V5 DDL**

Change every V4 schema/meta assertion to `5`. Add both tables to statements, table inventory, required columns, and exact trigger inventory:

```sql
CREATE TABLE vNext_bootstrap_consumptions (
  marker_key PRIMARY KEY CHECK(marker_key='single-authority-bootstrap'),
  bootstrap_intent_id UNIQUE NOT NULL,
  authority_id UNIQUE NOT NULL,
  installation_key_fingerprint SHA256 NOT NULL,
  policy_manifest_sha256 SHA256 NOT NULL,
  receipt_id UNIQUE NOT NULL,
  consumed_at VALID_INSTANT NOT NULL
);
CREATE TABLE vNext_trust_root_evidence (
  evidence_id PRIMARY KEY, authority_id NOT NULL, receipt_id NOT NULL,
  actor_kind CHECK(actor_kind IN ('deployment_bootstrap','owner_recovery_event')),
  event_id NOT NULL, assertion_evidence_sha256 SHA256 NOT NULL,
  backup_id NULL, backup_manifest_sha256 SHA256 NULL, created_at VALID_INSTANT NOT NULL,
  UNIQUE(authority_id,receipt_id), UNIQUE(actor_kind,event_id),
  CHECK((actor_kind='deployment_bootstrap' AND backup_id IS NULL AND backup_manifest_sha256 IS NULL)
     OR (actor_kind='owner_recovery_event' AND backup_id IS NOT NULL AND backup_manifest_sha256 IS NOT NULL))
);
```

Use existing `id`, `NONEMPTY`, `SHA256`, and `time` helpers in real DDL. Add update/delete abort triggers plus exact insert guards: a marker must reference an accepted null-actor `authority.bootstrap` receipt with `actor_key='bootstrap:'+intent`, authority target, expected/committed `0/1`, and the exact seven-key bootstrap result; bootstrap evidence must match that marker; recovery evidence must reference an accepted null-actor `authority.owner_recover` receipt with `actor_key='recovery:'+event`, authority target, null aggregate versions, an exact recovery result, and mandatory backup fields. The marker intentionally has no FK and therefore still blocks bootstrap if authority rows are damaged. Public schema assertion remains read-only.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
node shared/vNextControlPlaneReferenceKernel.test.js
npm run test:vnext-migration
git diff --check
git add -- shared/vNextControlPlaneReferenceKernel.js shared/vNextControlPlaneReferenceKernel.test.js
git commit -m "auto-publish 2026-08-14"
```

Expected: all tests pass; V4 fails before DDL; no user `output/` directory is staged.

### Task 2: V5 dual audit

- [ ] **Step 1: Request 5.6-sol necessity and quality gates**

Require: marker/evidence is the minimal predecessor; exact SQL/triggers fail-close; V4 fails before DDL; no seed; marker persistence; evidence backup shape; assertion read-only; no runtime/file/network import.

- [ ] **Step 2: Repair findings through red tests**

For each finding, add a regression test and run the kernel test red. Apply the smallest repair, then run focused kernel, `npm run test:vnext-migration`, and `git diff --check`.

- [ ] **Step 3: Commit and push audited schema**

Run:

```powershell
git add -- shared/vNextControlPlaneReferenceKernel.js shared/vNextControlPlaneReferenceKernel.test.js
git commit -m "auto-publish 2026-08-14"
git push gewu master
```

### Task 3: Trust-root verifier boundary

**Files:**

- Create: `shared/vNextTrustRootVerifierBoundaryReference.js`
- Create: `shared/vNextTrustRootVerifierBoundaryReference.test.js`
- Modify: `package.json:16`

- [ ] **Step 1: Write red boundary tests**

Require exact verifier results:

```js
{ kind: 'deployment_bootstrap', bootstrapIntentId, authorityId, accountId, deviceId,
  installationId, installationPublicKey, installationKeyFingerprint,
  policyManifestSha256, expiresAt, approvalVersion, assertionEvidenceSha256 }
{ kind: 'owner_recovery_event', recoveryEventId, authorityId, replacementAccountId,
  replacementDeviceId, replacementInstallationId, replacementInstallationPublicKey,
  replacementInstallationKeyFingerprint, backupId, backupManifestSha256,
  reasonCode, expiresAt, approvalVersion, assertionEvidenceSha256 }
```

The exact factory input is `{ databaseBinding, verifyBootstrapPresentation, verifyRecoveryPresentation, now }`: `databaseBinding` is compared only by object identity and is never read or called. Reject fake/spread/JSON/cross-boundary/wrong-kind assertions, proxy/accessor/symbol/non-enumerable outputs, invalid IDs/hashes/dates/kinds, approval version other than integer `1`, expiry at or before `now`, expiry more than five minutes ahead, and verifier/clock errors without leaking source messages. Test native Promise success, reject thenables, assert deep snapshots/freeze/no raw presentation return, cross-binding rejection, repeat unwrap stability, and a verifier result mutated after return.

- [ ] **Step 2: Confirm red test**

Run: `node shared/vNextTrustRootVerifierBoundaryReference.test.js`

Expected: module-not-found.

- [ ] **Step 3: Implement closure-private assertions**

Follow the trusted-session boundary pattern:

```js
const boundaryBrand = new WeakMap();
const assertions = new WeakMap();
function createVNextTrustRootVerifierBoundaryReference(config) { return createExactBoundary(config); }
function verifyBootstrap(presentation) { return issue('deployment_bootstrap', presentation); }
function verifyRecovery(presentation) { return issue('owner_recovery_event', presentation); }
function unwrap(assertion, expectedKind) { return requireMatchingAssertion(assertions, assertion, expectedKind); }
```

Also export an identity-only `isVNextTrustRootVerifierBoundaryReferenceForDatabase(boundary, databaseBinding)` for writers. Use own-data-descriptor snapshots, `types.isProxy`, `Reflect.ownKeys`, strict ID/SHA-256/canonical-instant validation, a single clock read, and map verifier/parsing failures to `VNEXT_TRUST_ROOT_PRESENTATION_REJECTED`. The boundary does not create keys/nonces/signatures, inspect a database, consume an assertion, or implement nonce/command replay; deployment verifier and future writers respectively own those responsibilities.

- [ ] **Step 4: Register, verify, commit**

Add this test after the existing trusted-session boundary test, then run:

```powershell
node shared/vNextTrustRootVerifierBoundaryReference.test.js
npm run test:vnext-migration
git add -- shared/vNextTrustRootVerifierBoundaryReference.js shared/vNextTrustRootVerifierBoundaryReference.test.js package.json
git commit -m "auto-publish 2026-08-14"
```

### Task 4: First-authority bootstrap writer

**Files:**

- Create: `shared/vNextFirstAuthorityBootstrapReference.js`
- Create: `shared/vNextFirstAuthorityBootstrapReference.test.js`
- Modify: `package.json:16`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [ ] **Step 1: Write red bootstrap tests**

Use only `:memory:` V5 fixtures and a branded synthetic assertion. Command shape:

```js
{ type: 'authority.bootstrap', bootstrapIntentId, authorityId, accountId, deviceId,
  installationId, installationPublicKey, installationKeyFingerprint,
  policyManifest, idempotencyKey, reasonCode }
```

Test: all expected rows exactly once; policy hash equals assertion; no session/catalog seed; command-binding mismatch; existing authority or marker; replay and changed key; expired/wrong-bound/cross-db/fake assertion; every write hook leaves zero partial rows.

- [ ] **Step 2: Confirm red test**

Run: `node shared/vNextFirstAuthorityBootstrapReference.test.js`

Expected: module-not-found.

- [ ] **Step 3: Implement one atomic writer**

`createVNextFirstAuthorityBootstrapReference({ db, verifier, now, idFactory, testHooks })` requires exact own-data config, V5 schema, ISO clock, and branded verifier. Before the writer test can go green, extend the policy-publication trigger with one exact branch requiring accepted `AUTHORITY_BOOTSTRAPPED`, command `authority.bootstrap`, authority target, expected version `0`, committed target version `1`, null account versions, and the seven-key result `{ authorityId, code, policyContractVersion: 1, policyManifestSha256, policyRevision: 1, publicationId, status: 'accepted' }`; retain the current policy-writer branch and reject every other bootstrap-like receipt. Then `execute(assertion, command)` unwraps bootstrap assertion; canonicalizes the manifest with `createPolicyManifest`; requires equality of all bound IDs/key/fingerprint/intent and hash; requires zero authorities plus absent marker; creates rows at version `1` with null `granted_by_account_id`; writes receipt with `actor_key='bootstrap:' + bootstrapIntentId` and null actor; writes marker/publication/bootstrap evidence/audit/one `authorization.authority_bootstrapped` outbox; and replay-validates every companion.

Use the Task 1 seven-key result and return only frozen `{ authorityId, code: 'AUTHORITY_BOOTSTRAPPED', replayed, status: 'accepted' }`.

- [ ] **Step 4: Verify, document, commit**

Register test after trust-root test. Add dated reference-only evidence to the control-plane plan: not a server deployment, real initialization, credential issuer, or cloud migration. Run focused test, full suite, diff check, then stage only task files and commit.

### Task 5: Bootstrap audit and recovery precondition

- [ ] **Step 1: Request 5.6-sol bootstrap dual gate**

Necessary: no production verifier, secret, token, route, server path, or migration. Quality: opaque proof only, marker cannot reopen, trigger exactness, companion/replay and rollback tests are real.

- [ ] **Step 2: Repair by TDD**

For each finding, add a narrow red test, repair, and rerun focused bootstrap, full suite, and diff check.

- [ ] **Step 3: Request recovery necessity gate**

Confirm recovery remains limited to existing authority, new replacement chain, CAS revocation of old super-admin grants and sessions, business preservation, and no server operation.

### Task 6: Emergency recovery writer

**Files:**

- Modify: `docs/superpowers/specs/2026-08-14-vnext-single-owner-bootstrap-and-emergency-recovery-design.md`
- Create: `shared/vNextEmergencyRecoveryReference.js`
- Create: `shared/vNextEmergencyRecoveryReference.test.js`
- Modify: `package.json:16`

- [ ] **Step 1: Freeze replacement records**

Replace every `create or bind` phrase with: “Recovery always creates a new replacement account, trusted device, installation, and account-device link identified by the trusted assertion. It never binds an existing account or device.”

- [ ] **Step 2: Write red recovery tests**

From synthetic bootstrapped authority, create two old super-admin grants, ordinary role/profile/scope rows, two active sessions, and unrelated business-like row. Command:

```js
{ type: 'authority.owner_recover', recoveryEventId, authorityId,
  replacementAccountId, replacementDeviceId, replacementInstallationId,
  replacementInstallationPublicKey, replacementInstallationKeyFingerprint,
  backupId, backupManifestSha256, reasonCode, idempotencyKey }
```

Assert: exactly one replacement super-admin even when the captured old-super-admin set is empty; old grants/sessions revoked when present; distinct old-admin accounts bump once; ordinary/profile/scope/business rows byte-identical; one backup-bound evidence/receipt/audit/outbox; fake/cross-db/expired/wrong-bound assertion and changed backup reject; event/key replay rules; every write hook rollback; companion tampering rejects replay.

- [ ] **Step 3: Confirm red test**

Run: `node shared/vNextEmergencyRecoveryReference.test.js`

Expected: module-not-found.

- [ ] **Step 4: Implement one atomic recovery writer**

`createVNextEmergencyRecoveryReference({ db, verifier, now, idFactory, testHooks })` requires V5 schema and branded recovery assertion. Require command/assertion equality for authority, replacement IDs/key/fingerprint, event, backup ID/hash, reason, and expiry. Use `actor_key='recovery:' + recoveryEventId`, never replacement account.

Sort/capture the zero-or-more active old super-admin grants and sessions. Create a replacement chain at version `1`; CAS-revoke every captured grant; bump each distinct old-admin account once; CAS-revoke every captured session; add one new grant at version `1`; assert final active-super-admin count `1` on the replacement account. A zero-grant capture is a valid lockout-recovery case, not a rejection. Write `OWNER_RECOVERY_COMPLETED` receipt, backup-bound evidence, audit, and one `authorization.owner_recovered` outbox with only authority/replacement IDs, event hash, and revoked-ID count/hash. Replay validates every companion and final invariant. Return only frozen `{ authorityId, code, replacementAccountId, replayed, status }`.

- [ ] **Step 5: Register, verify, commit**

Run focused recovery, full suite, and diff check; stage only recovery design/reference/test/package files; commit.

### Task 7: Final dual audit and publication

- [ ] **Step 1: Run pre-review verification**

```powershell
node shared/vNextControlPlaneReferenceKernel.test.js
node shared/vNextTrustRootVerifierBoundaryReference.test.js
node shared/vNextFirstAuthorityBootstrapReference.test.js
node shared/vNextEmergencyRecoveryReference.test.js
npm run test:vnext-migration
git diff --check
git status --short
```

Expected: all focused and full tests pass; diff check is empty; user `output/` directories are preserved and untracked.

- [ ] **Step 2: Request final 5.6-sol dual gate**

Necessary: no real server recovery, UI/API, token, storage access, deployment, or business migration. Quality: exact bootstrap closure, replay companions, CAS/version matrix, preservation, and rollback checks resist false-positive helpers.

- [ ] **Step 3: Repair findings and repeat verification**

For every finding, add a targeted red test first, repair minimally, rerun Step 1, then repeat quality review until PASS.

- [ ] **Step 4: Commit and push audited files**

Stage only the kernel, three reference modules/tests, package, updated specification, and two plan files. Commit with the repository date convention and push `gewu/master`. Do not build Electron or publish OSS: these are reference-only contracts. Do not connect to a server or execute recovery; that requires later event-specific owner authorization.
