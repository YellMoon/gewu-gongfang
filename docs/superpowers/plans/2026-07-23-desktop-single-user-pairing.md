# Desktop Single-User Pairing and Unified Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在冻结微信小程序的前提下，为当前数据主机建立本地单人身份初始化/密码重设、一次性普通设备配对、手动同步与主机自动处理，并完成此前任务审计、真实运行时验证和统一桌面/云端发布。

**Architecture:** 保留现有 canonical 用户、`desktop_device_authorizations`、Ed25519 设备签名、V2 桌面会话和 `primary_host_epochs`。新增由数据主机本地配置控制的 `single-user` 认证来源；普通设备把配对码和设备声明用当前主机在线发布的 X25519 公钥端到端加密，云网关只保存密文并中继，主机解密、原子消费配对码并创建设备授权。同步继续由用户确认预览后提交，主机自动领取；每个非空批次先建 SQLite 备份和题库影响清单，再事务应用并写审计。

**Tech Stack:** Node.js/CommonJS、Express、SQLite/better-sqlite3、Node `crypto`（Ed25519、X25519、AES-256-GCM、scrypt）、Electron `safeStorage`/IPC、React/TypeScript/Ant Design、现有云中继 V2、electron-updater、Node 断言测试与 Playwright/Electron 真实运行时。

---

## 文件边界

- `public/runtimeConfig.js`：持久化 `desktopIdentityMode`；普通 flavor 强制 `full`，只有主机运行时管理器可写 `single-user`。
- `backend/src/services/singleUserDesktopIdentityService.js`：主机本地初始化、密码重设、配对码、X25519 能力、密文请求和模式撤销的唯一领域服务。
- `public/singleUserPairingEnvelope.js`：无状态 X25519/AES-GCM 协议；只处理严格规范化、加密和解密，不访问数据库或网络。
- `backend/src/routes/desktopIdentity.js`：回环本地初始化/重设、主机配对能力和直连配对 HTTP 契约。
- `gateway/src/routes/cloudRelay.js`：保存主机发布的在线配对能力与不透明请求密文；不能生成授权。
- `backend/src/routes/cloudRelayHost.js`：数据主机领取 `desktop-pairing`/`desktop-sync` 任务并调用本地领域服务。
- `public/desktopIdentityVault.js`：继续保存设备私钥和密码信封；新增本地初始化/配对所需的待注册签名用途，不暴露私钥。
- `src/services/desktopIdentityClient.mjs`：选择本地主机初始化、直连配对或云配对，成功后沿用现有 `completeRegistration` 密封密码信封。
- `src/components/DesktopIdentityGate.tsx`：主机单人初始化/重设与普通端配对 UI；不再依赖微信。
- `backend/src/services/syncBatchBackupService.js`：非空同步批次的 SQLite 在线备份、题库影响清单和完成/失败审计。
- `src/pages/SyncSettings.tsx`、`src/pages/CloudSync.tsx`：统一“开始同步”文案和预览/冲突/备份结果。
- `public/electron.js`、`public/preload.js`、`src/pages/SystemSettings.tsx`：受限 IPC、默认菜单和 OSS 更新入口回归。
- 微信小程序文件只处理实施前已经存在的五个未提交修复；本计划不新增小程序功能、不构建、不上传。

### Task 0: 固化基线并隔离现有工作区改动

**Files:**
- Modify: `backend/src/routes/desktopIdentity.http.test.js:333-339`
- Modify: `backend/src/services/desktopIdentityService.js:145-158`
- Modify: `backend/src/services/desktopIdentityService.test.js:99-108`
- Modify: `miniapp/src/utils/desktopAuthorizationRuntime.js:84-102,217-225`
- Modify: `miniapp/src/utils/desktopAuthorizationRuntime.test.js:40-66,116-126`

- [x] **Step 1: 记录并验证现有五个已知改动**

Run:

```powershell
git diff -- backend/src/routes/desktopIdentity.http.test.js backend/src/services/desktopIdentityService.js backend/src/services/desktopIdentityService.test.js miniapp/src/utils/desktopAuthorizationRuntime.js miniapp/src/utils/desktopAuthorizationRuntime.test.js
npm run test:desktop-identity
npm run test:desktop-authorization
```

Expected: diff 只包含 miniapp challenge `rowVersion` 投影和手机号授权错误分类；两组测试 PASS。

- [x] **Step 2: 单独提交既有修复，不发布小程序**

Run:

```powershell
git add backend/src/routes/desktopIdentity.http.test.js backend/src/services/desktopIdentityService.js backend/src/services/desktopIdentityService.test.js miniapp/src/utils/desktopAuthorizationRuntime.js miniapp/src/utils/desktopAuthorizationRuntime.test.js
git commit -m "fix: 固化桌面授权版本与微信错误分类"
```

Expected: commit 只含五个已知文件；`.codex-task-handoff/`、`.playwright-cli/`、`dist-host/`、`output/` 和 `scripts/inspect-paper-template.py` 保持未跟踪且不删除。

### Task 1: 单人模式配置与可迁移数据模型

**Files:**
- Modify: `public/runtimeConfig.js:5-182`
- Modify: `public/runtimeConfig.test.js`
- Modify: `public/primaryHostRuntimeManager.js`
- Modify: `public/primaryHostRuntimeManager.test.js`
- Modify: `backend/src/schema.sql:426-655`
- Modify: `backend/src/database.js:409-690`
- Modify: `backend/src/databaseAuthorization.test.js`
- Modify: `gateway/src/db/schema.sql`
- Modify: `gateway/src/db/database.js`
- Modify: `package.json:20-60`

- [x] **Step 1: 写配置与迁移 RED 测试**

```js
const ordinary = normalizeRuntimeConfig({ desktopIdentityMode: 'single-user' }, {
  userDataPath: root,
  primaryHostCapable: false,
});
assert.strictEqual(ordinary.desktopIdentityMode, 'full');

const host = normalizeRuntimeConfig({ desktopIdentityMode: 'single-user' }, {
  userDataPath: root,
  primaryHostCapable: true,
});
assert.strictEqual(host.desktopIdentityMode, 'single-user');
assert.throws(
  () => writeManagedDesktopIdentityMode(configPath, 'single-user', { primaryHostCapable: false }),
  error => error.code === 'DESKTOP_IDENTITY_MODE_HOST_FLAVOR_REQUIRED'
);
```

