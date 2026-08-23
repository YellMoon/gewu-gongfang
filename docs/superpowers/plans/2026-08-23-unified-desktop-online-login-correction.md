# Unified Desktop Online Login Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the retired device-approval path from the desktop login flow and expose cloud account-password verification alongside WeChat verification.

**Architecture:** Cloud is the only identity and device authority. The desktop generates a device key, proves possession after a short-lived cloud verification, then seals cloud-issued session data with a local unlock password.

**Tech Stack:** React/TypeScript, Electron IPC vault, Node assertion tests, cloud Express API.

---

### Task 1: Define recovery as cloud silent registration

**Files:** `public/desktopIdentityVault.test.js`, `public/desktopIdentityVault.js`

- [x] Add a failing vault test for recovery with a fresh key-derived device identity.
- [x] Run `node public/desktopIdentityVault.test.js` and verify it fails.
- [x] Add the smallest recovery pending API without replacing the envelope.
- [x] Re-run the vault test and verify it passes.

### Task 2: Route recovery and password verification through cloud registration

**Files:** `src/services/desktopIdentityClient.test.js`, `src/services/desktopIdentityClient.mjs`

- [x] Add failing tests for cloud recovery registration and delayed vault replacement.
- [x] Run the client test and verify it fails.
- [x] Implement the client flow using short-lived cloud proofs.
- [x] Re-run the client test and verify it passes.

### Task 3: Present unified identity choices

**Files:** `src/components/DesktopIdentityGate.test.js`, `src/components/DesktopIdentityGate.tsx`

- [x] Add a failing UI-source assertion for account password inputs and no old approval text.
- [x] Implement the account-password option and unified recovery path.
- [x] Run the gate and identity tests.

### Task 4: Publish after regression verification

- [x] Run identity, authority-architecture, and cloud API tests.
- [x] Verify the running Electron screen without entering credentials.
- [ ] Commit the exact changed files and push `gewu/master`.
