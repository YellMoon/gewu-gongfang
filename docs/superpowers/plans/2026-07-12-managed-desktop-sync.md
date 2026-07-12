# Managed Desktop Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让普通桌面端零手工配置地使用受管同步传输，并通过管理员批准的设备到账户绑定获得可撤销、跨重启的安全凭证，同时隔离全部数据主机敏感配置和能力。

**Architecture:** 网关与本地后端共用无账号自报的设备配对契约，管理员审批时显式选择真实用户；Electron 主进程使用 `safeStorage` 持久化会话，渲染进程通过受限 IPC 使用；正式云入口由发布配置托管，普通端 UI 只展示设备、账号和连接状态。角色隔离同时落在 React 条件渲染、请求加载边界和服务端能力校验上。

**Tech Stack:** Electron 28、React 18、Ant Design 5、Express、better-sqlite3、Node `assert` 测试、Playwright/桌面运行时验证。

---

## File map

- `backend/src/services/desktopPairingService.js` 与 `gateway/src/services/desktopPairingService.js`：创建、校验和交换无手机号配对申请。
- `backend/src/routes/desktopPairing.js` 与 `gateway/src/routes/desktopPairing.js`：公开申请/交换，超级管理员选择用户批准、拒绝与撤销。
- `backend/src/schema.sql`、`gateway/src/db/schema.sql` 及数据库迁移入口：允许新配对记录不含手机号并记录设备凭证状态。
- `public/desktopCredentialStore.js`：封装 `safeStorage` 加密、原子保存、读取和清除。
- `public/electron.js`、`public/preload.js`、`src/custom.d.ts`：提供最小授权会话 IPC。
- `src/services/desktopAuthorizationSession.mjs`：启动申请、轮询交换、会话恢复与错误分类，不再接受手机号。
- `src/services/managedSyncConfig.mjs`：解析只读托管云入口并构造传输候选。
- `src/pages/SyncSettings.tsx`：普通端配对状态与一键同步，不呈现手机号输入。
- `src/components/PairingReviewPanel.tsx`：管理员从真实用户列表选择账号后批准设备。
- `src/pages/SystemSettings.tsx`：普通端简易视图与主机专属完整视图分离。
- `backend/src/routes/questionBankStorageRoutes.js`、`backend/src/routes/exportBackupTargets.js` 及相关主机运维路由：服务端主机能力校验。

### Task 1: 无账号自报的配对领域模型

**Files:**
- Modify: `backend/src/services/desktopPairingService.test.js`
- Modify: `gateway/src/services/desktopPairingService.test.js`
- Modify: `backend/src/services/desktopPairingService.js`
- Modify: `gateway/src/services/desktopPairingService.js`

- [ ] **Step 1: 写失败测试**

测试调用 `createDesktopPairing(db, { deviceId: 'd1', deviceName: 'PC', secret })` 必须成功；传入 `phone`、`userId` 或 `role` 必须抛出 `PAIRING_IDENTITY_NOT_ALLOWED`；交换只返回服务端已批准的 `userId` 与原设备 ID。

- [ ] **Step 2: 验证测试先失败**

Run: `node backend/src/services/desktopPairingService.test.js && node gateway/src/services/desktopPairingService.test.js`
Expected: FAIL，因为现实现要求手机号并接受客户端身份字段。

- [ ] **Step 3: 实现最小领域逻辑**

将创建输入限制为 `deviceId/deviceName/secret`，对 `phone/userId/role/teacherId` 使用 `Object.hasOwn` 拒绝；保留秘密哈希、短时配对码、过期、单次交换和并发状态保护。

- [ ] **Step 4: 运行测试至通过并提交**

Run: `node backend/src/services/desktopPairingService.test.js && node gateway/src/services/desktopPairingService.test.js`
Expected: 两套测试打印 passed。

Commit: `fix: 禁止桌面配对自报账号身份`

### Task 2: 管理员选择真实账号批准设备

**Files:**
- Modify: `backend/src/routes/desktopPairing.js`
- Modify: `gateway/src/routes/desktopPairing.js`
- Modify: `backend/src/services/desktopPairingParity.test.js`
- Create: `backend/src/routes/desktopPairing.http.test.js`
- Create: `gateway/src/routes/desktopPairing.http.test.js`
- Modify: `backend/src/schema.sql`
- Modify: `gateway/src/db/schema.sql`

- [ ] **Step 1: 写失败 HTTP 契约测试**

覆盖：`POST /start` 含手机号返回 400；无身份字段返回 pending；非超级管理员批准返回 403；超级管理员以 `{ userId }` 批准成功；不存在/未批准/停用用户返回稳定错误；重复批准只有一次成功；拒绝和撤销后不可交换或同步。

- [ ] **Step 2: 验证测试先失败**

Run: `node backend/src/routes/desktopPairing.http.test.js && node gateway/src/routes/desktopPairing.http.test.js`
Expected: FAIL，因为当前审批按申请手机号反查用户且接口不接收 `userId`。

- [ ] **Step 3: 实现审批事务与审计**

