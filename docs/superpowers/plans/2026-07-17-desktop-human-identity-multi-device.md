# Desktop Human Identity, Multi-Role, Multi-Device and Host Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立微信手机号证明人类身份、本机密码解锁可信设备、同一用户多角色与多设备、可见设备审核中心，以及唯一数据主机的计划换机和紧急恢复链路。

**Architecture:** `/scheduling` Backend 是唯一身份与设备控制面，本地数据主机继续是业务与题库最高权威。`users` 表示唯一人类身份，`user_role_grants` 表示可选角色，`desktop_device_authorizations` 表示一对多设备，短时会话用 `active_role` 强制服务端范围；主机职责由单调递增的 `primary_host_epoch` 控制。Electron 主进程保存设备私钥和双层加密信封，渲染端只能获得短会话。

**Tech Stack:** Node.js/CommonJS、Express、SQLite/better-sqlite3、jsonwebtoken、Electron `safeStorage` 与 Node `crypto`、React/TypeScript/Ant Design、Taro 微信小程序、现有 V2 云中继和 Node 断言测试。

---

## 文件边界

- `backend/src/services/userRoleGrantService.js`：角色集合、兼容主角色和当前工作身份校验。
- `backend/src/services/desktopIdentityService.js`：桌面挑战、手机号声明、设备审批、交换、撤销和短会话。
- `backend/src/services/desktopSessionService.js`：在线会话落库、版本校验、当前角色和近期提权。
- `backend/src/services/primaryHostIdentityService.js`：当前主机 bootstrap、generation、计划迁移和紧急恢复。
- `backend/src/routes/desktopIdentity.js`：公开挑战、微信确认、可信设备审批、会话和设备管理 HTTP 契约。
- `public/desktopIdentityVault.js`：设备密钥与本机密码/PIN双层加密信封；任何私钥不进入渲染层。
- `src/services/desktopIdentityClient.mjs`：渲染层状态机，只调用受限 IPC 和 Backend 短会话接口。
- `src/components/DesktopIdentityGate.tsx`：业务应用启动前的注册、待审、密码解锁、离线租约和角色选择界面。
- `src/pages/IdentityDeviceCenter.tsx`：顶级审核、设备列表、撤销、主机 bootstrap/迁移/恢复页面。
- `miniapp/src/pages/desktop-authorization/*`：扫码后显示挑战并调用新的微信手机号凭证确认。
- `gateway/src/routes/desktopPairing.js`：旧 V1 路由 410；不再拥有第二份审批真相。
- 当前未认可学生计划的 Task 7 及后续发布任务在本计划安全切片完成后继续；所有外部推送、打包和部署仍推迟到统一矩阵。

### Task 1: 一个人多角色并保留超级管理员老师绑定

**Files:**
- Create: `backend/src/services/userRoleGrantService.js`
- Create: `backend/src/services/userRoleGrantService.test.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `backend/src/services/authorizationPolicy.js`
- Modify: `backend/src/services/authorizationPolicy.test.js`
- Modify: `package.json`

- [x] **Step 1: 写角色迁移 RED 测试**

测试必须先建立固定超级管理员和唯一老师档案，给该用户写入 `teacher_id`，重新执行规范超级管理员收敛，并断言 `teacher_id` 不被清空；再断言角色集合同时为 `super_admin`、`teacher`，老师 grant 的 `subject_id` 等于原老师 ID。增加重复老师手机号、无效 subject 和非规范超级管理员 grant 拒绝测试。

```js
const roles = listUserRoleGrants(db, canonicalId);
assert.deepStrictEqual(roles.map(function (row) { return row.role; }), ['super_admin', 'teacher']);
assert.strictEqual(roles.find(function (row) { return row.role === 'teacher'; }).subject_id, 'teacher-self');
assert.strictEqual(db.prepare('SELECT teacher_id FROM users WHERE id=?').get(canonicalId).teacher_id, 'teacher-self');
```

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `node backend/src/services/userRoleGrantService.test.js && node backend/src/services/authorizationPolicy.test.js`

Expected: FAIL，原因是表和服务不存在，且现有 `_enforceCanonicalSuperAdmin()` 把 `teacher_id` 写为 NULL。

- [x] **Step 3: 实现增量表、迁移和角色解析**

新增以 `(user_id, role)` 为主键的 `user_role_grants`；数据库初始化为已批准用户幂等补 grant。固定超级管理员只强制其最高兼容角色和规范身份，不修改已有合法 `teacher_id`。服务公开 `listUserRoleGrants`、`ensureCompatibilityRoleGrants`、`assertActiveRole` 和 `roleContextForUser`：

```js
function assertActiveRole(db, user, requestedRole) {
  const grants = listUserRoleGrants(db, user.id);
  const selected = requestedRole || defaultActiveRole(grants);
  if (!grants.some(function (grant) { return grant.role === selected && grant.status === 'active'; })) {
    throw roleError('ACTIVE_ROLE_NOT_GRANTED');
  }
  return Object.freeze({
    activeRole: selected,
    eligibleRoles: grants.map(function (grant) { return grant.role; }),
    teacherId: selected === 'teacher' ? user.teacher_id : null,
    studentId: selected === 'student' ? user.student_id : null,
  });
}
```

`scopeForUser` 接受显式 `activeRole`，老师身份始终返回 teacher scope，超级管理员身份才返回 all。

- [x] **Step 4: 运行角色 GREEN 与数据库回归**

Run: `node backend/src/services/userRoleGrantService.test.js && node backend/src/services/authorizationPolicy.test.js && node backend/src/databaseAuthorization.test.js && node backend/src/databaseMiniappAdminSeed.test.js`

Expected: PASS；重复初始化不新增 grant，固定超级管理员老师绑定保持稳定。

- [x] **Step 5: 本地提交角色切片**

Run: `git add backend/src/schema.sql backend/src/database.js backend/src/services/userRoleGrantService.js backend/src/services/userRoleGrantService.test.js backend/src/services/authorizationPolicy.js backend/src/services/authorizationPolicy.test.js package.json && git commit -m "自动发布 2026-07-17"`

### Task 2: 微信手机号固定声明人的桌面挑战

**Files:**
- Create: `backend/src/services/desktopIdentityService.js`
- Create: `backend/src/services/desktopIdentityService.test.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `backend/src/services/miniappIdentityService.js`
- Modify: `package.json`

