# Source Recovery Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a source-machine recovery package that preserves the only real desktop data before any cloud migration can read it.

**Architecture:** The package receives only explicit source paths and a new external destination. It uses an online SQLite backup for the business database, copies desktop metadata and optional question files as immutable recovery payloads, records SHA-256 manifests, and proves restoration into an empty directory. It does not interpret business rows or activate credentials.

**Tech Stack:** Node.js, better-sqlite3, fs/path/crypto, existing vNext path safety and SQLite snapshot modules.

---

### Task 1: Recovery package contract

**Files:**
- Create: `scripts/vnext-migration/sourceRecoveryPackage.test.js`
- Create: `scripts/vnext-migration/sourceRecoveryPackage.js`
- Modify: `package.json`

- [x] Write a failing test for explicit source paths, operator exit confirmation, atomic `.partial` behaviour, SQLite snapshot preservation, optional question payload preservation, SHA-256 verification, and restore to a new empty directory.
- [x] Run `node scripts/vnext-migration/sourceRecoveryPackage.test.js` and confirm it fails because the module is missing.
- [x] Implement the smallest package writer and verifier that pass the test. Refuse source/output overlap, reparse points, source changes, existing target, and missing exit confirmation.
- [x] Add the test to `test:vnext-migration` and run it together with the existing migration suite.

### Task 2: Operator contract

**Files:**
- Create: `docs/vnext-source-recovery-runbook.md`
- Modify: `scripts/vnext-migration/cli.js`
- Modify: `scripts/vnext-migration/cli.test.js`

- [x] Add explicit `recover-package`, `verify-recover-package`, and `restore-recover-package` commands; they must never discover paths automatically.
- [x] Verify that commands reject missing exit acknowledgement and output/source overlap.
- [x] Document the exact source-machine shutdown, package creation, verification, local-only handling, and empty-directory restore sequence. Explicitly state that the package is not a cloud import and never activates legacy credentials.

### Task 3: Verification and review

**Files:**
- Modify: `docs/verification-2026-08-13-source-recovery-package.md`

- [x] Run the complete vNext migration test suite, static syntax checks, and whitespace check.
- [ ] Ask GPT-5.6-sol/high for the required quality audit; fix every `revise`/`block` finding and re-audit.
- [ ] Commit and push only source-recovery files; do not package, deploy, or contact a production service.