数据库测试断言存在以下字段/表，并重复初始化两次不丢数据：

```js
assert.ok(columnNames('desktop_device_authorizations').includes('authorization_source'));
assertTable('desktop_single_user_pairing_grants');
assertTable('desktop_single_user_pairing_requests');
assertTable('desktop_sync_batch_backups');
```

- [x] **Step 2: 运行 RED**

Run:

```powershell
node public/runtimeConfig.test.js
node public/primaryHostRuntimeManager.test.js
node backend/src/databaseAuthorization.test.js
node gateway/src/databaseAuthorization.test.js
```

Expected: FAIL，缺少 `desktopIdentityMode`、受控写入函数和三张本地表/网关配对中继表。

- [x] **Step 3: 实现配置强制边界**

在 `public/runtimeConfig.js` 中使用明确枚举：

```js
const DESKTOP_IDENTITY_MODES = new Set(['full', 'single-user']);

function normalizeDesktopIdentityMode(value, options = {}) {
  if (!options.primaryHostCapable) return 'full';
  return DESKTOP_IDENTITY_MODES.has(value) ? value : 'full';
}

function writeManagedDesktopIdentityMode(configPath, mode, options = {}) {
  if (!options.primaryHostCapable) {
    throw runtimeConfigError('DESKTOP_IDENTITY_MODE_HOST_FLAVOR_REQUIRED');
  }
  const current = readRuntimeConfig(configPath, options);
  return persistRuntimeConfig(configPath, normalizeRuntimeConfig({
    ...current,
    desktopIdentityMode: normalizeDesktopIdentityMode(mode, options),
  }, options));
}
```

`applyRuntimeConfigToEnv` 总是写入 `GEWU_DESKTOP_IDENTITY_MODE`；普通 flavor 在 `loadAndApplyRuntimeConfig()` 中再次强制 `full`。`primaryHostRuntimeManager.setIdentityMode({ mode, confirmation })` 只接受 `confirmation === 'ENABLE_SINGLE_USER_MODE'` 或 `DISABLE_SINGLE_USER_MODE`，写入后要求 Electron 重启；普通包既不包含 manager，也不暴露该 IPC。

- [x] **Step 4: 实现增量 schema**

`desktop_device_authorizations.authorization_source` 默认 `wechat_phone`。新增本地 grant/request/backup 表；grant 只存 `code_salt`、`code_digest` 和公开能力 ID，不存配对码或 X25519 私钥。网关新增 `desktop_pairing_capabilities` 与 `desktop_pairing_relay_requests`，只存公开能力和密文：

```sql
CREATE TABLE IF NOT EXISTS desktop_single_user_pairing_grants (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  code_salt TEXT NOT NULL,
  code_digest TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','consumed','revoked','expired','locked')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT
);
```

迁移使用 `PRAGMA table_info` + `ALTER TABLE ... ADD COLUMN`；不重建或删除现有授权表。

- [x] **Step 5: 运行 GREEN 并提交**

Run:

```powershell
node public/runtimeConfig.test.js
node public/primaryHostRuntimeManager.test.js
node backend/src/databaseAuthorization.test.js
node gateway/src/databaseAuthorization.test.js
git add public/runtimeConfig.js public/runtimeConfig.test.js public/primaryHostRuntimeManager.js public/primaryHostRuntimeManager.test.js backend/src/schema.sql backend/src/database.js backend/src/databaseAuthorization.test.js gateway/src/db/schema.sql gateway/src/db/database.js gateway/src/databaseAuthorization.test.js package.json
git commit -m "feat: 增加桌面单人身份模式与迁移表"
```

Expected: tests PASS；现有授权自动得到 `wechat_phone` 来源；不 push。

### Task 2: X25519 不透明配对协议

**Files:**
- Create: `public/singleUserPairingEnvelope.js`
- Create: `public/singleUserPairingEnvelope.test.js`
- Modify: `public/desktopBuildFlavor.test.js`
- Modify: `electron-builder.host.config.cjs`
- Modify: `package.json`

- [x] **Step 1: 写协议 RED 测试**

```js
const host = protocol.createHostCapability({ now: fixedNow });
const device = crypto.generateKeyPairSync('ed25519');
const encrypted = protocol.encryptPairingRequest({
  capability: host.publicCapability,
  pairingCode: '0123-4567-89AB-CDEF',
  device: {
    deviceId: 'ordinary-1',
    deviceName: 'Second PC',
    publicKey: device.publicKey.export({ type: 'spki', format: 'pem' }),
  },
  sign: payload => crypto.sign(null, Buffer.from(payload), device.privateKey).toString('base64'),
});
const opened = protocol.decryptPairingRequest({
  envelope: encrypted,
  capabilityPrivateKey: host.privateKey,
  expectedCapabilityId: host.publicCapability.id,
});
assert.strictEqual(opened.pairingCode, '0123456789ABCDEF');
assert.strictEqual(opened.device.deviceId, 'ordinary-1');
```

另测篡改 capability ID、AAD、ciphertext、device public key、签名、过期时间和超长字段全部返回稳定错误码。

- [x] **Step 2: 运行 RED**

Run: `node public/singleUserPairingEnvelope.test.js`

Expected: FAIL with missing module.

- [x] **Step 3: 实现协议**

协议固定 `gewu-single-user-pairing/v1`。主机生成内存 X25519 密钥；客户端生成临时 X25519 密钥，用 HKDF-SHA256 派生 32 字节 AES key，以 12 字节随机 IV 和规范 JSON AAD 加密。明文包含 16 位 Crockford 配对码、设备声明、请求 nonce、签发/过期时间和设备 Ed25519 签名。公开返回值不含私钥：

```js
return Object.freeze({
  protocolVersion: 'gewu-single-user-pairing/v1',
  capabilityId,
  clientEphemeralPublicKey,
  iv: iv.toString('base64'),
  ciphertext: ciphertext.toString('base64'),
  tag: cipher.getAuthTag().toString('base64'),
});
```

- [x] **Step 4: 验证 ordinary 包不含主机私有运行模块**

`public/desktopBuildFlavor.test.js` 断言普通包包含无状态 envelope 协议，但仍不包含 `primaryHostCredentialStore.js`、`primaryHostOperationValidation.js`、`primaryHostRuntimeManager.js`。主机配置显式包含协议文件。

