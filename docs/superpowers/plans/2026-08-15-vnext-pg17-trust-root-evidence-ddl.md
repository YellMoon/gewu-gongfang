# PostgreSQL 17 Trust-Root Evidence Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Keep work inline; do not dispatch parallel agents.

**Goal:** Add only the V5 trust-root evidence ledger and its receipt/marker, recovery-backup, and append-only PostgreSQL 17 protections as migration 14.

**Architecture:** The empty ledger preserves the already verified bootstrap or recovery evidence that a future trust-root writer will supply. A SECURITY DEFINER insert guard validates the durable receipt/marker relationship and typed receipt result without creating an authority, account, policy, backup, session, or credential. The relation stores hashes as opaque fixed-format evidence; it neither performs backup I/O nor validates signatures.

**Tech Stack:** Node.js assertions, exact-pinned `pg`, disposable PostgreSQL 17 Docker runtime, PostgreSQL catalog assertions, and the V5 SQLite reference contract.

---

## Fixed scope

- Append migration 14 only. Create `vnext_control_plane.vnext_trust_root_evidence` with `evidence_id`, `authority_id`, `receipt_id`, `actor_kind`, `event_id`, `assertion_evidence_sha256`, `backup_id`, `backup_manifest_sha256`, and `created_at`.
- Use C-collated nonblank identifiers; actor kind is exactly `deployment_bootstrap|owner_recovery_event`; evidence and backup hashes are lowercase 64 hex; timestamps are finite. Bootstrap rows require both backup columns null. Recovery rows require both backup columns populated and a nonblank backup ID.
- Keep exactly the PK, authority/receipt unique, actor-kind/event unique, authority RESTRICT FK, and receipt/authority composite RESTRICT FK. Add no bootstrap/recovery data, backup registry, policy/session relation, writer, API, resolver, or default evidence.
- The insert guard accepts bootstrap evidence only if M12 binds the same authority, intent/event, and receipt and its creation time does not precede consumption. It accepts recovery evidence only if its receipt is an exact accepted `authority.owner_recover` result with recovery actor, null account/version vectors, four typed result keys, and nondecreasing time. It must not substitute an ordinary command receipt or infer missing backup evidence.
- Define only insert guard, no-update, and no-delete owner-owned SECURITY DEFINER functions/triggers. Their path is `pg_catalog,pg_temp`; PUBLIC, verifier, and runtime have no EXECUTE. Verifier has SELECT only and runtime has no table privileges.
- Preserve M1-M13 bytes/checksums and schema-meta timestamp. Do not access RDS/ECS, real backup data, D-drive/NAS, production secrets, signing material, or deployment.

### Task 1: Write red manifest coverage before M14 SQL

**Files:**
- Modify: `shared/vnext-pg17/migrationManifest.test.js`
- Modify: `shared/vnext-pg17/migrationManifest.js`

- [x] Import `TRUST_ROOT_EVIDENCE_MIGRATION`, require versions `[1..14]`, and assert the exact nine-column table, two FKs, backup-pair lifecycle, bootstrap marker and recovery receipt dependencies, and three trigger functions.
- [x] Run `node shared/vnext-pg17/migrationManifest.test.js` and observe failure because M14 does not exist.
- [x] Append only M14 SQL, migration record, function hashes, relation/trigger manifests, and export; do not modify M1-M13 SQL.
- [x] Rerun the manifest test and require `vNext PG17 migration manifest checks passed`.

### Task 2: Prove both evidence branches and exact catalog enforcement

**Files:**
- Modify: `shared/vnext-pg17/catalogAssertion.test.js`
- Modify: `shared/vnext-pg17/catalogAssertion.js`

- [x] Create failing synthetic bootstrap and recovery evidence cases. Bootstrap uses the exact M12 marker; recovery uses an exact accepted owner-recovery receipt plus paired backup evidence.
- [x] Prove no seed; both unique rules; both RESTRICT FKs; actor/backup/hash/time constraints; append-only P0001 preservation; verifier SELECT only; and runtime zero access.
- [x] Add failing guard cases for wrong bootstrap time, an ordinary recovery command, and malformed backup pairing/hash; rejected rows leave the ledger unchanged.
- [x] Add M13-prefix coverage: hand-apply M1-M13, require catalog apply/assert failure, keep ledger exactly `[1..13]`, and prove the evidence relation plus all three functions are absent.
- [x] Freeze nine columns, all constraints/indexes/FKs, owner/ACL/function/trigger facts and ledger entry. Isolated disposable handles require schema drift for altered unique/FK/actor/backup/index/ACL/function/trigger/public-shadow drift.
- [x] Run `node shared/vnext-pg17/catalogAssertion.test.js` and `npm.cmd run test:vnext-control-plane-target`; no labeled runtime container remains after cleanup.

### Task 3: Evidence and limited publication

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-vnext-pg17-trust-root-evidence-ddl.md`
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`

- [x] Rerun focused manifest/catalog, target aggregate, `git diff --check`, and the Docker label query.
- [x] Record synthetic-only evidence. Stage only these two plans and the four PG17 manifest/catalog files, commit using the repository-required dated message, and push `gewu HEAD:master` without output artifacts.

## Verification evidence

- Focused manifest and disposable PostgreSQL 17 catalog checks passed on 2026-08-15.
- `npm.cmd run test:vnext-control-plane-target` and `git diff --check` passed before publication. The labelled-container query was empty after cleanup.
- Published commit: `9284993` (`自动发布 2026-08-15`) to `gewu/master`. This evidence covers synthetic local PostgreSQL only; it does not represent RDS, ECS, backup, signing, recovery, or business-data execution.
