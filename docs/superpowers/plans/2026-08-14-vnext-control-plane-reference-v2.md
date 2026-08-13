# vNext Control-Plane Reference V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the isolated vNext SQLite reference contract so a later authorization mutation vertical slice can prove idempotency, versioning, audit, and outbox semantics without touching a runtime or real data.

**Architecture:** Keep `shared/vNextControlPlaneReferenceKernel.js` as an explicitly injected SQLite bootstrap with no path, environment, network, or runtime imports. Schema version 2 adds one append-only command receipt as the idempotency authority, one receipt-bound append-only audit record, and one immutable receipt-bound outbox intent envelope; audit cannot become a competing idempotency authority. The plan only defines schema and tests: it does not implement a command handler, authorization decision, session, reauthentication, delivery worker, cloud DDL, or data import.

**Tech Stack:** Node.js CommonJS, `better-sqlite3`, in-memory SQLite contract tests.

---

## Frozen mutation semantics for the next task

| Future command | Target CAS | Account version changes on accepted mutation | Target version change | Outbox aggregate |
| --- | --- | --- | --- | --- |
| `role.grant` | absent logical role requires expected target version `0` | `auth_version +1`, `access_version +1`, `row_version +1` | new grant starts at `row_version=1`, `grant_version=1` | `role_grant` / grant ID |
| `role.revoke` | active grant `row_version` must equal expected value | `auth_version +1`, `access_version +1`, `revocation_version +1`, `row_version +1` | grant `row_version +1`, `grant_version +1` | `role_grant` / grant ID |
| `capability.override` | absent logical capability requires `0`; otherwise target `row_version` | `auth_version +1`, `access_version +1`, `row_version +1` | override `row_version +1` | `capability_override` / override ID |
| `scope.grant` | absent logical scope requires `0`; otherwise target `row_version` | `auth_version +1`, `access_version +1`, `row_version +1` | scope `row_version +1` | `scope_grant` / scope grant ID |
| `account_device_link.revoke` | link `row_version` must equal expected value | no account-wide version is changed; future resolver must invalidate by link status/version | link `auth_version +1`, `access_version +1`, `row_version +1` | `account_device_link` / link ID |

For every future command, the receipt is the idempotency authority: equal `(authority_id, actor_key, idempotency_key)` with the same canonical request hash replays its recorded canonical result; the same key with another hash is a conflict. The later mutation service must atomically write target state, account/link versions, receipt, receipt-bound audit row, and one or more outbox rows. A new key for an already-revoked target is a defined reject/no-op that must not increment versions. The reference schema does not implement these mutations.

### Task 1: Add V2 red tests

**Files:**
- Modify: `shared/vNextControlPlaneReferenceKernel.test.js`

- [ ] **Step 1: Write the failing test**

Add assertions that a fresh bootstrap reports schema version `2`, creates empty `vNext_authorization_command_receipts` and `vNext_authorization_outbox_events`, accepts a receipt with a receipt-bound audit/outbox row, rejects duplicate actor/idempotency receipt keys, permits the same key for another actor, and rejects update/delete of receipt and audit rows.

- [ ] **Step 2: Run test to verify it fails**

Run: `node shared/vNextControlPlaneReferenceKernel.test.js`

Expected: FAIL because v1 has no command receipt/outbox tables and returns schema version 1.

### Task 2: Implement the V2 reference schema

**Files:**
- Modify: `shared/vNextControlPlaneReferenceKernel.js`
- Test: `shared/vNextControlPlaneReferenceKernel.test.js`

- [ ] **Step 1: Replace only the reference schema contract**

Set `vNext_schema_meta.schema_version` to `2`. Add `vNext_authorization_command_receipts` with nonblank opaque IDs/keys, lower-case 64-hex SHA-256-shaped fields, nonnegative integer expected version, nullable positive integer committed versions, valid JSON result, authority-bound actor FK, and `(authority_id,actor_key,idempotency_key)` uniqueness. Add `vNext_authorization_outbox_events` as an immutable intent envelope with a composite receipt/authority FK, valid JSON payload plus a SHA-256-shaped hash, positive integer aggregate version, unique receipt event identity, and update/delete rejection triggers. JSON canonicalization and JSON-to-hash equality remain a future writer responsibility, not a claim made by SQLite.

Make `vNext_authorization_audit_events` receipt-bound and append-only. Add append-only receipt triggers. Update the reference table list, exact normalized table/index/trigger drift contract, schema version result, and fail-closed reapplication behavior.

- [ ] **Step 2: Run the focused test**

Run: `node shared/vNextControlPlaneReferenceKernel.test.js`

Expected: PASS.

### Task 3: Add adversarial V2 contract coverage

**Files:**
- Modify: `shared/vNextControlPlaneReferenceKernel.test.js`

- [ ] **Step 1: Write and run rejection tests**

Cover receipt hash/version/foreign-key failures, cross-authority receipt/outbox linking with a real second authority, malformed JSON, receipt/audit/outbox append-only behavior, receipt key reuse by another actor, v1 schema rejection, and receipt/outbox semantic drift rejection. Also prove that foreign-named indexes and triggers attached to vNext tables are rejected. Run the focused test after each added behavior.

- [ ] **Step 2: Keep test setup synthetic only**

Use `new Database(':memory:')`; do not open a project database, refer to a desktop data path, seed an authority, or import any runtime module.

### Task 4: Record scope and verify release quality

**Files:**
- Modify: `package.json`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Create: `docs/verification-2026-08-14-vnext-control-plane-reference-v2.md`

- [ ] **Step 1: Keep the test in the migration foundation suite**

Ensure `test:vnext-migration` still executes `shared/vNextControlPlaneReferenceKernel.test.js`.

- [ ] **Step 2: Document the exact reference-only boundary**

Record that v2 provides only schema-level receipt/outbox semantics and frozen version rules. It is not a selected cloud engine, mutation service, session/reauth implementation, delivery worker, cloud deployment, real-data importer, or business writer.

- [ ] **Step 3: Run final verification**

Run: `node shared/vNextControlPlaneReferenceKernel.test.js && npm run test:vnext-migration && git diff --check`

Expected: all commands pass. Then obtain GPT-5.6-sol necessity and quality audits before committing only task-owned files and pushing `gewu/master`.