- [x] **Step 5: 运行 GREEN 并提交**

Run:

```powershell
node public/singleUserPairingEnvelope.test.js
npm run test:desktop-build-flavor
git add public/singleUserPairingEnvelope.js public/singleUserPairingEnvelope.test.js public/desktopBuildFlavor.test.js electron-builder.host.config.cjs package.json
git commit -m "feat: 增加端到端加密桌面配对协议"
```

### Task 3: 主机本地初始化、密码重设与一次性 grant 领域服务

**Files:**
- Create: `backend/src/services/singleUserDesktopIdentityService.js`
- Create: `backend/src/services/singleUserDesktopIdentityService.test.js`
- Modify: `backend/src/services/desktopSessionService.js:130-290`
- Modify: `backend/src/services/desktopSessionService.test.js`
- Modify: `backend/src/services/primaryHostIdentityService.js`
- Modify: `backend/src/services/primaryHostIdentityService.test.js`
- Modify: `backend/src/services/primaryHostLocalValidationService.js`
- Modify: `backend/src/services/primaryHostLocalValidationService.test.js`
- Modify: `package.json`

- [x] **Step 1: 写领域 RED 测试**

覆盖：模式默认关闭；普通 flavor、非回环、非 canonical owner、错误 runtime device/epoch、DB `quick_check` 失败、题库绑定失败、备份失败均不能改表；成功初始化创建 `single_user_local_bootstrap` 授权且不改变业务表计数；密码重设只替换公钥并递增 credential version；配对码正好 80 bit、16 个 Crockford 字符、10 分钟、只存 scrypt 摘要；并发消费只有一个成功；第五次错误后锁定；普通设备的 `deviceKind=primary-host` 被拒绝。

```js
const started = service.bootstrapLocalHost({
  localBridgeVerified: true,
  buildFlavor: 'primary-host',
  runtime: hostRuntime,
  publicIdentity: hostPublicIdentity,
  confirmation: 'SET_LOCAL_PASSWORD_CONFIRMED',
});
assert.strictEqual(started.authorization.authorizationSource, 'single_user_local_bootstrap');
assert.strictEqual(countBusinessRows(db), beforeBusinessRows);

const grant = service.issuePairingGrant({ actor: started.actor });
assert.match(grant.code, /^[0-9A-HJKMNP-TV-Z]{16}$/);
assert.strictEqual(db.prepare('SELECT code_digest FROM desktop_single_user_pairing_grants WHERE id=?').get(grant.id).code_digest.includes(grant.code), false);
```

- [x] **Step 2: 运行 RED**

Run:

```powershell
node backend/src/services/singleUserDesktopIdentityService.test.js
node backend/src/services/desktopSessionService.test.js
```

Expected: FAIL with missing service/source-aware revalidation.

- [x] **Step 3: 实现严格服务接口**

服务只公开：

```js
return Object.freeze({
  bootstrapLocalHost,
  resetLocalHostCredential,
  issuePairingGrant,
  revokePairingGrant,
  currentPairingCapability,
  consumeEncryptedPairingRequest,
  disableSingleUserAuthorizations,
});
```

模块同时导出 `getSingleUserDesktopIdentityService({ db, ...deps })`，用 `WeakMap` 按数据库实例缓存服务，确保直连路由与云任务处理共享同一内存 X25519 capability 私钥。

`bootstrapLocalHost` 复用 `primaryHostLocalValidationService` 的 DB/题库证据和备份，复用 `primaryHostIdentityService` 的 epoch 激活内部事务；若当前 active epoch 已绑定同一 host device，则只补齐/轮换 host 授权，不新建 generation。canonical owner 缺失时 fail closed，不创建匿名用户。

配对码使用：

```js
const raw = crypto.randomBytes(10); // 80 bit
const code = crockfordBase32(raw);  // exactly 16 characters
const salt = crypto.randomBytes(16);
const digest = crypto.scryptSync(code, salt, 32).toString('hex');
```

`consumeEncryptedPairingRequest` 先解密和验证设备签名，再在一个 better-sqlite3 transaction 中锁定 grant、常量时间验证摘要、消费 grant、创建/替换 ordinary authorization、记录 request 和审计。

- [x] **Step 4: 让会话校验识别授权来源**

`desktopSessionService` 的手机号到期判断改为：

```js
if (authorization.authorization_source === 'wechat_phone') {
  assertPhoneReverificationCurrent(authorization, current);
} else if (!isSingleUserModeActive()) {
  throw sessionError('DESKTOP_SINGLE_USER_AUTHORIZATION_DISABLED');
}
```

`single_user_pairing` 只能签发 ordinary session；`single_user_local_bootstrap` 只有 runtime device/active epoch 同时匹配时才能签发 host session。

- [x] **Step 5: 实现模式关闭撤销**

在一个事务中把 `single_user_pairing` 授权设为 `revoked`、credential version +1、关联 session 设为 `revoked`、pending grant/request 失效；`single_user_local_bootstrap` 不删除，但禁止签发新会话。保留主机 epoch、业务数据、备份和审计。

- [x] **Step 6: 运行 GREEN 并提交**

Run:

```powershell
node backend/src/services/singleUserDesktopIdentityService.test.js
node backend/src/services/desktopSessionService.test.js
node backend/src/services/primaryHostIdentityService.test.js
node backend/src/services/primaryHostLocalValidationService.test.js
git add backend/src/services/singleUserDesktopIdentityService.js backend/src/services/singleUserDesktopIdentityService.test.js backend/src/services/desktopSessionService.js backend/src/services/desktopSessionService.test.js backend/src/services/primaryHostIdentityService.js backend/src/services/primaryHostIdentityService.test.js backend/src/services/primaryHostLocalValidationService.js backend/src/services/primaryHostLocalValidationService.test.js package.json
git commit -m "feat: 实现主机单人身份与一次性配对授权"
```

### Task 4: 本地主机 HTTP/IPC 与密码信封

**Files:**
- Modify: `backend/src/routes/desktopIdentity.js:1-760`
- Modify: `backend/src/routes/desktopIdentity.http.test.js`
- Modify: `backend/src/app.js:300-320`
- Modify: `public/desktopIdentityVault.js:600-930`
- Modify: `public/desktopIdentityVault.test.js`
- Modify: `public/electron.js:360-760`
- Modify: `public/preload.js:40-70`
- Modify: `src/custom.d.ts`
- Modify: `package.json`

