# vNext Existing-Authority Policy Publication Mutation Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one injected-reference mutation that publishes a later authority policy only from a current trusted desktop super-admin AccessContext.

**Architecture:** Brand the existing resolver factory so a look-alike `resolve()` object cannot become an authorization bypass. The mutation service receives that resolver and a trusted assertion, reconstructs its context, canonicalizes the candidate manifest, and commits receipt/publication/audit/outbox in one SQLite transaction. Revision zero remains an explicit first-authority ceremony gate.

**Tech Stack:** Node.js CommonJS, `better-sqlite3` injected `:memory:` database, existing V4 kernel, policy contract, trusted-session boundary and AccessContext resolver.

---

### Task 1: Resolver factory identity

**Files:**
- Modify: `shared/vNextAccessContextResolverReference.js`
- Modify: `shared/vNextAccessContextResolverReference.test.js`

- [x] Add a module-private `WeakSet` and exported resolver predicate, with a `WeakMap` binding each resolver to its injected database handle.
- [x] Prove look-alike/copy rejection and same-database-only resolver use.
- [x] Run `node shared/vNextAccessContextResolverReference.test.js`.

### Task 2: Existing-authority policy mutation red tests

**Files:**
- Create: `shared/vNextPolicyPublicationMutationReference.test.js`
- Modify: `package.json`

- [x] Build an in-memory V4 fixture with a current trusted desktop super-admin context and a pre-existing first publication.
- [x] Add red/green coverage for revision 1 to 2, replay/conflict, unchanged noop, revision-zero rejection, caller-fact spoofing, nested accessor/proxy rejection, authority self-lock prevention, tampered replay evidence and cross-database resolver rejection.
- [x] Add the focused test to `test:vnext-migration`.

### Task 3: Transactional writer

**Files:**
- Create: `shared/vNextPolicyPublicationMutationReference.js`
- Test: `shared/vNextPolicyPublicationMutationReference.test.js`

- [x] Require an exact factory, real resolver bound to the same database, exact command and recursively snapshotted plain candidate manifest.
- [x] Require a current desktop `super_admin` context, `access.manage` and a strictly valid reauthentication; caller authority/session/role facts are never accepted.
- [x] Canonicalize/hash only copied policy bytes, reject revision zero and stale CAS, and reject any candidate that removes/retire/restricts desktop `access.manage` from `super_admin`.
- [x] Atomically create receipt, immutable publication, audit and outbox; adjacent identity creates only noop receipt/audit.
- [x] Revalidate request/result hashes, publication ID/contract/content, audit reason/context hash and outbox payload/hash on every replay.
- [x] Run focused/full/diff checks.

### Task 4: Evidence and audit

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Modify: this plan

- [x] Record only reference boundaries and fresh command evidence; do not claim cloud integration or first-authority initialization.
- [x] GPT-5.6-sol necessity audit: PASS. GPT-5.6-sol quality audit: PASS after input snapshot, replay-companion and self-lock regressions.
- [ ] Commit only task files using the project release commit convention and push `gewu/master`.