- [x] **Step 1: 写挑战状态机 RED 测试**

覆盖：start 只接受 deviceId、deviceName、publicKey、keyFingerprint 和 purpose；传 phone、userId、role、teacherId 或 primary-host 全部拒绝。`confirmVerifiedIdentity` 只能接收微信服务已解析的 identity/loginEvent，首次固定 claimant，重复同一证明幂等，不同用户冲突；短码、挑战秘密、设备指纹、过期和并发 CAS 全部校验。

```js
const challenge = service.startChallenge({
  deviceId: 'device-2',
  deviceName: 'Second PC',
  publicKey: fixturePublicKey,
  keyFingerprint: fixtureFingerprint,
  purpose: 'register',
});
service.confirmVerifiedIdentity({ challengeId: challenge.id, identity: canonicalUser, loginEventId: 'login-1' });
assert.strictEqual(service.readChallenge(challenge.id).claimed_user_id, canonicalUser.id);
assert.throws(function () {
  service.startChallenge({ deviceId: 'evil', userId: canonicalUser.id });
}, function (error) { return error.code === 'DESKTOP_IDENTITY_INPUT_FORBIDDEN'; });
```

- [x] **Step 2: 运行 RED**

Run: `node backend/src/services/desktopIdentityService.test.js`

Expected: FAIL with missing module/table.

- [x] **Step 3: 实现挑战表和纯领域服务**

新增 `desktop_identity_challenges` 和 `desktop_device_authorizations`，challenge token 只存 SHA-256，短码使用部分唯一索引，状态更新使用 `row_version`。公开 start 只能申请 `desktop-client`；手机号确认函数必须由路由在成功调用微信交换和 `miniappIdentityService` 后传入已验证 identity，服务本身不接受客户端手机号。

- [x] **Step 4: 运行 GREEN 和身份冲突回归**

Run: `node backend/src/services/desktopIdentityService.test.js && node backend/src/services/miniappIdentityService.test.js && node backend/src/services/miniappApplicationService.test.js`

Expected: PASS，且测试数据库中不存在微信 code、phoneCode、挑战明文或设备私钥。

- [x] **Step 5: 本地提交挑战领域切片**

Run: `git add backend/src/schema.sql backend/src/database.js backend/src/services/desktopIdentityService.js backend/src/services/desktopIdentityService.test.js backend/src/services/miniappIdentityService.js package.json && git commit -m "自动发布 2026-07-17"`

### Task 3: Backend 单一 HTTP 控制面、设备审批和可撤销短会话

