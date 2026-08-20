# PG17 vNext Verified-Contact Metadata Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit synthetic historical verified-contact metadata into the disposable copy-only rehearsal without making it operational for login, recovery, sessions, reauthentication, or authorization.

**Architecture:** Extend the exact memory-SQLite source manifest and runtime-issued PG17 facade. Validate source before the one write transaction; issue only a static INSERT and static reread SELECT; compare canonical source and target hashes before COMMIT.

**Tech Stack:** Node.js `node:test`, memory SQLite, disposable PostgreSQL 17, existing restricted facade.

---

## Scope Lock

- Do not change M1--M15 SQL/checksums, ACLs, catalog assertions, writer grants, or mutations.
- Do not add normalization, a contact writer/lookup, login/recovery/reauth factor, session, API, CLI, real source path, or real database connection.
- Both hash-named fields stay opaque nonblank text. Exact row shape rejects raw contact properties; opaque values are never parsed or normalized.
- Unsupported mapped collections stay nonempty-fail-closed; inert collections stay inventory-only.

## Files

- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js` for exact source fields, validation, hash/report, and transaction wiring.
- Modify: `shared/vnext-pg17/disposableRuntime.js` for fixed contact INSERT/reread SQL plus fault and trace entries.
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js` for fixture, red/green admission, trace, rollback, and poison proof.
- Modify: `docs/superpowers/plans/2026-08-20-vnext-pg17-control-plane-copy-only-rehearsal-implementation.md` after green proof.

### Task 1: Write source-admission RED tests

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [ ] **Step 1: Add a valid two-row fixture**

```js
verifiedContacts: [
  { contact_id: 'contact-phone-1', authority_id: 'authority-1', account_id: 'account-1', contact_type: 'phone', normalized_value_hash: 'opaque-phone-hash', verification_state: 'verified', verification_evidence_hash: 'opaque-evidence-1', verified_at: INSTANT, revoked_at: null, row_version: 1, created_at: INSTANT, updated_at: INSTANT },
  { contact_id: 'contact-openid-1', authority_id: 'authority-1', account_id: 'account-1', contact_type: 'wechat_openid', normalized_value_hash: 'opaque-openid-hash', verification_state: 'revoked', verification_evidence_hash: 'opaque-evidence-2', verified_at: INSTANT, revoked_at: LATER_INSTANT, row_version: 2, created_at: INSTANT, updated_at: LATER_INSTANT },
]
```

Keep the exact 22-collection source shape; all other mapped collections stay empty.

- [ ] **Step 2: Add isolated invalid rows**

```js
const invalid = [
  ['raw property', row => ({ ...row, phoneNumber: '+8613800000000' })],
  ['missing evidence', ({ verification_evidence_hash, ...row }) => row],
  ['invalid type', row => ({ ...row, contact_type: 'email' })],
  ['verified without time', row => ({ ...row, verified_at: null })],
  ['verified with revoke', row => ({ ...row, revoked_at: LATER_INSTANT })],
  ['revoked without revoke time', row => ({ ...row, verification_state: 'revoked', revoked_at: null })],
  ['revoked without verified time', row => ({ ...row, verification_state: 'revoked', verified_at: null, revoked_at: LATER_INSTANT })],
  ['unknown account', row => ({ ...row, account_id: 'missing-account-1' })],
  ['verified on disabled account', row => ({ ...row, account_id: 'disabled-account-1' })],
  ['verified on revoked account', row => ({ ...row, account_id: 'revoked-account-1' })],
  ['cross authority', row => ({ ...row, authority_id: 'authority-2' })],
  ['reserved identity duplicate', row => ({ ...row, contact_id: 'contact-phone-2', account_id: 'account-2' })],
];
```

Each fresh source must reject with `VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID` before target creation. Make disabled/duplicate fixtures otherwise valid so no earlier condition masks the expected failure. Add separate positive fixtures proving a revoked contact is admitted on each existing disabled and revoked account; these are historical rows and must not be silently dropped.

- [ ] **Step 3: Verify RED**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`.

Expected: the valid fixture fails because `verifiedContacts` is source-rejected, and invalid rows cannot be silently ignored.

### Task 2: Implement exact source validation and evidence

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`
- Test: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [ ] **Step 1: Add the source manifest**

```js
const METADATA_COLLECTIONS = Object.freeze(['profileBindings', 'verifiedContacts']);
const VERIFIED_CONTACT_FIELDS = Object.freeze([
  'contact_id', 'authority_id', 'account_id', 'contact_type',
  'normalized_value_hash', 'verification_state', 'verification_evidence_hash',
  'verified_at', 'revoked_at', 'row_version', 'created_at', 'updated_at',
]);
```

Use existing exact-own-data and `sameKeys` helpers; never spread a source row into target parameters.

- [ ] **Step 2: Add the frozen validator**

```js
const verified = row.verification_state === 'verified';
const revoked = row.verification_state === 'revoked';
if (!accounts.has(row.account_id)) throw sourceInvalid();
if ((!verified && !revoked)
  || !nonBlank(row.contact_id) || !nonBlank(row.authority_id)
  || !nonBlank(row.account_id) || !nonBlank(row.normalized_value_hash)
  || !nonBlank(row.verification_evidence_hash) || !positiveSafeInteger(row.row_version)
  || (verified && (row.verified_at === null || row.revoked_at !== null))
  || (revoked && (row.verified_at === null || row.revoked_at === null))) throw sourceInvalid();
if (verified && accounts.get(row.account_id).status !== 'active') throw sourceInvalid();
```

