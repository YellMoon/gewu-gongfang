# Unified Release Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent desktop, data-host, Backend, Gateway, and WeChat development releases from drifting to different versions.

**Architecture:** A generated local release manifest carries one already-committed source version through every publishing endpoint. Each endpoint rejects mismatches and records only its own exact-version success receipt. Completion requires all five receipts.

**Tech Stack:** Node.js release scripts, Python deployment scripts, npm tests, OSS publisher, WeChat DevTools/miniprogram-ci.

---

### Task 1: Release manifest contract

**Files:**
- Create: `scripts/release-matrix.js`
- Test: `scripts/release-matrix.test.js`

- [x] Write a failing test for required targets, version mismatches, duplicate receipts, and stale packages.
- [x] Implement `prepare`, `assert`, `record`, `status`, and `complete` with exact-version validation.
- [x] Run the contract test.

### Task 2: Connect publishing boundaries

**Files:**
- Modify: `package.json`, `scripts/upload-miniapp.js`, `scripts/publish-oss-feed.js`, `scripts/deploy.py`, `scripts/deploy_gateway.py`
- Test: `scripts/release-boundary.test.js`, `scripts/release-matrix-python.test.js`

- [x] Make desktop packaging consume, rather than increment, the prepared version.
- [x] Make OSS, Backend, Gateway, and WeChat endpoints reject absent or mismatched manifests.
- [x] Record endpoint receipts only after their successful result.
- [x] Run the isolated Node and Python boundary tests.

### Task 3: Operational specification and regression wiring

**Files:**
- Create: `docs/release-version-matrix.md`
- Modify: `scripts/update-version.test.js`, `package.json`

- [x] Document the one-version workflow, receipts, retries, and rollback boundary.
- [x] Add release-matrix checks to standard test coverage.
- [x] Run targeted release regressions, full `npm test`, miniapp build/release check, and inspect the final diff.
- [ ] Commit and push the isolated release-governance changes.
