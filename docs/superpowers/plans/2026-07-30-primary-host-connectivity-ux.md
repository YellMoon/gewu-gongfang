# Primary-host connectivity UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep cloud relay usable without a Windows firewall rule and make LAN direct access an explicit optional primary-host acceleration.

**Architecture:** Retain the existing narrow helper and invoke it only after a deliberate UI confirmation. Localize the renderer state and run firewall audit only for an explicit LAN acceptance row.

**Tech Stack:** React/TypeScript, Electron IPC, Node assert tests, PowerShell, isolated packaged Electron checks.

---

## File map

- `src/pages/SystemSettings.tsx`: optional LAN card, confirmation, localized status messages.
- `src/pages/SystemSettings.test.js`: product-copy regression checks.
- `public/windowsHostFirewall.test.js`: explicit-action and narrow-rule contract.
- `src/services/authorityTransports.test.js`: durable fallback after LAN unavailable.
- `public/desktopAuthorityRuntime.test.js`: cloud projection fallback evidence.
- `scripts/real-two-desktop-e2e.js`: LAN-only firewall preflight.
- `scripts/realTwoDesktopE2e.test.js`: static harness contract.
- `task.md`: terminal isolated acceptance evidence only.

### Task 1: Make the primary-host UI explicit and localized

**Files:** `src/pages/SystemSettings.tsx`, `src/pages/SystemSettings.test.js`, `public/windowsHostFirewall.test.js`

- [ ] **Step 1: Write the failing UI assertions**

```js
assert.ok(source.includes('\\u5c40\\u57df\\u7f51\\u76f4\\u8fde\\uff08\\u53ef\\u9009\\uff09'));
assert.ok(source.includes('\\u4e91\\u4e2d\\u7ee7\\u59cb\\u7ec8\\u53ef\\u7528\\uff0c\\u65e0\\u9700\\u8bbe\\u7f6e Windows \\u9632\\u706b\\u5899'));
assert.ok(source.includes('\\u542f\\u7528\\u5c40\\u57df\\u7f51\\u76f4\\u8fde'));
assert.ok(source.includes('\\u4e0d\\u9700\\u8981\\u624b\\u5de5\\u521b\\u5efa\\u9632\\u706b\\u5899\\u89c4\\u5219'));
assert.ok(source.includes('\\u662f\\u5426\\u542f\\u7528\\u5c40\\u57df\\u7f51\\u76f4\\u8fde\\uff1f'));
assert.ok(!source.includes('message="LAN access"'));
assert.ok(!source.includes('Enable LAN access'));
```

- [ ] **Step 2: Verify RED**

Run: `node src/pages/SystemSettings.test.js`

Expected: fail because the existing card is English and directly invokes elevation.

- [ ] **Step 3: Implement the confirmed UI**

Import `Popconfirm`. Replace the English alert with `message="\\u5c40\\u57df\\u7f51\\u76f4\\u8fde\\uff08\\u53ef\\u9009\\uff09"` and the following semantic contents:

```tsx
<span>\\u4e91\\u4e2d\\u7ee7\\u59cb\\u7ec8\\u53ef\\u7528\\uff0c\\u65e0\\u9700\\u8bbe\\u7f6e Windows \\u9632\\u706b\\u5899\\u3002</span>
<span>\\u5c40\\u57df\\u7f51\\u76f4\\u8fde\\u4ec5\\u7528\\u4e8e\\u52a0\\u5feb\\u540c\\u4e00\\u4e13\\u7528\\u7f51\\u7edc\\u5185\\u5df2\\u6388\\u6743\\u8bbe\\u5907\\u8bbf\\u95ee\\u672c\\u673a\\u6570\\u636e\\u4e3b\\u673a\\u7684\\u901f\\u5ea6\\u3002</span>
<span>{windowsHostFirewallStatus?.state === 'enabled' ? `\\u5df2\\u542f\\u7528\\uff1a\\u4ec5\\u4e13\\u7528\\u7f51\\u7edc\\u3001\\u672c\\u5730\\u5b50\\u7f51\\u3001TCP ${windowsHostFirewallStatus.localPort || '-'}` : '\\u672a\\u542f\\u7528\\u5c40\\u57df\\u7f51\\u76f4\\u8fde\\u65f6\\uff0c\\u8f6f\\u4ef6\\u4f1a\\u7ee7\\u7eed\\u901a\\u8fc7\\u4e91\\u4e2d\\u7ee7\\u5de5\\u4f5c\\u3002'}</span>
<span>\\u4e0d\\u9700\\u8981\\u624b\\u5de5\\u521b\\u5efa\\u9632\\u706b\\u5899\\u89c4\\u5219\\u3002</span>
```

Keep `\\u68c0\\u67e5\\u72b6\\u6001`. Place the existing request behind this sole `Popconfirm` action:

```tsx
<Popconfirm title="\\u662f\\u5426\\u542f\\u7528\\u5c40\\u57df\\u7f51\\u76f4\\u8fde\\uff1f" description="\\u5c06\\u8bf7\\u6c42\\u4e00\\u6b21 Windows \\u7ba1\\u7406\\u5458\\u6388\\u6743\\uff0c\\u4ec5\\u5141\\u8bb8\\u672c\\u673a\\u5df2\\u5b89\\u88c5\\u7684\\u6570\\u636e\\u4e3b\\u673a\\u7a0b\\u5e8f\\u5728\\u4e13\\u7528\\u7f51\\u7edc\\u7684\\u672c\\u5730\\u5b50\\u7f51\\u901a\\u8fc7\\u6307\\u5b9a TCP \\u7aef\\u53e3\\u63a5\\u6536\\u8fde\\u63a5\\u3002\\u62d2\\u7edd\\u6388\\u6743\\u4e0d\\u4f1a\\u5f71\\u54cd\\u4e91\\u4e2d\\u7ee7\\u3002" okText="\\u8bf7\\u6c42\\u6388\\u6743" cancelText="\\u7ee7\\u7eed\\u4f7f\\u7528\\u4e91\\u4e2d\\u7ee7" onConfirm={() => void requestWindowsHostLanFirewall()}>
  <Button size="small" type="primary" loading={windowsHostFirewallLoading}>\\u542f\\u7528\\u5c40\\u57df\\u7f51\\u76f4\\u8fde</Button>
</Popconfirm>
```

Make every declined/error notice state that cloud relay remains usable. Do not alter the helper, IPC channel names, or startup lifecycle.

- [ ] **Step 4: Extend and verify the safety test**

Append `assert.strictEqual(plan.requiresExplicitAction, true);`, `assert.strictEqual(elevated.action, 'ensure');`, and `assert.ok(elevated.args.includes('-EncodedCommand'));` to `public/windowsHostFirewall.test.js`.

Run: `node public/windowsHostFirewall.test.js; node src/pages/SystemSettings.test.js; node src/pages/systemSettingsAuthoritySurface.test.js`

Expected: all pass and the host authority monitor remains rendered.

- [ ] **Step 5: Commit**

Run: `git add -- src/pages/SystemSettings.tsx src/pages/SystemSettings.test.js public/windowsHostFirewall.test.js; git commit -m "clarify optional LAN access"`

### Task 2: Prove relay fallback is independent of LAN availability

**Files:** `src/services/authorityTransports.test.js`, `public/desktopAuthorityRuntime.test.js`

- [ ] **Step 1: Add the failing durable fallback case**

```js
const durableCalls = [];
const selector = createAuthorityTransportSelector({
  lanTransport: { name: 'lan-websocket', isReady: async () => false },
  relayWebSocketTransport: { name: 'relay-websocket', isReady: async () => false },
  durableRelayTransport: { name: 'durable-relay', isReady: async () => true, submit: async value => { durableCalls.push(value); return receipt; } },
});
const delivered = await selector.submit(envelope);
assert.strictEqual(delivered.transportUsed, 'durable-relay');
assert.deepStrictEqual(durableCalls, [envelope]);
assert.deepStrictEqual(delivered.diagnostics, [{ name: 'lan-websocket', code: 'TRANSPORT_UNAVAILABLE' }, { name: 'relay-websocket', code: 'TRANSPORT_UNAVAILABLE' }]);
```

- [ ] **Step 2: Verify RED and preserve the selector contract**

Run: `node src/services/authorityTransports.test.js`

Expected: first RED only if a fixture transport name is not the real adapter name. Do not change `authorityTransports.mjs` unless this exposes a real defect: it may fall through only after unavailable/retryable transport conditions, never after a receipt or authorization rejection.

- [ ] **Step 3: Add cloud-projection fallback evidence and verify GREEN**

After `await runtime.readProjection()` in `public/desktopAuthorityRuntime.test.js`, add:

```js
assert.ok(calls.some(call => call.url === 'http://host.lan/api/authority/projections/current'));
assert.ok(calls.some(call => call.url === 'https://control.example/api/authority/projections/current'));
```

Run: `node src/services/authorityTransports.test.js; node public/desktopAuthorityRuntime.test.js`

Expected: the same frozen envelope reaches durable relay and cloud projection follows unavailable LAN.

- [ ] **Step 4: Commit**

Run: `git add -- src/services/authorityTransports.test.js public/desktopAuthorityRuntime.test.js; git commit -m "cover relay fallback without LAN"`

### Task 3: Make firewall preflight LAN-only in isolated acceptance

**Files:** `scripts/real-two-desktop-e2e.js:1218-1235`, `scripts/realTwoDesktopE2e.test.js`

- [ ] **Step 1: Add failing static assertions**

