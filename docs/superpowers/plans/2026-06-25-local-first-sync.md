# Local-First Multi-Endpoint Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local-first foundation for Gewu Gongfang: one primary host as authority, removable-drive question bank storage, offline-capable desktop clients, cloud relay APIs, and read-mostly miniapp access.

**Architecture:** Implement in vertical slices. Start with runtime role/path configuration, then removable question-bank storage, then unified mutation capture, then host/client sync authorization and conflict handling, then cloud relay and miniapp permission/task restrictions. The first executable milestone is a desktop build that can run as either `primary-host` or `desktop-client`, detect the question-bank drive, and expose observable sync/storage status without changing existing user workflows.

**Tech Stack:** Electron, React, TypeScript, Node.js, Express, better-sqlite3, SQLite, Taro miniapp, existing `backend`, `gateway`, `miniapp`, and `src/services/syncEngine.ts`.

---

## Scope and sequencing

This plan covers the whole confirmed design, but execution must be staged. Do not start miniapp UI redesign until Tasks 1-9 are implemented and verified. Do not deploy cloud or miniapp until Tasks 10-12 are implemented and verified.

Committed design source:

- `docs/superpowers/specs/2026-06-25-local-first-sync-design.md`
- `task.md`

Current important existing files:

- `public/electron.js`: starts the embedded backend and sets `DB_PATH` / `QUESTION_BANK_UPLOAD_DIR`.
- `public/preload.js`: safe IPC allow-list.
- `backend/src/database.js`: SQLite service and existing sync primitives.
- `backend/src/routes/sync.js`: existing pull/push/status endpoints.
- `backend/src/schema.sql`: sync/audit/outbox schema foundation.
- `src/services/syncEngine.ts`: desktop pending change engine.
- `src/services/syncApi.ts`: desktop sync HTTP client.
- `src/services/questionAssetStore.ts`: current IndexedDB question asset store.
- `src/pages/SystemSettings.tsx`: existing settings/backup page.
- `src/pages/SyncSettings.tsx` and `src/pages/CloudSync.tsx`: existing sync control pages.
- `miniapp/src/utils/syncEngine.ts` and `miniapp/src/utils/sync.ts`: miniapp sync foundations.
- `gateway/src/app.js`: cloud/gateway entry point.

---

## File structure to create or modify

### Desktop/Electron runtime configuration

- Create `public/runtimeConfig.js`
  - Reads/writes `<Electron userData>/gewugongfang.config.json`.
  - Normalizes `nodeRole`, `deviceId`, `mainDbPath`, `questionBankPath`, `questionAssetPath`, `hostBaseUrl`, `cloudBaseUrl`.
- Modify `public/electron.js`
  - Load runtime config before `startBackendService()`.
  - Inject env vars: `GEWU_NODE_ROLE`, `GEWU_DEVICE_ID`, `DB_PATH`, `QUESTION_BANK_ROOT`, `QUESTION_BANK_UPLOAD_DIR`, `GEWU_HOST_BASE_URL`, `GEWU_CLOUD_BASE_URL`.
  - Add IPC handlers for runtime config read/write and folder selection.
- Modify `public/preload.js`
  - Allow safe config IPC channels.
- Modify `src/custom.d.ts`
  - Add `window.api.invoke(...)` typing for new IPC channels.
- Create `src/services/runtimeConfigClient.ts`
  - Browser-side wrapper around `window.api.invoke`.
- Modify `src/pages/SystemSettings.tsx`
  - Add role/path configuration panel.

### Question-bank removable storage

- Create `backend/src/services/questionBankStorageService.js`
  - Initializes and validates `manifest.json`.
  - Ensures `assets/images`, `assets/word-imports`, `assets/exports`, `backups`.
  - Validates role-based write rules.
- Create `backend/src/services/questionBankStorageService.test.js`
  - Covers init, missing drive, invalid manifest, client write rejection.
- Modify `backend/src/routes/questionBank.js`
  - Route uploads/exports through `QuestionBankStorageService`.
- Modify `src/services/questionAssetStore.ts`
  - Keep IndexedDB read compatibility, but prepare metadata for backend/file storage when configured.

### Unified mutation and sync

- Create `src/services/mutationQueue.ts`
  - Defines `SyncOperation`, risk levels, and local queue adapter.
- Modify `src/services/syncEngine.ts`
  - Add base-version-aware operation creation.
  - Preserve pending operations until host confirms applied IDs.
- Create `src/services/mutationQueue.test.js`
  - Node-runnable unit tests for risk classification and applied-operation clearing.
- Modify `backend/src/schema.sql`
  - Add host sync tables if missing: `sync_devices`, `sync_authorizations`, `sync_conflicts`.
- Modify `backend/src/database.js`
  - Add device registration, authorization token issue/verify, baseVersion conflict detection, conflict persistence.
- Modify `backend/src/routes/sync.js`
  - Add host discovery/status, device registration, authorization request, authorized push.
- Create or extend `backend/src/services/syncIncremental.test.js`
  - Cover authorized push, conflict, partial applied clearing.

### Desktop sync UX

- Modify `src/pages/SyncSettings.tsx`
  - Show role, host availability, pending operation count, sync authorization prompt, conflict count.
- Modify `src/pages/CloudSync.tsx`
  - Keep compatibility or route to the unified sync settings view.
- Modify `src/pages/TodayWorkbench.tsx`
  - Continue showing sync status, now using the new queue status.

### Cloud relay and miniapp

- Create `gateway/src/routes/cloudRelay.js`
  - Host heartbeat.
  - Snapshot publish/read.
  - Miniapp task create/read/result.
  - Device metadata.
- Modify `gateway/src/db/schema.sql`
  - Add `host_heartbeats`, `readonly_snapshots`, `miniapp_tasks`, `cloud_devices`.
- Modify `gateway/src/app.js`
  - Mount cloud relay routes.
- Modify `miniapp/src/utils/permission.ts`
  - Enforce read-mostly permission map.
- Modify `miniapp/src/utils/api.ts`
  - Add cloud snapshot and task APIs.
- Modify miniapp pages in later UI-confirmed tasks:
  - `miniapp/src/pages/index/index.tsx`
  - `miniapp/src/pages/assets/index.tsx`
  - question-bank pages to be added after UI confirmation.

### Verification and release

- Modify `package.json`
  - Add new Node-runnable tests to `test:backend`.
- Use existing:
  - `npm test`
  - `npm run build`
  - `npx electron-builder --win`
  - `node scripts/upload-quark-clean.js`

---

## Task 1: Runtime config service

**Files:**

- Create: `public/runtimeConfig.js`
- Create: `public/runtimeConfig.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing runtime config test**

Create `public/runtimeConfig.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeRuntimeConfig,
  readRuntimeConfig,
  writeRuntimeConfig,
  applyRuntimeConfigToEnv,
} = require('./runtimeConfig');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-runtime-config-'));
const configPath = path.join(dir, 'gewugongfang.config.json');

const normalized = normalizeRuntimeConfig({
  nodeRole: 'primary-host',
  deviceId: 'desktop_test',
  mainDbPath: 'D:/GewuData/scheduling.db',
  questionBankPath: 'E:/GewuQuestionBank',
  cloudBaseUrl: 'https://cloud.example.com/',
});

assert.strictEqual(normalized.nodeRole, 'primary-host');
assert.strictEqual(normalized.deviceId, 'desktop_test');
assert.strictEqual(normalized.questionAssetPath.replace(/\\/g, '/'), 'E:/GewuQuestionBank/assets');
assert.strictEqual(normalized.cloudBaseUrl, 'https://cloud.example.com');

writeRuntimeConfig(configPath, normalized);
const readBack = readRuntimeConfig(configPath, { userDataPath: dir });
assert.strictEqual(readBack.mainDbPath.replace(/\\/g, '/'), 'D:/GewuData/scheduling.db');

