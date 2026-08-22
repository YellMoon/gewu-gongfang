# Unified Desktop Cloud Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all host/client desktop authority modes with one cloud-authorized desktop package that retains only encrypted local drafts.

**Architecture:** Cloud API is the sole business and structured-question authority. Every desktop has the same package and first-login identity flow; an offline desktop may save encrypted drafts but may only submit after an explicit user confirmation while online. NAS remains a separate encrypted media worker, never a desktop role.

**Tech Stack:** Electron, React, Node.js, PostgreSQL, existing Node test runners.

---

### Task 1: One package identity

**Files:** `package.json`, `public/desktopBuildFlavor.js`, `public/desktopBuildFlavor.test.js`, `scripts/unified-desktop-package-boundary.test.js`

- [ ] Write failing assertions:

```js
assert.strictEqual(packageJson.desktopBuildFlavor, 'unified-desktop');
assert.strictEqual(resolveDesktopBuildFlavor({ isPackaged: true }), 'unified-desktop');
assert.doesNotMatch(source, /PRIMARY_HOST_FLAVOR|desktop-client|primary-host/);
```

- [ ] Run `node public/desktopBuildFlavor.test.js && node scripts/unified-desktop-package-boundary.test.js`; expect failure.
- [ ] Replace flavour resolution with `const UNIFIED_DESKTOP_FLAVOR = 'unified-desktop'; function resolveDesktopBuildFlavor() { return UNIFIED_DESKTOP_FLAVOR; }`; remove per-flavour updater feeds.
- [ ] Re-run the same command; expect PASS.
- [ ] Commit: `git add package.json public/desktopBuildFlavor.js public/desktopBuildFlavor.test.js scripts/unified-desktop-package-boundary.test.js && git commit -m "auto release 2026-08-23"`.

### Task 2: Cloud-only runtime configuration

**Files:** `public/runtimeConfig.js`, `public/runtimeConfig.test.js`, `src/services/runtimeConfigClient.ts`, `src/services/managedSyncConfig.mjs`, `src/services/managedSyncConfig.test.js`

- [ ] Write failing tests:

```js
assert.strictEqual(normalizeRuntimeConfig({ nodeRole: 'primary-host' }, opts).nodeRole, undefined);
assert.strictEqual(normalizeRuntimeConfig({ nodeRole: 'desktop-client' }, opts).nodeRole, undefined);
assert.strictEqual(normalizeRuntimeConfig({}, opts).cloudBaseUrl, DEFAULT_MANAGED_CLOUD_BASE_URL);
```

- [ ] Run `node public/runtimeConfig.test.js && node src/services/managedSyncConfig.test.js`; expect failure.
- [ ] Remove `nodeRole`, host epochs, host address, host promotion and demotion persistence. Keep cloud base URL, local cache path, device display name, and non-authoritative draft configuration only.
- [ ] Re-run the focused tests; expect PASS.
- [ ] Commit the five files with message `auto release 2026-08-23`.

### Task 3: Delete desktop local-authority capabilities

**Files:** `public/electron.js`, `public/preload.js`, `public/electronRuntimeContracts.test.js`, `public/electronShellPolicy.test.js`, `public/primaryHostListenPolicy.js`, `public/primaryHostListenPolicy.test.js`

- [ ] Write failing tests:

```js
assert.doesNotMatch(electronSource, /ipcMain\.handle\('primary-host:/);
assert.doesNotMatch(preloadSource, /primaryHostRuntime/);
assert.strictEqual(resolveEmbeddedListenHost({}), '127.0.0.1');
```

- [ ] Run `node public/electronRuntimeContracts.test.js && node public/primaryHostListenPolicy.test.js`; expect failure.
- [ ] Delete host manager, host command worker, LAN firewall, host websocket, local execution, and every `primary-host:*` IPC handler. Preserve only identity and encrypted `desktop-authority:*` draft outbox IPC.
- [ ] Run `node public/electronRuntimeContracts.test.js && node public/electronShellPolicy.test.js && node public/primaryHostListenPolicy.test.js`; expect PASS.
- [ ] Commit the six files with message `auto release 2026-08-23`.

### Task 4: Explicit cloud confirmation for every draft

**Files:** `public/desktopAuthorityRuntime.js`, `src/services/desktopAuthorityClient.mjs`, `src/components/AuthorityOutboxPanel.tsx`, `public/desktopAuthorityRuntime.test.js`, `src/services/desktopAuthorityClient.test.js`

- [ ] Write failing tests:

```js
await assert.rejects(() => runtime.submit(id, { sessionToken }), /DESKTOP_OFFLINE_DRAFT_SUBMISSION_FORBIDDEN/);
assert.strictEqual(result.transportUsed, 'cloud-business-authority');
assert.doesNotMatch(runtimeSource, /primary-host-local|executeLocalDraft/);
```

- [ ] Run `node public/desktopAuthorityRuntime.test.js && node src/services/desktopAuthorityClient.test.js`; expect failure.
- [ ] Remove local execution transport. Confirmed drafts require online state and current cloud session, submit exactly once to the cloud command route, and record the cloud receipt. Reconnect never submits automatically.
- [ ] Re-run the focused tests; expect PASS.
- [ ] Commit the five files with message `auto release 2026-08-23`.

### Task 5: Remove host UI and release gates

**Files:** `src/pages/SystemSettings.tsx`, `src/pages/IdentityDeviceCenter.tsx`, `src/pages/QuestionBankPaper.tsx`, `src/pages/SystemSettings.test.js`, `src/pages/IdentityDeviceCenter.test.js`, `scripts/realTwoDesktopE2e.test.js`, `scripts/check_cloud_business_authority_contract.js`, `scripts/check_deploy_readiness.js`, `scripts/release-matrix.js`

- [ ] Write failing UI and gate assertions:

```js
assert.doesNotMatch(settingsSource, /primary-host|desktop-client/);
assert.doesNotMatch(identitySource, /host bootstrap|host transfer|host recovery/i);
assert.match(twoDesktopTest, /same installer.*online first login.*confirmed cloud submit/is);
```

- [ ] Run `node src/pages/SystemSettings.test.js && node src/pages/IdentityDeviceCenter.test.js && node scripts/realTwoDesktopE2e.test.js`; expect failure.
- [ ] Replace host controls with cloud connection, signed-session expiry, encrypted draft count, and explicit submit state. Make release gates reject a second installer, host authority residue, missing NAS health, or missing miniapp constraints.
- [ ] Run `npm test && npm run build && npm run dist:win && npm run publish:desktop-update`; expect tests and one installer feed to pass. Deploy cloud API, upload/verify miniapp, and record NAS health before claiming unified release.
- [ ] Commit and push only `gewu master`.

## Self-review

- Tasks 1, 3, and 5 remove the two-desktop product split.
- Tasks 2 and 4 preserve cloud authority and explicit online submission.
- Task 5 makes NAS and miniapp part of the release matrix without granting them business authority.