Check every non-null time with the existing finite canonical-UTC helper. Before any status read, require `accounts.has(row.account_id)` and then require the mapped account to be in the one authority. Use a Set keyed by authority/type/value hash to enforce the nonpartial unique identity across both states. Do not add SHA-shape, lookup, normalization, or revoked-account-state behavior.

- [ ] **Step 3: Add canonical contact evidence**

Sort validated rows by `contact_id`, hash using existing canonical row logic, and retain the source fingerprint. Add only `verifiedContactCount`, `sourceVerifiedContactLogicalSha256`, and `targetVerifiedContactLogicalSha256` to the result; do not add resolver inputs or authorization counters.

- [ ] **Step 4: Verify partial GREEN**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`.

Expected: invalid cases pass and the valid fixture remains red until the facade exists.

### Task 3: Add static target SQL and reread proof

**Files:**
- Modify: `shared/vnext-pg17/disposableRuntime.js`
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`
- Test: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [ ] **Step 1: Add failing result and trace assertions**

```js
assert.equal(result.verifiedContactCount, 2);
assert.equal(result.sourceVerifiedContactLogicalSha256, result.targetVerifiedContactLogicalSha256);
assert.ok(trace.queries.some(sql => sql.startsWith('INSERT INTO vnext_control_plane.vnext_verified_contacts(')));
assert.ok(trace.queries.some(sql => sql.includes('FROM vnext_control_plane.vnext_verified_contacts ORDER BY contact_id')));
assert.equal(result.activeSessionCount, 0);
assert.equal(result.activeReauthenticationCount, 0);
assert.equal(result.outboxDispatchedCount, 0);
```

Freeze the exact INSERT and reread SQL strings in the test. On every trace entry,
allow only the exact transaction statements, exact catalog/empty-check SELECTs,
the exact contact INSERT, or the exact ordered reread SELECT. Reject any
semicolon-composed statement and add `INSERT ...; DELETE ...` and
`SELECT ...; UPDATE ...` classification counterexamples.

- [ ] **Step 2: Verify RED**

Run the focused test. Expected: valid contact fixture fails due to the missing restricted facade method.

- [ ] **Step 3: Add only static facade calls**

```js
insertVerifiedContact: row => query(
  'INSERT INTO vnext_control_plane.vnext_verified_contacts(contact_id, authority_id, account_id, contact_type, normalized_value_hash, verification_state, verification_evidence_hash, verified_at, revoked_at, row_version, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
  [row.contact_id, row.authority_id, row.account_id, row.contact_type, row.normalized_value_hash, row.verification_state, row.verification_evidence_hash, row.verified_at, row.revoked_at, row.row_version, row.created_at, row.updated_at],
),
readVerifiedContacts: () => readRows('vnext_verified_contacts', 'contact_id', VERIFIED_CONTACT_FIELDS),
```

Add only `verifiedContacts` and `postReadContactMismatch` to the runtime-issued fault set. The mismatch must alter the reread snapshot, never a DB row.

- [ ] **Step 4: Wire the one transaction**

After profile metadata and before optional evidence, insert contacts, reread by `contact_id`, hash, and fail before COMMIT:

```js
if (sourceVerifiedContactLogicalSha256 !== targetVerifiedContactLogicalSha256) throw logicalMismatch();
```

- [ ] **Step 5: Verify GREEN**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js` and `node shared/vnext-pg17/disposableRuntime.test.js`.

Expected: both exit 0 and the trace has no non-static/escape SQL.

### Task 4: Prove rollback, poison, and release quality

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`
- Modify: `docs/superpowers/plans/2026-08-20-vnext-pg17-control-plane-copy-only-rehearsal-implementation.md`

- [ ] **Step 1: Extend runtime fault proof**

Add `verifiedContacts` to the write-stage matrix and `postReadContactMismatch` to mismatch coverage. Each must return the stable rollback/mismatch code, leave all 19 data relations empty, preserve the source fingerprint, and return no success report.

- [ ] **Step 2: Reuse terminal uncertainty proof**

Run existing `commit` and `rollback` fault plans with the valid contact source. Assert target is poisoned and a second rehearsal returns the stable unavailable error rather than reusing a client.

- [ ] **Step 3: Update current-boundary text after GREEN**

State only that identity topology, inactive historical authorization, profile-binding metadata, and verified-contact metadata are synthetic boundary-verified. Contacts are opaque and non-authorizing; sessions, reauth, receipts, audit, outbox, policy, and trust remain nonempty-fail-closed. Never call this a complete rehearsal or real migration.

- [ ] **Step 4: Verify and audit**

Run the focused rehearsal/runtime/catalog tests, `npm.cmd run test:vnext-control-plane-target`, and `git diff --check`. Request independent read-only audit; make every blocking finding a red test, rerun verification, then commit scoped files using the repository release format and push `HEAD:master` to `gewu`. Do not package, deploy, publish, or access external data.
