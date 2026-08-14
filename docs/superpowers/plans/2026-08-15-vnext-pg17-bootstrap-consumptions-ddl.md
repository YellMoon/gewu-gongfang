# PostgreSQL 17 Bootstrap Consumptions Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Keep work inline; do not dispatch parallel agents.

**Goal:** Add only the V5 deployment-global bootstrap-consumption marker and its receipt-bound, append-only PostgreSQL 17 protections as migration 12.

**Architecture:** The marker is intentionally an empty, zero-foreign-key table. Its insert guard verifies an already durable accepted bootstrap receipt so the marker can permanently prove consumption even if authority or receipt rows are later damaged. It precedes policy-publication migration work and does not create an authority, policy, or writer.

**Tech Stack:** Node.js assertions, exact-pinned `pg`, disposable PostgreSQL 17 Docker runtime, PostgreSQL catalog assertions, and the V5 SQLite reference contract.

---

## Fixed scope

- Append migration 12 only. Create `vnext_control_plane.vnext_bootstrap_consumptions` with `marker_key`, `bootstrap_intent_id`, `authority_id`, `installation_key_fingerprint`, `policy_manifest_sha256`, `receipt_id`, and `consumed_at`.
- `marker_key` is exactly `single-authority-bootstrap`; intent, authority, and receipt are nonblank C-collated text and separately unique. The two hash fields are lowercase 64-hex C-collated text. The time is finite.
- Define no foreign key, seed, policy publication, trust evidence, bootstrap writer, API, or real authority. The table must retain a valid marker after later parent damage.
- The insert guard accepts only one matching M9 accepted `authority.bootstrap` receipt: null actor account, `bootstrap:<intent>` actor key, authority target, 0-to-1 target versions, null account versions, `AUTHORITY_BOOTSTRAPPED`, nondecreasing time, and exact typed seven-key result. It binds the marker authority and policy hash to that receipt.
- Add only the insert guard, no-update, and no-delete owner-owned SECURITY DEFINER functions/triggers. Their path is `pg_catalog,pg_temp`; PUBLIC, verifier, and runtime have no EXECUTE. Verifier has SELECT only and runtime has no table privileges.
- Preserve M1-M11 bytes/checksums and schema-meta timestamp. Do not access RDS/ECS, real data, D-drive/NAS, or deployment.

### Task 1: Write red manifest coverage before M12 SQL

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.test.js`
- Modify: `shared/vnext-pg17/migrationManifest.js`

- [ ] Import `BOOTSTRAP_CONSUMPTIONS_MIGRATION`, require versions `[1..12]`, and assert the exact seven-column table, zero FKs, three trigger functions, and guard result-shape constants.
- [ ] Run `node shared/vnext-pg17/migrationManifest.test.js` and observe failure because M12 does not exist.
- [ ] Append only the M12 SQL, migration record, function hashes, relation/trigger manifests, and export; do not modify M1-M11 SQL.
- [ ] Rerun the manifest test and require `vNext PG17 migration manifest checks passed`.

### Task 2: Prove marker behavior and exact catalog enforcement

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`

- [ ] Create a real accepted bootstrap-receipt fixture with an exact canonical seven-key JSON result, then write marker behavior tests before catalog facts.
- [ ] Prove the valid marker path, fixed-marker/intent/authority/receipt uniqueness, no-update/no-delete P0001 preservation, zero foreign-key list, and parent-damage retention after the valid insert.
- [ ] Add independently failing guard tests for normal receipts, actor/target/outcome/version/time/hash mismatches, missing/extra keys, JSON boolean/string/fractional version bypasses, and every bound marker field. Each rejected insert must leave the marker table empty.
- [ ] Add M11-prefix coverage: hand-apply M1-M11, require catalog apply/assert failure, keep ledger exactly `[1..11]`, and prove the marker relation plus all three functions are absent.
- [ ] Freeze seven columns, eleven constraints, four indexes, zero FKs, owner/ACL/function/trigger facts and ledger entry. In isolated disposable handles require schema drift for added authority/receipt FKs, changed fixed-key/unique/hash/time/default/nullability/collation/index/owner/ACL/function/trigger/public-shadow drift.
- [ ] Run `node shared/vnext-pg17/catalogAssertion.test.js` and `npm.cmd run test:vnext-control-plane-target`; require no labeled runtime container after cleanup.

### Task 3: Audit, evidence, and limited publication

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-vnext-pg17-bootstrap-consumptions-ddl.md`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [ ] Obtain an independent necessity and quality audit; turn each valid issue into an isolated regression before correction.
- [ ] Rerun focused manifest/catalog, target aggregate, `git diff --check`, and the Docker label query.
- [ ] Record synthetic-only evidence. Stage only these two plans and the four PG17 manifest/catalog files, commit using the repository-required dated message, and push `gewu HEAD:master` without output artifacts.