- [x] **Step 1: 写 HTTP 与 IPC RED 契约**

新增测试覆盖：

```js
assert.strictEqual((await post('/single-user/bootstrap', payload)).status, 403);
assert.strictEqual((await postLoopback('/single-user/bootstrap', payload, localBridgeHeader)).status, 200);
assert.strictEqual((await postLan('/single-user/grants', {})).status, 403);
assert.strictEqual((await getLan('/single-user/pairing-capability')).status, 200);
assert.strictEqual((await postLan('/single-user/pairing-requests', encryptedEnvelope)).status, 200);
```

测试还断言 renderer 暴露的方法集合中没有 bridge secret、私钥、明文 vault 内容或任意文件读写方法。

- [x] **Step 2: 运行 RED**

Run:

```powershell
node backend/src/routes/desktopIdentity.http.test.js
node public/desktopIdentityVault.test.js
```

Expected: FAIL with missing single-user routes and IPC.

- [x] **Step 3: 新增回环受保护路由**

路由加入严格 allowlist：

```js
const SINGLE_USER_BOOTSTRAP_KEYS = new Set(['publicIdentity', 'confirmation', 'operationManifest']);
const SINGLE_USER_RESET_KEYS = new Set(['publicIdentity', 'confirmation', 'expectedCredentialVersion']);
const SINGLE_USER_GRANT_KEYS = new Set([]);
const SINGLE_USER_PAIR_KEYS = new Set(['protocolVersion','capabilityId','clientEphemeralPublicKey','iv','ciphertext','tag']);
```

bootstrap/reset/grant/revoke 同时要求 `req.ip` 为 loopback、正确的 `x-gewu-local-bridge`、`GEWU_NODE_ROLE=primary-host` 和 `GEWU_DESKTOP_IDENTITY_MODE=single-user`。capability 和 pairing-request 允许 LAN/云转发，但受限速器约束。

- [x] **Step 4: 扩展 vault 而不暴露私钥**

`desktopIdentityVault` 新增：

```js
function beginSingleUserEnrollment(input = {}) {
  return beginRegistration({ ...input, deviceKind: input.deviceKind || 'desktop-client' });
}

function signPairingEnvelope(input = {}) {
  const source = pendingRegistration;
  if (!source || source.purpose !== 'register') throw vaultError('DESKTOP_IDENTITY_REGISTRATION_NOT_PENDING');
  return signWithPendingPrivateKey(input.payload, source);
}
```

`createPairingEnvelope({ capability, pairingCode })` 在主进程内组合 pending public identity、调用 `signPairingEnvelope`，再交给 `singleUserPairingEnvelope.encryptPairingRequest`；renderer 只能拿到密文 envelope。仍由既有 `completeRegistration({ password, authorization, profile, offlineLease })` 写 scrypt + AES-GCM + safeStorage 双层信封。密码不进入 HTTP body。

- [x] **Step 5: Electron 主进程持有本地 bridge secret**

Electron 启动生成 32 字节 `GEWU_ELECTRON_LOCAL_BRIDGE_SECRET`，只放主进程/embedded backend 环境。所有 flavor 的 `desktopIdentity` 增加 `createPairingEnvelope`；只有主机 flavor 额外暴露 `single-user:enable-mode`、`single-user:disable-mode`、`single-user:status`、`single-user:bootstrap`、`single-user:reset-host-password`、`single-user:issue-pairing-code`、`single-user:revoke-pairing-code`。IPC 自己补 bridge header，preload 不暴露 bridge secret。

`backend/src/app.js` 为 desktop identity router 和 cloud relay host processor 注入同一 `getSingleUserDesktopIdentityService(database)` 实例，保证两条入口共享内存中的 X25519 capability 私钥；服务使用 `WeakMap<db, service>` 缓存，不能每个请求重新生成能力密钥。

- [x] **Step 6: 运行 GREEN 并提交**

Run:

```powershell
node backend/src/routes/desktopIdentity.http.test.js
node public/desktopIdentityVault.test.js
npm run test:desktop-build-flavor
git add backend/src/routes/desktopIdentity.js backend/src/routes/desktopIdentity.http.test.js backend/src/app.js public/desktopIdentityVault.js public/desktopIdentityVault.test.js public/electron.js public/preload.js src/custom.d.ts package.json
git commit -m "feat: 接通主机本地身份与受限IPC"
```

### Task 5: 阿里云不透明配对中继与主机自动处理

**Files:**
- Modify: `gateway/src/routes/cloudRelay.js`
- Modify: `gateway/src/routes/cloudRelay.http.test.js`
- Modify: `gateway/src/services/cloudRelayTaskService.js`
- Modify: `gateway/src/services/cloudRelayTaskService.test.js`
- Modify: `backend/src/services/cloudRelayClient.js`
- Modify: `backend/src/services/cloudRelayClient.test.js`
- Modify: `backend/src/routes/cloudRelayHost.js`
- Modify: `backend/src/routes/cloudRelayHostTasks.test.js`
- Modify: `src/services/oneClickSyncTransports.mjs`
- Modify: `src/services/oneClickSyncTransports.test.js`
- Modify: `package.json`

- [x] **Step 1: 写云中继 RED 测试**

覆盖主机发布 capability、普通端读取 capability、提交密文、使用客户端自生成 request secret 轮询、主机领取并完成；网关响应中不能包含配对码/authorization/session token；没有在线主机 capability 返回 `PAIRING_HOST_OFFLINE`；同设备/IP 限速；网关直接写授权表的路径不存在。

```js
const capability = await hostPublishCapability(hostAuth, publicCapability);
const request = await anonymousSubmit({ envelope, requestSecretHash });
assert.strictEqual(request.status, 'pending_host');
assert.ok(!JSON.stringify(request).includes(pairingCode));
assert.strictEqual(await poll(request.id, wrongSecret), 404);
```

- [x] **Step 2: 运行 RED**

Run:

```powershell
node gateway/src/routes/cloudRelay.http.test.js
node backend/src/services/cloudRelayClient.test.js
node backend/src/routes/cloudRelayHostTasks.test.js
```

Expected: FAIL with missing `desktop-pairing` task flow.