**Files:**
- Create: `backend/src/services/desktopSessionService.js`
- Create: `backend/src/services/desktopSessionService.test.js`
- Create: `backend/src/routes/desktopIdentity.js`
- Create: `backend/src/routes/desktopIdentity.http.test.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/middleware/auth.js`
- Modify: `backend/src/routes/auth.js`
- Modify: `backend/src/routes/questionBank.js`
- Modify: `backend/src/services/desktopIdentityService.js`
- Modify: `backend/src/services/wechatMiniappService.js`
- Modify: `backend/src/services/questionBankStorageService.js`
- Modify: `backend/src/services/questionDeletionPolicy.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `package.json`

- [x] **Step 1: 写真实 HTTP RED 契约**

使用临时 SQLite 和真实 Express 端口覆盖：start；小程序用新的 `code + phoneCode` 确认；待审列表只显示固定 claimant；approve 请求含 `userId` 返回 400；批准来自待审设备自己返回 403；来自另一台 active super-admin 设备且近期提权成功；exchange 需要目标设备签名；两台设备归属同一用户；第三台可新增；撤销一台不影响另一台。

```js
assert.strictEqual((await request('/api/desktop-identity/challenges/start', {
  deviceId: 'device-2', deviceName: 'Second PC', publicKey: fixturePublicKey,
})).status, 200);
assert.strictEqual((await approve({ challengeId: 'challenge-2', userId: canonicalId })).status, 400);
assert.strictEqual((await approve({ challengeId: 'challenge-2', expectedRowVersion: 2 }, trustedHostSession)).status, 200);
```

- [x] **Step 2: 运行 HTTP RED**

Run: `node backend/src/routes/desktopIdentity.http.test.js && node backend/src/services/desktopSessionService.test.js`

Expected: FAIL because route, session table and revocation checks do not exist.

- [x] **Step 3: 实现审批、交换和短会话**

新增 `desktop_sessions`。审批端必须是 active device、`active_role=super_admin`、`auth_time` 在 15 分钟内且 deviceId 不等于目标。exchange 校验一次性 challenge secret、设备公钥签名和 CAS 后激活 authorization。会话最长 8 小时并保存 sid、auth_version、credential_version、active_role；中间件每次从数据库校验用户、设备和 session 版本，不再仅信任 30 天 JWT。主机写入权限还必须同时满足授权记录 `device_kind=primary-host`，普通客户端即使连接到数据主机也不能冒充主机设备。

- [x] **Step 4: 运行 GREEN、并发和撤销测试**

Run: `node backend/src/routes/desktopIdentity.http.test.js && node backend/src/services/desktopSessionService.test.js && node backend/src/services/desktopPairingService.test.js && node backend/src/services/desktopPairingParity.test.js`

Expected: PASS；两次并发批准只有一个成功，撤销后旧 JWT 立即 401，另一台设备会话仍有效。

- [x] **Step 5: 本地提交控制面切片**

Run: `git add backend/src/app.js backend/src/middleware/auth.js backend/src/schema.sql backend/src/database.js backend/src/routes/desktopIdentity.js backend/src/routes/desktopIdentity.http.test.js backend/src/services/desktopSessionService.js backend/src/services/desktopSessionService.test.js package.json && git commit -m "自动发布 2026-07-17"`

### Task 4: 当前工作身份的服务端范围与提权切换

**Files:**
- Modify: `backend/src/services/authorizationPolicy.js`
- Modify: `backend/src/services/dataScopeService.js`
- Modify: `backend/src/services/syncScopeService.js`
- Modify: `backend/src/services/desktopSessionService.js`
- Modify: `backend/src/middleware/auth.js`
- Modify: `backend/src/routes/desktopIdentity.js`
- Modify: `backend/src/routes/permissions.js`
- Modify: `backend/src/routes/sync.js`
- Modify: `backend/src/services/authorizationPolicy.test.js`
- Modify: `backend/src/services/dataScopeService.test.js`
- Modify: `backend/src/services/syncScopeService.test.js`
- Modify: `backend/src/services/syncScopeIntegration.test.js`
- Create: `backend/src/routes/desktopRoleSession.http.test.js`
- Modify: `backend/src/routes/adminUsers.test.js`
- Modify: `package.json`

- [x] **Step 1: 写同一人双角色 RED 测试**

构造同一用户 roles 为 `super_admin,teacher` 且 `teacher_id=t-self`。老师会话读取快照只含 t-self，写入其他老师课程被拒；超级管理员会话读取全量；老师会话不能调用设备审批；切换超级管理员需要 active device 和近期本机提权，切换回老师不扩大范围。

```js
const teacherContext = roleContextForUser(db, user, 'teacher');
assert.deepStrictEqual(scopeForUser(teacherContext), { kind: 'teacher', teacherId: 't-self' });
const adminContext = roleContextForUser(db, user, 'super_admin');
assert.deepStrictEqual(scopeForUser(adminContext), { kind: 'all' });
```

- [x] **Step 2: 运行 RED**

Run: `node backend/src/routes/desktopRoleSession.http.test.js && node backend/src/services/dataScopeService.test.js && node backend/src/services/syncScopeIntegration.test.js`

Expected: FAIL，因为当前 `roleForUser` 直接把固定用户视为 super_admin，忽略会话 active role。

- [x] **Step 3: 把 active role 贯穿权限和同步**

`attachAuthorizationContext` 从已落库桌面 session 读取 activeRole/eligibleRoles，权限与范围只使用 activeRole；teacherId 只在老师 grant 合法时生效。新增 `/api/desktop-identity/session/role`：降权即时旋转会话；升到 super_admin 必须提交由当前设备 Ed25519 私钥签署、绑定 sid/device/target role/session version 且两分钟内有效的本机解锁证明，服务端只采用自己的当前时间写入新 auth_time。权限响应同时返回 eligible_roles 与 active_role，不暴露未选角色的数据。

- [x] **Step 4: 运行 GREEN 和越权矩阵**

Run: `node backend/src/routes/desktopRoleSession.http.test.js && node backend/src/routes/adminUsers.test.js && node backend/src/services/authorizationPolicy.test.js && node backend/src/services/dataScopeService.test.js && node backend/src/services/syncScopeService.test.js && node backend/src/services/syncScopeIntegration.test.js`

Expected: PASS；同一个 JWT/session 不能通过自报 header 切换角色。

- [x] **Step 5: 本地提交当前身份切片**

Run: `git add backend/src/services/authorizationPolicy.js backend/src/services/authorizationPolicy.test.js backend/src/services/dataScopeService.js backend/src/services/syncScopeService.js backend/src/services/desktopSessionService.js backend/src/middleware/auth.js backend/src/routes/desktopIdentity.js backend/src/routes/permissions.js backend/src/routes/sync.js backend/src/routes/adminUsers.test.js backend/src/services/dataScopeService.test.js backend/src/services/syncScopeService.test.js backend/src/services/syncScopeIntegration.test.js backend/src/routes/desktopRoleSession.http.test.js package.json docs/superpowers/plans/2026-07-17-desktop-human-identity-multi-device.md && git commit -m "自动发布 2026-07-17"`

### Task 5: Electron 设备密钥、本机密码信封和受限 IPC

**Files:**
- Create: `public/desktopIdentityVault.js`
- Create: `public/desktopIdentityVault.test.js`
- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Modify: `public/desktopCredentialStore.js`
- Modify: `public/desktopCredentialStore.test.js`
- Modify: `src/custom.d.ts`
- Modify: `package.json`

- [x] **Step 1: 写保险库 RED 测试**

临时目录和注入 safeStorage 覆盖：生成 Ed25519 设备密钥；文件中无密码、私钥、短会话明文；正确密码解锁；错误密码得到稳定错误并渐进延迟；设备 ID/指纹篡改失败；原子写失败保留旧信封；清除只删除凭证不删除业务数据。测试 preload 只暴露 beginRegistration、completeRegistration、unlock、lock、signChallenge 和 status，不暴露 raw read/write/privateKey。

```js
const vault = createDesktopIdentityVault({ filePath, safeStorage, now, delay });
const publicIdentity = vault.beginRegistration({ deviceId: 'device-2' });
assert.ok(publicIdentity.publicKey);
vault.completeRegistration({
  password: 'local-password-1',
  authorization: approvedAuthorization,
  profile,
  sessionToken: 'short-session-token',
});
assert.strictEqual(fs.readFileSync(filePath).includes(Buffer.from('local-password-1')), false);
assert.strictEqual(safeStorage.decryptString(fs.readFileSync(filePath)).includes('BEGIN PRIVATE KEY'), false);
assert.strictEqual(safeStorage.decryptString(fs.readFileSync(filePath)).includes('short-session-token'), false);
```

- [x] **Step 2: 运行 RED**

Run: `node public/desktopIdentityVault.test.js && node public/desktopCredentialStore.test.js && node src/services/browserDatabaseSafety.test.js`

Expected: FAIL with missing vault and IPC channels.

- [x] **Step 3: 实现双层信封与主进程会话交换**

用 `crypto.scryptSync` 派生 32 字节密钥，AES-256-GCM 加密设备私钥、authorization ID、离线 profile/lease，再用 safeStorage 包裹整个 envelope。主进程持有解锁态，使用私钥签结构化服务器 nonce；短期 token 即使随完成注册输入到达也不写入信封，只向渲染层返回用户摘要、eligibleRoles、activeRole、deviceId 和离线状态。旧 `desktop-session.bin` 仅作为升级检测，不解密、不自动把无微信证明的 V1 token 转成 V2。

- [x] **Step 4: 运行 GREEN、安全扫描和 Electron 语法检查**

Run: `node public/desktopIdentityVault.test.js && node public/desktopCredentialStore.test.js && node src/services/browserDatabaseSafety.test.js && node --check public/electron.js && node --check public/preload.js`

Expected: PASS；测试产物和日志不含测试密码、私钥或 token。

- [x] **Step 5: 本地提交 Electron 保险库切片**

Run: `git add public/desktopIdentityVault.js public/desktopIdentityVault.test.js public/electron.js public/preload.js public/desktopCredentialStore.js public/desktopCredentialStore.test.js src/custom.d.ts package.json docs/superpowers/plans/2026-07-17-desktop-human-identity-multi-device.md && git commit -m "自动发布 2026-07-17"`

### Task 6: 桌面启动身份门、离线租约和角色切换

**Files:**
- Create: `src/services/desktopIdentityClient.mjs`
- Create: `src/services/desktopIdentityClient.test.js`
- Create: `src/services/desktopIdentityPartition.mjs`
- Create: `src/services/desktopIdentityPartition.test.js`
- Create: `src/services/desktopCacheProjection.mjs`
- Create: `src/services/desktopCacheProjection.test.js`
- Create: `src/components/DesktopIdentityGate.tsx`
- Create: `src/components/DesktopIdentityGate.css`
- Create: `src/components/DesktopIdentityGate.test.js`
- Modify: `src/App.tsx`
- Modify: `src/index.tsx`
- Modify: `src/services/desktopAuthorizationSession.mjs`
- Modify: `src/services/desktopAuthorizationSession.test.js`
- Modify: `src/services/browserDatabase.ts`
- Modify: `src/services/questionLocalStore.ts`
- Modify: `src/services/syncEngine.ts`
- Create: `backend/src/services/desktopDeviceChallengeService.js`
- Create: `backend/src/services/desktopDeviceChallengeService.test.js`
- Modify: `backend/src/routes/desktopIdentity.js`
- Modify: `backend/src/routes/desktopIdentity.http.test.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `package.json`

