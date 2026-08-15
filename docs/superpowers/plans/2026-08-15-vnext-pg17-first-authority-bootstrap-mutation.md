# PostgreSQL 17 First-Authority Bootstrap Mutation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Keep work inline; do not dispatch parallel agents.

**Goal:** Add a synthetic-only PostgreSQL 17 reference mutation that atomically creates the sole first authority from an already verified, opaque bootstrap assertion.

**Architecture:** The mutation is a local disposable-PG17 test artifact, not an API or deployment initializer. It validates a same-runtime opaque bootstrap assertion, canonical command snapshot, expiry, and policy manifest before opening one locked transaction. The transaction creates the authority/account/device/installation/link/super-admin/policy/receipt/audit/outbox/marker/evidence chain in V5 dependency order; replay validates durable companions and never reruns the ceremony.

**Tech Stack:** Node.js, the existing disposable PostgreSQL 17 runtime, `pg`, the V5 SQLite bootstrap reference as semantic oracle, and the existing trust-root verifier-boundary reference.

---

## Scope

- Accept only an injected disposable PG17 handle that passes the exact M1-M15 catalog. Reject connection strings, raw `pg.Client` values, arbitrary database objects, and runtime configuration.
- Accept only the existing `deployment_bootstrap` opaque assertion from a same-database-bound trust-root verifier boundary. Intent, authority/account/device/installation IDs, public key/fingerprint, policy hash, reason, expiry, and approval version must exactly match the command.
- Require zero authorities and zero bootstrap markers before the transaction. The zero-FK marker remains durable; a changed key or semantic request never reopens bootstrap.
- Use existing authority/account/device/installation/link/role/policy/receipt/audit/outbox/marker/evidence relations only. Do not add a schema migration.
- Exclude RDS/ECS, real signatures/nonces, tokens, credentials, sessions, HTTP/API/desktop integration, business/desktop/NAS data, imports, deployment, and secrets.

## File map

- Create `shared/vnext-pg17/firstAuthorityBootstrapMutation.js`: strict configuration and command snapshots, assertion unwrap, transaction, replay validator, and stable error mapping.
- Create `shared/vnext-pg17/firstAuthorityBootstrapMutation.test.js`: synthetic bootstrap/replay/conflict/rollback/tamper tests through disposable PG17.
- Modify `shared/vnext-pg17/runPg17IntegrationTests.js`: run the focused writer module through the existing PG17 gate.
- Modify `package.json`: include only the focused writer test in the PG17 aggregate.
- Modify `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`: append sanitized evidence after all gates pass.

## Task 1: Establish failing boundary tests

- [ ] Create a test factory that applies M1-M15 to a disposable handle, constructs a same-runtime bootstrap verifier boundary, and returns a valid synthetic assertion plus exactly matching command.
- [ ] Add red tests for fake assertion, wrong kind, foreign boundary, foreign handle, expired/equal-now proof, accessor/symbol/Proxy/extra command input, each assertion-command mismatch, existing authority, and existing marker. Snapshot every target relation and require zero writes.
- [ ] Run `node shared/vnext-pg17/firstAuthorityBootstrapMutation.test.js`; expect module-not-found failure.

## Task 2: Implement input and transaction mechanics

- [ ] Implement `createVNextPg17FirstAuthorityBootstrapMutation({ runtime, verifierBoundary, now, idFactory, testHooks })` with exact own-data config and no accessor/Proxy reads.
- [ ] Implement `execute(assertion, command)`: snapshot once, unwrap once as `deployment_bootstrap`, validate canonical UTC clock and future expiry, canonicalize the policy with `vNextAuthorizationPolicyReference`, then compare every assertion-bound field before receipt lookup.
- [ ] In one transaction, take a fixed bootstrap advisory lock, assert catalog, evaluate replay/conflict, and require zero authorities and zero markers.
- [ ] Generate IDs before writes and insert authority, account, device, installation, link, active null-grantor super-admin, accepted null-actor receipt, marker, revision-one publication, evidence, audit, and one outbox in dependency order.
- [ ] Invoke an `afterWrite` test hook after every write; any hook or constraint failure must roll back every target relation.

## Task 3: Prove replay and durable state

- [ ] Exact replay returns the original result with `replayed: true`, adds no rows, and does not invoke `idFactory` or hooks.
- [ ] Replay revalidates receipt actor/command/target/request/result/hash, complete created chain, sole active null-grantor super-admin, policy publication, marker, evidence, audit, and outbox. Missing or altered evidence fails as `IDEMPOTENCY_RECEIPT_INVALID`.
- [ ] Add same-key changed-command conflict, new-key consumed rejection, existing-authority/marker rejection, ordinary-receipt masquerade rejection, and every write-boundary rollback tests.
- [ ] Prove no session, reauthentication, contact, capability, scope, profile, or synthetic business-like row is seeded or changed.

## Task 4: Verify and publish

- [ ] Compare success/replay/conflict/rollback outcome categories with `shared/vNextFirstAuthorityBootstrapReference.js`; do not compare engine-specific SQLSTATE text.
- [ ] Run focused writer test, manifest test, catalog test, `npm.cmd run test:vnext-control-plane-target`, `git diff --check`, and labelled-container query. The query must be empty.
- [ ] After independent necessity and quality review, stage only the scoped files, commit with the repository-required dated message, and push `gewu HEAD:master`. Do not package or deploy.

## Self-review

- The transaction includes every trust-root artifact required by the owner-approved decision while reusing the existing M1-M15 schema.
- The test runtime and assertion remain reference-only; neither becomes a credential nor a production bootstrap path.
- Failure injection and companion validation are mandatory, so a happy-path insert cannot stand in for atomicity or replay proof.