const env = {};
applyRuntimeConfigToEnv(readBack, env);
assert.strictEqual(env.GEWU_NODE_ROLE, 'primary-host');
assert.strictEqual(env.GEWU_DEVICE_ID, 'desktop_test');
assert.strictEqual(env.DB_PATH.replace(/\\/g, '/'), 'D:/GewuData/scheduling.db');
assert.strictEqual(env.QUESTION_BANK_ROOT.replace(/\\/g, '/'), 'E:/GewuQuestionBank');
assert.strictEqual(env.QUESTION_BANK_UPLOAD_DIR.replace(/\\/g, '/'), 'E:/GewuQuestionBank/assets');

const fallback = normalizeRuntimeConfig({}, { userDataPath: dir });
assert.ok(fallback.deviceId.startsWith('desktop_'));
assert.strictEqual(fallback.nodeRole, 'desktop-client');
assert.ok(fallback.mainDbPath.endsWith(path.join('data', 'scheduling.db')));
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node public/runtimeConfig.test.js
```

Expected: fail with `Cannot find module './runtimeConfig'`.

- [ ] **Step 3: Implement `public/runtimeConfig.js`**

Create `public/runtimeConfig.js`:

```js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_ROLES = new Set(['primary-host', 'desktop-client']);

function trimTrailingSlash(value) {
  return String(value || '').replace(/[\\/]+$/, '');
}

function makeDeviceId() {
  return `desktop_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function defaultConfig(userDataPath) {
  return {
    nodeRole: 'desktop-client',
    deviceId: makeDeviceId(),
    hostBaseUrl: 'http://127.0.0.1:3001',
    cloudBaseUrl: '',
    mainDbPath: path.join(userDataPath, 'data', 'scheduling.db'),
    questionBankPath: '',
    questionAssetPath: '',
  };
}

function normalizeRuntimeConfig(input = {}, options = {}) {
  const userDataPath = options.userDataPath || process.cwd();
  const defaults = defaultConfig(userDataPath);
  const next = { ...defaults, ...(input || {}) };

  next.nodeRole = VALID_ROLES.has(next.nodeRole) ? next.nodeRole : 'desktop-client';
  next.deviceId = next.deviceId || defaults.deviceId;
  next.hostBaseUrl = trimTrailingSlash(next.hostBaseUrl || defaults.hostBaseUrl);
  next.cloudBaseUrl = trimTrailingSlash(next.cloudBaseUrl || '');
  next.mainDbPath = next.mainDbPath || defaults.mainDbPath;
  next.questionBankPath = trimTrailingSlash(next.questionBankPath || '');
  next.questionAssetPath = trimTrailingSlash(
    next.questionAssetPath || (next.questionBankPath ? path.join(next.questionBankPath, 'assets') : '')
  );

  return next;
}

function readRuntimeConfig(configPath, options = {}) {
  let raw = {};
  if (fs.existsSync(configPath)) {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return normalizeRuntimeConfig(raw, options);
}

function writeRuntimeConfig(configPath, config, options = {}) {
  const normalized = normalizeRuntimeConfig(config, options);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function applyRuntimeConfigToEnv(config, env = process.env) {
  env.GEWU_NODE_ROLE = config.nodeRole;
  env.GEWU_DEVICE_ID = config.deviceId;
  env.GEWU_HOST_BASE_URL = config.hostBaseUrl || '';
  env.GEWU_CLOUD_BASE_URL = config.cloudBaseUrl || '';
  env.DB_PATH = config.mainDbPath;
  if (config.questionBankPath) env.QUESTION_BANK_ROOT = config.questionBankPath;
  if (config.questionAssetPath) env.QUESTION_BANK_UPLOAD_DIR = config.questionAssetPath;
  return env;
}

module.exports = {
  normalizeRuntimeConfig,
  readRuntimeConfig,
  writeRuntimeConfig,
  applyRuntimeConfigToEnv,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node public/runtimeConfig.test.js
```

Expected: exit code 0.

- [ ] **Step 5: Add test to package script**

Modify `package.json` `test:backend` by prepending this command to the existing value:

```text
node public/runtimeConfig.test.js &&
```

The resulting script must start with:

```text
node public/runtimeConfig.test.js && node backend/src/services/questionBankService.test.js
```

- [ ] **Step 6: Run full test**

Run:

```bash
npm test
```

Expected: all existing tests plus `runtimeConfig.test.js` pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add public/runtimeConfig.js public/runtimeConfig.test.js package.json
git commit -m "feat: add runtime role and path config"
```

---

## Task 2: Wire runtime config into Electron startup and IPC

**Files:**

- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Modify: `src/custom.d.ts`
- Create: `src/services/runtimeConfigClient.ts`
- Create: `src/services/runtimeConfigClient.test.js`

- [ ] **Step 1: Write a lightweight browser client test**

Create `src/services/runtimeConfigClient.test.js`:

```js
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/runtimeConfigClient.ts', 'utf-8');

assert.ok(source.includes("runtime-config:get"), 'client should call runtime-config:get');
assert.ok(source.includes("runtime-config:set"), 'client should call runtime-config:set');
assert.ok(source.includes("dialog:select-folder"), 'client should call dialog:select-folder');
assert.ok(source.includes('getRuntimeConfig'), 'client should export getRuntimeConfig');
assert.ok(source.includes('saveRuntimeConfig'), 'client should export saveRuntimeConfig');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node src/services/runtimeConfigClient.test.js
```

Expected: fail because `src/services/runtimeConfigClient.ts` does not exist.

- [ ] **Step 3: Modify `public/electron.js`**

Add near the top:

```js
const {
  readRuntimeConfig,
  writeRuntimeConfig,
  applyRuntimeConfigToEnv,
} = require('./runtimeConfig');

function getRuntimeConfigPath() {
  return path.join(app.getPath('userData'), 'gewugongfang.config.json');
}

function loadAndApplyRuntimeConfig() {
  const config = readRuntimeConfig(getRuntimeConfigPath(), { userDataPath: app.getPath('userData') });
  applyRuntimeConfigToEnv(config, process.env);
  return config;
}
```

Inside `startBackendService()`, before the existing `process.env.NODE_ENV = process.env.NODE_ENV || 'production';` line, add:

```js
const runtimeConfig = loadAndApplyRuntimeConfig();
log('Runtime config loaded: role=' + runtimeConfig.nodeRole + ' device=' + runtimeConfig.deviceId);
```

Replace the existing default env assignments:

```js
process.env.DB_PATH = process.env.DB_PATH || path.join(appDataDir, 'data', 'scheduling.db');
process.env.QUESTION_BANK_UPLOAD_DIR = process.env.QUESTION_BANK_UPLOAD_DIR || path.join(appDataDir, 'uploads', 'question-bank');
```

with:

```js
process.env.DB_PATH = process.env.DB_PATH || runtimeConfig.mainDbPath || path.join(appDataDir, 'data', 'scheduling.db');
process.env.QUESTION_BANK_UPLOAD_DIR = process.env.QUESTION_BANK_UPLOAD_DIR
  || runtimeConfig.questionAssetPath
  || path.join(appDataDir, 'uploads', 'question-bank');
```

Add IPC handlers near existing update handlers:

```js
ipcMain.handle('runtime-config:get', async () => {
  return readRuntimeConfig(getRuntimeConfigPath(), { userDataPath: app.getPath('userData') });
});

ipcMain.handle('runtime-config:set', async (_event, config) => {
  return writeRuntimeConfig(getRuntimeConfigPath(), config, { userDataPath: app.getPath('userData') });
});

ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? '' : result.filePaths[0];
});
```

- [ ] **Step 4: Modify `public/preload.js` allow-list**

Add:

```js
'runtime-config:get',
'runtime-config:set',
'dialog:select-folder',
```

to `invokeAllowList`.

- [ ] **Step 5: Create `src/services/runtimeConfigClient.ts`**

```ts
export type NodeRole = 'primary-host' | 'desktop-client';