- [x] **Step 1: 写启动顺序和状态机 RED 测试**

断言 locked 时不导入 browserDatabase、不启动 host heartbeat/task poll、不构造同步传输；无凭证显示二维码注册；手机号已确认显示待管理员批准；获批后要求设置密码；重启要求本机密码；在线失败只在 14 天有效离线租约内进入 scoped offline；租约过期阻断；多角色默认 teacher，升 super_admin 必须再次 unlock。

```js
const state = await resolveDesktopGateState({ vaultStatus: { sealed: true }, online: false, offlineLease });
assert.strictEqual(state.kind, 'offline-unlocked');
assert.strictEqual(state.activeRole, 'teacher');
assert.strictEqual(canStartBusinessRuntime({ gateState: { kind: 'locked' } }), false);
```

- [x] **Step 2: 运行 RED**

Run: `node src/services/desktopIdentityClient.test.js && node src/components/DesktopIdentityGate.test.js && node src/services/desktopAuthorizationSession.test.js && node src/services/oneClickSyncHostBackground.test.js`

Expected: FAIL，因为 App 当前挂载后立即加载数据库并启动主机轮询。

- [x] **Step 3: 实现身份门并延迟全部业务副作用**

`index.tsx` 先挂载 gate，只有 `online-unlocked` 或有效 `offline-unlocked` 才渲染业务 App。把 db import、window.dbService、host loop 和同步 transport 初始化移动到 gate 后。二维码 URL 来自 Backend challenge；密码只传受限 IPC。角色切换先清空旧角色内存缓存、请求新短会话，再加载以 `{userId,activeRole,subjectId}` 分区的本地缓存。

- [x] **Step 4: 运行 GREEN、TypeScript 和生产构建**

Run: `node src/services/desktopIdentityClient.test.js && node src/components/DesktopIdentityGate.test.js && node src/services/desktopAuthorizationSession.test.js && node src/services/oneClickSyncHostBackground.test.js && npm run typecheck && npx craco build`

Expected: PASS；locked HTML/runtime 证据中无业务数据库读取和主机 heartbeat。

- [x] **Step 5: 本地提交启动身份门切片**

