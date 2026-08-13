# vNext Session and Reauthentication Reference Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add online/initialization session state and immutable recent-reauthentication evidence to the isolated vNext reference contract, without credentials, handlers, or an AccessContext resolver.

**Architecture:** V3 remains explicitly injected in-memory SQLite only. `vNext_sessions` is an opaque server-side state record bound to one authority/account/device/installation/link tuple and captured authorization versions. `vNext_recent_reauthentication_events` is append-only evidence bound to an online session. Token issuance/verification, APIs, runtime integration, offline licenses, policy mapping and AccessContext resolution are separate later tasks.

**Tech Stack:** Node.js CommonJS, `better-sqlite3`, in-memory SQLite contract tests.

---

## Frozen semantics

- Version changes from V2 to V3; V2 fails closed and is never silently upgraded.
- A session contains no bearer, refresh token, password, code, challenge, secret, private key or raw authentication material. `session_id` is a server-side relation ID, not a credential.
- Every session has an authority/account/device/installation/link composite relationship, captured account auth/access/revocation versions, device risk/credential versions, installation credential version, link auth/access/row versions, valid lifecycle times and an opaque positive row version.
- Session kind is `online` or `initialization`; only `online` can parent recent reauth evidence. This does not grant business access.
- Reauth stores only allowed factor class (`password`, `passkey`, `verified_contact`), SHA-256-shaped evidence hash, version vector and valid time interval. It forbids device-only proof as a reauth factor, and is append-only.
- Exact DDL/index/trigger assertion continues to fail closed. Assertion stays read-only and never enables foreign keys.

## Files

- Modify: `shared/vNextControlPlaneReferenceKernel.js` — V3 DDL, version marker, exact drift contract.
- Modify: `shared/vNextControlPlaneReferenceKernel.test.js` — synthetic red/green invariant tests.
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md` — reference-only evidence.
- Create: `docs/verification-2026-08-14-vnext-session-reauth-reference.md` — scope and verification record.

### Task 1: Write session red tests

**Files:**
- Modify: `shared/vNextControlPlaneReferenceKernel.test.js`

- [ ] **Step 1: Add failing V3 fixture assertions**

Add synthetic authority/account/device/installation/link fixtures, then assert a future bootstrap reports `schemaVersion === 3`, creates zero session rows, and accepts one online session with a captured version vector. Assert V2 metadata and a cross-authority tuple fail with `VNEXT_REFERENCE_SCHEMA_DRIFT` and SQLite foreign-key errors respectively.

- [ ] **Step 2: Run the focused test**

Run: `node shared/vNextControlPlaneReferenceKernel.test.js`

Expected: FAIL because V2 has no session table and returns version 2.

### Task 2: Implement minimal session DDL

**Files:**
- Modify: `shared/vNextControlPlaneReferenceKernel.js`
- Test: `shared/vNextControlPlaneReferenceKernel.test.js`

- [ ] **Step 1: Add exact composite relationship constraints**

Add `UNIQUE(link_id,authority_id,account_id,device_id,installation_id)` to `vNext_account_device_links`. Add `vNext_sessions` with opaque nonempty identifiers; `online|initialization`; `active|revoked|expired`; issued/expires/revoked lifecycle checks; positive integer type checks for every version; and authority-scoped composite foreign keys to the account, device, installation and link tuple. Use existing schema helper conventions and add exact required table/column/index contracts.

- [ ] **Step 2: Change only the reference marker**

Set bootstrap and `vNext_schema_meta` version to 3. Update exact normalized table/index/trigger checks so same-column DDL drift and all V2 shapes fail closed. Do not add a path, environment fallback, seed record, handler, API or runtime import.

- [ ] **Step 3: Verify green**

Run: `node shared/vNextControlPlaneReferenceKernel.test.js`

Expected: PASS.

### Task 3: Add reauth red tests and immutable DDL

**Files:**
- Modify: `shared/vNextControlPlaneReferenceKernel.test.js`
- Modify: `shared/vNextControlPlaneReferenceKernel.js`

- [ ] **Step 1: Add failing invariant cases**

Add explicit `assert.throws` cases for initialization-session binding, cross-authority link, `device_proof`, invalid/upper-case/BLOB/short evidence hash, invalid times, fractional/zero captured versions and update/delete attempts, alongside one admitted online-session record. Use `:memory:` only. The initialization failure must expose stable `VNEXT_REAUTH_ONLINE_SESSION_REQUIRED`.

- [ ] **Step 2: Add reauth table and triggers**

Add `vNext_recent_reauthentication_events` with opaque event ID, authority/session composite FK, allowed factor class, evidence SHA-256, captured account/device/installation/link versions, verified/expires/created times and append-only update/delete triggers. Add an INSERT trigger that rejects a parent whose `session_kind != 'online'`. Register exact table/trigger contracts. Do not create a token, credential, login, logout, refresh, verifier, resolver or route.

- [ ] **Step 3: Verify green**

Run: `node shared/vNextControlPlaneReferenceKernel.test.js`

Expected: PASS.

### Task 4: Finish boundary and verification

**Files:**
- Modify: `shared/vNextControlPlaneReferenceKernel.test.js`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Create: `docs/verification-2026-08-14-vnext-session-reauth-reference.md`

- [ ] **Step 1: Add drift/read-only checks**

Test same-column session DDL missing its composite link FK, foreign-named trigger attached to a V3 table, and public schema assertion with FK state and session/reauth counts unchanged.

- [ ] **Step 2: Record the strict non-goals**

Document that V3 is no credential issuer/verifier, session API, AccessContext resolver, policy/capability calculator, offline license, worker, runtime integration, selected cloud DDL, data import or deployment. Record the resolver prerequisites: role-default capability map, normalized surface semantics, policy version, deny precedence, scope canonicalization/hash rules and a trusted verifier boundary.

- [ ] **Step 3: Run final verification and audit**

Run `node shared/vNextControlPlaneReferenceKernel.test.js`, `npm run test:vnext-migration`, and `git diff --check`. Require GPT-5.6-sol necessity and quality PASS before committing only task-owned files and pushing `gewu/master`. No Electron build or OSS package is needed because no runtime behavior changes.