审批请求只接受服务端数据库中的 `userId`；事务内校验超级管理员、目标用户状态、pending/未过期状态，写入 `user_id/approved_by/status`，注册 `desktop-client` 设备并记录审计。撤销将配对和设备标为 inactive，使现有同步中间件拒绝。

- [ ] **Step 4: 运行配对、权限和奇偶测试并提交**

Run: `node backend/src/routes/desktopPairing.http.test.js && node gateway/src/routes/desktopPairing.http.test.js && node backend/src/services/desktopPairingParity.test.js`
Expected: PASS。

Commit: `feat: 由超级管理员绑定桌面设备账号`

### Task 3: Electron 安全凭证持久化

**Files:**
- Create: `public/desktopCredentialStore.js`
- Create: `public/desktopCredentialStore.test.js`
- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Modify: `src/custom.d.ts`
- Modify: `src/services/desktopAuthorizationSession.mjs`
- Modify: `src/services/desktopAuthorizationSession.test.js`

- [ ] **Step 1: 写失败测试**

使用注入式 `safeStorage` 和临时目录验证：写入内容不会以明文 token 出现在文件中；读取可恢复；设备 ID 不匹配拒绝；清除后为空；渲染层只调用 `desktop-auth:get/set/clear` IPC；旧 `sessionStorage` 会话仅成功迁移一次。

- [ ] **Step 2: 验证测试先失败**

Run: `node public/desktopCredentialStore.test.js && node src/services/desktopAuthorizationSession.test.js`
Expected: FAIL，因为安全存储模块和 IPC 尚不存在。

- [ ] **Step 3: 实现加密存储与 IPC**

`desktopCredentialStore` 用 `safeStorage.encryptString/decryptString` 和 UTF-8 文件保存；主进程限制 schema 为 token、user 摘要、deviceId 和过期时间；preload 只暴露三条白名单 IPC；渲染服务优先使用 IPC，并删除成功迁移的旧 session key。

- [ ] **Step 4: 运行测试并提交**

Run: `node public/desktopCredentialStore.test.js && node src/services/desktopAuthorizationSession.test.js && node --check public/electron.js && node --check public/preload.js`
Expected: PASS。

Commit: `feat: 安全持久化桌面设备凭证`

### Task 4: 托管云入口与可诊断传输选择

**Files:**
- Create: `src/services/managedSyncConfig.mjs`
- Create: `src/services/managedSyncConfig.test.js`
- Modify: `public/runtimeConfig.js`
- Modify: `public/runtimeConfig.test.js`
- Modify: `src/services/oneClickSyncService.mjs`
- Modify: `src/services/oneClickSyncService.test.js`
- Modify: `src/pages/SyncSettings.tsx`

- [ ] **Step 1: 写失败测试**

覆盖普通端用户配置为空时仍解析发布时托管云入口；普通端保存不能覆盖托管入口、角色或同步密钥；候选传输全部失败时返回每项失败原因和 `CLOUD_UNREACHABLE`、`DEVICE_APPROVAL_REQUIRED`、`DEVICE_CREDENTIAL_REVOKED` 等用户态分类。

- [ ] **Step 2: 验证测试先失败**

Run: `node src/services/managedSyncConfig.test.js && node public/runtimeConfig.test.js && node src/services/oneClickSyncService.test.js`
Expected: FAIL，当前空配置产生空传输且错误被折叠。

- [ ] **Step 3: 实现托管配置和诊断**

从编译环境/主进程只读默认值解析 HTTPS 云入口；普通端归一化保存时保留受管字段；`chooseSyncTransport` 收集每个 `check` 的 code/reason；同步页无条件基于托管入口建立云候选，再尝试云端发现的 LAN 候选。

- [ ] **Step 4: 运行传输测试并提交**

Run: `node src/services/managedSyncConfig.test.js && node public/runtimeConfig.test.js && node src/services/oneClickSyncService.test.js && node src/services/oneClickSyncTransports.test.js`
Expected: PASS。

Commit: `fix: 为普通端提供托管同步传输`

### Task 5: 普通端配对 UI 与管理员审批 UI

**Files:**
- Modify: `src/pages/SyncSettings.tsx`
- Modify: `src/components/PairingReviewPanel.tsx`
- Modify: `src/pages/PermissionManager.tsx`
- Modify: `src/pages/PermissionManager.css`
- Modify: `src/pages/SyncSettingsAuthorization.test.js`
- Modify: `src/uiRegression.test.js`

- [ ] **Step 1: 写失败 UI 源码/行为测试**

断言同步页不存在手机号 Input 和 `phone:` 配对载荷，未配对态显示设备码/等待批准；审批面板包含真实用户选择器并把 `userId` 发给批准接口；普通管理员看不到批准操作。

- [ ] **Step 2: 验证测试先失败**

Run: `node src/pages/SyncSettingsAuthorization.test.js && node src/uiRegression.test.js`
Expected: FAIL，当前存在手机号输入且审批按手机号自动匹配。

- [ ] **Step 3: 实现角色清晰的状态 UI**

普通端只显示开始申请、配对码、刷新批准状态、已绑定账号摘要和撤销提示；管理员审批表显示设备、申请时间、过期状态和用户选择器，批准按钮在选中合法用户前禁用，并提供加载、空态、失败和并发状态变化反馈。