Run: `git add src/services/desktopIdentityClient.mjs src/services/desktopIdentityClient.test.js src/components/DesktopIdentityGate.tsx src/components/DesktopIdentityGate.css src/components/DesktopIdentityGate.test.js src/App.tsx src/index.tsx src/services/desktopAuthorizationSession.mjs src/services/desktopAuthorizationSession.test.js src/services/browserDatabase.ts package.json && git commit -m "自动发布 2026-07-17"`

### Task 7: 小程序扫码确认必须重新验证微信手机号

**Files:**
- Create: `miniapp/src/utils/desktopAuthorizationRuntime.js`
- Create: `miniapp/src/utils/desktopAuthorizationRuntime.test.js`
- Create: `miniapp/src/pages/desktop-authorization/index.tsx`
- Create: `miniapp/src/pages/desktop-authorization/index.scss`
- Create: `miniapp/src/pages/desktop-authorization/index.config.ts`
- Modify: `miniapp/src/app.config.ts`
- Modify: `miniapp/src/utils/api.ts`
- Modify: `miniapp/src/utils/miniappUiPageInventory.js`
- Modify: `miniapp/src/utils/miniappUiCoverage.test.js`
- Modify: `miniapp/src/app.tsx`
- Modify: `backend/src/services/desktopIdentityService.js`
- Modify: `backend/src/services/desktopIdentityService.test.js`
- Modify: `backend/src/services/wechatMiniappService.js`
- Create: `backend/src/services/wechatDesktopAuthorizationUrlLink.test.js`
- Modify: `backend/src/routes/desktopIdentity.js`
- Modify: `backend/src/routes/desktopIdentity.http.test.js`
- Modify: `backend/.env.example`
- Modify: `package.json`

- [x] **Step 1: 写新 phoneCode、挑战投影和页面 RED 测试**

从 scene/query 只解析有界 challenge ID；读取挑战只返回设备名、指纹摘要、时间、purpose 和状态。确认按钮必须是 `openType="getPhoneNumber"`，每次点击同时调用 `Taro.login()` 获取新 code 并提交新的 phoneCode；取消授权不调用服务端。禁止使用缓存 openid、缓存手机号或普通 miniapp token 直接确认。

```js
assert.deepStrictEqual(buildDesktopConfirmationPayload({
  challengeId: 'challenge-2', loginCode: 'new-code', phoneCode: 'new-phone-code',
}), { challengeId: 'challenge-2', code: 'new-code', phoneCode: 'new-phone-code' });
assert.throws(function () {
  buildDesktopConfirmationPayload({ challengeId: 'challenge-2', loginCode: 'new-code' });
}, function (error) { return error.code === 'WECHAT_PHONE_CODE_REQUIRED'; });
```

- [x] **Step 2: 运行 RED**

Run: `node miniapp/src/utils/desktopAuthorizationRuntime.test.js && node miniapp/src/utils/miniappPhoneLogin.test.js && node miniapp/src/utils/miniappUiCoverage.test.js`

Expected: FAIL because page/runtime is absent and inventory count has not increased.

- [x] **Step 3: 实现真实手机号确认页**

页面明确显示“二维码只建立一次性通道，微信手机号用于确认申请人”，显示脱敏设备指纹和过期时间。成功后展示等待可信设备批准；身份冲突、挑战过期、设备已归属他人、手机号取消和网络失败使用不同文案。本任务先由 desktop-authorization 将当前清单从 16 页增加到 17 页；Task 12 加入 account-application 后达到最终 18 页。实际注册数必须由 inventory 自动计算，不能写虚假固定数。

- [x] **Step 4: 运行 GREEN、typecheck 和 WeApp build**

Run: `npm run test:desktop-authorization && npm run test:desktop-identity && npm --prefix miniapp run typecheck && npm --prefix miniapp run build:weapp`

Expected: PASS；构建产物注册确认页且无体验码、账号选择或静默手机号路径。

- [x] **Step 5: 本地提交小程序确认切片**

Run: `git add miniapp/src/utils/desktopAuthorizationRuntime.js miniapp/src/utils/desktopAuthorizationRuntime.test.js miniapp/src/pages/desktop-authorization miniapp/src/app.config.ts miniapp/src/utils/api.ts miniapp/src/utils/miniappUiPageInventory.js miniapp/src/utils/miniappUiCoverage.test.js package.json && git commit -m "自动发布 2026-07-17"`

### Task 8: 顶级身份与设备审核中心

**Files:**
- Create: `src/services/identityDeviceCenterPolicy.mjs`
- Create: `src/services/identityDeviceCenterPolicy.test.js`
- Create: `src/pages/IdentityDeviceCenter.tsx`
- Create: `src/pages/IdentityDeviceCenter.css`
- Create: `src/pages/IdentityDeviceCenter.test.js`
- Modify: `src/navigation/appNavigation.tsx`
- Modify: `src/layout/AppShell.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/PermissionManager.tsx`
- Delete: `src/components/PairingReviewPanel.tsx`
- Modify: `src/pages/SyncSettingsAuthorization.test.js`
- Modify: `src/uiRegression.test.js`
- Modify: `package.json`
- Modify: `backend/src/services/desktopIdentityService.js`
- Modify: `backend/src/services/desktopSessionService.js`
- Modify: `backend/src/routes/desktopIdentity.js`
- Modify: `backend/src/routes/desktopIdentity.http.test.js`
- Modify: `src/custom.d.ts`
- Modify: `src/index.css`

- [x] **Step 1: 写可见入口、固定声明人和设备列表 RED 测试**

断言 primary-host 的 super-admin active role 总能看到顶级入口和待审角标；老师 active role、普通管理员和待审设备看不到审批动作。待审表含已验证 claimant 和设备指纹但不含 Select/userId；批准只发送 challengeId/rowVersion。本人设备页同时列出 host 和第二台电脑，撤销 device-2 不影响 host；第三台显示 replacement 关系。