export type RuntimeConfig = {
  nodeRole: NodeRole;
  deviceId: string;
  hostBaseUrl: string;
  cloudBaseUrl: string;
  mainDbPath: string;
  questionBankPath: string;
  questionAssetPath: string;
};

function requireApi() {
  const api = (window as any).api;
  if (!api?.invoke) throw new Error('Electron API is not available');
  return api;
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return requireApi().invoke('runtime-config:get');
}

export async function saveRuntimeConfig(config: Partial<RuntimeConfig>): Promise<RuntimeConfig> {
  return requireApi().invoke('runtime-config:set', config);
}

export async function selectFolder(): Promise<string> {
  return requireApi().invoke('dialog:select-folder');
}
```

- [ ] **Step 6: Update `src/custom.d.ts`**

Append:

```ts
interface Window {
  api?: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    on?(channel: string, listener: (...args: any[]) => void): () => void;
  };
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
node src/services/runtimeConfigClient.test.js
npm test
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add public/electron.js public/preload.js src/custom.d.ts src/services/runtimeConfigClient.ts src/services/runtimeConfigClient.test.js package.json
git commit -m "feat: wire runtime config into electron"
```

---

## Task 3: Add role and path configuration UI

**Files:**

- Modify: `src/pages/SystemSettings.tsx`
- Test: `src/uiRegression.test.js`

- [ ] **Step 1: Add UI regression assertions first**

Modify `src/uiRegression.test.js` to read `src/pages/SystemSettings.tsx` and assert:

```js
const systemSettings = read('src/pages/SystemSettings.tsx');

assert.ok(
  systemSettings.includes('数据主机与同步') &&
  systemSettings.includes('本地数据主机') &&
  systemSettings.includes('普通离线客户端') &&
  systemSettings.includes('题库移动硬盘路径') &&
  systemSettings.includes('主数据库路径'),
  'system settings should expose local-first role and storage path controls'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node src/uiRegression.test.js
```

Expected: fail with the new assertion.

- [ ] **Step 3: Implement UI section**

In `src/pages/SystemSettings.tsx`, import:

```ts
import { Form, Input, Select, Alert } from 'antd';
import {
  getRuntimeConfig,
  saveRuntimeConfig,
  selectFolder,
  RuntimeConfig,
} from '../services/runtimeConfigClient';
```

Add state:

```ts
const [runtimeForm] = Form.useForm<RuntimeConfig>();
const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
const [runtimeLoading, setRuntimeLoading] = useState(false);
```

Add loader:

```ts
const loadRuntimeConfig = async () => {
  try {
    const config = await getRuntimeConfig();
    setRuntimeConfig(config);
    runtimeForm.setFieldsValue(config);
  } catch (error: any) {
    message.warning(error.message || '运行配置暂不可用');
  }
};

useEffect(() => {
  loadRuntimeConfig();
}, []);
```

Add save handler:

```ts
const handleSaveRuntimeConfig = async () => {
  setRuntimeLoading(true);
  try {
    const values = await runtimeForm.validateFields();
    const saved = await saveRuntimeConfig(values);
    setRuntimeConfig(saved);
    runtimeForm.setFieldsValue(saved);
    message.success('数据主机与同步配置已保存，重启软件后生效');
  } catch (error: any) {
    message.error(error.message || '保存运行配置失败');
  } finally {
    setRuntimeLoading(false);
  }
};
```

Add a new `Card` before the existing data management card:

```tsx
<Card title="数据主机与同步" style={{ marginBottom: 16 }}>
  <Alert
    type={runtimeConfig?.nodeRole === 'primary-host' ? 'success' : 'info'}
    showIcon
    style={{ marginBottom: 16 }}
    message={runtimeConfig?.nodeRole === 'primary-host' ? '当前配置为本地数据主机' : '当前配置为普通离线客户端'}
    description="本地数据主机保存权威数据和题库移动硬盘；普通离线客户端可断网修改，联网后经确认同步到主机。"
  />
  <Form form={runtimeForm} layout="vertical">
    <Form.Item name="nodeRole" label="运行角色" rules={[{ required: true }]}>
      <Select
        options={[
          { label: '本地数据主机', value: 'primary-host' },
          { label: '普通离线客户端', value: 'desktop-client' },
        ]}
      />
    </Form.Item>
    <Form.Item name="deviceId" label="设备 ID" rules={[{ required: true }]}>
      <Input disabled />
    </Form.Item>
    <Form.Item name="mainDbPath" label="主数据库路径" rules={[{ required: true }]}>
      <Input
        addonAfter={<Button size="small" onClick={async () => {
          const folder = await selectFolder();
          if (folder) runtimeForm.setFieldValue('mainDbPath', `${folder}\\scheduling.db`);
        }}>选择</Button>}
      />
    </Form.Item>
    <Form.Item name="questionBankPath" label="题库移动硬盘路径">
      <Input
        addonAfter={<Button size="small" onClick={async () => {
          const folder = await selectFolder();
          if (folder) {
            runtimeForm.setFieldValue('questionBankPath', folder);
            runtimeForm.setFieldValue('questionAssetPath', `${folder}\\assets`);
          }
        }}>选择</Button>}
      />
    </Form.Item>
    <Form.Item name="questionAssetPath" label="题库附件路径">
      <Input />
    </Form.Item>
    <Form.Item name="hostBaseUrl" label="本地数据主机地址">
      <Input placeholder="http://192.168.1.10:3001" />
    </Form.Item>
    <Form.Item name="cloudBaseUrl" label="阿里云服务地址">
      <Input placeholder="https://your-domain.example.com" />
    </Form.Item>
    <Button type="primary" loading={runtimeLoading} onClick={handleSaveRuntimeConfig}>
      保存数据主机与同步配置
    </Button>
  </Form>
</Card>
```

- [ ] **Step 4: Run regression and build**

Run:

```bash
node src/uiRegression.test.js
npm run build
```

Expected: regression passes and production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SystemSettings.tsx src/uiRegression.test.js
git commit -m "feat: add data host settings UI"
```

---

## Task 4: Question-bank removable storage service

**Files:**

- Create: `backend/src/services/questionBankStorageService.js`
- Create: `backend/src/services/questionBankStorageService.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `backend/src/services/questionBankStorageService.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  initQuestionBankStore,
  inspectQuestionBankStore,
  assertQuestionBankWritable,
} = require('./questionBankStorageService');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-qb-store-'));
const deviceId = 'desktop_host_test';

const manifest = initQuestionBankStore(root, { deviceId });

assert.ok(manifest.storeId.startsWith('qb_'));
assert.strictEqual(manifest.schemaVersion, 1);
assert.strictEqual(manifest.lastMountedByDeviceId, deviceId);
assert.ok(fs.existsSync(path.join(root, 'manifest.json')));
assert.ok(fs.existsSync(path.join(root, 'assets', 'images')));
assert.ok(fs.existsSync(path.join(root, 'assets', 'word-imports')));
assert.ok(fs.existsSync(path.join(root, 'assets', 'exports')));
assert.ok(fs.existsSync(path.join(root, 'backups')));

const inspected = inspectQuestionBankStore(root);
assert.strictEqual(inspected.available, true);
assert.strictEqual(inspected.manifest.storeId, manifest.storeId);

assert.doesNotThrow(() => assertQuestionBankWritable(root, { nodeRole: 'primary-host', deviceId }));
assert.throws(
  () => assertQuestionBankWritable(root, { nodeRole: 'desktop-client', deviceId: 'client_a' }),
  /Only primary-host/
);
assert.throws(
  () => inspectQuestionBankStore(path.join(root, 'missing')),
  /not available/
);
```

- [ ] **Step 2: Verify failing test**

Run:

```bash
node backend/src/services/questionBankStorageService.test.js
```

Expected: fail with `Cannot find module './questionBankStorageService'`.

- [ ] **Step 3: Implement service**

Create `backend/src/services/questionBankStorageService.js`:

```js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function now() {
  return new Date().toISOString();
}