- [x] **Step 3: 实现网关公开/主机端点**

新增：

```text
POST /api/cloud/desktop-pairing/capability       (host credential required)
GET  /api/cloud/desktop-pairing/capability       (public, online capability only)
POST /api/cloud/desktop-pairing/requests         (public, rate limited, ciphertext only)
GET  /api/cloud/desktop-pairing/requests/:id     (x-pairing-request-secret required)
```

网关只校验 envelope 结构/大小，不解密。`request_secret_hash` 使用 SHA-256，响应仅在匹配时返回，成功读取一次后把敏感结果 payload 清空，只保留审计摘要。

- [x] **Step 4: 主机自动处理 pairing task**

`cloudRelayHost.processMiniappTask` 增加：

```js
if (task.task_type === 'desktop-pairing') {
  return singleUserIdentity.consumeEncryptedPairingRequest({
    requestId: task.id,
    envelope: task.payload.envelope,
    channel: 'cloud',
  });
}
```

成功结果含 authorization/profile/offlineLease 和授权摘要，不含配对码、主机私钥或会话 token。普通端随后使用设备签名走现有 V2 session challenge。

- [x] **Step 5: 运行 GREEN 并提交**

Run:

```powershell
node gateway/src/services/cloudRelayTaskService.test.js
node gateway/src/routes/cloudRelay.http.test.js
node backend/src/services/cloudRelayClient.test.js
node backend/src/routes/cloudRelayHostTasks.test.js
node src/services/oneClickSyncTransports.test.js
git add gateway/src/routes/cloudRelay.js gateway/src/routes/cloudRelay.http.test.js gateway/src/services/cloudRelayTaskService.js gateway/src/services/cloudRelayTaskService.test.js backend/src/services/cloudRelayClient.js backend/src/services/cloudRelayClient.test.js backend/src/routes/cloudRelayHost.js backend/src/routes/cloudRelayHostTasks.test.js src/services/oneClickSyncTransports.mjs src/services/oneClickSyncTransports.test.js package.json
git commit -m "feat: 增加阿里云不透明桌面配对中继"
```

### Task 6: 普通端配对客户端与桌面身份界面

**Files:**
- Modify: `src/services/desktopIdentityClient.mjs:240-530`
- Modify: `src/services/desktopIdentityClient.test.js`
- Create: `src/services/singleUserPairingClient.mjs`
- Create: `src/services/singleUserPairingClient.test.js`
- Modify: `src/components/DesktopIdentityGate.tsx:1-480`
- Modify: `src/components/DesktopIdentityGate.test.js`
- Modify: `src/pages/IdentityDeviceCenter.tsx`
- Modify: `src/pages/IdentityDeviceCenter.test.js`
- Modify: `src/services/runtimeConfigClient.ts`
- Modify: `src/services/runtimeConfigClient.test.js`
- Modify: `package.json`

- [x] **Step 1: 写客户端/UI RED 测试**

测试普通端状态机：输入带分组的 16 位码，优先发现 LAN capability，失败后使用 cloud；请求成功后用现有 vault 密封；错误不删除 pending key；配对成功不自动同步。主机界面只在 `buildFlavor=primary-host && desktopIdentityMode=single-user` 显示初始化/重设/生成配对码。

```js
assert.strictEqual(normalizePairingCode('0123-4567-89ab-cdef'), '0123456789ABCDEF');
assert.deepStrictEqual(await choosePairingChannel({ lan: online, cloud: online }), { channel: 'direct' });
assert.ok(hostGate.includes('重新核验身份并重设密码'));
assert.ok(ordinaryGate.includes('输入一次性配对码'));
assert.ok(!ordinaryGate.includes('初始化数据主机'));
```

- [x] **Step 2: 运行 RED**

Run:

```powershell
node src/services/singleUserPairingClient.test.js
node src/services/desktopIdentityClient.test.js
node src/components/DesktopIdentityGate.test.js
node src/pages/IdentityDeviceCenter.test.js
```

Expected: FAIL with missing client/mode-specific UI.

- [x] **Step 3: 实现配对客户端状态机**

`singleUserPairingClient.mjs` 公开 `normalizePairingCode`、`discoverPairingCapability`、`submitPairingRequest`、`pollPairingResult`。renderer 把 capability 与规范化配对码传给 `window.desktopIdentity.createPairingEnvelope`，密文返回后才进入网络层；设备私钥和配对明文不进入 fetch body。请求 secret 由客户端 `crypto.getRandomValues` 生成，只有 hash 发给网关；明文 secret 仅存在本机内存。

成功后：

```js
await desktopIdentity.completeRegistration({
  password,
  authorization: result.authorization,
  profile: result.profile,
  offlineLease: result.offlineLease,
});
return exchangeOnlineSession({ baseUrl, desktopIdentity });
```

- [x] **Step 4: 实现清晰 UI 与错误映射**

主机 flavor 且 mode 为 `full` 时只显示“启用临时单人模式”及风险说明，二次确认后调用 host-only mode IPC 并重启；不会自动启用。主机空 vault 且 mode 为 `single-user` 时显示“单人模式初始化”、两次密码输入和“初始化前会备份，不会删除数据”。主机 sealed 且忘记密码：显示“重新核验身份并重设密码”。主机设备中心：生成/复制/撤销配对码及倒计时。普通端：设备名、配对码、两次本机密码；不显示微信、手机号、主机迁移/恢复。

稳定错误映射至少包含 `PAIRING_CODE_EXPIRED`、`PAIRING_CODE_USED`、`PAIRING_CODE_LOCKED`、`PAIRING_HOST_OFFLINE`、`PAIRING_CAPABILITY_STALE`、`DESKTOP_DEVICE_FINGERPRINT_MISMATCH`、`SINGLE_USER_MODE_DISABLED`、`LOCAL_BACKUP_FAILED`。

- [x] **Step 5: 运行 GREEN、typecheck 并提交**

Run:

```powershell
node src/services/singleUserPairingClient.test.js
node src/services/desktopIdentityClient.test.js
node src/components/DesktopIdentityGate.test.js
node src/pages/IdentityDeviceCenter.test.js
npm run typecheck
git add src/services/singleUserPairingClient.mjs src/services/singleUserPairingClient.test.js src/services/desktopIdentityClient.mjs src/services/desktopIdentityClient.test.js src/components/DesktopIdentityGate.tsx src/components/DesktopIdentityGate.test.js src/pages/IdentityDeviceCenter.tsx src/pages/IdentityDeviceCenter.test.js src/services/runtimeConfigClient.ts src/services/runtimeConfigClient.test.js package.json
git commit -m "feat: 增加桌面单人初始化与配对界面"
```

### Task 7: 同步批次备份、审计、冲突与自动处理

**Files:**
- Create: `backend/src/services/syncBatchBackupService.js`
- Create: `backend/src/services/syncBatchBackupService.test.js`
- Modify: `backend/src/database.js:1740-2030`
- Modify: `backend/src/services/primaryHostSyncPreflightService.js`
- Modify: `backend/src/services/primaryHostSyncPreflightService.test.js`
- Modify: `backend/src/routes/sync.js:150-260`
- Modify: `backend/src/routes/cloudRelayHost.js:105-155`
- Modify: `backend/src/routes/cloudRelayHostTasks.test.js`
- Modify: `src/pages/SyncSettings.tsx`
- Modify: `src/pages/SyncSettingsAuthorization.test.js`
- Modify: `src/pages/CloudSync.tsx`
- Modify: `src/services/oneClickSyncService.mjs`
- Modify: `src/services/oneClickSyncService.test.js`
- Modify: `package.json`

- [ ] **Step 1: 写备份/事务 RED 测试**

构造含普通表和题库 committed question 的批次，断言：预检写入数为 0；非空批次先生成 SQLite backup；manifest 只含受影响题库路径/摘要；备份失败时 `applySyncChanges` 未调用；题库临时文件替换失败时 DB 不提交、客户端批次保持 pending；成功审计含 batch/device/count/backup ID；重复 batch 幂等返回原结果。

```js
const prepared = service.prepareBatch({ batchId: 'batch-1', changes, authz });
assert.ok(fs.existsSync(prepared.sqliteBackupPath));
assert.strictEqual(prepared.manifest.questions.length, 1);
await assert.rejects(() => applyWithBrokenFileReplace(prepared), /QUESTION_FILE_REPLACE_FAILED/);
assert.strictEqual(readCourse(db, 'course-1').name, 'before');
```

- [ ] **Step 2: 运行 RED**

Run:

```powershell
node backend/src/services/syncBatchBackupService.test.js
node backend/src/services/primaryHostSyncPreflightService.test.js
node backend/src/routes/cloudRelayHostTasks.test.js
node src/services/oneClickSyncService.test.js
```

Expected: FAIL with missing batch backup service/result metadata.

- [ ] **Step 3: 实现批次生命周期**

服务公开 `preflightBatch`、`createBatchBackup`、`markBatchApplied`、`markBatchFailed`、`readBatchRecoveryRecord`。使用 better-sqlite3 `.backup()` 创建在线备份；文件写采用 sibling temp + fsync + rename；失败保留原文件。数据库事务只在文件准备全部成功后执行，提交成功后再清理临时文件。

审计 JSON 仅记录：

```js
{
  batchId,
  requestId,
  sourceDeviceId,
  actorUserId,
  counts: { create, update, delete, conflict, rejected },
  tables: tableCounts,
  backupId,
  epochId,
  generation,
  resultCode,
}
```

- [ ] **Step 4: 接入 direct/cloud 同步**

`/api/sync/push` 与 `desktop-sync` host task 共用同一个 `applyAuthorizedSyncBatch`；只有 V2 session actor 通过预检才创建备份。主机继续自动领取任务，但冲突数组原样返回，不能在 host 端自动选胜者。

- [ ] **Step 5: 统一手动同步文案与结果**

删除 `CloudSync.tsx` 中“申请同步权限”阶段，统一通过现有 V2 session 注册/授权。按钮与日志使用“开始同步”；确认弹窗显示上传、下载、新增、修改、删除、冲突、拒绝数量；结果显示 backup ID 的可读短标识。任何失败保持本地 pending queue。

- [ ] **Step 6: 运行 GREEN 并提交**

Run:

```powershell
node backend/src/services/syncBatchBackupService.test.js
node backend/src/services/primaryHostSyncPreflightService.test.js
node backend/src/routes/cloudRelayHostTasks.test.js
node src/services/oneClickSyncService.test.js
node src/pages/SyncSettingsAuthorization.test.js
npm run test:sync-identity
npm run typecheck
git add backend/src/services/syncBatchBackupService.js backend/src/services/syncBatchBackupService.test.js backend/src/database.js backend/src/services/primaryHostSyncPreflightService.js backend/src/services/primaryHostSyncPreflightService.test.js backend/src/routes/sync.js backend/src/routes/cloudRelayHost.js backend/src/routes/cloudRelayHostTasks.test.js src/pages/SyncSettings.tsx src/pages/SyncSettingsAuthorization.test.js src/pages/CloudSync.tsx src/services/oneClickSyncService.mjs src/services/oneClickSyncService.test.js package.json
git commit -m "feat: 增加同步批次备份审计与自动处理"
```

### Task 8: 默认菜单、密码错误与 OSS updater 回归

**Files:**
- Create: `public/electronShellPolicy.js`
- Create: `public/electronShellPolicy.test.js`
- Modify: `public/electron.js:483-520,701-755`
- Modify: `public/preload.js:1-35`
- Modify: `public/updateCheckTimeout.test.js`
- Modify: `src/services/desktopUpdateClient.mjs`
- Modify: `src/pages/SystemSettings.tsx:120-370,730-790`
- Modify: `src/uiRegression.test.js:185-205`
- Modify: `package.json`

- [ ] **Step 1: 写 shell/updater RED 测试**

```js
assert.deepStrictEqual(buildApplicationMenu({ isPackaged: true }), null);
assert.deepStrictEqual(buildApplicationMenu({ isPackaged: false }).debugOnly, true);
assert.strictEqual(updateFeedForFlavor('desktop-client'), 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/');
assert.strictEqual(updateFeedForFlavor('primary-host'), 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/host/');
```

UI 回归断言“检查更新”始终可见，且状态覆盖 checking/available/downloading/downloaded/error；身份错误只显示稳定中文，不包含 `Error invoking remote method`。

- [ ] **Step 2: 运行 RED/现状测试**

Run:

```powershell
node public/electronShellPolicy.test.js
node public/updateCheckTimeout.test.js
node src/uiRegression.test.js
```

Expected: 新 policy 测试 FAIL；现有 updater 回归给出真实基线。

- [ ] **Step 3: 提取可测 shell policy 并保持生产无菜单**

`createWindow()` 在创建窗口前调用：

```js
Menu.setApplicationMenu(buildApplicationMenu({ isPackaged: app.isPackaged }));
```

生产返回 `null`；开发构建只保留调试菜单/快捷键。BrowserWindow 同时设置 `autoHideMenuBar: true`、`menuBarVisible: false`，避免旧系统菜单闪现。

- [ ] **Step 4: 验证 updater 真链路**

保留现有 IPC，补充结构化返回和 UI 状态；普通/主机 flavor 必须使用隔离 feed。失败显示网络/签名/版本错误，不把 updater 堆栈显示给用户。安装动作仍需用户点击，不静默覆盖运行中数据。

- [ ] **Step 5: 运行 GREEN 并提交**

Run:

```powershell
node public/electronShellPolicy.test.js
node public/updateCheckTimeout.test.js
node scripts/publish-oss-feed.test.js
node src/uiRegression.test.js
npm run typecheck
git add public/electronShellPolicy.js public/electronShellPolicy.test.js public/electron.js public/preload.js public/updateCheckTimeout.test.js src/services/desktopUpdateClient.mjs src/pages/SystemSettings.tsx src/uiRegression.test.js package.json
git commit -m "fix: 恢复桌面更新入口并移除默认菜单"
```

### Task 9: 安全回归与真实 Electron 双端验证

**Files:**
- Modify: `scripts/check_deploy_readiness.js`
- Modify: `scripts/check_deploy_readiness.test.js`
- Modify: `scripts/packaged-smoke-check.js`
- Create: `scripts/single-user-pairing-runtime-smoke.js`
- Modify: `task.md`

- [ ] **Step 1: 扩展发布就绪检查**

检查必须 fail closed：普通包不能包含主机管理模块；默认 mode 为 full；配对码不进入 schema、日志或响应 fixture；legacy `GEWU_DESKTOP_SYNC_TOKEN` 不能替代 V2 session；主机/普通 feed 分离；miniapp 本阶段标记 frozen。

- [ ] **Step 2: 运行完整安全测试**

Run:

```powershell
npm run test:desktop-identity
npm run test:primary-host
npm run test:identity-device-center
npm run test:sync-identity
npm run check:desktop-identity-release
npm test
npm run typecheck
```

Expected: 全部 PASS；若全量套件发现与本次无关的既有失败，先定位并记录，不能用窄测试替代。

- [ ] **Step 3: 准备隔离的真实运行时数据副本**

从当前数据主机执行 SQLite 在线备份并复制 runtime config/题库元数据清单到测试目录；不修改生产数据目录。记录原路径、备份路径、摘要和恢复命令，不记录任何凭证。

- [ ] **Step 4: 运行数据主机真实流程**

以 host flavor 启动测试副本，验证：无默认 File/Edit 菜单；单人初始化；重启后密码解锁；重设密码后旧密码失败、新密码成功；生成/撤销/过期配对码；数据、题库计数和 epoch 不变；OSS 检查更新入口可见。

- [ ] **Step 5: 运行普通端真实流程**

以独立 userData 启动 ordinary flavor，验证：不能出现主机入口；输入配对码后建立 ordinary authorization；重启解锁；手动同步显示预览；主机自动处理；离线时队列保留；冲突可见；撤销设备后旧会话立即失败。

- [ ] **Step 6: 保存非敏感证据并提交**

在 `task.md` 记录版本、测试命令、退出码、运行时状态和截图路径；截图不得包含配对码、电话、token 或本机绝对私密路径。

Run:

```powershell
git add scripts/check_deploy_readiness.js scripts/check_deploy_readiness.test.js scripts/packaged-smoke-check.js scripts/single-user-pairing-runtime-smoke.js task.md
git commit -m "test: 完成桌面单人配对安全与运行时验证"
```

### Task 10: 此前任务与 OpenCode PR 完成度审计

**Files:**
- Modify: `task.md`
- Create: `docs/reports/2026-07-23-unified-completion-audit.md`

- [ ] **Step 1: 获取权威 Git/PR 状态但不合并**

Run:

```powershell
git fetch gewu --prune
git log --oneline --decorate --graph --max-count=40 --all
git diff --name-status gewu/master...HEAD
```

Expected: 明确 OpenCode PR/提交是否已进入 `gewu/master`、本地分支独有提交及未提交文件；不 push、不 merge。

- [ ] **Step 2: 逐项建立证据矩阵**

审计报告每项必须标记 `proved / incomplete / contradicted / missing`，并引用文件、测试或运行时证据：

```markdown
| 要求 | 代码证据 | 测试证据 | 运行时/发布证据 | 结论 |
|---|---|---|---|---|
| 体系可增删改并同步试题标注 | `TaxonomyManager.tsx`、`taxonomyFilter.*`、`questionBankService.*` | `npm run test:taxonomy` 退出 0 | 主机与普通端体系增删改/筛选截图及标注计数 | 三类证据齐全才填 `proved` |
| 二次确认后级联删除、备份、审计 | taxonomy deletion transaction 与 backup/audit 表 | 受影响数量、回滚、并发删除测试退出 0 | 二次确认和恢复记录 | 三类证据齐全才填 `proved` |
| 普通包无数据主机权限 | `desktopBuildFlavor.*` 与 ordinary files 清单 | `npm run test:desktop-build-flavor` 退出 0 | ordinary 安装包无主机入口 | 三类证据齐全才填 `proved` |
| 当前主机 bootstrap/迁移/紧急恢复 | `primaryHostIdentityService.*` 与 recovery delivery | `npm run test:primary-host` 退出 0 | 当前主机/计划换机/恢复运行记录 | 三类证据齐全才填 `proved` |
| OSS 检查下载安装 | `desktopUpdateClient.mjs`、`SystemSettings.tsx`、双 feed | updater 与 publish feed 测试退出 0 | 两种 flavor 实际检查/下载/安装记录 | 三类证据齐全才填 `proved` |
| 未认可学生管理员/学生端 | membership/backend/frontend 对应计划文件 | 两份计划的目标测试退出 0 | 管理员和学生关键状态运行记录 | 三类证据齐全才填 `proved` |
```