```js
assert.strictEqual(source.includes('选择设备绑定账号'), false);
assert.strictEqual(source.includes('selectedUsers'), false);
assert.strictEqual(buildApprovalBody(row).challengeId, row.id);
assert.strictEqual(Object.hasOwn(buildApprovalBody(row), 'userId'), false);
```

- [x] **Step 2: 运行 RED**

Run: `node src/services/identityDeviceCenterPolicy.test.js && node src/pages/IdentityDeviceCenter.test.js && node src/pages/SyncSettingsAuthorization.test.js && node src/uiRegression.test.js`

Expected: FAIL；现有面板仍位于 PermissionManager 底部并包含账号下拉选择。

- [x] **Step 3: 实现顶级页面、角标和明确状态**

新增 PageKey `identity-devices`，AppShell 导航显示待审 badge；页面分待审申请、我的设备、全部设备和数据主机四区，覆盖 loading/empty/offline/expired/conflict/concurrent/revoked。删除 PairingReviewPanel 和权限页嵌入。批准本人第二台设备时明确标注“申请人与审批人相同，但审批来自另一台可信设备”。所有操作使用 operation lock 和确认框。

- [x] **Step 4: 运行 GREEN 和生产构建**

Run: `node src/services/identityDeviceCenterPolicy.test.js && node src/pages/IdentityDeviceCenter.test.js && node src/pages/SyncSettingsAuthorization.test.js && node src/uiRegression.test.js && npm run typecheck && npm run build`

Expected: PASS；源码和构建中不存在任意账号选择器。

- [x] **Step 5: 本地提交审核中心切片**

Run: `git add src/services/identityDeviceCenterPolicy.mjs src/services/identityDeviceCenterPolicy.test.js src/pages/IdentityDeviceCenter.tsx src/pages/IdentityDeviceCenter.css src/pages/IdentityDeviceCenter.test.js src/navigation/appNavigation.tsx src/layout/AppShell.tsx src/App.tsx src/pages/PermissionManager.tsx src/pages/SyncSettingsAuthorization.test.js src/uiRegression.test.js src/components/PairingReviewPanel.tsx package.json && git commit -m "自动发布 2026-07-17"`

### Task 9: 统一同步身份并关闭 Gateway V1 配对

**Files:**
- Modify: `gateway/src/databaseAuthorization.test.js`
- Modify: `gateway/src/db/database.js`
- Modify: `gateway/src/db/schema.sql`
- Modify: `gateway/src/middleware/auth.js`
- Modify: `gateway/src/routes/desktopPairing.js`
- Modify: `gateway/src/routes/cloudRelay.js`
- Modify: `gateway/src/routes/cloudRelay.http.test.js`
- Modify: `gateway/src/services/relayAssertionService.js`
- Modify: `backend/src/database.js`
- Modify: `backend/src/middleware/auth.js`
- Modify: `backend/src/routes/desktopPairing.js`
- Modify: `backend/src/services/desktopPairingParity.test.js`
- Modify: `backend/src/routes/cloudRelay.js`
- Modify: `backend/src/routes/cloudRelay.http.test.js`
- Modify: `backend/src/routes/cloudRelayHost.js`
- Modify: `backend/src/routes/cloudRelayHostTasks.test.js`
- Modify: `backend/src/routes/desktopCloudSync.test.js`
- Modify: `backend/src/services/desktopSessionService.js`
- Modify: `backend/src/services/desktopSessionService.test.js`
- Modify: `backend/src/services/relayAssertionService.js`
- Modify: `backend/src/services/relayAssertionService.test.js`
- Modify: `backend/src/services/syncScopeIntegration.test.js`
- Modify: `miniapp/src/pages/admin/users/index.scss`
- Modify: `miniapp/src/pages/admin/users/index.tsx`
- Modify: `miniapp/src/utils/api.ts`
- Modify: `miniapp/src/utils/miniappUiPageInventory.js`
- Modify: `src/custom.d.ts`
- Modify: `src/pages/SyncSettings.tsx`
- Modify: `src/pages/SyncSettingsAuthorization.test.js`
- Modify: `src/services/desktopAuthorizationSession.mjs`
- Modify: `src/services/desktopAuthorizationSession.test.js`
- Modify: `src/services/pairingApiBase.mjs`
- Modify: `src/services/pairingApiBase.test.js`
- Modify: `src/services/oneClickSyncService.mjs`
- Modify: `src/services/oneClickSyncService.test.js`
- Modify: `src/services/oneClickSyncTransports.mjs`
- Modify: `src/services/oneClickSyncTransports.test.js`
- Modify: `package.json`

- [x] **Step 1: 写 V1 tombstone 和同步身份 RED 测试**

Gateway 和 Backend 的 start/exchange/pending/approve/reject 全部预期 410 `DESKTOP_PAIRING_V1_REMOVED`，不查询用户、不写 pairing 表；小程序管理员页不再提供任意账号选择式配对审批。所有直连、发现 LAN、手工 LAN 和云中继同步都必须从同一 V2 desktop session resolver 取得 userId、deviceId、activeRole、teacherId、sessionId、authVersion 和 credentialVersion；只有本地离线租约时返回 `ONLINE_DESKTOP_SESSION_REQUIRED`。

```js
assert.strictEqual((await gatewayPairing('/start', {})).status, 410);
assert.strictEqual((await gatewayPairing('/start', {})).body.code, 'DESKTOP_PAIRING_V1_REMOVED');
assert.strictEqual(resolveSyncActor(offlineLease).code, 'ONLINE_DESKTOP_SESSION_REQUIRED');
```

- [x] **Step 2: 运行 RED**