function storeId() {
  return `qb_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function manifestPath(root) {
  return path.join(root, 'manifest.json');
}

function requiredDirs(root) {
  return [
    path.join(root, 'assets'),
    path.join(root, 'assets', 'images'),
    path.join(root, 'assets', 'word-imports'),
    path.join(root, 'assets', 'exports'),
    path.join(root, 'backups'),
  ];
}

function initQuestionBankStore(root, options = {}) {
  if (!root) throw new Error('question bank root is required');
  ensureDir(root);
  requiredDirs(root).forEach(ensureDir);

  const file = manifestPath(root);
  let manifest;
  if (fs.existsSync(file)) {
    manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } else {
    manifest = {
      storeId: storeId(),
      schemaVersion: 1,
      createdAt: now(),
      lastMountedByDeviceId: options.deviceId || '',
      lastVerifiedAt: now(),
    };
  }

  manifest.schemaVersion = Number(manifest.schemaVersion || 1);
  manifest.lastMountedByDeviceId = options.deviceId || manifest.lastMountedByDeviceId || '';
  manifest.lastVerifiedAt = now();
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

function inspectQuestionBankStore(root) {
  if (!root || !fs.existsSync(root)) throw new Error('question bank store is not available');
  const file = manifestPath(root);
  if (!fs.existsSync(file)) throw new Error('question bank manifest is missing');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const missingDirs = requiredDirs(root).filter(dir => !fs.existsSync(dir));
  return { available: missingDirs.length === 0, root, manifest, missingDirs };
}

function assertQuestionBankWritable(root, options = {}) {
  const inspected = inspectQuestionBankStore(root);
  if (!inspected.available) throw new Error('question bank store is incomplete');
  if (options.nodeRole !== 'primary-host') {
    throw new Error('Only primary-host can write to question bank removable storage');
  }
  return inspected;
}

function resolveQuestionAssetPath(root, category, fileName) {
  const safeName = path.basename(fileName);
  const folder = category === 'word-imports' || category === 'exports' ? category : 'images';
  return path.join(root, 'assets', folder, safeName);
}

module.exports = {
  initQuestionBankStore,
  inspectQuestionBankStore,
  assertQuestionBankWritable,
  resolveQuestionAssetPath,
};
```

- [ ] **Step 4: Run tests**

```bash
node backend/src/services/questionBankStorageService.test.js
npm test
```

Expected: all pass.

- [ ] **Step 5: Add test to package**

Add `node backend/src/services/questionBankStorageService.test.js` to `test:backend` after `eventBus.test.js`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/questionBankStorageService.js backend/src/services/questionBankStorageService.test.js package.json
git commit -m "feat: add removable question bank storage service"
```

---

## Task 5: Protect question-bank writes when removable storage is unavailable

**Files:**

- Modify: `backend/src/routes/questionBank.js`
- Modify: `backend/src/services/questionBankService.js` if direct file paths are used there.
- Modify: `src/pages/QuestionBankImport.tsx`
- Modify: `src/pages/QuestionBankPreview.tsx`
- Test: `src/uiRegression.test.js`

- [ ] **Step 1: Add UI regression checks**

Add to `src/uiRegression.test.js`:

```js
assert.ok(
  questionBankImport.includes('题库移动硬盘未连接') ||
  questionBankImport.includes('questionBankStorageStatus'),
  'question bank import should show removable storage unavailable state'
);

assert.ok(
  questionBankPreview.includes('题库移动硬盘未连接') ||
  questionBankPreview.includes('questionBankStorageStatus'),
  'question bank preview should respect removable storage status'
);
```

- [ ] **Step 2: Add backend storage status endpoint**

In `backend/src/routes/questionBank.js`, import:

```js
const {
  initQuestionBankStore,
  inspectQuestionBankStore,
  assertQuestionBankWritable,
} = require('../services/questionBankStorageService');
```

Add:

```js
router.get('/storage/status', (_req, res) => {
  try {
    const root = process.env.QUESTION_BANK_ROOT || '';
    if (!root) {
      return res.json({ success: true, available: false, writable: false, reason: 'QUESTION_BANK_ROOT is not configured' });
    }
    const status = inspectQuestionBankStore(root);
    res.json({
      success: true,
      available: status.available,
      writable: process.env.GEWU_NODE_ROLE === 'primary-host',
      root,
      manifest: status.manifest,
      missingDirs: status.missingDirs,
    });
  } catch (error) {
    res.json({ success: true, available: false, writable: false, reason: error.message });
  }
});

router.post('/storage/init', (_req, res) => {
  try {
    if (process.env.GEWU_NODE_ROLE !== 'primary-host') {
      return res.status(403).json({ success: false, error: 'Only primary-host can initialize question bank storage' });
    }
    const root = process.env.QUESTION_BANK_ROOT;
    const manifest = initQuestionBankStore(root, { deviceId: process.env.GEWU_DEVICE_ID || '' });
    res.json({ success: true, manifest, root });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

- [ ] **Step 3: Guard write endpoints**

Before Word import upload, asset upload, and export file writes, call:

```js
assertQuestionBankWritable(process.env.QUESTION_BANK_ROOT, {
  nodeRole: process.env.GEWU_NODE_ROLE,
  deviceId: process.env.GEWU_DEVICE_ID,
});
```

Return HTTP 409 with message:

```js
return res.status(409).json({
  success: false,
  error: '题库移动硬盘未连接或当前设备无写入权限',
});
```

- [ ] **Step 4: Add frontend status loading**

In question bank pages, load:

```ts
async function fetchQuestionBankStorageStatus() {
  const res = await fetch(`${API_BASE}/question-bank/storage/status`);
  const json = await res.json();
  return json;
}
```

Show `<Alert type="warning" message="题库移动硬盘未连接" />` when unavailable. Disable import/export buttons that require writes.

- [ ] **Step 5: Verify**

Run:

```bash
node src/uiRegression.test.js
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/questionBank.js src/pages/QuestionBankImport.tsx src/pages/QuestionBankPreview.tsx src/uiRegression.test.js
git commit -m "feat: guard question bank writes by removable storage status"
```

---

## Task 6: Define unified mutation queue model

**Files:**

- Create: `src/services/mutationQueue.ts`
- Create: `src/services/mutationQueue.test.js`
- Modify: `src/services/syncEngine.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing test**

Create `src/services/mutationQueue.test.js`:

```js
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/mutationQueue.ts', 'utf-8');

assert.ok(source.includes('export type SyncOperation'), 'should export SyncOperation');
assert.ok(source.includes('class LocalMutationQueue'), 'should define LocalMutationQueue');
assert.ok(source.includes('riskLevel'), 'operations should include riskLevel');
assert.ok(source.includes('baseVersion'), 'operations should include baseVersion');
assert.ok(source.includes('clearApplied'), 'queue should clear only applied operation ids');
```

- [ ] **Step 2: Verify failing test**

```bash
node src/services/mutationQueue.test.js
```

Expected: fail because file does not exist.

- [ ] **Step 3: Implement `mutationQueue.ts`**

Create:

```ts
import { v4 as uuid } from 'uuid';
import type { SyncTable, SyncAction } from './syncEngine';

export type RiskLevel = 'low' | 'medium' | 'high';

export type SyncOperation = {
  operationId: string;
  tenantId: string;
  deviceId: string;
  tableName: SyncTable;
  recordId: string;
  action: SyncAction;
  baseVersion: string | null;
  newVersion: string;
  payload: Record<string, any>;
  riskLevel: RiskLevel;
  createdAt: string;
};

const HIGH_RISK_TABLES = new Set([
  'payments',
  'consumptions',
  'schedules',
  'courses',
  'questions',
  'assetRecords',
]);

export function classifyRisk(tableName: SyncTable, payload: Record<string, any>): RiskLevel {
  if (HIGH_RISK_TABLES.has(tableName)) return 'high';
  if ('balance_money' in payload || 'tuition_total' in payload || 'answer' in payload || 'analysis' in payload) return 'high';
  if ('notes' in payload || 'tags' in payload) return 'low';
  return 'medium';
}

export function createSyncOperation(input: {
  tenantId?: string;
  deviceId: string;
  tableName: SyncTable;
  recordId: string;
  action: SyncAction;
  baseVersion?: string | null;
  payload?: Record<string, any>;
}): SyncOperation {
  const createdAt = new Date().toISOString();
  const payload = { ...(input.payload || {}), id: input.recordId };
  return {
    operationId: uuid(),
    tenantId: input.tenantId || payload.tenant_id || 'default',
    deviceId: input.deviceId,
    tableName: input.tableName,
    recordId: input.recordId,
    action: input.action,
    baseVersion: input.baseVersion || null,
    newVersion: payload.updated_at || createdAt,
    payload,
    riskLevel: classifyRisk(input.tableName, payload),
    createdAt,
  };
}

export interface MutationQueueStorage {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
}

export class LocalMutationQueue {
  private key = 'gewu_mutation_queue_v1';
  constructor(private storage: MutationQueueStorage) {}

  list(): SyncOperation[] {
    return this.storage.get<SyncOperation[]>(this.key) || [];
  }

  add(operation: SyncOperation): SyncOperation[] {
    const next = [...this.list(), operation];
    this.storage.set(this.key, next);
    return next;
  }

  clearApplied(appliedOperationIds: string[]): SyncOperation[] {
    const applied = new Set(appliedOperationIds);
    const next = this.list().filter(op => !applied.has(op.operationId));
    this.storage.set(this.key, next);
    return next;
  }

  replace(operations: SyncOperation[]): void {
    this.storage.set(this.key, operations);
  }
}
```

- [ ] **Step 4: Update `syncEngine.ts` compatibility**

Map `SyncOperation` into existing `SyncChange` when pushing:

```ts
function operationToChange(operation: SyncOperation): SyncChange {
  return {
    id: operation.operationId,
    table: operation.tableName,
    action: operation.action,
    data: {
      ...operation.payload,
      _base_version: operation.baseVersion,
      _risk_level: operation.riskLevel,
    },
    version: operation.newVersion,
    updatedAt: operation.newVersion,
    tenantId: operation.tenantId,
    deviceId: operation.deviceId,
  };
}
```

Keep old `SyncChange` APIs working so existing pages do not break.

- [ ] **Step 5: Run tests**

```bash
node src/services/mutationQueue.test.js
npm test
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/mutationQueue.ts src/services/mutationQueue.test.js src/services/syncEngine.ts package.json
git commit -m "feat: define unified local mutation queue"
```

---

## Task 7: Backend sync authorization and conflict persistence

**Files:**

- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `backend/src/routes/sync.js`
- Modify: `backend/src/services/syncIncremental.test.js`

- [ ] **Step 1: Add schema test expectations**

Extend `backend/src/services/syncIncremental.test.js` to assert these tables exist:

```js
const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
assert.ok(tables.includes('sync_devices'), 'sync_devices table should exist');
assert.ok(tables.includes('sync_authorizations'), 'sync_authorizations table should exist');
assert.ok(tables.includes('sync_conflicts'), 'sync_conflicts table should exist');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node backend/src/services/syncIncremental.test.js
```

Expected: fail because tables do not exist.

- [ ] **Step 3: Add schema**

In `backend/src/schema.sql` add:

```sql
CREATE TABLE IF NOT EXISTS sync_devices (
  id TEXT PRIMARY KEY,
  device_name TEXT,
  role TEXT NOT NULL DEFAULT 'desktop-client',
  trusted INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_authorizations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'sync:push',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES sync_devices(id)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  base_version TEXT,
  server_version TEXT,
  client_payload TEXT NOT NULL,
  server_payload TEXT,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_devices_last_seen ON sync_devices(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sync_authorizations_device ON sync_authorizations(device_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(status, created_at);
```

- [ ] **Step 4: Add database methods**

In `backend/src/database.js`, add methods:

```js
registerSyncDevice(deviceId, payload = {}) {
  const now = this._now();
  this.db.prepare(
    `INSERT INTO sync_devices (id, device_name, role, trusted, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       device_name = excluded.device_name,
       role = excluded.role,
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`
  ).run(deviceId, payload.deviceName || deviceId, payload.role || 'desktop-client', payload.trusted ? 1 : 0, now, now, now);
  return this.db.prepare('SELECT * FROM sync_devices WHERE id = ?').get(deviceId);
}

issueSyncAuthorization(deviceId, options = {}) {
  const crypto = require('crypto');
  const now = this._now();
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + (options.ttlMs || 10 * 60 * 1000)).toISOString();
  const id = this._generateId ? this._generateId() : crypto.randomUUID();
  this.registerSyncDevice(deviceId, { role: options.role || 'desktop-client' });
  this.db.prepare(
    `INSERT INTO sync_authorizations (id, device_id, token_hash, scope, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, deviceId, tokenHash, options.scope || 'sync:push', expiresAt, now);
  return { id, token, expiresAt };
}

verifySyncAuthorization(deviceId, token) {
  const crypto = require('crypto');
  const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const row = this.db.prepare(
    `SELECT * FROM sync_authorizations
     WHERE device_id = ? AND token_hash = ? AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(deviceId, tokenHash);
  if (!row) return false;
  if (Date.parse(row.expires_at) < Date.now()) return false;
  this.db.prepare('UPDATE sync_authorizations SET used_at = ? WHERE id = ?').run(this._now(), row.id);
  return true;
}
```

In `applySyncChanges`, before applying high-risk updates, compare:

```js
const baseVersion = change.data?._base_version || change.baseVersion || null;
const riskLevel = change.data?._risk_level || change.riskLevel || 'medium';
const existingVersion = existing?.updated_at || null;
if (existing && baseVersion && existingVersion && baseVersion !== existingVersion && riskLevel === 'high') {
  this.recordSyncConflict(change, existing, { deviceId, tenantId });
  results.conflicts += 1;
  continue;
}
```

Add `recordSyncConflict`:

```js
recordSyncConflict(change, existing, options = {}) {
  const id = this._generateId ? this._generateId() : require('crypto').randomUUID();
  this.db.prepare(
    `INSERT INTO sync_conflicts
     (id, operation_id, device_id, table_name, record_id, base_version, server_version,
      client_payload, server_payload, risk_level, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    id,
    change.id,
    options.deviceId || change.deviceId || 'unknown',
    change.table,
    change.data?.id,
    change.data?._base_version || null,
    existing?.updated_at || null,
    JSON.stringify(change.data || {}),
    JSON.stringify(existing || {}),
    change.data?._risk_level || 'medium',
    this._now()
  );
  return id;
}
```

- [ ] **Step 5: Add routes**

In `backend/src/routes/sync.js`, add:

```js
router.post('/devices/register', (req, res) => {
  try {
    const db = getInstance();
    const deviceId = readDeviceId(req);
    const device = db.registerSyncDevice(deviceId, {
      deviceName: req.body?.deviceName,
      role: req.body?.role || 'desktop-client',
    });
    res.json({ success: true, device });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/authorize', (req, res) => {
  try {
    const db = getInstance();
    const deviceId = readDeviceId(req);
    const authorization = db.issueSyncAuthorization(deviceId, { role: req.body?.role || 'desktop-client' });
    res.json({ success: true, authorization });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
```

In `/push`, require token when current backend role is `primary-host`:

```js
const token = req.headers['x-sync-authorization'] || req.body?.syncAuthorizationToken;
if (process.env.GEWU_NODE_ROLE === 'primary-host' && !db.verifySyncAuthorization(deviceId, token)) {
  return res.status(403).json({ success: false, error: 'sync authorization required' });
}
```

- [ ] **Step 6: Run tests**

```bash
node backend/src/services/syncIncremental.test.js
npm test
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/schema.sql backend/src/database.js backend/src/routes/sync.js backend/src/services/syncIncremental.test.js
git commit -m "feat: add host sync authorization and conflict records"
```

---

## Task 8: Desktop client sync confirmation workflow

**Files:**

- Modify: `src/services/syncApi.ts`
- Modify: `src/pages/SyncSettings.tsx`
- Modify: `src/pages/CloudSync.tsx`
- Modify: `src/pages/TodayWorkbench.tsx`
- Test: `src/uiRegression.test.js`

- [ ] **Step 1: Add regression checks**

In `src/uiRegression.test.js`, assert:

```js
const syncSettings = read('src/pages/SyncSettings.tsx');

assert.ok(
  syncSettings.includes('申请同步权限') &&
  syncSettings.includes('检测到') &&
  syncSettings.includes('离线更改') &&
  syncSettings.includes('只拉取主机数据'),
  'sync settings should require user confirmation before pushing offline changes'
);
```

- [ ] **Step 2: Add sync API helpers**

In `src/services/syncApi.ts`, add:

```ts
export async function registerSyncDevice(input: { deviceId: string; role: string; deviceName?: string }) {
  const res = await fetch(`${SYNC_URL}/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: input.deviceId,
      role: input.role,
      deviceName: input.deviceName,
    }),
  });
  return res.json();
}

export async function requestSyncAuthorization(input: { deviceId: string; role: string }) {
  const res = await fetch(`${SYNC_URL}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: input.deviceId, role: input.role }),
  });
  return res.json();
}
```

Modify `pushSyncBatch` to accept token:

```ts
export async function pushSyncBatch(
  batch: SyncBatch,
  options: { authorizationToken?: string } = {}
): Promise<{ success: boolean; serverTimestamp: number; applied?: number; conflicts?: number; errors?: any[] }> {
  // existing fetch body stays, add header:
  // 'x-sync-authorization': options.authorizationToken || ''
}
```

- [ ] **Step 3: Update UI**

In `src/pages/SyncSettings.tsx`:

- Add state for `runtimeConfig`.
- Show pending count.
- Add a primary button labeled `申请同步权限并推送`.
- Add a secondary button labeled `只拉取主机数据`.
- Before push, call `requestSyncAuthorization`.
- Pass returned token into `pushSyncBatch`.

Required behavior:

```ts
const handleAuthorizedPush = async () => {
  if (!engine) return;
  const pending = engine.getPendingChanges();
  if (pending.length === 0) {
    message.info('没有待同步的离线更改');
    return;
  }
  Modal.confirm({
    title: `检测到 ${pending.length} 条离线更改`,
    content: '是否申请同步权限并同步到本地数据主机？同步前不会静默覆盖主机数据。',
    okText: '申请同步权限并推送',
    cancelText: '稍后',
    onOk: async () => {
      const auth = await requestSyncAuthorization({ deviceId: engine.getDeviceId(), role: runtimeConfig?.nodeRole || 'desktop-client' });
      if (!auth.success) throw new Error(auth.error || '申请同步权限失败');
      const result = await engine.push(batch => pushSyncBatch(batch, {
        authorizationToken: auth.authorization.token,
      }));
      refreshStatus();
      message.success(`同步完成，已推送 ${result.pushed} 条`);
    },
  });
};
```

- [ ] **Step 4: Run checks**

```bash
node src/uiRegression.test.js
npm run build
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/syncApi.ts src/pages/SyncSettings.tsx src/pages/CloudSync.tsx src/pages/TodayWorkbench.tsx src/uiRegression.test.js
git commit -m "feat: require user confirmation for offline sync push"
```

---

## Task 9: Main-host sync review center

**Files:**

- Modify: `backend/src/routes/sync.js`
- Modify: `backend/src/database.js`
- Modify: `src/pages/SyncSettings.tsx`
- Test: `src/uiRegression.test.js`

- [ ] **Step 1: Add backend conflict list and resolve APIs**

In `backend/src/database.js`:

```js
listSyncConflicts(status = 'pending') {
  return this.db.prepare(
    `SELECT * FROM sync_conflicts WHERE status = ? ORDER BY created_at DESC LIMIT 200`
  ).all(status).map(row => ({
    ...row,
    client_payload: JSON.parse(row.client_payload || '{}'),
    server_payload: JSON.parse(row.server_payload || '{}'),
  }));
}

resolveSyncConflict(id, resolution) {
  const now = this._now();
  this.db.prepare(
    `UPDATE sync_conflicts
     SET status = 'resolved', resolution = ?, resolved_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(resolution), now, id);
  return this.db.prepare('SELECT * FROM sync_conflicts WHERE id = ?').get(id);
}
```

In `backend/src/routes/sync.js`:

```js
router.get('/conflicts', (_req, res) => {
  try {
    const db = getInstance();
    res.json({ success: true, conflicts: db.listSyncConflicts('pending') });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/conflicts/:id/resolve', (req, res) => {
  try {
    const db = getInstance();
    const conflict = db.resolveSyncConflict(req.params.id, req.body || {});
    res.json({ success: true, conflict });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 2: Add UI panel**

In `src/pages/SyncSettings.tsx`, add section title `同步审核中心` and a table with:

- table name
- record id
- device id
- risk level
- created at
- actions: 主机优先, 客户端优先, 拒绝

- [ ] **Step 3: Add regression**

Assert `SyncSettings.tsx` includes:

```js
assert.ok(
  syncSettings.includes('同步审核中心') &&
  syncSettings.includes('主机优先') &&
  syncSettings.includes('客户端优先') &&
  syncSettings.includes('拒绝'),
  'sync settings should expose host conflict review actions'
);
```

- [ ] **Step 4: Run checks**

```bash
node src/uiRegression.test.js
npm test
npm run build
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/database.js backend/src/routes/sync.js src/pages/SyncSettings.tsx src/uiRegression.test.js
git commit -m "feat: add host sync conflict review center"
```

---

## Task 10: Cloud relay schema and gateway routes

**Files:**

- Modify: `gateway/src/db/schema.sql`
- Create: `gateway/src/routes/cloudRelay.js`
- Modify: `gateway/src/app.js`
- Create: `gateway/src/routes/cloudRelay.test.js`
- Modify: `package.json` if root test script should run gateway tests.

- [ ] **Step 1: Add gateway route test**

Create `gateway/src/routes/cloudRelay.test.js`:

```js
const assert = require('assert');
const fs = require('fs');

const schema = fs.readFileSync('gateway/src/db/schema.sql', 'utf-8');
const route = fs.readFileSync('gateway/src/routes/cloudRelay.js', 'utf-8');
const app = fs.readFileSync('gateway/src/app.js', 'utf-8');

assert.ok(schema.includes('host_heartbeats'), 'schema should include host_heartbeats');
assert.ok(schema.includes('readonly_snapshots'), 'schema should include readonly_snapshots');
assert.ok(schema.includes('miniapp_tasks'), 'schema should include miniapp_tasks');
assert.ok(route.includes('/host/heartbeat'), 'cloud relay should expose host heartbeat');
assert.ok(route.includes('/snapshots/publish'), 'cloud relay should expose snapshot publish');
assert.ok(route.includes('/snapshots/read'), 'cloud relay should expose snapshot read');
assert.ok(route.includes('/tasks'), 'cloud relay should expose miniapp tasks');
assert.ok(app.includes("require('./routes/cloudRelay')"), 'gateway app should mount cloud relay');
```

- [ ] **Step 2: Verify failing test**

```bash
node gateway/src/routes/cloudRelay.test.js
```

Expected: fail because route/schema missing.

- [ ] **Step 3: Add schema**

Append to `gateway/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS host_heartbeats (
  id TEXT PRIMARY KEY,
  host_device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'online',
  base_url TEXT,
  last_snapshot_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS readonly_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  source_device_id TEXT NOT NULL,
  version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS miniapp_tasks (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_host',
  payload TEXT NOT NULL,
  result_payload TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_devices (
  id TEXT PRIMARY KEY,
  device_name TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 4: Create `gateway/src/routes/cloudRelay.js`**

```js
const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/database');

const router = express.Router();

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }

router.post('/host/heartbeat', (req, res) => {
  const db = getDb();
  const time = now();
  const hostDeviceId = req.body.hostDeviceId || req.body.deviceId;
  if (!hostDeviceId) return res.status(400).json({ success: false, error: 'hostDeviceId is required' });
  db.prepare(
    `INSERT INTO host_heartbeats (id, host_device_id, status, base_url, last_snapshot_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       base_url = excluded.base_url,
       last_snapshot_at = excluded.last_snapshot_at,
       updated_at = excluded.updated_at`
  ).run(hostDeviceId, hostDeviceId, req.body.status || 'online', req.body.baseUrl || '', req.body.lastSnapshotAt || null, time, time);
  res.json({ success: true, serverTime: time });
});

router.post('/snapshots/publish', (req, res) => {
  const db = getDb();
  const snapshotId = id('snap');
  const time = now();
  db.prepare(
    `INSERT INTO readonly_snapshots (id, snapshot_type, payload, source_device_id, version, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    snapshotId,
    req.body.snapshotType || 'full',
    JSON.stringify(req.body.payload || {}),
    req.body.sourceDeviceId || 'unknown',
    req.body.version || time,
    time
  );
  res.json({ success: true, id: snapshotId, createdAt: time });
});

router.get('/snapshots/read', (req, res) => {
  const db = getDb();
  const snapshotType = req.query.snapshotType || 'full';
  const row = db.prepare(
    `SELECT * FROM readonly_snapshots WHERE snapshot_type = ? ORDER BY created_at DESC LIMIT 1`
  ).get(snapshotType);
  res.json({
    success: true,
    snapshot: row ? { ...row, payload: JSON.parse(row.payload || '{}') } : null,
  });
});

router.post('/tasks', (req, res) => {
  const db = getDb();
  const allowed = new Set(['asset-import', 'question-paper', 'paper-export-word', 'paper-export-pdf']);
  if (!allowed.has(req.body.taskType)) return res.status(403).json({ success: false, error: 'task type is not allowed' });
  const taskId = id('task');
  const time = now();
  db.prepare(
    `INSERT INTO miniapp_tasks (id, task_type, status, payload, created_by, created_at, updated_at)
     VALUES (?, ?, 'pending_host', ?, ?, ?, ?)`
  ).run(taskId, req.body.taskType, JSON.stringify(req.body.payload || {}), req.body.createdBy || 'miniapp', time, time);
  res.json({ success: true, task: { id: taskId, status: 'pending_host' } });
});

router.get('/tasks/:id/result', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id = ?').get(req.params.id);
  res.json({
    success: true,
    task: row ? {
      ...row,
      payload: JSON.parse(row.payload || '{}'),
      result_payload: row.result_payload ? JSON.parse(row.result_payload) : null,
    } : null,
  });
});

module.exports = router;
```

- [ ] **Step 5: Mount route**

In `gateway/src/app.js`:

```js
const cloudRelayRouter = require('./routes/cloudRelay');
app.use('/api/cloud', cloudRelayRouter);
```

- [ ] **Step 6: Run tests**

```bash
node gateway/src/routes/cloudRelay.test.js
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add gateway/src/db/schema.sql gateway/src/routes/cloudRelay.js gateway/src/routes/cloudRelay.test.js gateway/src/app.js
git commit -m "feat: add cloud relay snapshot and task APIs"
```

---

## Task 11: Miniapp read-mostly permission and allowed task APIs

**Files:**

- Modify: `miniapp/src/utils/permission.ts`
- Modify: `miniapp/src/utils/api.ts`
- Modify: `miniapp/src/pages/assets/index.tsx`
- Modify: `miniapp/src/pages/index/index.tsx`
- Create: `miniapp/src/utils/miniappAccessPolicy.test.js`

- [ ] **Step 1: Write policy test**

Create `miniapp/src/utils/miniappAccessPolicy.test.js`:

```js
const assert = require('assert');
const fs = require('fs');

const permission = fs.readFileSync('miniapp/src/utils/permission.ts', 'utf-8');
const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');

assert.ok(permission.includes('readonlyModules'), 'miniapp permission should define readonlyModules');
assert.ok(permission.includes('allowedWriteTasks'), 'miniapp permission should define allowedWriteTasks');
assert.ok(api.includes('createMiniappTask'), 'miniapp API should create allowed cloud tasks');
assert.ok(api.includes('readCloudSnapshot'), 'miniapp API should read cloud snapshots');
```

- [ ] **Step 2: Add policy**

In `miniapp/src/utils/permission.ts`:

```ts
export const readonlyModules = [
  'students',
  'courses',
  'schedule',
  'teachers',
  'payments',
  'consumptions',
  'question-bank',
  'finance-stats',
];

export const allowedWriteTasks = [
  'asset-import',
  'question-paper',
  'paper-export-word',
  'paper-export-pdf',
];

export function canMiniappWrite(target: string): boolean {
  return allowedWriteTasks.includes(target);
}

export function assertMiniappWriteAllowed(target: string): void {
  if (!canMiniappWrite(target)) {
    throw new Error('小程序仅允许提交财务导入、组卷和导出任务');
  }
}
```

- [ ] **Step 3: Add cloud task API**

In `miniapp/src/utils/api.ts`:

```ts
export const cloudRelayApi = {
  readCloudSnapshot: (snapshotType = 'full') => api.get<any>(`/cloud/snapshots/read?snapshotType=${snapshotType}`),
  createMiniappTask: (taskType: string, payload: any) => api.post<any>('/cloud/tasks', { taskType, payload }),
  getMiniappTaskResult: (taskId: string) => api.get<any>(`/cloud/tasks/${taskId}/result`),
};

export const readCloudSnapshot = cloudRelayApi.readCloudSnapshot;
export const createMiniappTask = cloudRelayApi.createMiniappTask;
```

- [ ] **Step 4: Update pages**

In `miniapp/src/pages/index/index.tsx`, show snapshot time if returned:

```tsx
<View className='snapshot-time'>
  数据快照：{snapshot?.created_at || '等待主机发布'}
</View>
```

In `miniapp/src/pages/assets/index.tsx`, change write actions to create `asset-import` task instead of direct business mutation.

- [ ] **Step 5: Run tests/build**

```bash
node miniapp/src/utils/miniappAccessPolicy.test.js
cd miniapp && npm run build:weapp
```

Expected: policy test passes and miniapp build succeeds.

- [ ] **Step 6: Commit**

```bash
git add miniapp/src/utils/permission.ts miniapp/src/utils/api.ts miniapp/src/pages/assets/index.tsx miniapp/src/pages/index/index.tsx miniapp/src/utils/miniappAccessPolicy.test.js
git commit -m "feat: restrict miniapp writes to allowed cloud tasks"
```

---

## Task 12: Host publishes snapshots and consumes miniapp tasks

**Files:**

- Create: `backend/src/services/cloudRelayClient.js`
- Create: `backend/src/services/cloudRelayClient.test.js`
- Modify: `backend/src/routes/sync.js` or create `backend/src/routes/cloudRelayHost.js`
- Modify: `backend/src/app.js`

- [ ] **Step 1: Write client test**

Create `backend/src/services/cloudRelayClient.test.js`:

```js
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('backend/src/services/cloudRelayClient.js', 'utf-8');

assert.ok(source.includes('publishHeartbeat'), 'cloud relay client should publish heartbeat');
assert.ok(source.includes('publishSnapshot'), 'cloud relay client should publish snapshot');
assert.ok(source.includes('fetchPendingTasks'), 'cloud relay client should fetch pending tasks');
```

- [ ] **Step 2: Implement cloud relay client**

Create `backend/src/services/cloudRelayClient.js`:

```js
async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function baseUrl() {
  return (process.env.GEWU_CLOUD_BASE_URL || '').replace(/\/+$/, '');
}

async function publishHeartbeat(payload) {
  if (!baseUrl()) return { success: false, skipped: true, reason: 'GEWU_CLOUD_BASE_URL is not configured' };
  return postJson(`${baseUrl()}/api/cloud/host/heartbeat`, payload);
}

async function publishSnapshot(payload) {
  if (!baseUrl()) return { success: false, skipped: true, reason: 'GEWU_CLOUD_BASE_URL is not configured' };
  return postJson(`${baseUrl()}/api/cloud/snapshots/publish`, payload);
}

async function fetchPendingTasks() {
  if (!baseUrl()) return { success: false, skipped: true, tasks: [] };
  const res = await fetch(`${baseUrl()}/api/cloud/tasks?status=pending_host`);
  return res.json();
}

module.exports = {
  publishHeartbeat,
  publishSnapshot,
  fetchPendingTasks,
};
```

- [ ] **Step 3: Add backend route for manual snapshot publish**

Create `backend/src/routes/cloudRelayHost.js`:

```js
const { Router } = require('express');
const { getInstance } = require('../database');
const { publishHeartbeat, publishSnapshot } = require('../services/cloudRelayClient');

const router = Router();

router.post('/heartbeat', async (_req, res) => {
  const result = await publishHeartbeat({
    hostDeviceId: process.env.GEWU_DEVICE_ID || 'unknown',
    status: 'online',
    baseUrl: process.env.GEWU_HOST_BASE_URL || '',
  });
  res.json(result);
});

router.post('/snapshot', async (_req, res) => {
  const db = getInstance();
  const payload = db.exportAllData ? db.exportAllData() : {};
  const result = await publishSnapshot({
    snapshotType: 'full',
    payload,
    sourceDeviceId: process.env.GEWU_DEVICE_ID || 'unknown',
    version: new Date().toISOString(),
  });
  res.json(result);
});

module.exports = router;
```

Mount in `backend/src/app.js`:

```js
app.use('/api/cloud-relay-host', require('./routes/cloudRelayHost'));
```

- [ ] **Step 4: Run tests**

```bash
node backend/src/services/cloudRelayClient.test.js
npm test
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/cloudRelayClient.js backend/src/services/cloudRelayClient.test.js backend/src/routes/cloudRelayHost.js backend/src/app.js
git commit -m "feat: let primary host publish cloud relay snapshots"
```

---

## Task 13: Deployment preparation and smoke checks

**Files:**

- Modify: `scripts/check_server.py` or add `scripts/check_cloud_relay.js`
- Modify: `scripts/docker_deploy.py` if cloud relay env vars need to be passed.
- Modify: `.env.staging.example`
- Modify: `backend/.env.example`

- [ ] **Step 1: Add environment documentation**

Add to `.env.staging.example` and `backend/.env.example`:

```env
GEWU_NODE_ROLE=primary-host
GEWU_DEVICE_ID=desktop_host_001
GEWU_HOST_BASE_URL=http://127.0.0.1:3001
GEWU_CLOUD_BASE_URL=https://your-domain.example.com
QUESTION_BANK_ROOT=E:/GewuQuestionBank
QUESTION_BANK_UPLOAD_DIR=E:/GewuQuestionBank/assets
```

- [ ] **Step 2: Add cloud relay smoke script**

Create `scripts/check_cloud_relay.js`:

```js
const base = (process.env.GEWU_CLOUD_BASE_URL || process.argv[2] || '').replace(/\/+$/, '');
if (!base) {
  console.error('Missing GEWU_CLOUD_BASE_URL or URL argument');
  process.exit(1);
}

async function main() {
  const heartbeat = await fetch(`${base}/api/cloud/host/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostDeviceId: 'smoke_host', status: 'online' }),
  }).then(r => r.json());
  if (!heartbeat.success) throw new Error('heartbeat failed');

  const snapshot = await fetch(`${base}/api/cloud/snapshots/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshotType: 'smoke', payload: { ok: true }, sourceDeviceId: 'smoke_host' }),
  }).then(r => r.json());
  if (!snapshot.success) throw new Error('snapshot publish failed');

  const read = await fetch(`${base}/api/cloud/snapshots/read?snapshotType=smoke`).then(r => r.json());
  if (!read.success || !read.snapshot) throw new Error('snapshot read failed');
  console.log('cloud relay smoke passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Run local checks**

```bash
node scripts/check_cloud_relay.js http://localhost:3000
```

Expected: fail if no gateway server is running; pass when gateway is running. Document the expected dependency in the deployment notes.

- [ ] **Step 4: Commit**

```bash
git add .env.staging.example backend/.env.example scripts/check_cloud_relay.js
git commit -m "chore: document cloud relay deployment env"
```

---

## Task 14: Release after each implementation batch

This project has persistent release instructions in `AGENTS.md`. After code modifications that complete a batch, run:

- [ ] **Step 1: Rebuild native dependency for current Node if needed**

```bash
npm rebuild better-sqlite3
```

- [ ] **Step 2: Run verification**

```bash
npm test
npm run build
```

- [ ] **Step 3: Bump version**

```bash
npm version patch --no-git-tag-version
```

- [ ] **Step 4: Build installer**

```bash
npx electron-builder --win
```

- [ ] **Step 5: Commit release**

```bash
git add -A
git commit -m "自动发布 2026-06-25"
```

Use the actual current date for future runs.

- [ ] **Step 6: Push all remotes**

```bash
git push origin master
git push gewu master
```

If SSH fails, use the HTTPS remotes already validated previously:

```bash
git push https://github.com/YellMoon/scheduling-system.git master
git push https://github.com/YellMoon/gewu-gongfang.git master
```

- [ ] **Step 7: Upload installer to Quark**

```bash
node scripts/upload-quark-clean.js
```

Expected destination:

```text
codex项目/<当日日期>/格物工坊 Setup <version>.exe
```

---

## Self-review checklist

- Spec coverage:
  - Local host role: Tasks 1, 2, 3, 7, 9, 12.
  - Removable question-bank storage: Tasks 1, 3, 4, 5.
  - Desktop offline writes and authorized sync: Tasks 6, 7, 8, 9.
  - Cloud relay: Tasks 10, 12, 13.
  - Miniapp read-mostly and limited writes: Tasks 10, 11.
  - UI redesign is intentionally delayed until after the foundation; this matches the design document.
  - Deployment is covered by Tasks 13 and 14.

- Type consistency:
  - Runtime roles use `primary-host | desktop-client` across config, env, backend, and UI.
  - Question-bank env names use `QUESTION_BANK_ROOT` and `QUESTION_BANK_UPLOAD_DIR`.
  - Sync operations preserve compatibility with existing `SyncChange` via `operationToChange`.

- Verification:
  - Every implementation task includes an initial failing test or regression assertion.
  - Each task includes explicit commands and expected pass/fail states.
  - Release instructions remain separate because they are required after code-changing batches, not after plan-only work.