- [ ] **Step 4: 运行测试并提交**

Run: `node src/pages/SyncSettingsAuthorization.test.js && node src/uiRegression.test.js`
Expected: PASS。

Commit: `feat: 建立管理员受控桌面配对界面`

### Task 6: 普通端简易系统参数与主机能力隔离

**Files:**
- Create: `src/services/systemSettingsRolePolicy.mjs`
- Create: `src/services/systemSettingsRolePolicy.test.js`
- Modify: `src/pages/SystemSettings.tsx`
- Modify: `src/uiRegression.test.js`
- Modify: `backend/src/routes/questionBank.js`
- Modify: `backend/src/routes/export.js`
- Modify: `backend/src/routes/questionBankStorageRoutes.test.js`
- Modify: `backend/src/routes/exportBackupTargetsRoutes.test.js`

- [ ] **Step 1: 写失败测试**

策略测试断言 desktop-client 仅有版本、设备、账号、连接、同步状态；源码回归断言 SSD、备份目标、所有路径、地址、密钥、快照、重置和清空仅存在于 `isPrimaryHost` 分支；HTTP 测试断言普通设备访问主机状态/维护接口返回 403。

- [ ] **Step 2: 验证测试先失败**

Run: `node src/services/systemSettingsRolePolicy.test.js && node src/uiRegression.test.js`
Expected: FAIL，当前普通端加载并渲染完整主机配置。

- [ ] **Step 3: 拆分角色视图和加载边界**

先加载最小运行身份，再按 `primary-host` 条件触发题库/备份请求；普通端渲染紧凑的“本机与同步”卡片；主机保留完整运维卡片。服务端在题库盘、备份和危险数据接口前验证主机角色/能力。

- [ ] **Step 4: 运行 UI 与路由测试并提交**

Run: `node src/services/systemSettingsRolePolicy.test.js && node src/uiRegression.test.js && node backend/src/routes/questionBankStorageRoutes.test.js && node backend/src/routes/exportBackupTargetsRoutes.test.js && npm run test:backend`
Expected: PASS。

Commit: `fix: 隔离普通端与数据主机系统参数`

### Task 7: 集成回归、构建和 Electron 运行时验证

**Files:**
- Modify: `task.md`
- Create: `docs/verification-2026-07-12-managed-desktop-sync.md`
- Do not commit screenshots; save them outside the repository.

- [ ] **Step 1: 运行聚焦和完整测试**

Run: `node backend/src/services/desktopPairingService.test.js && node gateway/src/services/desktopPairingService.test.js && node src/services/desktopAuthorizationSession.test.js && node src/services/oneClickSyncService.test.js && node src/uiRegression.test.js`
Expected: PASS。

Run: `npm test`
Expected: PASS，无失败测试。

- [ ] **Step 2: 构建并验证 native 环境**

Run: `npm run build`
Expected: production build completed successfully。

Run: `npm run rebuild:node && node -e "require('better-sqlite3'); console.log('native ok')"`
Expected: `native ok`。

- [ ] **Step 3: 真实运行时检查**

普通端流程：启动 → 自动恢复/发起设备申请 → 系统参数简易页 → 同步按钮 → 预览或明确可处理状态。主机流程：启动 → 完整系统参数 → 待设备审批 → 选择真实账号批准。桌面和窄窗口均检查页面身份、非空、无框架 overlay、控制台健康、主交互和截图；截图写到系统临时目录。

- [ ] **Step 4: 写安全验证记录并提交**

验证文档仅记录视口、流程、检查结果、命令和限制，不记录 token、手机号全值、私有路径或截图原件。

Commit: `test: 验证受管桌面同步与角色隔离`

### Task 8: 统一版本矩阵与发布准备

**Files:**
- Modify: `package.json` and generated version files only through the auto-version workflow when code changes require release.
- Modify: `task.md`
- Modify: project release-status document selected by existing scripts.

- [ ] **Step 1: 检查四端契约兼容性**

确认桌面端、数据主机 backend、阿里云 gateway 和小程序管理入口对新增配对字段兼容；旧客户端得到明确升级提示而非越权回退。

- [ ] **Step 2: 在发布前创建云端数据库与代码备份**

记录备份标识和回滚命令，不在仓库或日志持久化密钥。

- [ ] **Step 3: 自动判定版本、构建并发布适用端**

使用项目自动版本技能判定语义版本；按项目规则部署阿里云、安装本地数据主机、构建上传小程序管理入口（若受平台阻断则记录）、执行 `npm run dist:win` 与 `npm run publish:desktop-update`。

- [ ] **Step 4: 验证版本/健康/运行时证据**

校验公网与内网健康、主机同步、OSS `latest.yml` 和安装包版本；任一端未完成时状态写为“部分发布”或“受阻”。

- [ ] **Step 5: 提交工作树并等待合并确认**

确保 `git status --short` 只包含预期内容，提交当前工作树；不直接合并到另一任务所在分支，向用户提供提交号、测试证据和剩余发布限制。
