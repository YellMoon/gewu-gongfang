# PostgreSQL 17 Sessions and Reauthentication Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Keep work inline; do not dispatch parallel agents.

**Goal:** Add the V5 session and recent-reauthentication relation pair, including the guards needed to trust the captured authority/account/device/installation/link version vector.

**Architecture:** Migration 15 is dependency-closed: reauthentication references a session, and a session must preserve parent-currentness and lifecycle invariants. It maps the approved SQLite V5 contract to fresh PostgreSQL 17 objects inside the disposable test runtime only. It creates no issuer, credential verifier, token, API, writer, or production connection.

**Tech Stack:** Node.js assertions, exact-pinned `pg`, disposable PostgreSQL 17 Docker runtime, PostgreSQL catalog assertions, V5 SQLite reference contract.

---

## Fixed scope

- Append migration 15 only; preserve M1-M14 SQL/checksums and V5 schema meta.
- Create `vnext_sessions` with exactly 23 columns: six IDs; session kind/status; issued/expires/revoked timestamps; nine captured versions; row version; created/updated timestamps.
- Create `vnext_recent_reauthentication_events` with exactly 17 columns: event/authority/session IDs, factor class, evidence SHA-256, nine captured versions, verified/expires/created timestamps.
- Sessions use C-collated nonblank IDs, closed kind/status sets, positive bigint versions, finite timestamps, window/lifecycle checks, PK, `(session_id,authority_id)` unique, and four RESTRICT composite parent FKs.
- Reauthentication uses C-collated nonblank IDs, `password|passkey|verified_contact`, lower-case SHA-256 evidence, positive bigint versions, finite window, PK, and `(session_id,authority_id)` RESTRICT FK.
- Add session insert/current-parent, identity-immutable, monotonic lifecycle, and no-delete guards; add reauthentication online/window/current-parent, no-update, and no-delete guards. Every function is owner-owned SECURITY DEFINER with `pg_catalog,pg_temp`; verifier receives SELECT only; runtime receives no rights.
- Exclude session issuance/revocation writers, credentials, tokens, APIs, production/RDS/ECS/data migration, secrets, NAS/D-drive, and business data.

### Task 1: Establish failing M15 manifest coverage

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.test.js`
- Modify: `shared/vnext-pg17/migrationManifest.js`

- [ ] Import `SESSIONS_REAUTHENTICATION_MIGRATION`; require `[1..15]`, both relations, and all session/reauth trigger names.
- [ ] Assert exact columns, four session parent FKs, reauth session FK, enum/time/lifecycle clauses, and eight function/trigger names.
- [ ] Run `node shared/vnext-pg17/migrationManifest.test.js`; expect red because M15 is absent.
- [ ] Add only M15 SQL, manifest record, function hashes, relation/trigger manifests, and export; do not alter M1-M14 SQL.
- [ ] Rerun the manifest test; expect `vNext PG17 migration manifest checks passed`.

### Task 2: Prove table and guard semantics

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`

- [ ] Hand-apply M1-M14: require catalog apply/assert failure, exact `[1..14]` ledger, and both M15 relations/functions absent.
- [ ] Use only synthetic active authority/account/device/installation/link parents. Prove zero seed, valid online/initialization sessions, and valid password/passkey/verified-contact reauth events.
- [ ] Prove every parent FK, nonblank ID, enum, version, finite-time, window, status/revoked pairing, and duplicate identity failure hits its intended guard or constraint.
- [ ] Prove session parent-currentness for all five parents and nine versions; identity immutability; valid active-to-revoked/expired transition; invalid terminal/reversal/version/time transitions; append-only deletion failure.
- [ ] Prove reauth rejects non-online/non-active sessions, invalid/equal/out-of-session windows, all nine vector mismatches, and stale current parents. Updates/deletes fail with `P0001` and preserve valid rows.
- [ ] Prove verifier read-only access and runtime zero access to both relations and all functions.

### Task 3: Freeze catalog and drift behavior

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.js`
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`

- [ ] Freeze both column sets, owners, exact constraints/indexes/FKs, ACLs, function security/path/source hashes, and full trigger facts.
- [ ] Use fresh handles to inject one drift each: altered FK/enum/window/lifecycle/collation/default/nullability/index/owner/ACL/function security/path/body/execute/trigger/public shadow. Every case must reject with `VNEXT_PG17_SCHEMA_DRIFT`.
- [ ] Run focused catalog plus `npm.cmd run test:vnext-control-plane-target`; confirm the labelled container query is empty.

### Task 4: Evidence and controlled publication

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-vnext-pg17-sessions-reauth-ddl.md`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [ ] Record sanitized synthetic evidence only; run focused tests, aggregate gate, `git diff --check`, and the label query.
- [ ] Stage only the two plan files and four PG17 manifest/catalog files; commit with the repository-required dated message and push `gewu HEAD:master` without output artifacts.

## Self-review

- This plan covers every approved V5 session/reauth relation, FK, version vector, lifecycle rule, and trigger family.
- It keeps the two relations together as one dependency closure and excludes all issuers, credential verifiers, APIs, business migration, and real environment actions.
- SQL changes are TDD-first and are validated with a real disposable PostgreSQL 17 catalog and behavior suite.
