# Unified Desktop Online Registration Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one cloud-control-plane command that turns a verified online identity assertion into a silent desktop registration without granting arbitrary table DML.

**Architecture:** Migration 16 introduces immutable online identity assertions and one-time consumption rows. A dedicated identity-verifier role may issue assertions; the writer role may execute exactly one `SECURITY DEFINER` registration function. That function reads the account/device binding from the assertion, atomically creates or reuses the device, installation, account link, receipt, audit event, outbox event and short online session record. The future cloud identity service signs the session token; the database never stores or replays token secrets.

**Tech Stack:** Node.js CommonJS, PostgreSQL 17, `pg`, current disposable runtime, Node `assert`.

---

### Task 1: Freeze the registration input boundary

**Files:**
- Create: `shared/vnext-pg17/unifiedDesktopRegistrationCommand.js`
- Create: `shared/vnext-pg17/unifiedDesktopRegistrationCommand.test.js`

- [ ] **Step 1: Write the failing pure-boundary test**

```js
const { createUnifiedDesktopRegistrationCommand } = require('./unifiedDesktopRegistrationCommand');

assert.throws(
  () => createUnifiedDesktopRegistrationCommand({}),
  error => error && error.code === 'VNEXT_UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID',
);
```

- [ ] **Step 2: Run the test and confirm it fails because the module is absent**

Run: `node shared/vnext-pg17/unifiedDesktopRegistrationCommand.test.js`

Expected: non-zero exit and `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the minimal pure request snapshot**

```js
function registrationRequestSnapshot(value) {
  // Accept only assertionId, idempotencyKey, receiptId, auditEventId,
  // outboxEventId, sessionId and occurredAt. Reject Proxy, accessors,
  // extra keys, blank values and non-UTC finite time.
}