- [ ] **Step 3: 对非 proved 项执行已有精确计划**

本步骤不以修改报告代替实现。按审计项回到以下已有计划的未完成任务，逐条执行其中的文件列表、RED/GREEN 命令和运行时验证：

```text
主机 bootstrap/迁移/恢复：docs/superpowers/plans/2026-07-17-desktop-human-identity-multi-device.md
恢复包交付：docs/superpowers/plans/2026-07-19-primary-host-recovery-package-delivery.md
未认可学生后端：docs/superpowers/plans/2026-07-16-unrecognized-student-membership.md
未认可学生前端：docs/superpowers/plans/2026-07-20-unrecognized-student-frontend.md
```

体系与级联删除若不是 `proved`，以 `src/components/TaxonomyManager.tsx`、`src/services/taxonomyFilter.*`、`backend/src/services/questionBankService.*` 和 `npm run test:taxonomy` 为固定边界补写独立设计/实施计划，再按 TDD 执行。任何项只有在代码、测试和真实运行时三类证据齐全后才能改为 `proved`。

- [ ] **Step 4: 重新运行覆盖矩阵**

Run:

```powershell
npm run test:taxonomy
npm run test:desktop-build-flavor
npm run test:primary-host
npm run test:desktop-identity
npm run test:identity-device-center
npm run test:sync-identity
npm run test:miniapp-identity
npm run test:miniapp-applications
npm test
```

Expected: 与冻结小程序无关的代码测试全部 PASS；小程序不进行构建、上传或真实发布动作。

- [ ] **Step 5: 提交审计报告**

Run:

```powershell
git add docs/reports/2026-07-23-unified-completion-audit.md task.md
git commit -m "docs: 完成历史任务与发布矩阵审计"
```

### Task 11: 统一发布、主机升级、OSS 与夸克交付

**Files:**
- Modify: `package.json`
- Modify: `task.md`
- Generated: `dist/GewuGongfang-Desktop-6.3.0-x64.exe`
- Generated: `dist/latest.yml`
- Generated: `dist-host/GewuGongfang-PrimaryHost-6.3.0-x64.exe`
- Generated: `dist-host/latest.yml`

- [ ] **Step 1: 发布前最终门禁**

确认工作树只含明确保留的未跟踪证据/产物；所有计划任务与审计矩阵为 proved；`git diff --check`、全量测试、typecheck、release readiness、native ABI 检查通过。任何失败停止发布。

- [ ] **Step 2: 创建阿里云与本地主机备份**

执行现有云端发布备份脚本，记录代码/数据库备份目录和摘要；对当前数据主机执行 SQLite 在线备份、题库元数据清单和 runtime config 安全副本。先验证可读性，再部署。

- [ ] **Step 3: 部署兼容后端/网关**

部署后运行内网与公网 health、身份契约、配对 host-offline/online、同步权限契约；确认旧 v6.2.0 客户端仍得到稳定响应。失败按备份回滚，不能继续桌面发布。

- [ ] **Step 4: 递增版本并构建两种 flavor**

先在 `package.json.build` 固定 `artifactName` 为 `GewuGongfang-Desktop-${version}-${arch}.${ext}`，再只执行一次 minor bump，避免 `dist:win` 的隐式 patch bump 产生 6.3.1：

```powershell
node scripts/update-version.js --bump=minor
npm run build
npm run prepare:python
npm run rebuild:electron
npx electron-builder --win
npx electron-builder --win --config electron-builder.host.config.cjs
npm run rebuild:node
```

Expected: 普通与主机安装包、各自 `latest.yml` 生成；`better-sqlite3` 恢复 Node ABI；安装包摘要记录。

- [ ] **Step 5: 升级当前数据主机并真实复验**

安装 host flavor 到当前主机，保留 userData、数据库、题库绑定和设备配置。验证版本、后台健康、主机 epoch/generation、数据计数、题库读写、单人密码解锁、同步和 updater。

- [ ] **Step 6: 发布并验证 OSS 双 feed**

Run:

```powershell
npm run publish:desktop-update
npm run publish:desktop-host-update
```

Expected: 普通 `desktop/latest.yml` 与主机 `desktop/host/latest.yml` 指向正确 flavor、版本、sha512 和文件；通过公网下载 HEAD/摘要验证。普通电脑只自行更新，不远程安装。

- [ ] **Step 7: 上传夸克网盘并核验**

Run: `node scripts/upload-quark-clean.js`

Expected: 最终普通端和数据主机端安装包上传到目标目录；远端文件名、大小和版本与本地产物一致。若脚本只支持一个产物，按脚本支持的显式参数分别上传，不能使用旧 `upload-quark.js`。

- [ ] **Step 8: 合并并推送正式分支**

在所有适用端验证完成后，将当前分支与最新 `gewu/master` 合并，解决冲突并重跑最小安全矩阵；随后先用 `git status --short` 逐项核对，只暂存本计划明确修改的 tracked 文件和审计文档，不暂存 `.codex-task-handoff/`、`.playwright-cli/`、构建目录或用户脚本：

```powershell
git add -u
git add docs/superpowers docs/reports task.md
git commit -m "自动发布 2026-07-23"
git push gewu HEAD:master
```

若没有新文件可提交，跳过空 commit。不得推送 `origin/master`。

- [ ] **Step 9: 最终完成审计**

逐条重新读取设计、计划、`task.md` 和完成度报告；核对 Git commit、`gewu/master`、云端 health、当前主机运行版本、普通/主机 OSS feed、夸克文件。微信小程序明确记录为“冻结/本阶段不适用”，不能宣称已发布新版小程序。全部证据成立后才将 active goal 标记 complete。

---

## 实施纪律

- 当前用户已选择 Inline Execution；不创建子代理，不新建 worktree。
- 在 Task 9 完成统一矩阵验证之前不 push、不打包、不部署。
- 每个代码任务严格执行 RED → GREEN → 回归 → commit；不要把未跟踪用户文件加入提交。
- 涉及数据库、题库、云部署或本机安装前必须先备份并记录回滚路径。
- 所有日志、截图、审计和交接文件都不得包含密码、配对码、私钥、token、手机号或未脱敏绝对私密路径。
