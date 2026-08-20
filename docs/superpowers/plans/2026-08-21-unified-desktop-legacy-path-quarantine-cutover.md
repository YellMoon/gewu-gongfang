# Unified Desktop Legacy-Path Quarantine and Cutover Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an exact static inventory and quarantine boundary for the legacy `primary-host` and manual device-approval implementation before introducing the unified-desktop flow.

**Architecture:** The current legacy flow spans backend identity services, HTTP routes, desktop vault/client code, Electron IPC, build/runtime configuration, host workers, and tests. A repository-wide ban is invalid while that implementation exists, and a broad allow-list would be misleading. First lock an immutable inventory; then, once a new `unified-desktop` namespace exists, gate its transitive imports, route constants, IPC capabilities, state tokens, and persistence tokens against that inventory.

**Tech Stack:** Node.js static source-contract tests and Markdown inventory only. No import execution, Electron, SQLite/PostgreSQL, Docker, network, legacy source disk, NAS, account, device, or release access.

---

## Current facts and non-goals

- The current runtime contains `primary-host` and `desktop-client` flavors, `identity_verified_pending_approval` and `approved_pending_exchange` statuses, `desktop_device_authorizations`, and `/api/desktop-identity/primary-host/*` routes.
- Existing `awaiting_confirmation` draft and offline-lease tests demonstrate local legacy behavior only; they are not evidence of a cloud-authoritative command flow.
- This plan neither removes nor invokes the old implementation. It creates no new login, registration API, writer, database DDL, deployment, or release.
- The target architecture is defined in `docs/superpowers/specs/2026-08-21-unified-desktop-silent-registration-offline-draft-admission-design.md`: one desktop installer, online verification followed by silent registration, offline encrypted drafts awaiting explicit confirmation, and cloud-only business writes.

## Inventory contract

Create `docs/superpowers/inventories/2026-08-21-unified-desktop-legacy-path-inventory.md`. Every record must contain: `id`, `sourceFile`, `symbolOrRoute`, `legacyToken`, `callers`, `callees`, `persistence`, `disposition`, and `newPathForbiddenReason`. The checked-in inventory is an explicit literal list: no glob, wildcard, directory shorthand, or inferred catch-all record is allowed.

Allowed dispositions are exactly `retain-for-diagnostics`, `migration-reader-only`, `terminal-deny`, and `future-remove`. Missing fields, unknown dispositions, or records without callers and callees make the inventory invalid. `migration-reader-only` may name only a future, independently reviewed narrow reader symbol with no write, transaction, network-send, submit, executor, or legacy service import. No current module with a generic write API may receive that disposition.

The first inventory must include, at minimum, these known source/call edges. Implementation must extract the final source, symbol/route, and token sets from checked-in sources and compare both directions; this table is a starting requirement, not a hand-maintained allow-list.