function createUnifiedDesktopRegistrationCommand({ invoke, now }) {
  // Do not accept accountId, authorityId, deviceId, installationId,
  // a verified boolean, token, password, private key or SQL.
}
```

- [ ] **Step 4: Run the pure-boundary test**

Run: `node shared/vnext-pg17/unifiedDesktopRegistrationCommand.test.js`

Expected: exit 0.

### Task 2: Add M16 and closed database capabilities

**Files:**
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Modify: `shared/vnext-pg17/migrationManifest.js`
- Modify: `shared/vnext-pg17/migrationManifest.test.js`

- [ ] **Step 1: Write the failing M16 manifest test**

```js
assert.equal(MIGRATIONS.at(-1).semanticVersion, 16);
assert.match(MIGRATIONS.at(-1).sql, /vnext_online_identity_assertions/);
assert.match(MIGRATIONS.at(-1).sql, /vnext_register_unified_desktop_online/);
assert.match(MIGRATIONS.at(-1).sql, /GRANT EXECUTE ON FUNCTION .*vnext_pg17_writer/);
assert.doesNotMatch(MIGRATIONS.at(-1).sql, /GRANT (INSERT|UPDATE|DELETE) ON TABLE .*vnext_pg17_writer/);
```

- [ ] **Step 2: Run the manifest test and confirm M16 is absent**

Run: `node shared/vnext-pg17/migrationManifest.test.js`

Expected: non-zero exit because the final version is not 16.

- [ ] **Step 3: Implement the minimum M16 SQL and identity-verifier role**

```sql
CREATE TABLE vnext_control_plane.vnext_online_identity_assertions (...);
CREATE TABLE vnext_control_plane.vnext_online_identity_assertion_consumptions (...);
CREATE FUNCTION vnext_control_plane.vnext_issue_online_identity_assertion(...) ...;
CREATE FUNCTION vnext_control_plane.vnext_register_unified_desktop_online(...) ...;
REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_issue_online_identity_assertion(...) TO vnext_pg17_identity_verifier;
GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_register_unified_desktop_online(...) TO vnext_pg17_writer;
```

The assertion binds authority/account/device/installation/public-key fingerprint, audience, nonce hash, canonical request hash and issue/expiry time. Consumption is append-only. The registration function derives account and device identifiers only from the assertion; it rejects expiry, wrong audience, previous consumption, revocation and every binding conflict. Success writes one accepted receipt, audit, outbox and online session row in the same transaction; every failure rolls back.

- [ ] **Step 4: Re-run the manifest test**

Run: `node shared/vnext-pg17/migrationManifest.test.js`

Expected: exit 0.

### Task 3: Lock structure, role membership and ACLs in catalog assertions

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.js`
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`

- [ ] **Step 1: Write a catalog drift test before assertion changes**

```js
await facade.query('GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_register_unified_desktop_online(...) TO PUBLIC');
await assert.rejects(() => catalog.assert(handle), error => error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
```

Also cover writer table DML, invalid identity-verifier/runtime/verifier execution, role membership, assertion/consumption columns and constraints, triggers, function owner/security/search path/body and M1-M15 immutable bytes.

- [ ] **Step 2: Run the catalog test and confirm the new assertion is red**

Run: `node shared/vnext-pg17/catalogAssertion.test.js`

Expected: non-zero exit because M16 objects are not asserted yet.

- [ ] **Step 3: Implement exact catalog and fresh/reapply checks**

```js
// Add identity verifier to exact roles; it has no membership or table DML.
// Only identity verifier executes issuance; only writer executes registration.
// The ledger must be exactly M1..M16 while M1..M15 bytes/checksums remain unchanged.
```

- [ ] **Step 4: Run the catalog test**

Run: `node shared/vnext-pg17/catalogAssertion.test.js`

Expected: exit 0.

### Task 4: Exercise atomic online registration end to end

**Files:**
- Modify: `shared/vnext-pg17/unifiedDesktopRegistrationCommand.test.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`

- [ ] **Step 1: Write failing disposable-PG scenarios**

```js
// Identity verifier issues an assertion and writer registers it. Assert one
// device/installation/link/session, receipt/audit/outbox/consumption and no
// approval or primary-host state. Exact replay creates no duplicate identity.
// Cross-account key/installation/idempotency conflicts, expired/wrong-audience/
// repeated-nonce/consumed assertions, revoked parents and writer direct INSERT
// all fail with zero partial state.
```

- [ ] **Step 2: Run the end-to-end test and confirm it is red**

Run: `node shared/vnext-pg17/unifiedDesktopRegistrationCommand.test.js`

Expected: non-zero exit because closed calls and database capability are missing.

- [ ] **Step 3: Add only the private runtime calls required by the test**

```js
// Add private identity-verifier and writer-function invocations. Neither is
// added to the generic SQL facade. Run the case after business shadow and
// before production readiness; failure must stop the runner and clean up.
```

- [ ] **Step 4: Run focused and aggregate verification**

Run: `node shared/vnext-pg17/unifiedDesktopRegistrationCommand.test.js`

Run: `node shared/vnext-pg17/catalogAssertion.test.js`

Run: `node shared/vnext-pg17/runPg17IntegrationTests.test.js`

Run: `npm.cmd run test:vnext-control-plane-target`

Expected: all exit 0.

### Task 5: Record the boundary and submit

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-unified-desktop-silent-registration-offline-draft-admission-design.md`
- Modify: `docs/superpowers/plans/2026-08-21-unified-desktop-online-registration-command.md`

- [ ] **Step 1: State the delivered and still-blocked boundary**

M16 proves only the local disposable command capability. External online verification, JWT issuance, HTTP routes, old approval removal, encrypted offline drafts, real RDS and release remain unimplemented and must not be claimed.

- [ ] **Step 2: Run final checks**

Run: `git diff --check`

Run: `git status --short`

Expected: diff check exit 0 and existing output directories remain preserved.

- [ ] **Step 3: Commit and push under project convention**

```powershell
git add -A
git commit -m "automatic release 2026-08-21"
git push gewu master
```
