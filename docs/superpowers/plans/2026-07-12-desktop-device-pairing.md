# Desktop Device Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide a usable, super-admin-approved desktop pairing flow and identical secure cloud relay authorization in local backend and formal gateway.

**Architecture:** A shared pairing contract owns normalization, secret hashing, expiry and stable errors. Backend and gateway expose identical routes backed by additive tables; the desktop stores only the generated secret and exchanged short session in sessionStorage. Gateway signs relay assertions after persisted user/device checks; host verifies and consumes nonces.

**Tech Stack:** Node.js, Express, SQLite, JWT, React, Web Crypto.

---

### Task 1: Pairing persistence and service

**Files:** Create `backend/src/services/desktopPairingService.js`; modify backend/gateway schemas; test `backend/src/services/desktopPairingService.test.js`.

- [ ] Write failing tests for pending start, secret mismatch, expiry and one-time exchange.
- [ ] Run the focused test and confirm missing-module RED.
- [ ] Implement normalized phone, SHA-256 secret verification and CAS exchange.
- [ ] Re-run the focused test and confirm GREEN.

### Task 2: Identical routes

**Files:** Create backend/gateway desktop pairing routes; modify app mounts; add HTTP and parity tests.

- [ ] Test public start, ordinary-admin denial, super-admin approval, and exchange failures.
- [ ] Implement identical start/exchange/approve/reject endpoints and audit writes.
- [ ] Run backend, gateway and parity tests.

### Task 3: Desktop session and UI

**Files:** Modify `desktopAuthorizationSession.mjs` and `SyncSettings.tsx`; add focused tests.

- [ ] Test generated secret, API helpers, save/clear and UI writer wiring.
- [ ] Implement the helpers and minimal manual approval/refresh flow.
- [ ] Run focused desktop tests.

### Task 4: Formal gateway relay

**Files:** Modify gateway cloud relay route, schema and HTTP tests.

- [ ] Test owner success and anonymous/cross-owner/missing-secret denial.
- [ ] Implement gateway device registration, HMAC assertion and task persistence.
- [ ] Run gateway relay tests.

### Task 5: Verification

**Files:** Modify `package.json` and `task.md`.

- [ ] Add focused tests explicitly to the package test chain.
- [ ] Run `npm test`, `npm run build`, and `git diff --check`.
- [ ] Restore build-only version output, update evidence, and commit.
