# PostgreSQL 17 Emergency Recovery Mutation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Keep execution inline; do not dispatch parallel agents.

**Goal:** Add a synthetic-only PG17 reference mutation for a specifically authorized existing-authority owner-recovery event.

**Architecture:** The writer consumes a same-disposable-handle opaque `owner_recovery_event` assertion. Inside one lock-ordered transaction it creates a new replacement identity chain, CAS-revokes captured active super-admin grants and active sessions, writes the V5 recovery companions, and proves that exactly one active super-admin remains. It is not an API, recovery credential, backup operation, production initializer, or data migration.

**Tech Stack:** Node.js, existing disposable PostgreSQL 17 runtime, `pg`, existing PG17 M1-M15 catalog boundary, existing trust-root verifier boundary, and `shared/vNextEmergencyRecoveryReference.js` as the behavior oracle.

---

## Scope

- Require one existing active authority; never insert an authority or update the bootstrap marker.
- Require a same-runtime opaque recovery assertion bound to event, authority, all replacement IDs/key/fingerprint, backup ID/hash, reason, expiry, and approval version.
- Create only a new replacement account/device/installation/link and its null-grantor active `super_admin` grant.
- Capture active super-admin grants and every active session under deterministic locks. CAS-revoke every captured grant/session and increment each distinct former-super-admin account's auth/access/revocation/row vectors once.
- End with exactly one active super-admin for the replacement account and zero active sessions in that authority at commit time. Preserve ordinary roles, profile bindings, scopes, contacts, capabilities, policy rows, marker, and synthetic business-like rows.
- Write accepted recovery receipt, backup-bound recovery evidence, audit, and one recovery outbox in the same transaction. Replays validate every durable companion and return no raw assertion or backup content.
- Exclude real signatures/nonces, real backup or restore, RDS/ECS, HTTP/API/UI, session issuing, business imports, desktop/NAS/D-drive data, secrets, and deployment.

## File map

- Create `shared/vnext-pg17/emergencyRecoveryMutation.js`: strict snapshots, same-runtime assertion gate, lock/CAS transaction, replay validation, and stable local error mapping.
- Create `shared/vnext-pg17/emergencyRecoveryMutation.test.js`: synthetic old-admin/session fixture, recovery/replay/conflict/tamper/rollback regressions.
- Modify `shared/vnext-pg17/runPg17IntegrationTests.js` and `.test.js`: invoke the focused recovery cases in the existing one-runtime aggregate.
- Modify `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`: append only verified synthetic evidence.

## Task 1: Establish red recovery boundary tests

- [ ] Create a fixture that applies M1-M15, uses the PG17 bootstrap reference to create the sole authority, then inserts synthetic active old super-admin grants and sessions plus ordinary role/profile/scope/contact/business-like rows.
- [ ] Produce a valid same-handle recovery assertion with backup ID/hash and an exactly matching command. Add red tests for fake/wrong-kind/foreign-boundary assertions, expired/equal-now proof, strict command/config rejection, every proof-field mismatch, inactive/missing authority, replacement ID/fingerprint collisions, same-key conflict, and same-event/new-key rejection. Every rejected case must leave a full logical table snapshot unchanged.
- [ ] Run `node shared/vnext-pg17/emergencyRecoveryMutation.test.js`; expect the module-not-found failure before implementation.

## Task 2: Implement the lock-ordered recovery transaction

- [ ] Implement `createVNextPg17EmergencyRecoveryMutation({ runtime, handle, verifierBoundary, now, idFactory, testHooks })` using exact own-data snapshots; reject raw clients, foreign handles, proxies, accessors, unknown configuration, and unbranded boundaries before SQL.
- [ ] On `execute(assertion, command)`, unwrap once as `owner_recovery_event`, validate one canonical UTC timestamp and expiry, compare every assertion-bound field, then use the canonical request hash for event/idempotency replay semantics.
- [ ] Assert M1-M15 before mutation. In one `READ COMMITTED` transaction lock the authority, lock distinct old-super-admin accounts by C-order, grants by ID, and active sessions by ID. Lock a recovery-event advisory key before inspecting receipts or replacement collisions.
- [ ] Insert replacement account/device/installation/link at version one. CAS-revoke each captured active super-admin grant, CAS-increment each distinct owning account once, CAS-revoke every captured active session, then create the replacement null-grantor super-admin grant.
- [ ] Assert final active-super-admin and active-session invariants before inserting receipt, backup-bound evidence, audit, and canonical recovery outbox. Invoke `afterWrite` after every insert/CAS stage; any failure rolls back all touched rows.

## Task 3: Prove replay, preservation, and concurrent-state defenses

- [ ] Exact replay must not call `idFactory` or hooks and must revalidate replacement rows, final admin invariant, receipt/result/hash, evidence backup/assertion hash, audit context, and exact canonical outbox payload/hash.
- [ ] Add tamper fixtures that preserve catalog validity but omit or alter each evidence/audit/outbox companion; replay must fail closed as `IDEMPOTENCY_RECEIPT_INVALID`.
- [ ] Test two former super-admin accounts and an ordinary-only account/session. Assert each former-admin account vector increments exactly once, each captured grant/session becomes revoked with row-version increment, the ordinary account remains unchanged while its active session is revoked, and ordinary roles/profiles/scopes/contacts/business-like rows are byte-for-byte logically unchanged.
- [ ] Inject a version conflict after the capture stage for each former-admin account version field and a session row version; expect `RECOVERY_CONFLICT` with a complete transaction rollback. Also inject hook failures at every write stage.
- [ ] Prove zero-old-super-admin recovery succeeds, still makes one replacement admin, and never creates a second authority or changes the marker.

## Task 4: Verify, record evidence, and publish

- [ ] Compare success, replay, conflict, lockout-recovery, and rollback outcome categories with `shared/vNextEmergencyRecoveryReference.js`, without comparing PostgreSQL SQLSTATE text.
- [ ] Run focused recovery and runner tests, manifest/catalog tests, `npm.cmd run test:vnext-control-plane-target`, `npm.cmd test`, `git diff --check`, and the labelled-container query. The query must be empty after the final run.
- [ ] Perform the required necessity and quality review. Turn every valid finding into a targeted red test, rerun the affected checks, append only verified synthetic evidence, stage scoped files, commit with the repository-required dated message, and push `gewu HEAD:master`.

## Self-review

- The writer is the target-engine equivalent of the approved isolated recovery reference and does not become a production recovery mechanism.
- The recovery event does not create a second authority, change bootstrap consumption, preserve an old active session, or elevate a replacement account as its own actor.
- Lock order, per-row CAS, complete rollback, and replay-companion proof are explicit rather than inferred from PostgreSQL defaults.