Run: `node gateway/src/routes/cloudRelay.http.test.js && node backend/src/routes/cloudRelay.http.test.js && node src/services/pairingApiBase.test.js && node src/services/oneClickSyncService.test.js && node src/services/oneClickSyncTransports.test.js`

Expected: FAIL；Gateway 仍能创建/批准 V1 pairing，部分旧同步路径未使用桌面会话。

- [x] **Step 3: tombstone V1 并绑定 relay assertion**

Gateway 与 Backend desktopPairing router 固定 410，不查询用户或 pairing；小程序用户审核页删除旧配对 API 和账号选择器。Backend `/scheduling` 保持新控制面和中继 owner。relay assertion 增加 sessionId、activeRole、teacherId、authVersion、credentialVersion 和到期时间，主机验证签名、nonce、V2 session、设备 owner、角色 grant 和版本后才预览/应用。所有同步 transport 统一注入在线 V2 session resolver；仍保留变更预览和最终用户确认。

- [x] **Step 4: 运行 GREEN 与同步越权回归**

Run: `npm run test:sync-identity`

Expected: PASS；老师 active role 不能通过同步写其他老师数据，撤销设备即使已有排队任务也不能在主机落库，任一 transport 缺失在线 V2 session 都不能同步。

- [x] **Step 5: 本地提交统一同步身份切片**

Run: `git add gateway/src/databaseAuthorization.test.js gateway/src/db/database.js gateway/src/db/schema.sql gateway/src/middleware/auth.js gateway/src/routes/desktopPairing.js gateway/src/routes/cloudRelay.js gateway/src/routes/cloudRelay.http.test.js gateway/src/services/relayAssertionService.js backend/src/database.js backend/src/middleware/auth.js backend/src/routes/desktopPairing.js backend/src/services/desktopPairingParity.test.js backend/src/routes/cloudRelay.js backend/src/routes/cloudRelay.http.test.js backend/src/routes/cloudRelayHost.js backend/src/routes/cloudRelayHostTasks.test.js backend/src/routes/desktopCloudSync.test.js backend/src/services/desktopSessionService.js backend/src/services/desktopSessionService.test.js backend/src/services/relayAssertionService.js backend/src/services/relayAssertionService.test.js backend/src/services/syncScopeIntegration.test.js miniapp/src/pages/admin/users/index.scss miniapp/src/pages/admin/users/index.tsx miniapp/src/utils/api.ts miniapp/src/utils/miniappUiPageInventory.js src/custom.d.ts src/pages/SyncSettings.tsx src/pages/SyncSettingsAuthorization.test.js src/services/desktopAuthorizationSession.mjs src/services/desktopAuthorizationSession.test.js src/services/pairingApiBase.mjs src/services/pairingApiBase.test.js src/services/oneClickSyncService.mjs src/services/oneClickSyncService.test.js src/services/oneClickSyncTransports.mjs src/services/oneClickSyncTransports.test.js package.json docs/superpowers/plans/2026-07-17-desktop-human-identity-multi-device.md && git commit -m "自动发布 2026-07-18"`

### Task 10: 当前主机 bootstrap、计划换机和紧急恢复