| Area | Required source files | Known edges/tokens | Initial disposition |
| --- | --- | --- | --- |
| Backend identity state | `backend/src/services/desktopIdentityService.js` | `createDesktopIdentityService`, `approveChallenge`, `desktop_device_authorizations`, approval statuses | `terminal-deny` |
| HTTP identity and approval | `backend/src/routes/desktopIdentity.js`, `backend/src/app.js` | `/api/desktop-identity`, `/primary-host/*`, `createDesktopIdentityRouter` | `terminal-deny` |
| Host cloud relay | `backend/src/routes/cloudRelayHost.js`, `backend/src/routes/cloudRelay.js` | host credential and host-relay paths | `terminal-deny` |
| Desktop identity vault/client | `public/desktopIdentityVault.js`, `src/services/desktopIdentityClient.mjs` | `beginRegistration`, `completeRegistration`, approval exchange, offline lease | `future-remove` |
| Build, preload and IPC | `public/desktopBuildFlavor.js`, `public/runtimeConfig.js`, `public/preload.js`, `public/electron.js` | flavors, `primary-host:*`, `desktop-identity:*` | `future-remove` |
| Host worker and local execution | `public/primaryHostRuntimeManager.js`, `public/primaryHostRuntimeStatus.js`, `public/primaryHostListenPolicy.js`, `public/windowsHostFirewall.js`, `public/primaryHostRelaunchReadiness.js` | LAN listener, firewall, local command execution | `terminal-deny` |
| Local draft and transport | `public/desktopAuthorityRuntime.js`, `src/services/desktopAuthorityClient.mjs`, `src/services/desktopCommandOutbox.mjs`, `src/services/authoritySyncSurfacePolicy.mjs` | `awaiting_confirmation`, `primary-host-local`, local executor | `terminal-deny` |
| UI and configuration | `src/components/DesktopIdentityGate.tsx`, `src/pages/IdentityDeviceCenter.tsx`, `src/services/identityDeviceCenterPolicy.mjs`, `src/services/managedSyncConfig.mjs`, `src/services/runtimeConfigClient.ts` | approval UI and host/client role logic | `future-remove` |
| Storage and schema | `backend/src/schema.sql`, `backend/src/database.js`, `backend/src/services/desktopSessionService.js`, `backend/src/services/desktopDeviceChallengeService.js` | legacy challenge, authorization, session and offline-lease storage | `terminal-deny` |
| Tests and E2E | `backend/src/routes/desktopIdentity.http.test.js`, `backend/src/routes/primaryHostIdentity.http.test.js`, `public/primaryHostCredentialStore.test.js`, `public/primaryHostListenPolicy.test.js`, `public/primaryHostLocalDraftExecution.test.js`, `public/primaryHostOperationValidation.test.js`, `public/primaryHostRuntimeManager.test.js`, `scripts/isolated-primary-host-profile.js`, `scripts/real-two-desktop-e2e.js`, `scripts/prepare-isolated-primary-host.js`, `scripts/promote-primary-host-runtime.js` | approval, dual-app, host-profile evidence | `retain-for-diagnostics` |

## Permitted future call graph

```text
online account verification + device private-key proof
  -> cloud silent-registration command
  -> atomic, idempotent device / installation / account-link registration
  -> short online session

held valid local session
  -> encrypted awaiting_confirmation draft
  -> explicit user confirmation after impact/conflict view
  -> cloud-authoritative command using the same idempotency key
```

A future new namespace must have no edge to `identity_verified_pending_approval`, `approved_pending_exchange`, `desktop_device_authorizations`, `/primary-host/*`, `primary-host:*`, either build flavor, a host/LAN/local executor, or legacy SQLite business writes.

### Task 1: Lock the legacy inventory

**Files:**
- Create: `scripts/unified_desktop_legacy_path_inventory.test.js`
- Create: `docs/superpowers/inventories/2026-08-21-unified-desktop-legacy-path-inventory.md`
- Modify: `package.json`

- [ ] **Step 1: Write the failing exact-inventory test**

```js
assert.deepStrictEqual(
  normalizedInventoryEntries,
  EXPECTED_LEGACY_ENTRIES,
  'the inventory must freeze every source file, symbol/route, token and call edge exactly'
);
assert.deepStrictEqual(
  extractedLegacyEdges,
  expectedExtractedLegacyEdges,
  'checked-in source edges and inventory entries must have no missing or extra item'
);
assert.ok(inventory.every(entry => ALLOWED_DISPOSITIONS.has(entry.disposition)));
```

The initial red cases must independently mutate: an additional approval status in `desktopIdentityService`, a `primary-host:*` capability in `preload`, a legacy table token in `schema.sql`, and a host route in a legacy E2E fixture. Each must produce `UNIFIED_DESKTOP_LEGACY_INVENTORY_INVALID`. A record labelled `migration-reader-only` that contains `INSERT`, `UPDATE`, `DELETE`, transaction control, `send`, `submit`, `execute`, or an import of a listed legacy service must also fail.

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/unified_desktop_legacy_path_inventory.test.js`

Expected: FAIL because the machine-readable inventory and exact extractor do not exist.

- [ ] **Step 3: Implement the smallest static parser and inventory**

Read only explicitly enumerated workspace source files. Do not execute imports. Reject extra or missing source/token/symbol/call-edge entries, unknown dispositions, missing call-edge fields, wildcard sources, and dynamic import syntax with `UNIFIED_DESKTOP_LEGACY_INVENTORY_INVALID`. The inventory must name every test file explicitly rather than using `primaryHost*.test.js` or another pattern.

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/unified_desktop_legacy_path_inventory.test.js`

Expected: PASS without reporting source data, user/device values, paths outside the workspace, or runtime state.

