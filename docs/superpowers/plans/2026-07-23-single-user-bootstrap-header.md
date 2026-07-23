# Single-User Host Bootstrap and Identity Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a single-user primary-host bootstrap produce a trusted `primary-host` device identity, show a useful error if that contract regresses, and simplify the identity card header into one horizontal icon-and-title row.

**Architecture:** Put device-kind selection in a small pure main-process policy module so the renderer cannot choose its own authority. Electron supplies trusted build/runtime facts to that policy; the backend retains its strict `primary-host` bootstrap check. The React gate only changes presentation and localized error mapping.

**Tech Stack:** Electron 28, Node.js CommonJS main process, React/TypeScript, Ant Design, CSS, Node `assert` tests, better-sqlite3.

---

## File map

- Create `public/desktopIdentityKind.js`: pure trusted policy for choosing `primary-host` versus `desktop-client`.
- Create `public/desktopIdentityKind.test.js`: real behavior tests for the policy.
- Modify `public/electron.js`: pass host-build and managed-mode facts into the policy for single-user enrollment.
- Modify `package.json`: include the policy test in `test:desktop-identity`.
- Modify `src/services/desktopIdentityError.mjs`: localize the device-kind contract failure.
- Modify `src/services/desktopIdentityError.test.js`: prove wrapped IPC errors map safely.
- Modify `src/components/DesktopIdentityGate.tsx`: horizontal header and removal of the obsolete subtitle.
- Modify `src/components/DesktopIdentityGate.css`: responsive header alignment.
- Modify `src/components/DesktopIdentityGate.test.js`: source-level UI contract checks.
- Modify `task.md` and `docs/reports/2026-07-23-unified-completion-audit.md`: record verified runtime evidence only after the real bootstrap succeeds.

### Task 1: Trusted device-kind policy

**Files:**
- Create: `public/desktopIdentityKind.test.js`
- Create: `public/desktopIdentityKind.js`
- Modify: `public/electron.js`
- Modify: `package.json`

- [x] **Step 1: Write the failing policy test**

Create `public/desktopIdentityKind.test.js`:

```js
const assert = require('assert');
const { resolveConfiguredDesktopIdentityKind } = require('./desktopIdentityKind');

assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: true,
  nodeRole: 'desktop-client',
  desktopIdentityMode: 'single-user',
  singleUserHostEnrollment: true,
}), 'primary-host');
assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: false,
  nodeRole: 'desktop-client',
  desktopIdentityMode: 'single-user',
  singleUserHostEnrollment: true,
}), 'desktop-client');
assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: true,
  nodeRole: 'desktop-client',
  desktopIdentityMode: 'full',
  singleUserHostEnrollment: true,
}), 'desktop-client');
assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: true,
  nodeRole: 'primary-host',
  desktopIdentityMode: 'single-user',
}), 'primary-host');
console.log('desktop identity kind policy checks passed');
```

- [x] **Step 2: Run the test and verify RED**

Run:

```powershell
node public/desktopIdentityKind.test.js
```

Expected: FAIL because `./desktopIdentityKind` does not exist.

- [x] **Step 3: Implement the pure policy**

Create `public/desktopIdentityKind.js`:

```js
function resolveConfiguredDesktopIdentityKind(input = {}) {
  const primaryHostCapable = input.primaryHostCapable === true;
  const singleUserHostEnrollment = input.singleUserHostEnrollment === true;
  if (primaryHostCapable
    && singleUserHostEnrollment
    && input.desktopIdentityMode === 'single-user') {
    return 'primary-host';
  }
  return primaryHostCapable && input.nodeRole === 'primary-host'
    ? 'primary-host'
    : 'desktop-client';
}

module.exports = { resolveConfiguredDesktopIdentityKind };
```

- [x] **Step 4: Wire the policy through trusted Electron state**

In `public/electron.js`:

```js
const { resolveConfiguredDesktopIdentityKind } = require('./desktopIdentityKind');
```

Change `configuredDesktopIdentity` to accept an internal option and preserve host mode while reading:

```js
function configuredDesktopIdentity(input = {}, options = {}) {
  const runtimeConfig = ensureRuntimeConfig(getRuntimeConfigPath(), {
    userDataPath: app.getPath('userData'),
    primaryHostCapable: PRIMARY_HOST_CAPABLE,
  });
  const deviceId = String(process.env.GEWU_DEVICE_ID || runtimeConfig.deviceId || '').trim();
  if (!deviceId) {
    const error = new Error('DESKTOP_IDENTITY_DEVICE_ID_REQUIRED');
    error.code = 'DESKTOP_IDENTITY_DEVICE_ID_REQUIRED';
    throw error;
  }
  return {
    deviceId,
    deviceName: String(input.deviceName || runtimeConfig.deviceName || os.hostname()).trim().slice(0, 128),
    deviceKind: resolveConfiguredDesktopIdentityKind({
      primaryHostCapable: PRIMARY_HOST_CAPABLE,
      nodeRole: runtimeConfig.nodeRole,
      desktopIdentityMode: runtimeConfig.desktopIdentityMode,
      singleUserHostEnrollment: options.singleUserHostEnrollment === true,
    }),
  };
}
```

Call it from the bootstrap-only channel:

```js
ipcMain.handle('desktop-identity:begin-single-user-enrollment', async (_event, input) => {
  return getDesktopIdentityVault().beginSingleUserEnrollment(configuredDesktopIdentity(input, {
    singleUserHostEnrollment: true,
  }));
});
```

Do not change `desktop-identity:begin-registration`.

- [x] **Step 5: Register and run the policy test**

Add `node public/desktopIdentityKind.test.js` immediately before
`node public/desktopIdentityVault.test.js` in `test:desktop-identity`.

Run:

```powershell
node public/desktopIdentityKind.test.js
node public/primaryHostRuntimeManager.test.js
```

Expected: both PASS.

### Task 2: Actionable error mapping

**Files:**
- Modify: `src/services/desktopIdentityError.test.js`
- Modify: `src/services/desktopIdentityError.mjs`

- [x] **Step 1: Write the failing mapping assertion**

Add to `src/services/desktopIdentityError.test.js`:

```js
const invalidHostKind = new Error(
  "Error invoking remote method 'single-user:bootstrap': Error: DESKTOP_SINGLE_USER_DEVICE_KIND_INVALID"
);
assert.strictEqual(
  extractDesktopIdentityErrorCode(invalidHostKind),
  'DESKTOP_SINGLE_USER_DEVICE_KIND_INVALID'
);
assert.strictEqual(
  desktopIdentityErrorMessage(invalidHostKind),
  '数据主机身份初始化参数异常，未修改本机数据。请更新应用后重试。'
);
```

- [x] **Step 2: Run the test and verify RED**

Run:

```powershell
node src/services/desktopIdentityError.test.js
```

Expected: FAIL because the code is not present in `ERROR_MESSAGES`.

- [x] **Step 3: Add the localized mapping**

Add to `ERROR_MESSAGES` in `src/services/desktopIdentityError.mjs`:

```js
DESKTOP_SINGLE_USER_DEVICE_KIND_INVALID: '\u6570\u636e\u4e3b\u673a\u8eab\u4efd\u521d\u59cb\u5316\u53c2\u6570\u5f02\u5e38\uff0c\u672a\u4fee\u6539\u672c\u673a\u6570\u636e\u3002\u8bf7\u66f4\u65b0\u5e94\u7528\u540e\u91cd\u8bd5\u3002',
```

- [x] **Step 4: Run the mapping test and verify GREEN**

Run:

```powershell
node src/services/desktopIdentityError.test.js
```

Expected: PASS with `desktop identity error mapping checks passed`.

### Task 3: Horizontal identity header

**Files:**
- Modify: `src/components/DesktopIdentityGate.test.js`
- Modify: `src/components/DesktopIdentityGate.tsx`
- Modify: `src/components/DesktopIdentityGate.css`

- [x] **Step 1: Write failing UI contract assertions**

Add to `src/components/DesktopIdentityGate.test.js`:

```js
assert.ok(!decodedGateSource.includes(
  '同一个人可以同时拥有超级管理员和老师身份；每台电脑分别注册、分别撤销。'
));
assert.ok(gateSource.includes('className="desktop-identity-header"'));
assert.ok(gateSource.includes('className="desktop-identity-title"'));
assert.ok(gateStyle.includes('.desktop-identity-header'));
assert.ok(gateStyle.includes('align-items: center'));
```

- [x] **Step 2: Run the source check and verify RED**

Run:

```powershell
node src/components/DesktopIdentityGate.test.js
```

Expected: FAIL because the subtitle remains and header classes do not exist.

- [x] **Step 3: Replace the card header**

In `src/components/DesktopIdentityGate.tsx`, replace the separate mark, title,
and subtitle with:

```tsx
<header className="desktop-identity-header">
  <div className="desktop-identity-mark" aria-hidden="true">
    <SafetyCertificateOutlined />
  </div>
  <Title level={2} className="desktop-identity-title">格物工坊身份验证</Title>
</header>
<Divider />
```

