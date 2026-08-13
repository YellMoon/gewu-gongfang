# vNext Role Mutation AccessContext Reference Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy injectable authorization callback in the existing role grant/revoke reference writer with the same opaque assertion and same-database AccessContext trust boundary used by the existing policy and device-link writers.

**Architecture:** A role mutation writer accepts only an exact V4 reference database, a resolver branded for that same database, opaque assertions, an injected clock/ID source, and test hooks. It derives actor and authority exclusively from the current AccessContext and requires desktop `super_admin`, `access.manage`, and valid recent reauthentication. Existing role CAS, final-effective-super-admin protection, receipt/audit/outbox atomicity, and account version changes remain unchanged.

**Tech Stack:** Node.js CommonJS, `better-sqlite3` `:memory:`, V4 reference kernel, trusted verifier boundary, AccessContext resolver.

---

### Task 1: Red tests and fixture conversion

**Files:**
- Modify: `shared/vNextRoleGrantMutationReference.test.js`
- Modify: `package.json` only if the focused command requires adjustment

- [x] Replace the injected `authorize()` fixture with a V4 publication, online actor session, opaque verifier assertion, same-DB resolver and recent reauthentication.
- [x] Add red tests for desktop/super-admin/`access.manage`/reauth requirements, fake or foreign-bound resolver/assertion rejection, exact input rejection, and role change invalidating a target's old session.
- [x] Preserve and extend existing CAS, last-effective-admin, replay-companion tampering and every-write-boundary rollback coverage.
- [x] Run the focused test and observe failure against the old callback boundary.

### Task 2: Trusted role writer

**Files:**
- Modify: `shared/vNextRoleGrantMutationReference.js`
- Test: `shared/vNextRoleGrantMutationReference.test.js`

- [x] Require an exact factory with same-DB branded resolver rather than `authorize()`.
- [x] Change execution to `execute(assertion, command)` and derive authority/actor only from the resolver's frozen current context.
- [x] Require desktop `super_admin`, `access.manage`, and strictly unexpired reauthentication before any role read or write.
- [x] Keep existing role mutation semantics, canonical receipt/audit/outbox evidence, no-op/rejected replay validation, and all-or-nothing transactions.
- [x] Run focused and full vNext migration suites and whitespace checks.

### Task 3: Evidence and audit

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Modify: this plan

- [x] Record reference-only non-claims and the trusted AccessContext dependency.
- [x] Request GPT-5.6-sol necessity then quality audit; fix all blocking findings and rerun verification.
- [ ] Commit task-only files with the project release convention and push `gewu/master`.
