# PostgreSQL 17 Policy Publications Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Keep work inline; do not dispatch parallel agents.

**Goal:** Add only the V5 authority-local policy-publication ledger and its receipt-, marker-, revision-, and append-only PostgreSQL 17 protections as migration 13.

**Architecture:** The empty ledger persists a canonical policy manifest text and its writer-supplied SHA-256. A SECURITY DEFINER insert guard accepts either a normal accepted policy-publish receipt or the already-bound bootstrap receipt plus durable M12 marker; it never calculates a hash or creates policy data. The table is append-only and is not a policy writer, resolver, API, or seed.

**Tech Stack:** Node.js assertions, exact-pinned `pg`, disposable PostgreSQL 17 Docker runtime, PostgreSQL catalog assertions, and the V5 SQLite reference contract.

---

## Fixed scope

- Append migration 13 only. Create `vnext_control_plane.vnext_authorization_policy_publications` with `publication_id`, `authority_id`, `receipt_id`, `policy_revision`, `policy_contract_version`, `canonical_manifest_json`, `policy_manifest_sha256`, and `published_at`.
- All identifiers and hash text use `COLLATE "C"` and are nonblank. Revisions are positive `bigint`; the contract version is exactly integer `1`; manifest text is `IS JSON OBJECT WITH UNIQUE KEYS`; hash is lowercase 64 hex; time is finite.
- Keep exactly the PK, authority/revision unique, authority/receipt unique, authority RESTRICT FK, and receipt/authority composite RESTRICT FK. Add no seed, resolver, writer, policy vocabulary, capability mapping, authority current-pointer, or second manifest store.
- The insert guard requires an active authority, exact contiguous authority-local revision, accepted receipt, null committed account versions, nondecreasing publication time, and an exact typed seven-key receipt result. Normal publication requires `authorization_policy.publish` with `POLICY_PUBLISHED` and the `revision-1 -> revision` receipt vector. Bootstrap publication requires revision one plus the same authority/receipt/policy hash/bootstrap actor binding and time ordering from M12 marker. A same contract/hash immediately adjacent revision is rejected as unchanged.
- Define only insert guard, no-update, and no-delete owner-owned SECURITY DEFINER functions/triggers. Their path is `pg_catalog,pg_temp`; PUBLIC, verifier, and runtime have no EXECUTE. Verifier has SELECT only and runtime has no table privileges.
- Preserve M1-M12 bytes/checksums and schema-meta timestamp. Do not access RDS/ECS, real data, D-drive/NAS, or deployment.

### Task 1: Write red manifest coverage before M13 SQL

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.test.js`
- Modify: `shared/vnext-pg17/migrationManifest.js`

- [x] Import `AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION`, require versions `[1..13]`, and assert the exact eight-column table, two foreign keys, three trigger functions, JSON-object contract, normal and bootstrap result constants, and M12 marker dependency.
- [x] Run `node shared/vnext-pg17/migrationManifest.test.js` and observe failure because M13 does not exist.
- [x] Append only M13 SQL, migration record, function hashes, relation/trigger manifests, and export; do not modify M1-M12 SQL.
- [x] Rerun the manifest test and require `vNext PG17 migration manifest checks passed`.

### Task 2: Prove publication behavior and exact catalog enforcement

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`

- [x] Create real accepted standard and bootstrap receipt fixtures, and write failing tests for the normal revision-one/two path and M12-marker bootstrap revision-one path before catalog facts.
- [x] Prove no seed; authority-local contiguous revisions; authority/revision and authority/receipt uniqueness; RESTRICT foreign keys; active-authority requirement; manifest object/duplicate-key rejection; contract/version/hash/time constraints; no-update/no-delete P0001 preservation.
- [x] Add independently failing guard tests for inactive authority, gap/replay/rollback revisions, wrong normal command/target/outcome/result/vector, bootstrap marker absent or mismatched, exact result missing/extra/boolean/string/fractional values, post-marker time reversal, and adjacent unchanged manifest. Every rejected insert must preserve publication rows.
- [x] Add M12-prefix coverage: hand-apply M1-M12, require catalog apply/assert failure, keep ledger exactly `[1..12]`, and prove the publication relation plus all three functions are absent.
- [x] Freeze eight columns, all constraints/indexes/FKs, owner/ACL/function/trigger facts and ledger entry. In isolated disposable handles require schema drift for altered unique/FK/revision/contract/JSON/hash/time/default/nullability/collation/index/owner/ACL/function/trigger/public-shadow drift.
- [x] Run `node shared/vnext-pg17/catalogAssertion.test.js` and `npm.cmd run test:vnext-control-plane-target`; require no labeled runtime container after cleanup.

### Task 3: Audit, evidence, and limited publication

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-vnext-pg17-policy-publications-ddl.md`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [x] Perform necessity and quality review; turn every valid issue into an isolated regression before correction.
- [x] Rerun focused manifest/catalog, target aggregate, `git diff --check`, and the Docker label query.
- [ ] Record synthetic-only evidence. Stage only these two plans and the four PG17 manifest/catalog files, commit using the repository-required dated message, and push `gewu HEAD:master` without output artifacts.

## Verification evidence

- Red: `node shared/vnext-pg17/migrationManifest.test.js` first failed because the expected M13 trigger inventory was absent.
- Green: focused manifest and disposable PostgreSQL 17 catalog suites passed after M13 catalog facts and guard behavior were added.
- Regression: normal and bootstrap publication paths, typed receipt result rejection, inactive authority, absent marker, revision conflict, adjacent unchanged hash, append-only behavior, M12-prefix zero-write rejection, and isolated catalog drift cases execute against synthetic local PostgreSQL 17.
- Aggregate: `npm.cmd run test:vnext-migration`, `npm.cmd run test:vnext-control-plane-target`, and `git diff --check` passed. Any labeled disposable test container found after verification was explicitly label-checked and removed; the final label query was empty.