**Files:**
- Create: `backend/src/services/primaryHostIdentityService.js`
- Create: `backend/src/services/primaryHostIdentityService.test.js`
- Create: `backend/src/services/hostRecoveryFactorService.js`
- Create: `backend/src/services/hostRecoveryFactorService.test.js`
- Create: `backend/src/routes/primaryHostIdentity.http.test.js`
- Modify: `backend/src/routes/desktopIdentity.js`
- Modify: `backend/src/routes/cloudRelay.js`
- Modify: `backend/src/routes/cloudRelayHost.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `public/runtimeConfig.js`
- Modify: `src/pages/SystemSettings.tsx`
- Modify: `src/pages/IdentityDeviceCenter.tsx`
- Modify: `scripts/check_local_storage_readiness.js`
- Modify: `package.json`

- [x] **Step 1: 写主机 generation 和恢复失败矩阵 RED 测试**

覆盖：没有 active host 时，只有 primary-host 本机、规范超级管理员新手机号证明、本地数据库实例摘要、现有题库 authority binding 和物理确认 receipt 全部满足才可 bootstrap；重复调用幂等。计划迁移创建 generation+1 pending，目标必须是同一用户已激活设备；备份、SQLite quick_check、schema、题库 storeId、authority binding、云健康、同步 dry-run 任一失败都不激活。成功后旧 host heartbeat/claim/write 被拒。

紧急恢复缺少手机号证明、未使用恢复因子、权威备份、题库绑定或旧主机失联证据任一项均失败；恢复因子只能使用一次，服务端只存慢哈希。

- [x] **Step 2: 运行 RED**

Run: `node backend/src/services/primaryHostIdentityService.test.js && node backend/src/services/hostRecoveryFactorService.test.js && node backend/src/routes/primaryHostIdentity.http.test.js`

Expected: FAIL with missing tables/services.

- [x] **Step 3: 实现两阶段主机协议**

新增 `primary_host_epochs`、`host_transfers`、`host_recovery_factors` 和本地 receipt。bootstrap 使用云 challenge 与本地 host token/authority evidence 双通道，成功后生成 generation 1 和一次性恢复包。计划迁移先 pending，目标主机提交有界验证 manifest 和本地签名 receipt，云端 CAS 激活新 generation 并轮换 host credential；旧 generation 只读为 retired。SystemSettings 删除可任意选择 nodeRole 的控件，角色只能由 bootstrap/迁移写入受管配置。

- [x] **Step 4: 运行 GREEN 与现有主机任务回归**

Run: `node backend/src/services/primaryHostIdentityService.test.js && node backend/src/services/hostRecoveryFactorService.test.js && node backend/src/routes/primaryHostIdentity.http.test.js && node backend/src/routes/cloudRelayHostTasks.test.js && node scripts/check_local_storage_readiness.test.js && node public/runtimeConfig.test.js`

Expected: PASS；任何时刻查询只返回一个 active epoch，激活前失败不改变旧主机。

- [x] **Step 5: 本地提交主机身份切片**

Run: `git add backend/src/services/primaryHostIdentityService.js backend/src/services/primaryHostIdentityService.test.js backend/src/services/hostRecoveryFactorService.js backend/src/services/hostRecoveryFactorService.test.js backend/src/routes/primaryHostIdentity.http.test.js backend/src/routes/desktopIdentity.js backend/src/routes/cloudRelay.js backend/src/routes/cloudRelayHost.js backend/src/schema.sql backend/src/database.js public/runtimeConfig.js src/pages/SystemSettings.tsx src/pages/IdentityDeviceCenter.tsx scripts/check_local_storage_readiness.js package.json docs/superpowers/plans/2026-07-17-desktop-human-identity-multi-device.md && git commit -m "自动发布 2026-07-18"`

### Task 11: 安全回归、真实运行时和计划自证

**Files:**
- Create: `docs/verification-2026-07-17-desktop-human-identity.md`
- Modify: `scripts/check_deploy_readiness.js`
- Modify: `scripts/check_deploy_readiness.test.js`
- Modify: `scripts/check_project_status_doc.js`
- Modify: `package.json`

- [x] **Step 1: 增加发布门禁 RED 测试**

门禁必须确认 Backend V2 desktop identity 路由、Gateway V1 410、角色 grant migration、主机 generation、miniapp desktop-authorization 页、桌面 identity gate 和 device center 均存在；同时扫描源码/构建产物禁止审批 `userId` 选择、长期明文 token、私钥/password 日志、locked 状态业务启动和可编辑 nodeRole。

- [x] **Step 2: 运行门禁 RED**

Run: `node scripts/check_deploy_readiness.test.js && node scripts/check_project_status_doc.js`

Expected: FAIL until all required evidence keys and documentation are present.

- [x] **Step 3: 完成文档和可执行门禁**

验证文档逐项记录：同一超级管理员老师双角色；host、第二台电脑和第三台替换设备；新手机号挑战；待审、自批拒绝和可信旧设备批准；密码错误/找回；在线/离线/过期；teacher/admin scope；撤销；bootstrap；计划迁移前失败/成功；紧急恢复缺因子失败。记录只用脱敏 ID/哈希摘要，不写手机号明文、token、密钥、密码或恢复因子。

- [x] **Step 4: 跑聚焦测试、fresh 全量测试和构建**

Run: `npm test`

Run: `npm run build && npm --prefix miniapp run typecheck && npm --prefix miniapp run build:weapp`

Expected: 全部 exit 0；保存命令时间、输出行数和关键测试名，不以旧日志替代 fresh 结果。

- [x] **Step 5: 真实 Electron 两角色/多设备 UI 验证**

在数据主机与普通客户端配置分别启动真实 Electron，桌面和窄窗口检查 locked、二维码、待审、密码、离线、老师工作台、超级管理员工作台、设备中心和主机迁移。验证无空白页、裁切、不可见审核入口、控制台错误或缓存串角色。只使用测试挑战和脱敏设备，不执行真实主机迁移或外部发布。

2026-07-19 已使用 Electron 28.3.3、生产 preload/build、临时 userData 与纯回环 fixture 完成：安全密码重设、老师窄屏、超级管理员、离线租约、数据主机宽屏、恢复包跨进程交付和 OSS 更新入口；渲染错误、主进程意外错误、网络失败均为 0，证据见 `output/task11-primary-host-recovery-delivery/`。

- [x] **Step 6: 本地提交验证切片**

Run: `git add docs/verification-2026-07-17-desktop-human-identity.md scripts/check_deploy_readiness.js scripts/check_deploy_readiness.test.js scripts/check_project_status_doc.js package.json && git commit -m "自动发布 2026-07-17"`

### Task 12: 回到未认可学生计划并统一发布矩阵

- [x] **Step 1: 更新总计划状态**

在 `2026-07-16-unrecognized-student-membership.md` 的 Task 6 后增加本计划完成证据，并把 Task 7 固定示例题设为下一执行步骤。桌面角色、设备、主机 generation、miniapp 确认页都加入 Task 12 全页面/安全矩阵和 Task 13 发布矩阵。

- [x] **Step 2: 继续原 Task 7 至 Task 13**

完成固定脱敏示例题和隔离 Word/PDF、小程序白名单/UI、隐私保留、全页面多角色验证，最后才递增版本、推送 `gewu/master`、备份/部署阿里云、升级真实数据主机、执行真实 bootstrap、上传小程序并发布 OSS 更新。

- [ ] **Step 3: 发布时验证真实两台电脑与换机准备**

当前主机完成一次性 bootstrap；另一台电脑扫码验证并由当前主机批准；两台显示同一 identity、双角色和 teacher_id，分别完成 teacher scope 与 super-admin 操作验证。只验证计划换机 dry-run 与恢复包生成，不在用户未要求实际换主机时切换当前权威主机。

2026-07-23：当前主机已完成 generation 1 bootstrap、6.4.0 安装和真实健康验证；生产脱敏审计只有 1 条 active desktop authorization，故第二台真实电脑、双机角色/同步/撤销和换机 dry-run 仍待执行。本步骤不能以同机临时 userData 或单元测试替代。

- [x] **Step 4: 保持发布结论真实**

微信审核、阿里云部署、本地主机安装、另一台电脑更新或 OSS feed 任一未完成时只报告“部分发布”或“受阻”。不得因为本计划单测通过就宣称整个长期目标完成。
