# Desktop Pairing Session Renewal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a paired ordinary desktop unlock and obtain an online sync session through the authoritative data host, while extending offline leases from 72 hours to 14 days.

**Architecture:** The local password opens the encrypted vault. A `single_user_pairing` device first challenges a reachable data host directly and otherwise sends a secret-protected start/exchange task through the cloud relay. The data host remains the only authorization authority; the relay cannot issue a session while the host is unavailable.

**Tech Stack:** Electron, React, Node.js, Express, SQLite, Ed25519, JWT, Node assert tests.

---

### Task 1: Fourteen-day offline lease

**Files:**
- Modify: `backend/src/services/desktopDeviceChallengeService.js`
- Modify: `backend/src/services/desktopDeviceChallengeService.test.js`
- Modify: `backend/src/routes/desktopIdentity.http.test.js`
- Modify: `public/desktopIdentityVault.js`
- Modify: `public/desktopIdentityVault.test.js`
- Modify: `src/services/desktopIdentityClient.mjs`
- Modify: `src/services/desktopIdentityClient.test.js`

- [ ] **Step 1: Write failing duration and boundary tests**

```js
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
assert.strictEqual(
  Date.parse(lease.expiresAt) - Date.parse(lease.issuedAt),
  FOURTEEN_DAYS_MS
);
```

Add assertions that the lease remains valid immediately before the 14-day boundary and becomes invalid immediately after it.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node backend/src/services/desktopDeviceChallengeService.test.js
node public/desktopIdentityVault.test.js
node src/services/desktopIdentityClient.test.js
```

Expected: FAIL because the current constant is 72 hours.

- [ ] **Step 3: Implement the common limit**

```js
const OFFLINE_LEASE_MAX_MS = 14 * 24 * 60 * 60 * 1000;
```

- [ ] **Step 4: Verify GREEN**

Run the commands from Step 2 and expect PASS.

### Task 2: Secret-protected cloud relay challenge

**Files:**
- Create: `backend/src/services/desktopSessionRelayService.js`
- Create: `backend/src/services/desktopSessionRelayService.test.js`
- Modify: `backend/src/routes/cloudRelay.js`
- Modify: `backend/src/routes/cloudRelay.http.test.js`
- Modify: `backend/src/routes/cloudRelayHost.js`
- Modify: `backend/src/routes/cloudRelayHostTasks.test.js`

- [ ] **Step 1: Write failing service and HTTP tests**

Test that only a hash of the request secret is stored, an incorrect secret cannot read a challenge or token, only the current host can process start/exchange tasks, the relay cannot issue sessions itself, and expired/replayed requests return stable error codes.

- [ ] **Step 2: Verify RED**

```powershell
node backend/src/services/desktopSessionRelayService.test.js
node backend/src/routes/cloudRelay.http.test.js
node backend/src/routes/cloudRelayHostTasks.test.js
```

Expected: FAIL because the relay service and routes do not exist.

- [ ] **Step 3: Implement minimal routes and host task handlers**

Expose:

```text
POST /api/cloud/desktop-session/challenges/start
GET  /api/cloud/desktop-session/requests/:id
POST /api/cloud/desktop-session/challenges/:id/exchange
```

The host task handlers call the existing `startChallenge()` and `exchangeChallenge()` services against the host database. The relay stores no authorization record and no plaintext request secret.

- [ ] **Step 4: Verify GREEN**

Run the commands from Step 2 and expect PASS.

### Task 3: Direct-first client renewal

**Files:**
- Create: `src/services/desktopSessionRelayClient.mjs`
- Create: `src/services/desktopSessionRelayClient.test.js`
- Modify: `src/services/desktopIdentityClient.mjs`
- Modify: `src/services/desktopIdentityClient.test.js`
- Modify: `src/components/DesktopIdentityGate.tsx`
- Modify: `src/components/DesktopIdentityGate.test.js`

- [ ] **Step 1: Write failing orchestration tests**

Cover direct host success, direct network failure followed by relay success, online session persistence, 14-day lease refresh, network-only offline fallback, no fallback for revocation or credential mismatch, and an online-session refresh before manual sync.

- [ ] **Step 2: Verify RED**

```powershell
node src/services/desktopSessionRelayClient.test.js
node src/services/desktopIdentityClient.test.js
node src/components/DesktopIdentityGate.test.js
```

Expected: FAIL because paired devices are currently forced offline.

- [ ] **Step 3: Implement the orchestration**

Pass `hostBaseUrl` and `cloudBaseUrl` into `desktopIdentityClient.unlock()`. For `single_user_pairing`, try direct challenge then relay challenge. On success use the existing lease refresh and session store. Only transport/host-unavailable failures may use a still-valid offline lease.

- [ ] **Step 4: Verify GREEN**

Run the commands from Step 2 and expect PASS.

### Task 4: Cross-layer verification and release

**Files:**
- Modify: `package.json`
- Modify: `backend/package.json`
- Modify: `src/generated/version.ts`
- Modify: `docs/verification-2026-07-17-desktop-human-identity.md`

- [ ] **Step 1: Run full checks**

```powershell
npm run typecheck
npm test
npm run build
```

- [ ] **Step 2: Apply the automatic patch bump**

This is a backward-compatible authentication/sync bug fix, so bump `6.4.4` to `6.4.5` in every version source.

- [ ] **Step 3: Verify the real flow**

Verify first pairing, restart unlock, manual sync, offline entry, the 14-day boundary, expired lease rejection, and renewal after the host returns.

- [ ] **Step 4: Commit, push, package, publish, and deploy**

Stage all intended tracked files, commit once with the project release message, push the current branch to `gewu/master`, run `npm run dist:win`, publish the desktop update, rebuild native modules for Node, and rerun the full test suite.

Then back up and deploy the cloud and local data host, verify internal/public health and authorization contracts, and verify the OSS installer/feed without changing the host data directory.