- [x] **Step 4: Add responsive header styles**

In `src/components/DesktopIdentityGate.css`:

```css
.desktop-identity-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.desktop-identity-title {
  margin: 0 !important;
}

.desktop-identity-mark {
  flex: 0 0 auto;
  margin-bottom: 0;
}
```

Extend the existing narrow-window media query:

```css
@media (max-width: 640px) {
  .desktop-identity-header { gap: 12px; }
  .desktop-identity-mark { width: 46px; height: 46px; border-radius: 14px; font-size: 22px; }
  .desktop-identity-title { font-size: 24px !important; }
}
```

- [x] **Step 5: Run UI checks and type checking**

Run:

```powershell
node src/components/DesktopIdentityGate.test.js
npm run typecheck
```

Expected: PASS.

### Task 4: Integrated regression and rebuilt runtime

**Files:**
- No new source files.

- [x] **Step 1: Run focused suites**

Run:

```powershell
npm run test:desktop-identity
npm run test:primary-host
npm run typecheck
git diff --check
```

Expected: all PASS; only existing Windows line-ending warnings are acceptable.

- [x] **Step 2: Rebuild the renderer without packaging**

Run:

```powershell
.\node_modules\.bin\craco.cmd build
```

Expected: `Compiled successfully.` No installer or distribution archive is generated.

- [x] **Step 3: Ensure both native dependency trees target Electron**

Run:

```powershell
npm run rebuild:electron
npm.cmd --prefix backend rebuild better-sqlite3 --runtime=electron --target=28.3.3 --dist-url=https://electronjs.org/headers --build-from-source
```

Expected: both rebuilds succeed. This is required because the embedded backend resolves
`backend/node_modules/better-sqlite3`.

- [x] **Step 4: Start the host-flavor development runtime**

Run:

```powershell
$env:GEWU_DESKTOP_BUILD_FLAVOR='primary-host'
.\node_modules\.bin\electron.cmd .
```

Expected: the identity card shows the inline header, no obsolete subtitle, and the
single-user initialization form.

- [x] **Step 5: Complete real bootstrap**

The user enters the local password twice and clicks `备份并完成初始化`.
The agent never reads or types the password.

Expected:

- POST `/api/desktop-identity/single-user/bootstrap` returns 200.
- Electron restarts through `window.primaryHostRuntime.restart()`.
- Runtime config becomes `nodeRole=primary-host`, retains `desktopIdentityMode=single-user`,
  and contains a non-empty epoch id and positive generation.
- Primary-host credential and desktop identity vault files exist.

- [x] **Step 6: Verify data and authority invariants**

Using read-only database checks, verify:

```text
PRAGMA quick_check = ok
users = 2
questions = 0
exactly one active primary_host_epochs row for desktop_host_001
active authorization referenced by that epoch
question-bank storeId = qb_mqukr4y6_9c27e660
```

Also verify local backend health reports version `6.3.2` and role `primary-host`.

- [x] **Step 7: Restore Node ABI and rerun Node verification**

After closing Electron:

```powershell
npm run rebuild:node
npm.cmd --prefix backend rebuild better-sqlite3
npm run test:desktop-identity
npm run test:primary-host
```

Expected: PASS with no ABI mismatch.

### Task 5: Audit and controlled integration

**Files:**
- Modify: `task.md`
- Modify: `docs/reports/2026-07-23-unified-completion-audit.md`

- [ ] **Step 1: Record only verified evidence**

Document the exact runtime result, safe backup location, version, database quick check,
business counts, epoch/authorization presence, preserved data paths, and remaining release
matrix blockers. Do not record passwords, credential contents, tokens, or recovery material.

- [ ] **Step 2: Run release-document checks**

Run:

```powershell
node scripts/check_project_status_doc.js
node scripts/check_deploy_readiness.js
```

Expected: PASS.

- [ ] **Step 3: Commit the verified task files**

Stage only the files listed in this plan plus the already-related tracked Task 10 changes.
Before committing, run `git diff --cached --name-only` and confirm no user-owned untracked
directories or scripts are included.

Commit message:

```text
fix: 完成单人数据主机初始化链路
```

- [ ] **Step 4: Continue the existing unified-matrix goal**

Do not push, package, publish OSS, deploy cloud, upload miniapp, or upload Quark at this step.
Return to Task 10 planned migration/emergency recovery evidence, Task 11 security regression,
then the unrecognized-student plan. Release actions occur only after the unified matrix passes.