```js
assert.ok(source.includes('const requiresLanFirewallAudit = !acceptance.websocketDisabled && !acceptance.relayWebSocket;'));
assert.ok(source.includes('requiresLanFirewallAudit && !usesIsolatedTemporaryHostPackage(HOST_EXE)'));
assert.ok(source.includes('[e2e] LAN firewall preflight skipped for relay-only acceptance'));
```

- [ ] **Step 2: Verify RED**

Run: `node scripts/realTwoDesktopE2e.test.js`

Expected: fail because `runAcceptance` currently audits every mode.

- [ ] **Step 3: Implement only the conditional audit**

```js
const requiresLanFirewallAudit = !acceptance.websocketDisabled && !acceptance.relayWebSocket;
const firewallAudit = requiresLanFirewallAudit && !usesIsolatedTemporaryHostPackage(HOST_EXE)
  ? runLanE2ePreflight({ hostExe: HOST_EXE, hostPort, helperPath: path.join(path.dirname(HOST_EXE), 'resources', 'app', 'public', 'windowsHostFirewallElevated.ps1'), clientBackendUrl: `http://127.0.0.1:${clientPort}` })
  : (requiresLanFirewallAudit ? { localPort: hostPort, testOnly: true } : null);
console.log(firewallAudit ? (firewallAudit.testOnly ? `[e2e] TEMPORARY_PACKAGE_FIREWALL_AUDIT_BYPASSED port ${firewallAudit.localPort}` : `[e2e] LAN firewall preflight enabled for port ${firewallAudit.localPort}`) : '[e2e] LAN firewall preflight skipped for relay-only acceptance');
```

Never request elevation in the harness. Normal LAN retains audit; relay-WebSocket and WebSocket-disabled durable rows skip it.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node scripts/realTwoDesktopE2e.test.js; node --check scripts/real-two-desktop-e2e.js; node scripts/windowsFirewallE2ePreflight.test.js`

Run: `git add -- scripts/real-two-desktop-e2e.js scripts/realTwoDesktopE2e.test.js; git commit -m "skip LAN firewall preflight for relay acceptance"`

### Task 4: Build and obtain real no-firewall relay evidence

**Files:** `task.md` only after a terminal result.

- [ ] **Step 1: Run non-Electron verification**

Run: `npm run test:authority-architecture; npm run test:desktop-build-flavor`

Expected: green with no Electron process.

- [ ] **Step 2: Build one temporary package pair**

Run: `npx electron-builder --win --dir --config electron-builder.host.config.cjs --config.directories.output=tmp-e2e-host-connectivity-20260730; npx electron-builder --win --dir --config electron-builder.client.config.cjs --config.directories.output=tmp-e2e-client-connectivity-20260730; npm run rebuild:node`

Expected: one host/client pair only; no production installation or profile is touched.

- [ ] **Step 3: Run one durable-relay/restart row**

Run: `$env:E2E_RUN_REAL_TWO_DESKTOP='1'; $env:E2E_REQUIRE_DURABLE='1'; $env:E2E_REQUIRE_OFFLINE_RESTART='1'; $env:E2E_REQUIRE_WEBSOCKET='0'; $env:GEWU_PACKAGED_HOST_EXE=(Resolve-Path 'tmp-e2e-host-connectivity-20260730\\win-unpacked\\gewu-gongfang.exe'); $env:GEWU_PACKAGED_CLIENT_EXE=(Resolve-Path 'tmp-e2e-client-connectivity-20260730\\win-unpacked\\gewu-gongfang.exe'); node scripts\\real-two-desktop-e2e.js --cloud-relay --restart --websocket-disabled --no-authority-data`

Expected: preflight-skip log, isolated visible approval, offline-draft restart persistence, and exactly one durable-relay receipt. Run no concurrent pair and retain isolated diagnostics on failure.

- [ ] **Step 4: Record evidence and commit only if terminal**

Append a dated `task.md` checkpoint with command, package paths, temporary root, terminal result, and preflight-skip result. Do not claim the full matrix complete.

Run: `git add -- task.md; git commit -m "record relay acceptance without LAN firewall"`

### Task 5: Resume unified release only after the full matrix audit

- [ ] **Step 1: Require current terminal evidence**

Audit `task.md` section 8 for normal LAN, relay WebSocket, durable relay, reverse projection, offline restart, approval state, and visitor/student/teacher/admin/superadmin API/Desktop/Miniapp rows. Static checks and stale packages do not count.

- [ ] **Step 2: Run missing rows serially**

Run at most one isolated host/client pair at a time. LAN rules are relevant only to explicit LAN acceptance; relay rows never require them.

- [ ] **Step 3: Publish only when all gates are green**

Then run the unified version bump, desktop builds and both OSS feeds, cloud backup/deploy/health checks, and miniapp build/upload verification. Otherwise report partial release.

## Self-review

- The approved UX requirements map to Tasks 1 through 3.
- No task broadens a firewall rule, adds startup elevation, or touches real authority data.
- The completed plan has no placeholders or deferred implementation steps.