- [ ] **Step 5: Commit**

```bash
git add scripts/unified_desktop_legacy_path_inventory.test.js docs/superpowers/inventories/2026-08-21-unified-desktop-legacy-path-inventory.md package.json
git commit -m "test: lock legacy desktop path inventory"
```

### Task 2: Gate the new namespace, not the legacy code

**Files:**
- Create: `scripts/check_unified_desktop_transition_boundary.js`
- Create: `scripts/check_unified_desktop_transition_boundary.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write isolated forbidden-edge tests**

```js
const forbidden = [
  "require('../public/primaryHostRuntimeManager')",
  "'/api/desktop-identity/primary-host/status'",
  "'identity_verified_pending_approval'",
  "'desktop_device_authorizations'",
  "'primary-host:execute-local-draft'",
];
```

Each must produce `UNIFIED_DESKTOP_LEGACY_EDGE_FORBIDDEN`. A new legacy token such as `primary-host-new-route` must instead fail the Task 1 inventory check.

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/check_unified_desktop_transition_boundary.test.js`

Expected: FAIL because the transition-boundary checker does not exist.

- [ ] **Step 3: Implement the closure-owned source-map checker**

Before any new implementation, the source-map mode is test-only and its PASS result is labelled `checker-contract-only`. Once the first unified-desktop entrypoint is committed, replace that mode with an explicit non-empty `UNIFIED_DESKTOP_ENTRYPOINTS` workspace-root list. Resolve each root by realpath, require it stays inside the workspace, recursively enumerate its real CJS/ESM literal imports, and reject omitted roots, extra relative imports, paths escaping the roots, dynamic require/import, and any forbidden transitive import, route constant, IPC capability, state token, or persistence token. The checker must not declare an empty new namespace as a completed runtime cutover.

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/check_unified_desktop_transition_boundary.test.js`

Expected: PASS for the allowed synthetic example only as `checker-contract-only`, and reject each independent forbidden edge. The first non-empty real entrypoint must enable the real graph mode in the same commit; omitted entrypoints and graph escapes must be RED cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/check_unified_desktop_transition_boundary.js scripts/check_unified_desktop_transition_boundary.test.js package.json
git commit -m "test: guard unified desktop transition boundary"
```

### Task 3: Design the command before implementation

**Files:**
- Create: `docs/superpowers/specs/2026-08-21-unified-desktop-registration-command-design.md`
- Create: `docs/superpowers/plans/2026-08-21-unified-desktop-registration-command-implementation.md`

- [ ] **Step 1: Freeze the registration envelope and replay order**

Specify `idempotencyKey`, `accountId`, `installationId`, `devicePublicKeyFingerprint`, `logicalRequestSha256`, verification-event reference, challenge signature, and required version bindings. Exact logical registration must be looked up before first-use verification consumption; session secrets never enter a receipt.

- [ ] **Step 2: Freeze the offline draft envelope**

Specify encrypted `awaiting_confirmation` command summary, idempotency key and versions. New-device offline login, automatic restart submission, automatic network-recovery submission, and host/LAN fallback are failure cases.

- [ ] **Step 3: Write the required TDD matrix**

Cover silent success, exact replay, account/key/installation conflicts, nonce/audience/expiry/consumption, revocation, offline session eligibility, draft restart, exactly-once confirmation, network retry, and legacy-path non-reachability. Require a cloud command-specific writer before any real session or business write.

- [ ] **Step 4: Verify design gates before commit**

Run: `node scripts/unified_desktop_legacy_path_inventory.test.js && node scripts/check_unified_desktop_transition_boundary.test.js && npm run test:cloud-business-authority-contract`

Expected: PASS; documentation must not claim a runtime cutover.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-21-unified-desktop-registration-command-design.md docs/superpowers/plans/2026-08-21-unified-desktop-registration-command-implementation.md
git commit -m "docs: plan unified desktop registration command"
```

## Acceptance and stop condition

This plan only freezes the inventory, future boundary and implementation order. It does not mean that host approval is removed, the unified desktop has switched, or an arbitrary computer can safely log in.

After Tasks 1–3, stop for an independently approved cloud command writer, account-verification contract and session-key lifecycle. Only then may the actual registration and draft-submit implementation begin in a new isolated workflow.
