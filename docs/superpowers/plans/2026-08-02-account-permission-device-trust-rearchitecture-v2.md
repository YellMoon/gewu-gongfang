# 账户、权限与持久设备信任重构 V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把账户、角色、教师/学生档案、家庭关系、细粒度能力、数据范围、普通桌面设备、30 天离线访问、授权数据副本、题库、学校和家庭资产统一为一套由数据主机最终授权、卸载重装可安全识别、所有入口真实可达且具有真实业务端到端证据的多端架构。

**Architecture:** `users`、`teachers/students`、基础角色、档案绑定、家庭关系、能力、数据范围、可信设备、安装实例和账户设备关联分别建模。普通桌面以 Windows 持久设备锚证明“同一 Windows 设备环境”，以安装 Ed25519 密钥证明“当前安装实例”，以在线账户认证证明“当前用户”，以数据主机签名 receipt 决定最终角色、档案、能力、范围和 30 天离线许可；云端只认证、中继和保存控制面镜像，不成为权威业务库。

**Tech Stack:** Electron 28、React 18、TypeScript 4.9、Ant Design 5、Node.js、Express、SQLite/better-sqlite3、WebSocket、Taro 3/微信小程序、Windows CNG/TPM、PowerShell/.NET CNG bridge、Electron safeStorage、Ed25519、Playwright。

---

## 0. 替代关系和执行边界

- 本计划替代 `docs/superpowers/plans/2026-08-02-account-role-device-data-rearchitecture.md`，前一版仅作讨论记录，不再作为执行基准。
- 本计划替代普通桌面“微信扫码、等待另一设备/超级管理员批准、激活设备”的流程；数据主机 bootstrap、主机迁移、主机损坏恢复和 host epoch 安全流程不取消。
- 本轮规划不实施代码。执行时每个 Task 必须先写失败测试，再实现，再验证，再提交；任何测试未通过不得继续发布步骤。
- 工作区现有未提交内容属于用户，不得清理、回退或覆盖。实现阶段必须先记录基线 `git status --short` 并只提交本 Task 文件。

## 1. 最终业务结论

### 1.1 账户、角色和档案

- 不使用备用账户 ID。`users.id`、`teachers.id`、`students.id` 都是不可替换主体 ID，只有关系记录可新增、撤销或替换。
- 超级管理员和已绑定老师可在数据主机/教学端创建没有账户、没有设备的教师或学生档案，档案可立即排课。
- 教学端老师可注册账号并默认提出 `teacher` 角色意图；小程序可选择 teacher、student 或仅个人/家庭用途。
- 角色标签本身不开放业务数据。teacher/student 必须同时满足有效角色、活动档案绑定、允许终端和有效数据范围。
- 正式基础角色为 `super_admin`、`teacher`、`student`；无正式角色授权时派生为 `visitor`。`admin` 停止新增并受控迁移退出。
- “家人”是叠加关系，不是互斥角色。一个老师或学生也可以是家庭成员。

### 1.2 权限和终端

```text
effectiveCapabilities =
  surfaceAllowList
  ∩ ((roleDefaults ∪ householdDefaults ∪ explicitAllows) - explicitDenies)

effectiveDataScope =
  roleScope ∩ relationshipScope ∩ explicitResourceScope ∩ authorityConfirmedScope
```

- 数据主机 UI 只允许 `super_admin`；教学工作端只允许存在活动 teacher 档案绑定的账户；小程序允许所有账户登录。
- 档案审核、账户身份审核、权限规则、主机迁移恢复、学校规范名治理、题库体系修改、备份恢复不可委派。
- “模块授权”只是 UI 分组，落库必须是具体 capability、surface、scope、reason、expires_at 和审计。

### 1.3 设备的四层身份

| 层 | 标识/密钥 | 生命周期 | 作用 |
| --- | --- | --- | --- |
| 设备锚 | CNG/TPM 非导出密钥及 `anchor_fingerprint` | 跨软件卸载重装；清 TPM/换主板/主动清除后失效 | 证明同一 Windows 用户＋设备安全环境 |
| 安装实例 | `installation_id`＋Ed25519 安装密钥 | 每次安装生成；应用数据清除后变化 | 证明当前安装实例，签桌面会话和命令 |
| 账户设备关联 | `user_id + device_id` | 登录后创建，可单独撤销 | 表示某账户允许在某设备使用 |
| 账户本地分区 | `partition_id`＋独立数据密钥＋本地解锁因子 | 每账户独立 | 隔离缓存、草稿、快照和离线许可 |

- 私钥全部留在客户端或数据主机本地；云端和数据主机数据库只保存客户端公钥、指纹和状态。
- TPM 可用时使用 `Microsoft Platform Crypto Provider`；不可用时降级为 Windows Software KSP 的非导出持久键。两者都失败时才使用 safeStorage 包装的软件锚，并明确标记 `software_fallback` 风险等级。
- 硬件原始字段不写日志、不上传云数据库。客户端经端到端 host command 把一次性采样送达数据主机；主机以 authority 专属 HMAC 生成组件 token，只持久化 token 和匹配结果。
- 设备名称、操作系统、应用版本、SMBIOS UUID、主板/BIOS 序列号、系统盘和网络信息只用于展示和风险判断，永远不能独立证明账户或授予权限。

### 1.4 新设备、重装和同机多账户

```text
账户在线认证
  -> 创建 bootstrap-only token
  -> 打开/创建设备锚
  -> 创建 installation_id 和安装密钥
  -> 数据主机比较设备锚与硬件 token
  -> same_device | reinstall_candidate | new_device | risk_blocked
  -> 创建/恢复 account-device link
  -> 签发短在线会话和 30 天离线许可
  -> 下载全量授权结构化快照
  -> snapshot_ready 后进入工作台
```

- 有可验证的原设备锚：同一设备。重装只新增 installation，旧 installation 标记 `replaced`。
- 锚丢失但硬件指纹高相似：`reinstall_candidate`。必须再次完成账户在线认证，生成新锚/安装密钥；自动建立替换关系但写高风险审计，不需要超级管理员人工批准。
- 锚和硬件指纹都不同：新设备。首次业务使用必须能够连接数据主机完成 authority receipt 和初始快照。
- 锚相同但硬件突变、同一安装密钥在不兼容环境并发、签名重放或账户异常：`risk_blocked`，不自动激活；数据主机账户中心提供真实风险处置入口。
- 同一设备可关联多个账户。登录其他账户时提示但允许；不显示其他账户敏感信息。每个账户使用独立本地分区、数据密钥、草稿队列、授权快照和离线许可。

### 1.5 在线与离线边界

- 新安装第一次业务使用必须联网，且数据主机必须在线。云端账号验证成功但主机不可达时只能进入“等待数据主机授权”页面。
- 在线 desktop session 和 authority command lease 保持分钟/小时级；30 天仅用于只读/普通离线编辑许可，不能授权同步、审核、题库操作、权限管理、主机操作或备份恢复。
- 完全离线设备无法即时收到撤权，最长可能继续访问至离线许可到期，这是确认接受的安全代价；在线后立即按 auth/access/credential version 失效。
- 权限缩小时清除活动缓存中的越权数据；未同步草稿进入只读加密隔离区，不静默删除。

### 1.6 授权数据、题库、学校和家庭

- 新设备下载账户当前权限范围内全部历史结构化数据，不按日期截断；下载必须签名 manifest、分块、哈希、断点续传和原子切换。
- 授权快照不包含题目、答案、解析、附件或题目索引。
- 题库必须在线且数据主机健康、题库盘挂载；本地只缓存签名体系目录，离线仅可看目录。
- 学校自由输入先成为别名，数据主机映射到按“行政区划＋规范全称”唯一的 canonical school；网络搜索只给候选，不能自动合并。
- 个人资产属于 user，家庭资产属于 household；家庭汇总、明细、写入和导出分别授权。

## 2. 当前代码必须显式替换的旧实现

| 当前对象 | 当前问题 | V2 处理 |
| --- | --- | --- |
| `desktop_identity_challenges` | `pending_phone -> pending_approval -> approved` | 普通设备停止写入；兼容期只读，随后归档 |
| `desktop_device_authorizations` | 一个 device 只能绑定一个 user，依赖微信审批 | 迁移为 trusted device＋installation＋account link |
| `desktop_device_activations` | 依赖旧 challenge/approval | 普通端路由 410；主机流程使用独立 host operation 表 |
| `device_grants` | `UNIQUE(authority_id,device_id)` 无法支持多账户 | 由 `account_device_links` 取代 |
| `device_leases` | 角色含 admin，最长实现仅 1 小时，在线/离线语义混合 | 拆成短在线 session 与 `offline_access_licenses` |
| `sync_devices` | 可能被客户端自报写入 | 仅作为数据主机投影镜像，来源必须是有效 link receipt |
| `/desktop-identity/challenges/*` | 普通设备扫码、批准、拒绝 | 普通注册返回 410；host challenge 路由保留 |
| `DesktopIdentityGate` | 注册态围绕二维码、待审批和单身份 vault | 改为账号登录、静默登记、账户选择和初始化状态机 |
| `IdentityDeviceCenter` | 混合角色审批、普通设备审批和主机管理 | 拆为账户权限中心＋设备与风险中心＋主机安全中心 |
| `public/desktopIdentityVault.js` | 单账户、安装私钥和账户数据耦合 | 拆成 device anchor、installation vault、account vault |

## 3. V2 核心表和唯一性

以下是执行时必须保持一致的最小字段；迁移可增加审计字段，但不得改变语义。

```sql
CREATE TABLE trusted_devices (
  device_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  anchor_public_key TEXT NOT NULL,
  anchor_fingerprint TEXT NOT NULL,
  anchor_backend TEXT NOT NULL
    CHECK(anchor_backend IN ('tpm_cng','windows_cng','software_fallback')),
  risk_state TEXT NOT NULL DEFAULT 'normal'
    CHECK(risk_state IN ('normal','watch','blocked')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','revoked','retired')),
  credential_version INTEGER NOT NULL DEFAULT 1,
  row_version INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX idx_trusted_device_anchor
  ON trusted_devices(authority_id,anchor_fingerprint);

CREATE TABLE device_installations (
  installation_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  install_public_key TEXT NOT NULL,
  install_key_fingerprint TEXT NOT NULL,
  app_version TEXT NOT NULL,
  os_summary_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_host'
    CHECK(status IN ('pending_host','snapshot_required','active','replaced','revoked')),
  replaces_installation_id TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  activated_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY(device_id) REFERENCES trusted_devices(device_id)
);
CREATE UNIQUE INDEX idx_device_installation_key
  ON device_installations(authority_id,install_key_fingerprint);

CREATE TABLE account_device_links (
  account_device_link_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_host'
    CHECK(status IN ('pending_host','active','revoked')),
  auth_version INTEGER NOT NULL,
  access_version INTEGER NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  first_linked_at TEXT NOT NULL,
  last_authenticated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(device_id) REFERENCES trusted_devices(device_id)
);
CREATE UNIQUE INDEX idx_account_device_active
  ON account_device_links(authority_id,user_id,device_id)
  WHERE status IN ('pending_host','active');

CREATE TABLE account_installation_states (
  account_installation_state_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  account_device_link_id TEXT NOT NULL,
  business_state TEXT NOT NULL DEFAULT 'onboarding'
    CHECK(business_state IN ('onboarding','snapshot_required','active','offline_locked','revoked')),
  initialized_snapshot_version INTEGER,
  initialized_snapshot_hash TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_device_link_id) REFERENCES account_device_links(account_device_link_id),
  FOREIGN KEY(installation_id) REFERENCES device_installations(installation_id)
);
CREATE UNIQUE INDEX idx_account_installation_live
  ON account_installation_states(authority_id,user_id,installation_id)
  WHERE business_state!='revoked';

CREATE TABLE device_registration_attempts (
  attempt_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  requested_device_id TEXT,
  state TEXT NOT NULL CHECK(state IN (
    'bootstrap_authenticated','host_pending','same_device','reinstall_candidate',
    'new_device','risk_blocked','snapshot_required','completed','rejected','expired'
  )),
  risk_evidence_json TEXT NOT NULL,
  host_command_id TEXT,
  host_receipt_id TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE offline_access_licenses (
  offline_license_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  account_device_link_id TEXT NOT NULL,
  account_installation_state_id TEXT NOT NULL,
  active_role TEXT NOT NULL CHECK(active_role='teacher'),
  profile_binding_id TEXT NOT NULL,
  auth_version INTEGER NOT NULL,
  access_version INTEGER NOT NULL,
  credential_version INTEGER NOT NULL,
  capability_hash TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  snapshot_version INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','expired','revoked')),
  signature TEXT NOT NULL
);
```

数据主机另建 `device_fingerprint_observations`，只保存 authority-HMAC 后的组件 token、质量、观察时间和比较结果；云端只保存最终 `risk_state/risk_evidence_json`，不保存硬件原值。

## 4. 密钥、令牌和敏感信息边界

| 对象 | 算法/位置 | 可上传内容 | 禁止上传内容 |
| --- | --- | --- | --- |
| 设备锚 | TPM/CNG ECDSA P-256；降级 CNG software | 公钥、SHA-256 指纹、backend | 私钥、原始 TPM EK |
| 安装密钥 | Ed25519，safeStorage 包装安装 vault | 公钥、指纹 | 私钥 |
| 账户分区密钥 | 随机 256-bit，本地解锁因子包装 | partition id、快照 hash | 数据密钥、PIN、派生密钥 |
| 主机签名密钥 | 数据主机本地 | 公钥、host epoch | 私钥 |
| 硬件采样 | 本机瞬时采集，经 E2E 主机命令 | HMAC token、匹配分 | 原始序列号、完整硬件清单 |
| bootstrap token | 云端签发，10 分钟 | `sub/authority/purpose/jti` | 业务 scope、正式角色能力 |
| desktop session | 15 分钟访问＋最长 8 小时刷新边界 | 最小 claims | 离线 30 天写授权 |
| offline license | 主机签名，最长 30 天 | capability/scope/snapshot hash | 同步、审核、题库和主机能力 |

## 5. 普通设备状态机和错误码

```text
empty
  -> account_authenticating
  -> bootstrap_authenticated
  -> device_anchor_ready
  -> installation_registered
  -> host_authorization_pending
  -> risk_blocked | snapshot_downloading
  -> snapshot_verifying
  -> online_ready
  -> offline_ready
  -> offline_locked
```

必须返回并在 UI 呈现的稳定错误码：

- `ACCOUNT_CREDENTIAL_INVALID`：账户认证失败。
- `DEVICE_ANCHOR_UNAVAILABLE`：TPM/CNG 和 fallback 都不能建立。
- `DEVICE_ANCHOR_PROOF_INVALID`：锚挑战签名无效。
- `INSTALLATION_KEY_INVALID`：安装密钥或指纹不一致。
- `PRIMARY_HOST_REQUIRED_FOR_FIRST_USE`：首次业务登录时主机不可达。
- `DEVICE_RISK_BLOCKED`：锚/硬件/并发证据冲突。
- `ACCOUNT_DEVICE_LINK_REVOKED`：仅当前账户在该设备被撤销。
- `DEVICE_REVOKED`：整台设备被撤销。
- `INITIAL_SNAPSHOT_REQUIRED`：主机已授权但本地数据尚未完成。
- `OFFLINE_LICENSE_EXPIRED`：30 天许可到期。
- `OFFLINE_OPERATION_FORBIDDEN`：离线尝试同步、审核、题库或高危操作。

## 6. API 和真实入口契约

| 用户动作 | 真实入口 | API/命令 | 权威结果 |
| --- | --- | --- | --- |
| 账号登录 | 教学端身份门 | `POST /api/account-sessions/login` | bootstrap token；不含业务数据 |
| 静默设备登记 | 身份门自动执行 | `POST /api/device-registrations`＋host command | device/install/link receipt |
| 等待主机 | 身份门状态页 | `GET /api/device-registrations/:id` | pending/receipt/reject |
| 同机第二账户 | 账户切换器 | `POST /api/account-device-links` | 新 link，不覆盖旧 link |
| 首次数据 | 初始化页 | snapshot manifest/chunks | 原子授权快照＋snapshot receipt |
| 查看本人设备 | 教学端账户菜单 | `GET /api/me/devices` | 当前账户 link 范围 |
| 查看全局设备风险 | 数据主机设备与风险中心 | host access API | trusted device、installation、link、风险审计 |
| 撤销账户关联 | 本人设备页/主机中心 | `POST /api/account-device-links/:id/revoke` | link revoked＋会话失效 |
| 撤销整台设备 | 主机设备与风险中心 | `POST /api/trusted-devices/:id/revoke` | device/install/all links revoked |
| 处理风险阻断 | 主机设备与风险中心 | host `device-risk.resolve.v1` | receipt；不能只改 UI 状态 |
| 主机迁移恢复 | 主机安全中心 | 现有 primary-host routes | host epoch/credential receipt |

## 7. 文件职责边界

- `shared/accessModel.js`：角色、surface、capability、scope 和不可委派能力。
- `shared/deviceTrustProtocol.js`：设备锚、安装、风险、注册、receipt 和错误码结构。
- `shared/offlineAccessLicenseProtocol.js`：30 天离线许可 canonical payload 和验证规则。
- `public/windowsDeviceAnchor.js`：Node 封装，只负责调用 Windows bridge，不接触账户权限；设备锚按“当前 Windows 用户＋设备”定义。
- `public/windows-device-anchor.ps1`：通过 .NET CNG 创建/打开/签名持久键，JSON stdin/stdout，禁止命令行传秘密。
- `public/installationIdentityVault.js`：installation_id、Ed25519 安装私钥和设备锚引用。
- `public/accountPartitionVault.js`：每账户本地解锁、数据密钥、离线许可和分区元数据。
- `backend/src/services/deviceTrustService.js`：设备、安装、account-device link 和 account-installation state 状态事务。
- `backend/src/services/deviceRiskService.js`：消费主机 risk receipt，不读取硬件原值。
- `backend/src/services/offlineAccessLicenseService.js`：由数据主机签发，客户端验证。
- `backend/src/services/authorizedSnapshotService.js`：授权快照 manifest/chunks/原子版本。
- `src/components/DesktopIdentityGate.tsx`：账号登录、静默登记、等待主机、初始化、离线锁定。
- `src/pages/DeviceRiskCenter.tsx`：仅数据主机超级管理员的设备、安装、账户关联和风险处置。
- `src/pages/AccountAccessCenter.tsx`：档案、身份、权限、家庭和学校审核，不再混入普通设备批准。

---

## 8. 分模块实施步骤


### Task 1：冻结统一账户—角色—档案—能力契约

**Files:**
- Create: `shared/accessModel.js`
- Create: `shared/profileBindingProtocol.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Test: `backend/src/services/accessSchemaContract.test.js`
- Test: `backend/src/services/accountRoleProfileMigration.test.js`

- [ ] **Step 1：写角色和终端失败测试**

```js
assert.deepStrictEqual(ACCESS_ROLES, ['super_admin', 'teacher', 'student']);
assert.strictEqual(resolveSurface('primary-host', 'teacher').allowed, false);
assert.strictEqual(resolveSurface('desktop-client', 'super_admin').allowed, false);
assert.strictEqual(resolveSurface('desktop-client', 'teacher').allowed, true);
assert.deepStrictEqual(resolveActingScope({ role: 'teacher', profileBinding: null }), {
  kind: 'onboarding'
});
```

- [ ] **Step 2：运行并确认失败**

Run: `node backend/src/services/accessSchemaContract.test.js`  
Expected: FAIL，提示 `shared/accessModel.js` 或新角色契约不存在。

- [ ] **Step 3：实现固定能力目录**

```js
const ACCESS_ROLES = Object.freeze(['super_admin', 'teacher', 'student']);
const SURFACES = Object.freeze(['primary-host', 'desktop-client', 'miniapp']);
const NON_DELEGABLE = Object.freeze([
  'profile.review', 'identity.review', 'access.manage', 'device.risk.resolve',
  'host.manage', 'school.canonical.manage', 'question.taxonomy.manage',
  'backup.manage'
]);
const CAPABILITIES = Object.freeze([
  'profile.unclaimed.create', 'schedule.read', 'schedule.write',
  'asset.personal.read', 'asset.personal.write', 'asset.household.summary.read',
  'asset.household.detail.read', 'asset.household.write',
  'question.online.use', ...NON_DELEGABLE
]);
```

数据库不得接受目录外的 capability 字符串；super_admin 的高危能力只在 `primary-host` surface 生效。

- [ ] **Step 4：新增档案绑定、联系方式、能力覆盖、数据范围和家庭表**

创建 `authority_profile_bindings`、`account_contact_points`、`profile_contact_points`、`authority_user_capability_overrides`、`authority_data_scope_grants`、`households`、`household_memberships` 和唯一索引。活动档案绑定必须满足：

```sql
CREATE UNIQUE INDEX idx_profile_binding_active_profile
ON authority_profile_bindings(authority_id,profile_type,profile_id)
WHERE status='active';

CREATE UNIQUE INDEX idx_profile_binding_active_user_role
ON authority_profile_bindings(authority_id,user_id,role)
WHERE status='active';
```

- [ ] **Step 5：迁移旧角色但不产生空档案授权**

旧 `authority_role_bindings.subject_id` 非空且目标档案存在时迁移为活动 profile binding；为空时只迁移角色意图，作用域固定为 onboarding。重复、悬空或跨类型引用写入迁移报告并使正式切换失败。

- [ ] **Step 6：验证迁移幂等**

Run: `node backend/src/services/accessSchemaContract.test.js && node backend/src/services/accountRoleProfileMigration.test.js && npm run test:authority-architecture`  
Expected: PASS；同一数据库迁移两次后表、索引和记录数不变。

- [ ] **Step 7：提交**

```bash
git add shared/accessModel.js shared/profileBindingProtocol.js backend/src/schema.sql backend/src/database.js backend/src/services/accessSchemaContract.test.js backend/src/services/accountRoleProfileMigration.test.js
git commit -m "feat: 建立账户角色档案权限统一契约"
```

### Task 2：实现无账户排课档案与档案认领审核闭环

**Files:**
- Create: `backend/src/services/profileContactService.js`
- Create: `backend/src/services/profileBindingService.js`
- Create: `backend/src/routes/profileClaims.js`
- Create: `backend/src/routes/hostAccountAccess.js`
- Modify: `backend/src/services/roleApplicationService.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityProjectionSourceService.js`
- Modify: `backend/src/routes/students.js`
- Modify: `backend/src/routes/teachers.js`
- Modify: `src/pages/StudentList.tsx`
- Modify: `src/pages/TeacherList.tsx`
- Test: `backend/src/services/profileBindingService.test.js`
- Test: `backend/src/routes/profileClaims.http.test.js`
- Test: `scripts/realUnclaimedProfileE2e.test.js`

- [ ] **Step 1：写候选匹配和并发批准失败测试**

```js
await assert.rejects(() => approveExisting({ claimId: 'c1', expectedRowVersion: 1 }), {
  code: 'PROFILE_MATCH_AMBIGUOUS'
});
await assert.rejects(() => approveExisting({ claimId: 'c2', profileId: 't-used' }), {
  code: 'PROFILE_ALREADY_BOUND'
});
await Promise.allSettled([
  approveExisting({ claimId: 'c3', profileId: 't1', expectedRowVersion: 1 }),
  approveExisting({ claimId: 'c3', profileId: 't1', expectedRowVersion: 1 })
]).then(results => assert.strictEqual(results.filter(x => x.status === 'fulfilled').length, 1));
```

- [ ] **Step 2：实现联系方式规范化**

手机号只接受规范大陆号码；人工微信号只做 NFKC、trim 和 ASCII 小写。保存 `raw_value/normalized_value/source/verification_state`。姓名、拼音和学校相似度只能排序，不得使批准条件成立。

- [ ] **Step 3：建立五个真实 authority command**

```js
[
  'profile-claim.submit.v1',
  'profile-claim.refresh-matches.v1',
  'profile-claim.approve-existing.v1',
  'profile-claim.approve-create.v1',
  'profile-claim.reject.v1'
].forEach(type => registry.require(type));
```

云端只写 command inbox；只有数据主机处理器可以写 teachers、students、profile bindings 和最终 receipt。

- [ ] **Step 4：实现无账户档案创建**

`StudentList`、`TeacherList` 使用真实 `profile.unclaimed.create` command。服务端从会话覆盖创建人、authority 和 teacher scope；不接受客户端传入的 owner/creator。创建完成后能立即用于排课，但不得创建 user、device、role binding 或 session。

- [ ] **Step 5：修复空 subject 放权**

`roleApplicationService.approve()` 在没有活动 profile binding 时只能返回 onboarding。任何 `subjectId=null` 的 teacher/student 令牌请求必须返回 `PROFILE_BINDING_REQUIRED`。

- [ ] **Step 6：实现主机审核事务**

批准已有档案必须在一个 SQLite 事务内重新计算候选、检查唯一索引和 row_version、写 binding、递增 access/auth version、撤销旧 session、写 audit、发布 projection 和 receipt。创建并绑定只在零精确候选时显示并执行。

- [ ] **Step 7：运行真实 HTTP 和排课测试**

Run: `node backend/src/services/profileBindingService.test.js && node backend/src/routes/profileClaims.http.test.js && node scripts/realUnclaimedProfileE2e.test.js`  
Expected: PASS；测试使用临时 SQLite、正式 router、command inbox 和 receipt，不允许内存数组伪造审核。

- [ ] **Step 8：提交**

```bash
git add backend/src/services/profileContactService.js backend/src/services/profileBindingService.js backend/src/routes/profileClaims.js backend/src/routes/hostAccountAccess.js backend/src/services/roleApplicationService.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityProjectionSourceService.js backend/src/routes/students.js backend/src/routes/teachers.js src/pages/StudentList.tsx src/pages/TeacherList.tsx backend/src/services/profileBindingService.test.js backend/src/routes/profileClaims.http.test.js scripts/realUnclaimedProfileE2e.test.js
git commit -m "feat: 实现无账户档案与档案认领审核"
```

### Task 3：教学端注册、小程序默认角色与账户身份认领

**Files:**
- Create: `backend/src/services/accountCredentialService.js`
- Create: `backend/src/services/accountIdentityClaimService.js`
- Create: `backend/src/routes/accountSessions.js`
- Create: `backend/src/routes/accountIdentityClaims.js`
- Modify: `backend/src/services/miniappIdentityService.js`
- Modify: `miniapp/src/pages/login/index.tsx`
- Modify: `src/components/DesktopIdentityGate.tsx`
- Test: `backend/src/routes/accountSessions.http.test.js`
- Test: `backend/src/routes/accountIdentityClaims.http.test.js`
- Test: `miniapp/src/utils/miniappAccountRegistration.test.js`

- [ ] **Step 1：写注册后无业务权限测试**

```js
const registered = await register({ phone: '13800000000', intendedRole: 'teacher' });
assert.strictEqual(registered.intendedRole, 'teacher');
assert.strictEqual(registered.scope.kind, 'onboarding');
assert.strictEqual((await getCourses(registered.bootstrapToken)).status, 403);
```

- [ ] **Step 2：实现密码凭据**

使用 Argon2id；如果当前依赖不可用则使用 Node `crypto.scrypt`，参数写入 credential 行并支持升级。登录错误统一返回 `ACCOUNT_CREDENTIAL_INVALID`，按 account＋IP 限速，不暴露账户是否存在。

- [ ] **Step 3：实现教学端固定老师意图**

教学端 `POST /api/account-sessions/register` 忽略客户端其他角色值，固定 `teacher`。注册成功立即创建 profile claim；没有档案绑定时身份门只显示申请状态、退出和重试。

- [ ] **Step 4：实现小程序角色意图**

小程序允许 `teacher/student/personal_family`。前两者创建 profile claim；`personal_family` 保持 visitor 基础状态，但可接受家庭关系和个人资产能力。

- [ ] **Step 5：关闭既有账户 openid 直接覆盖**

密码确认成功才可直接把当前微信身份绑定到目标账户。无法确认密码时创建 `account_identity_claims`，签发只能读取认领状态的 token；批准前不能读取目标账户任何业务数据。

- [ ] **Step 6：实现 identity claim 数据约束**

provider subject 在 claim 表只保存不可逆摘要；原始 openid/unionid 仅保存到加密身份表。批准事务重新检查目标账户未绑定其他 provider subject、当前 subject 未绑定其他账户、row_version 未变化，并写 receipt。

- [ ] **Step 7：运行**

Run: `node backend/src/routes/accountSessions.http.test.js && node backend/src/routes/accountIdentityClaims.http.test.js && node miniapp/src/utils/miniappAccountRegistration.test.js`  
Expected: PASS；错误密码、重复手机号、openid 冲突、并发批准和旧 token 读取全部失败。

- [ ] **Step 8：提交**

```bash
git add backend/src/services/accountCredentialService.js backend/src/services/accountIdentityClaimService.js backend/src/routes/accountSessions.js backend/src/routes/accountIdentityClaims.js backend/src/services/miniappIdentityService.js miniapp/src/pages/login/index.tsx src/components/DesktopIdentityGate.tsx backend/src/routes/accountSessions.http.test.js backend/src/routes/accountIdentityClaims.http.test.js miniapp/src/utils/miniappAccountRegistration.test.js
git commit -m "feat: 建立多端账户注册与身份认领"
```

### Task 4：建立家庭关系、用户额外能力和数据范围

**Files:**
- Create: `backend/src/services/effectiveAccessService.js`
- Create: `backend/src/services/householdService.js`
- Modify: `backend/src/services/authorizationPolicy.js`
- Modify: `gateway/src/middleware/permission.js`
- Modify: `miniapp/src/utils/permission.ts`
- Test: `backend/src/services/effectiveAccessService.test.js`
- Test: `backend/src/services/householdService.test.js`
- Test: `gateway/src/services/effectiveAccessParity.test.js`

- [ ] **Step 1：写统一 fixture**

```js
const fixture = {
  surface: 'miniapp',
  role: 'teacher',
  roleCapabilities: ['schedule.read', 'asset.personal.read'],
  relationshipCapabilities: ['asset.household.summary.read'],
  allows: ['asset.household.detail.read'],
  denies: ['schedule.read'],
  scopes: [{ type: 'household', id: 'h1' }]
};
assert.deepStrictEqual(evaluate(fixture).capabilities.sort(), [
  'asset.household.detail.read',
  'asset.household.summary.read',
  'asset.personal.read'
]);
```

- [ ] **Step 2：实现显式优先级**

deny 高于 allow；surface 白名单是最终上界；不可委派能力即使写入数据库也必须拒绝并产生安全审计。过期 override 不参与计算。

- [ ] **Step 3：实现家庭成员和资源范围**

家庭成员关系必须引用真实 user。课表共享必须引用明确 teacher/student profile；家庭资产范围必须引用 household。删除成员先撤销 scope，再递增 access_version。

- [ ] **Step 4：删除新 admin 授予**

删除 `grantAdmin()` 入口和命令；旧 admin 会话只返回 `LEGACY_ADMIN_MIGRATION_REQUIRED`。普通桌面不再接受 admin 或 super_admin surface。

- [ ] **Step 5：三端一致性测试**

Run: `node backend/src/services/effectiveAccessService.test.js && node backend/src/services/householdService.test.js && node gateway/src/services/effectiveAccessParity.test.js`  
Expected: 同一 fixture 在 Backend、Gateway、小程序得到相同 capability 和 scope hash。

- [ ] **Step 6：提交**

```bash
git add backend/src/services/effectiveAccessService.js backend/src/services/householdService.js backend/src/services/authorizationPolicy.js gateway/src/middleware/permission.js miniapp/src/utils/permission.ts backend/src/services/effectiveAccessService.test.js backend/src/services/householdService.test.js gateway/src/services/effectiveAccessParity.test.js
git commit -m "feat: 建立家庭关系与细粒度访问范围"
```

### Task 5：封闭旧角色真相和原始 REST 越权旁路

**Files:**
- Create: `backend/src/middleware/requireCapabilityAndScope.js`
- Modify: `backend/src/middleware/auth.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/routes/adminUsers.js`
- Modify: `backend/src/routes/students.js`
- Modify: `backend/src/routes/teachers.js`
- Modify: `backend/src/routes/courses.js`
- Modify: `backend/src/routes/schedules.js`
- Modify: `backend/src/routes/payments.js`
- Modify: `backend/src/routes/consumptions.js`
- Modify: `backend/src/routes/schools.js`
- Modify: `backend/src/routes/questionBank.js`
- Test: `backend/src/routes/unifiedAccessBoundary.http.test.js`
- Test: `backend/src/routes/legacyReviewRetirement.http.test.js`

- [ ] **Step 1：生成路由授权清单失败测试**

对 `backend/src/app.js` 挂载的每条业务路由断言存在 capability、surface、read/write scope 和 host requirement。未列入清单的业务路由启动时失败，不使用默认放行。

- [ ] **Step 2：写真实越权 HTTP 场景**

```js
assert.strictEqual(await status('GET', '/api/question-bank', null), 401);
assert.strictEqual(await statusAs(teacherA, 'GET', '/api/students?teacher_id=teacher-b'), 403);
assert.strictEqual(await statusAs(teacherA, 'POST', '/api/schedules', {
  teacher_id: 'teacher-b'
}), 403);
assert.strictEqual(await statusAs(visitor, 'GET', '/api/payments'), 403);
```

- [ ] **Step 3：实现统一中间件**

中间件从签名 session、活动 account-device link、profile binding 和 effectiveAccess 构造上下文；覆盖客户端提交的 user/role/teacher/student/owner/device/authority 字段。resource resolver 返回的行级 scope 必须在 SQL 查询和 mutation 两处校验。

- [ ] **Step 4：冻结旧审核写口**

`/api/admin/users/:id/review`、旧 teacher binding、旧 role mutation 和无法安全适配的原始写口返回 HTTP 410，body 固定包含 `replacementRoute`。唯一角色/档案/权限写入真相是 authority command＋host receipt。

- [ ] **Step 5：收口题库 GET**

`/api/question-bank` 所有 GET 也必须认证并检查 `question.online.use`、主机在线和题库盘状态；不能利用只校验 write 的中间件对 GET 放行。

- [ ] **Step 6：运行**

Run: `node backend/src/routes/unifiedAccessBoundary.http.test.js && node backend/src/routes/legacyReviewRetirement.http.test.js && npm run test:backend`  
Expected: PASS；伪造 header、query、body、JWT role 和跨老师 ID 均不能越权。

- [ ] **Step 7：提交**

```bash
git add backend/src/middleware/requireCapabilityAndScope.js backend/src/middleware/auth.js backend/src/app.js backend/src/routes/adminUsers.js backend/src/routes/students.js backend/src/routes/teachers.js backend/src/routes/courses.js backend/src/routes/schedules.js backend/src/routes/payments.js backend/src/routes/consumptions.js backend/src/routes/schools.js backend/src/routes/questionBank.js backend/src/routes/unifiedAccessBoundary.http.test.js backend/src/routes/legacyReviewRetirement.http.test.js
git commit -m "security: 统一业务路由权限与数据范围"
```

### Task 6：建立数据主机账户与权限中心

**Files:**
- Create: `src/pages/AccountAccessCenter.tsx`
- Create: `src/pages/AccountAccessCenter.css`
- Create: `src/components/ProfileClaimReviewPanel.tsx`
- Create: `src/components/AccountIdentityClaimReviewPanel.tsx`
- Create: `src/components/UserCapabilityEditor.tsx`
- Create: `src/components/HouseholdManager.tsx`
- Create: `src/components/SchoolAliasReviewPanel.tsx`
- Modify: `src/navigation/appNavigation.tsx`
- Modify: `src/App.tsx`
- Modify: `src/layout/AppShell.tsx`
- Modify: `src/pages/IdentityDeviceCenter.tsx`
- Test: `src/pages/AccountAccessCenter.test.js`
- Test: `scripts/hostIdentityUiProfile.test.js`

- [ ] **Step 1：写真实可达性测试**

测试以数据主机 runtime＋super_admin session 启动页面，点击侧栏“账户与权限”，从真实临时 Backend 获取待审数。教学端 runtime 不渲染入口，直接构造 page key 也得到拒绝页。

- [ ] **Step 2：实现五个标签页**

固定为“档案申请、账户身份、用户权限、家庭、学校别名”。每个列表支持分页、筛选、刷新、空态、失败、处理中和 receipt 状态。

- [ ] **Step 3：实现档案审核 UI**

显示精确联系方式证据和全部冲突；只有后端 `approvable=true` 时启用“绑定已有”。零精确候选显示“创建并绑定”。点击后必须等待最终 host receipt，再重新读取详情。

- [ ] **Step 4：实现额外权限高亮**

角色默认灰色、家庭默认绿色、显式 allow 蓝色、显式 deny 红色；保存必须选择 surface、scope、原因和可选有效期。不可委派能力不渲染可编辑控件。

- [ ] **Step 5：移除角色和普通设备批准混合入口**

从 `IdentityDeviceCenter` 移除 `AuthorityRoleApplicationsPanel`、直接授予管理员以及普通设备 approve/reject。主机迁移恢复导航移到“主机安全中心”。

- [ ] **Step 6：运行 UI 测试并留截图**

Run: `node src/pages/AccountAccessCenter.test.js && node scripts/hostIdentityUiProfile.test.js && npm run typecheck`  
Expected: PASS；保存 1920×1080 和 1280×720 下的待审、冲突、空态、失败、处理中、receipt 成功截图。

- [ ] **Step 7：提交**

```bash
git add src/pages/AccountAccessCenter.tsx src/pages/AccountAccessCenter.css src/components/ProfileClaimReviewPanel.tsx src/components/AccountIdentityClaimReviewPanel.tsx src/components/UserCapabilityEditor.tsx src/components/HouseholdManager.tsx src/components/SchoolAliasReviewPanel.tsx src/navigation/appNavigation.tsx src/App.tsx src/layout/AppShell.tsx src/pages/IdentityDeviceCenter.tsx src/pages/AccountAccessCenter.test.js scripts/hostIdentityUiProfile.test.js
git commit -m "feat: 建立数据主机账户与权限中心"
```


### Task 7：建立设备信任协议和可回滚数据库迁移

**Files:**
- Create: `shared/deviceTrustProtocol.js`
- Create: `shared/offlineAccessLicenseProtocol.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `gateway/src/db/schema.sql`
- Test: `shared/deviceTrustProtocol.test.js`
- Test: `backend/src/services/deviceTrustSchemaMigration.test.js`

- [ ] **Step 1：写协议失败测试**

```js
assert.deepStrictEqual(DEVICE_REGISTRATION_STATES, [
  'bootstrap_authenticated', 'host_pending', 'same_device',
  'reinstall_candidate', 'new_device', 'risk_blocked',
  'snapshot_required', 'completed', 'rejected', 'expired'
]);
assert.throws(() => normalizeDeviceRegistration({
  state: 'completed', hostReceiptId: null
}), /HOST_RECEIPT_REQUIRED/);
assert.throws(() => normalizeOfflineLicense({
  activeRole: 'super_admin'
}), /OFFLINE_ROLE_FORBIDDEN/);
```

- [ ] **Step 2：运行并确认失败**

Run: `node shared/deviceTrustProtocol.test.js`  
Expected: FAIL，提示模块不存在。

- [ ] **Step 3：实现 canonical payload**

`deviceRegistrationSigningPayload()` 必须覆盖 authority、user、device、installation、anchor/install key fingerprint、risk decision、auth/access/credential version、host epoch、issuedAt、expiresAt 和 nonce。`offlineLicenseSigningPayload()` 必须覆盖 capability/scope/snapshot hash，禁止调用者附加未登记字段。

- [ ] **Step 4：创建 V2 设备表**

按第 3 节创建 `trusted_devices`、`device_installations`、`account_device_links`、`account_installation_states`、`device_registration_attempts`、`offline_access_licenses`，另建：

```sql
CREATE TABLE device_fingerprint_observations (
  observation_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  device_id TEXT,
  component_tokens_json TEXT NOT NULL,
  quality_json TEXT NOT NULL,
  comparison_json TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
```

该表只存在于数据主机权威库；云迁移不得创建硬件原值字段。数据主机保存完整可信设备记录，云端只保存路由所需的 device/install/link 状态、公钥和 host receipt 镜像。

- [ ] **Step 5：加入外键和并发约束**

同一 authority 的 anchor fingerprint 唯一；同一安装公钥唯一；同一 account-device 只能有一个 pending/active link；同一 user-installation 只能有一个非 revoked 状态；所有状态更新使用 `row_version` CAS；registration attempt 的 `host_receipt_id` 唯一且只可消费一次。

- [ ] **Step 6：运行幂等迁移**

Run: `node backend/src/services/deviceTrustSchemaMigration.test.js && node shared/deviceTrustProtocol.test.js`  
Expected: PASS；空库、现有库和迁移两次均通过，旧设备表未删除。

- [ ] **Step 7：提交**

```bash
git add shared/deviceTrustProtocol.js shared/offlineAccessLicenseProtocol.js backend/src/schema.sql backend/src/database.js gateway/src/db/schema.sql backend/src/services/deviceTrustSchemaMigration.test.js shared/deviceTrustProtocol.test.js
git commit -m "feat: 建立持久设备信任协议与表结构"
```

### Task 8：实现 Windows 持久设备锚和硬件采样

**Files:**
- Create: `public/windows-device-anchor.ps1`
- Create: `public/windowsDeviceAnchor.js`
- Create: `public/windowsHardwareEvidence.js`
- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Modify: `src/custom.d.ts`
- Test: `public/windowsDeviceAnchor.test.js`
- Test: `public/windowsHardwareEvidence.test.js`
- Test: `scripts/windowsDeviceAnchorE2e.test.js`

- [ ] **Step 1：写 fake bridge 单元测试**

```js
const anchor = createWindowsDeviceAnchor({ invoke: fakeCng });
const first = await anchor.openOrCreate();
const second = await anchor.openOrCreate();
assert.strictEqual(first.fingerprint, second.fingerprint);
assert.strictEqual(first.backend, 'tpm_cng');
assert.strictEqual(await anchor.verifyLocalProof('nonce-1'), true);
assert.strictEqual(JSON.stringify(fakeCng.calls).includes('privateKey'), false);
```

- [ ] **Step 2：定义 PowerShell bridge 输入输出**

只允许 JSON stdin，操作为 `status/open-or-create/sign/delete`。stdout 只输出一行 JSON：

```json
{
  "ok": true,
  "backend": "tpm_cng",
  "publicKeySpkiBase64": "...",
  "fingerprint": "sha256:...",
  "signatureBase64": "..."
}
```

stderr 只允许稳定错误码；不得把 nonce 以外的数据、私钥、序列号或完整异常栈写日志。

- [ ] **Step 3：实现 CNG 降级顺序**

固定键名 `Gewu.DeviceAnchor.v2`，作用域为当前 Windows 用户。先尝试 `Microsoft Platform Crypto Provider` 创建不可导出 ECDSA P-256 键；失败再用 `Microsoft Software Key Storage Provider`；仍失败返回 `DEVICE_ANCHOR_CNG_UNAVAILABLE`，由 Node 层选择 software fallback。

- [ ] **Step 4：实现 software fallback**

software fallback 使用随机 ECDSA P-256 私钥并由 `safeStorage.encryptString()` 包装，存放在独立于普通账户缓存的 anchor 文件。状态中固定 `backend:'software_fallback'`，不能伪称硬件保护。

- [ ] **Step 5：实现硬件采样和清洗**

只采集 SMBIOS UUID、baseboard serial、BIOS serial、系统盘 serial、MachineGuid 的规范值和质量标记；过滤空值、全零、`To Be Filled By O.E.M.`、`Default string` 和长度异常。MAC、IP、设备名只进展示 metadata，不参与同设备强匹配。

- [ ] **Step 6：限制 IPC**

preload 只暴露：

```ts
deviceTrust: {
  getPublicStatus(): Promise<DeviceTrustPublicStatus>;
  prepareRegistration(input: {
    attemptId: string;
    anchorNonce: string;
    installationNonce: string;
    hostEncryptionPublicKey: string;
  }): Promise<DeviceRegistrationEnvelope>;
}
```

渲染进程不能传 key name、provider、PowerShell 路径、任意命令或任意签名 purpose；主进程固定构造 `device-registration-v2` canonical payload。

- [ ] **Step 7：真实 Windows E2E**

Run: `node public/windowsDeviceAnchor.test.js && node public/windowsHardwareEvidence.test.js && node scripts/windowsDeviceAnchorE2e.test.js`  
Expected: 连续两次运行 fingerprint 相同；临时复制应用目录不能导出私钥；显式 test cleanup 后键不存在。测试 cleanup 只能删除以 `Gewu.Test.DeviceAnchor.` 开头的测试键。

- [ ] **Step 8：提交**

```bash
git add public/windows-device-anchor.ps1 public/windowsDeviceAnchor.js public/windowsHardwareEvidence.js public/electron.js public/preload.js src/custom.d.ts public/windowsDeviceAnchor.test.js public/windowsHardwareEvidence.test.js scripts/windowsDeviceAnchorE2e.test.js
git commit -m "feat: 建立 Windows 持久设备锚"
```

### Task 9：拆分安装身份库和账户本地加密分区

**Files:**
- Create: `public/installationIdentityVault.js`
- Create: `public/accountPartitionVault.js`
- Modify: `public/desktopIdentityVault.js`
- Modify: `src/services/desktopIdentityPartition.mjs`
- Modify: `src/services/browserDatabase.ts`
- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Test: `public/installationIdentityVault.test.js`
- Test: `public/accountPartitionVault.test.js`
- Test: `src/services/desktopIdentityPartition.test.js`

- [ ] **Step 1：写多账户隔离失败测试**

```js
const install = await installationVault.create();
const a = await accountVault.create({ userId: 'u-a', localPin: 'pin-a-123' });
const b = await accountVault.create({ userId: 'u-b', localPin: 'pin-b-123' });
assert.notStrictEqual(a.partitionId, b.partitionId);
assert.notStrictEqual(a.dataKeyFingerprint, b.dataKeyFingerprint);
await assert.rejects(() => accountVault.unlock({ userId: 'u-a', localPin: 'pin-b-123' }), {
  code: 'ACCOUNT_PARTITION_UNLOCK_FAILED'
});
assert.strictEqual(install.privateKey in await installationVault.publicStatus(), false);
```

- [ ] **Step 2：实现 installation vault**

首次安装生成随机 UUIDv4 `installation_id` 和 Ed25519 密钥；safeStorage 文件只保存安装私钥、anchor fingerprint 和 schema version。公开 status 只返回 installation_id、公钥、指纹、创建时间和是否可解锁。

- [ ] **Step 3：实现 account partition vault**

每个 user 生成随机 partition_id 和 256-bit data key。data key 使用本地 PIN 经 scrypt 派生的 KEK 包装，并再由 safeStorage 保护；PIN、KEK 和明文 data key 不进入渲染持久存储。离线打开必须输入对应账户 PIN。

- [ ] **Step 4：明确分区路径**

```text
userData/
  installation/identity.v2
  accounts/<sha256(user_id)>/vault.v2
  accounts/<sha256(user_id)>/business.sqlite
  accounts/<sha256(user_id)>/drafts/
  accounts/<sha256(user_id)>/snapshots/
  accounts/<sha256(user_id)>/quarantine/
```

路径只使用 user_id 摘要，不能使用姓名、手机号或微信号。

- [ ] **Step 5：把浏览器数据库和草稿队列绑定 partition**

所有 IndexedDB/localStorage key 通过 `partitionedStorageKey()`；SQLite、快照和 authority draft 由主进程根据已解锁 partition 解析路径，渲染层不能传任意文件路径。

- [ ] **Step 6：保留旧 vault 只读迁移入口**

`desktopIdentityVault.js` 增加 `exportForV2Migration()`，只在旧 vault 成功解锁后返回公开 identity、加密业务路径和待同步草稿索引，不返回旧私钥给渲染层。

- [ ] **Step 7：运行**

Run: `node public/installationIdentityVault.test.js && node public/accountPartitionVault.test.js && node src/services/desktopIdentityPartition.test.js`  
Expected: PASS；账户 A 无法读取 B 的 metadata、数据库、草稿或离线许可。

- [ ] **Step 8：提交**

```bash
git add public/installationIdentityVault.js public/accountPartitionVault.js public/desktopIdentityVault.js src/services/desktopIdentityPartition.mjs src/services/browserDatabase.ts public/electron.js public/preload.js public/installationIdentityVault.test.js public/accountPartitionVault.test.js src/services/desktopIdentityPartition.test.js
git commit -m "feat: 拆分安装身份与账户本地分区"
```

### Task 10：实现账户先认证、设备静默登记和主机最终授权

**Files:**
- Create: `backend/src/services/deviceTrustService.js`
- Create: `backend/src/services/deviceRegistrationService.js`
- Create: `backend/src/routes/deviceRegistrations.js`
- Create: `backend/src/routes/accountDeviceLinks.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityHostCommandProcessor.js`
- Modify: `backend/src/services/desktopSessionService.js`
- Modify: `backend/src/app.js`
- Modify: `gateway/src/services/authorityDeviceControlMirrorService.js`
- Test: `backend/src/services/deviceRegistrationService.test.js`
- Test: `backend/src/routes/deviceRegistrations.http.test.js`
- Test: `backend/src/routes/accountDeviceLinks.http.test.js`

- [ ] **Step 1：写 bootstrap token 隔离测试**

```js
const login = await accountLogin({ phone, password });
assert.strictEqual(login.tokenUse, 'device-bootstrap');
assert.strictEqual(await getWithToken('/api/courses', login.token), 403);
assert.strictEqual(await postWithToken('/api/device-registrations', login.token, request), 202);
```

- [ ] **Step 2：验证两种设备证明**

新设备请求必须同时包含 installation public key、installation 对 nonce 的签名、anchor public identity、anchor 对另一 nonce 的签名和一次性 hardware evidence envelope。服务端检查 nonce、purpose、jti、过期、重放和公钥指纹。

- [ ] **Step 3：创建 host command**

```js
registry.register('device-registration.evaluate.v2', {
  requiredSurface: 'primary-host',
  handler: evaluateDeviceRegistration
});
```

payload 经主机公钥 E2E 加密；云端只能读取 attempt id、user id、installation key fingerprint 和状态，不能读取硬件原值。

- [ ] **Step 4：数据主机执行原子决策**

主机先验证账户活动状态，再读取角色和 profile binding：无档案 teacher 可得到 active account-device link 和 onboarding account-installation state，但不得得到业务 session、离线许可或快照；已绑定 teacher 的 account-installation state 为 `snapshot_required`。同一事务写 device、installation、account-device link、account-installation state、fingerprint observation、audit 和 signed receipt。

- [ ] **Step 5：云端消费 receipt**

云端验证 host epoch 和签名后更新控制面镜像。没有 receipt、receipt 字段不全、过期 host epoch 或 user/installation 不一致时，attempt 保持失败并不能签发 desktop session。

- [ ] **Step 6：签发正式短会话**

正式 session claims 固定含：

```js
{
  token_use: 'desktop-session',
  sub: userId,
  authority_id: authorityId,
  device_id: deviceId,
  installation_id: installationId,
  account_device_link_id: linkId,
  account_installation_state_id: accountInstallationStateId,
  active_role: role,
  profile_binding_id: profileBindingId,
  auth_version: authVersion,
  access_version: accessVersion,
  credential_version: credentialVersion
}
```

- [ ] **Step 7：运行真实 HTTP**

Run: `node backend/src/services/deviceRegistrationService.test.js && node backend/src/routes/deviceRegistrations.http.test.js && node backend/src/routes/accountDeviceLinks.http.test.js`  
Expected: 主机离线返回 pending/required，不伪造成功；receipt 后才产生正式 session。

- [ ] **Step 8：提交**

```bash
git add backend/src/services/deviceTrustService.js backend/src/services/deviceRegistrationService.js backend/src/routes/deviceRegistrations.js backend/src/routes/accountDeviceLinks.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityHostCommandProcessor.js backend/src/services/desktopSessionService.js backend/src/app.js gateway/src/services/authorityDeviceControlMirrorService.js backend/src/services/deviceRegistrationService.test.js backend/src/routes/deviceRegistrations.http.test.js backend/src/routes/accountDeviceLinks.http.test.js
git commit -m "feat: 实现账户驱动的设备静默登记"
```

### Task 11：实现重装识别、硬件风险评分和克隆阻断

**Files:**
- Create: `backend/src/services/deviceFingerprintService.js`
- Create: `backend/src/services/deviceRiskService.js`
- Modify: `backend/src/services/deviceRegistrationService.js`
- Modify: `backend/src/services/authorityHostCommandProcessor.js`
- Test: `backend/src/services/deviceFingerprintService.test.js`
- Test: `backend/src/services/deviceRiskService.test.js`
- Test: `scripts/deviceReinstallCloneE2e.test.js`

- [ ] **Step 1：固定 V1 组件权重**

```js
const DEVICE_MATCH_WEIGHTS_V1 = Object.freeze({
  anchorProof: 100,
  smbiosUuid: 45,
  baseboardSerial: 25,
  biosSerial: 10,
  systemDiskSerial: 10,
  machineGuid: 5
});
const REINSTALL_THRESHOLD = 70;
const WATCH_THRESHOLD = 40;
```

网络、IP、MAC、设备名、屏幕和时区权重为 0，只写展示/风险上下文。

- [ ] **Step 2：写判定矩阵测试**

覆盖：原 anchor 成功、anchor 丢失但 UUID＋主板相同、只换硬盘、换主板、所有值为空、虚拟机克隆、同 install key 不同 anchor、同 anchor 同时出现两个 active installation。

- [ ] **Step 3：实现 authority-HMAC token**

数据主机以 `HMAC-SHA256(authorityFingerprintKey, componentType + normalizedValue)` 生成 token；raw value 在事务结束前清零引用，不进入数据库、command receipt、日志或异常。

- [ ] **Step 4：实现决策规则**

```text
anchor proof valid + no contradiction -> same_device
anchor missing + score >= 70 -> reinstall_candidate
anchor missing + 40 <= score < 70 -> new_device + risk watch
anchor missing + score < 40 -> new_device
same install key + incompatible anchor/environment -> risk_blocked
valid anchor + >=2 strong components contradict -> risk_blocked
```

strong components 指 SMBIOS UUID 和 baseboard serial。generic/empty 值不计一致也不计冲突。

- [ ] **Step 5：实现重装替换**

reinstall candidate 完成在线账户认证后创建新 installation key，旧 installation 标记 replaced，新 installation 记录 `replaces_installation_id`。不能恢复旧 installation 私钥、未同步草稿或本地数据库；只能下载主机权威快照。

- [ ] **Step 6：实现克隆阻断**

同一 installation key 在两个不同 anchor 上出现，或 nonce 签名可从两个并发环境重放时，将 installation 和相关 session 置 blocked/revoked，要求主机风险中心处理。不得自动撤销整个账户。

- [ ] **Step 7：运行**

Run: `node backend/src/services/deviceFingerprintService.test.js && node backend/src/services/deviceRiskService.test.js && node scripts/deviceReinstallCloneE2e.test.js`  
Expected: 每个矩阵场景返回固定 decision、score、reasonCodes 和审计。

- [ ] **Step 8：提交**

```bash
git add backend/src/services/deviceFingerprintService.js backend/src/services/deviceRiskService.js backend/src/services/deviceRegistrationService.js backend/src/services/authorityHostCommandProcessor.js backend/src/services/deviceFingerprintService.test.js backend/src/services/deviceRiskService.test.js scripts/deviceReinstallCloneE2e.test.js
git commit -m "security: 实现设备重装识别与克隆阻断"
```

### Task 12：重构教学端身份门和同机多账户体验

**Files:**
- Modify: `src/components/DesktopIdentityGate.tsx`
- Modify: `src/components/DesktopIdentityGate.css`
- Create: `src/components/DesktopAccountSwitcher.tsx`
- Create: `src/services/deviceRegistrationClient.mjs`
- Create: `src/services/accountPartitionClient.mjs`
- Modify: `src/services/desktopIdentityClient.mjs`
- Modify: `src/services/desktopIdentityError.mjs`
- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Test: `src/components/DesktopIdentityGate.test.js`
- Test: `src/services/deviceRegistrationClient.test.js`
- Test: `scripts/desktopMultiAccountUiE2e.test.js`

- [ ] **Step 1：写 UI 状态机测试**

断言从账号登录依次出现：正在建立设备身份、等待数据主机、正在下载授权数据、可用。主机不可达时不得跳到工作台；risk blocked 必须显示事件编号和“联系超级管理员处理”，不能显示普通设备“等待批准”。

- [ ] **Step 2：删除普通设备扫码和批准文案**

移除 registration QR、short code、`identity_verified_pending_approval`、approve/reject、另一设备批准和手机号 30 天复核 UI。保留微信小程序账户登录本身，不再把它包装成设备审批。

- [ ] **Step 3：实现静默登记客户端**

客户端在 bootstrap token 后调用主进程获取 anchor/install public identity 和签名，提交 registration，轮询/订阅 host receipt；所有重试使用同一 idempotency key，不得产生重复 device/link。

- [ ] **Step 4：实现账户切换器**

本机无账户时显示登录；有一个分区时显示最近账户；多个分区时显示脱敏账号标签。登录一个未存在于本地分区的账户时显示：

```text
本设备已保存其他账户的数据。继续登录会为此账户创建独立数据空间，
不会覆盖或合并已有账户数据。
```

用户确认后继续，不要求超级管理员批准。

- [ ] **Step 5：实现本地 PIN 和离线入口**

首次快照成功后要求设置本地 PIN。在线可用账号密码重新建立分区；离线只能选择已有分区并用其 PIN 解锁。不存在分区或许可证时不显示离线登录按钮。

- [ ] **Step 6：实现初始化门禁**

installation 状态不是 active、link 不是 active、account-installation state 不是 active、profile binding 缺失或 snapshot 未原子完成时，业务路由全部保持挂起；React 页面隐藏不能替代主进程和 Backend 校验。

- [ ] **Step 7：运行真实 UI**

Run: `node src/components/DesktopIdentityGate.test.js && node src/services/deviceRegistrationClient.test.js && node scripts/desktopMultiAccountUiE2e.test.js`  
Expected: 两账户同机登录后数据库路径、快照、草稿和 offline license 均不同，切换不会串数据。

- [ ] **Step 8：提交**

```bash
git add src/components/DesktopIdentityGate.tsx src/components/DesktopIdentityGate.css src/components/DesktopAccountSwitcher.tsx src/services/deviceRegistrationClient.mjs src/services/accountPartitionClient.mjs src/services/desktopIdentityClient.mjs src/services/desktopIdentityError.mjs public/electron.js public/preload.js src/components/DesktopIdentityGate.test.js src/services/deviceRegistrationClient.test.js scripts/desktopMultiAccountUiE2e.test.js
git commit -m "feat: 重构教学端设备登录与多账户隔离"
```

### Task 13：拆分短在线会话和 30 天离线访问许可

**Files:**
- Create: `backend/src/services/offlineAccessLicenseService.js`
- Modify: `backend/src/services/deviceLeaseService.js`
- Modify: `backend/src/services/desktopSessionService.js`
- Modify: `public/accountPartitionVault.js`
- Modify: `src/services/desktopAuthorizationSession.mjs`
- Modify: `src/services/authoritySyncSurfacePolicy.mjs`
- Test: `backend/src/services/offlineAccessLicenseService.test.js`
- Test: `public/accountPartitionVault.test.js`
- Test: `scripts/desktopOfflineThirtyDayE2e.test.js`

- [ ] **Step 1：写时间边界测试**

```js
assert.strictEqual(verifyAt(license, day(29)).allowed, true);
assert.strictEqual(verifyAt(license, day(30)).allowed, false);
assert.strictEqual(verifyAt(license, day(-1)).code, 'OFFLINE_CLOCK_ROLLBACK');
assert.strictEqual(canOffline('schedule.write', license), true);
assert.strictEqual(canOffline('sync.push', license), false);
assert.strictEqual(canOffline('question.online.use', license), false);
assert.strictEqual(canOffline('profile.review', license), false);
```

过期边界使用 `now >= expiresAt` 即失效，不允许第 30 天后的毫秒宽限。

- [ ] **Step 2：保持在线令牌短时**

access token 15 分钟，refresh/session 上界 8 小时；authority command nonce 10 分钟且一次性。现有 `deviceLeaseService` 只保留兼容在线 grant 语义，不把 `MAX_LEASE_MS` 改成 30 天。

- [ ] **Step 3：签发离线许可**

只有数据主机、活动 account-device link、活动 account-installation state、活动 installation、活动 profile binding 和完成的 snapshot 才能签发。期限固定 `issuedAt + 30 days`，离线使用不滑动续期。

- [ ] **Step 4：绑定权限和快照**

许可包含 capability hash、scope hash、snapshot version/hash、auth/access/credential version。任一不匹配，在线时立即拒绝并清理许可；离线时只能验证本地签名与绑定快照。

- [ ] **Step 5：防系统时间回拨**

账户 vault 保存最近一次主机签名 server time 和最近成功本地时间。当前时间早于已保存时间超过 5 分钟时锁定离线模式；恢复联网后用主机时间重新校准。不能通过手工改系统时间延长许可。

- [ ] **Step 6：明确离线允许操作**

仅允许许可 capability 中的本地读取和普通业务草稿编辑；同步 push/pull、审核、权限、设备处置、题库、导出题库、主机、备份、学校规范治理全部返回 `OFFLINE_OPERATION_FORBIDDEN`。

- [ ] **Step 7：运行**

Run: `node backend/src/services/offlineAccessLicenseService.test.js && node public/accountPartitionVault.test.js && node scripts/desktopOfflineThirtyDayE2e.test.js`  
Expected: PASS；测试时钟覆盖 29 天、30 天、回拨、续签、撤权后再次联网和离线草稿保留。

- [ ] **Step 8：提交**

```bash
git add backend/src/services/offlineAccessLicenseService.js backend/src/services/deviceLeaseService.js backend/src/services/desktopSessionService.js public/accountPartitionVault.js src/services/desktopAuthorizationSession.mjs src/services/authoritySyncSurfacePolicy.mjs backend/src/services/offlineAccessLicenseService.test.js public/accountPartitionVault.test.js scripts/desktopOfflineThirtyDayE2e.test.js
git commit -m "feat: 实现三十天离线访问许可"
```

### Task 14：建立本人设备页、数据主机设备风险中心和撤销语义

**Files:**
- Create: `src/pages/MyDevices.tsx`
- Create: `src/pages/DeviceRiskCenter.tsx`
- Create: `src/pages/DeviceRiskCenter.css`
- Modify: `src/pages/IdentityDeviceCenter.tsx`
- Modify: `src/services/identityDeviceCenterPolicy.mjs`
- Modify: `src/navigation/appNavigation.tsx`
- Modify: `backend/src/routes/accountDeviceLinks.js`
- Create: `backend/src/routes/hostDeviceRisk.js`
- Modify: `backend/src/services/deviceTrustService.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Test: `src/pages/DeviceRiskCenter.test.js`
- Test: `backend/src/routes/hostDeviceRisk.http.test.js`
- Test: `scripts/deviceRevocationE2e.test.js`

- [ ] **Step 1：写撤销范围测试**

撤销 account-device link 只终止该 user 在该 device 的 session/license，其他 user link 保持 active；撤销 trusted device 必须递增 credential_version，撤销所有 installation、link、session 和 license。

- [ ] **Step 2：实现本人设备页**

教学端账户菜单可查看当前账户关联的设备名称、最近在线、anchor backend、安装版本和状态；允许“退出此设备”和“撤销其他设备上的本账户”。不得看到同设备其他账户身份。

- [ ] **Step 3：实现数据主机设备与风险中心**

固定三个标签页：“可信设备、安装实例、风险事件”。可展开查看账户关联，但手机号脱敏。normal/watch 设备不出现批准按钮；只有 blocked risk event 显示“确认本人重装”“认定克隆并撤销”“保持阻断”。

- [ ] **Step 4：实现真实风险处置命令**

```js
[
  'device-risk.confirm-reinstall.v1',
  'device-risk.revoke-clone.v1',
  'device-risk.keep-blocked.v1',
  'account-device-link.revoke.v1',
  'trusted-device.revoke.v1'
].forEach(type => registry.require(type));
```

所有操作要求 primary-host、super_admin、近期提权、row_version、原因和 host receipt。

- [ ] **Step 5：保留主机安全中心**

现有 primary-host bootstrap、transfer、recover、epoch 和 recovery package 继续位于 `IdentityDeviceCenter` 或重命名后的“主机安全中心”，不使用普通 trusted device 的自动注册代替。

- [ ] **Step 6：实现本地“清除此设备”**

用户必须再次输入当前账户 PIN，并选择“只清当前账户”或“清除全部本地账户和安装凭据”。设备锚默认保留；单独删除设备锚必须再次警告“重装后将作为新设备”，并要求在线撤销或生成离线清除审计待上传。

- [ ] **Step 7：运行**

Run: `node src/pages/DeviceRiskCenter.test.js && node backend/src/routes/hostDeviceRisk.http.test.js && node scripts/deviceRevocationE2e.test.js`  
Expected: PASS；普通设备不出现人工审批，风险阻断有真实入口、命令、receipt 和状态刷新。

- [ ] **Step 8：提交**

```bash
git add src/pages/MyDevices.tsx src/pages/DeviceRiskCenter.tsx src/pages/DeviceRiskCenter.css src/pages/IdentityDeviceCenter.tsx src/services/identityDeviceCenterPolicy.mjs src/navigation/appNavigation.tsx backend/src/routes/accountDeviceLinks.js backend/src/routes/hostDeviceRisk.js backend/src/services/deviceTrustService.js backend/src/services/authorityCommandRegistry.js src/pages/DeviceRiskCenter.test.js backend/src/routes/hostDeviceRisk.http.test.js scripts/deviceRevocationE2e.test.js
git commit -m "feat: 建立设备风险中心与分层撤销"
```


### Task 15：迁移旧单账户设备授权并退役普通设备审批

**Files:**
- Create: `backend/src/services/legacyDeviceTrustMigrationService.js`
- Modify: `backend/src/routes/desktopIdentity.js`
- Modify: `backend/src/services/desktopIdentityService.js`
- Modify: `backend/src/services/deviceActivationService.js`
- Modify: `backend/src/services/desktopDeviceChallengeService.js`
- Modify: `backend/src/services/desktopAuthorizationProjectionService.js`
- Modify: `gateway/src/db/schema.sql`
- Modify: `gateway/src/services/authorityDeviceControlMirrorService.js`
- Modify: `public/desktopIdentityVault.js`
- Modify: `public/desktopAuthorityRuntime.js`
- Modify: `public/runtimeConfig.js`
- Test: `backend/src/services/legacyDeviceTrustMigrationService.test.js`
- Test: `backend/src/routes/desktopIdentityV1Retirement.http.test.js`
- Test: `scripts/legacyDeviceCutover.test.js`

- [ ] **Step 1：写迁移账本测试**

每条 active `desktop_device_authorizations` 必须得到一条迁移账本结果：`migrated_online/requires_online/pending_discarded/conflict`。没有旧私钥证明、账户在线认证和 host receipt 的记录不能变为 active V2 link。

- [ ] **Step 2：实现在线升级证明**

旧 vault 解锁后，用旧 Ed25519 私钥签署一次性 `device-trust-migration-v2` nonce；同时完成账户在线认证，建立新的 CNG anchor 和 installation key。旧 PEM 不能导入 TPM 后宣称为 hardware-backed。

- [ ] **Step 3：迁移表语义**

`desktop_device_authorizations` 拆为 trusted device、installation 和 account link；`device_grants/device_leases` 不直接复制为 30 天许可；`desktop_sessions` 全部撤销；`sync_devices.owner_user_id` 停止作为真相。Gateway 删除 `UNIQUE(authority_id,device_id)` 的单账户镜像假设。

- [ ] **Step 4：分区 authority outbox**

`public/desktopAuthorityRuntime.js` 的 outbox 路径必须包含 account partition/association，账户 A 不能列出、提交或删除账户 B 的草稿。

- [ ] **Step 5：冻结旧普通设备路由**

当 `deviceKind=desktop-client` 时，下列路由固定返回 410 `DESKTOP_DEVICE_APPROVAL_V1_REMOVED`：

```text
/challenges/start
/challenges/:id/confirm
/challenges/:id/approve
/challenges/:id/reject
/challenges/:id/exchange
/challenges/:id/activation/exchange
/activations/:id/finalize
/authorizations/pending
/devices/:deviceId/revoke
```

primary-host challenge、bootstrap、transfer、recover 和 epoch 路由保持可用；测试必须证明普通 registration 不能伪造 `deviceKind=primary-host` 绕过 410。

- [ ] **Step 6：处理离线升级**

V2 首次启动但无法联网时不删除旧数据。旧签名许可仍在原有效期内则按原边界进入兼容离线；失效后只显示“需要联网升级”，保留数据库和草稿。联网迁移完成后才签发新 30 天许可。

- [ ] **Step 7：归档旧 pending 数据**

旧 pending challenge/activation 全部标记 cancelled，绝不自动变成新设备。旧表只读保留一个发布版本；迁移账本无 orphan/conflict 后，下一主版本才允许删除。

- [ ] **Step 8：运行**

Run: `node backend/src/services/legacyDeviceTrustMigrationService.test.js && node backend/src/routes/desktopIdentityV1Retirement.http.test.js && node scripts/legacyDeviceCutover.test.js`  
Expected: PASS；旧 active 设备只能通过在线证明迁移，旧 pending 永不继承信任。

- [ ] **Step 9：提交**

```bash
git add backend/src/services/legacyDeviceTrustMigrationService.js backend/src/routes/desktopIdentity.js backend/src/services/desktopIdentityService.js backend/src/services/deviceActivationService.js backend/src/services/desktopDeviceChallengeService.js backend/src/services/desktopAuthorizationProjectionService.js gateway/src/db/schema.sql gateway/src/services/authorityDeviceControlMirrorService.js public/desktopIdentityVault.js public/desktopAuthorityRuntime.js public/runtimeConfig.js backend/src/services/legacyDeviceTrustMigrationService.test.js backend/src/routes/desktopIdentityV1Retirement.http.test.js scripts/legacyDeviceCutover.test.js
git commit -m "refactor: 迁移并退役普通设备人工审批"
```

### Task 16：实现新设备全量授权快照和同步门禁

**Files:**
- Create: `shared/authorizedSnapshotProtocol.js`
- Create: `backend/src/services/authorizedSnapshotService.js`
- Create: `backend/src/routes/authorizedSnapshots.js`
- Create: `src/services/authorizedSnapshotClient.mjs`
- Modify: `backend/src/services/authorityProjectionSourceService.js`
- Modify: `src/services/browserDatabase.ts`
- Modify: `src/services/desktopCommandOutbox.mjs`
- Modify: `src/services/desktopAuthorityClient.mjs`
- Modify: `public/accountPartitionVault.js`
- Test: `backend/src/services/authorizedSnapshotService.test.js`
- Test: `src/services/authorizedSnapshotClient.test.js`
- Test: `scripts/authorizedSnapshotBusinessE2e.test.js`

- [ ] **Step 1：写 manifest 契约**

```js
assert.deepStrictEqual(manifest.excludedKinds, [
  'questions', 'question_answers', 'question_explanations',
  'question_assets', 'question_index'
]);
assert.strictEqual(manifest.historyWindow, 'all');
assert.ok(manifest.tables.every(t => t.rowCount >= 0 && t.sha256));
assert.ok(manifest.signature);
```

- [ ] **Step 2：生成全历史授权集合**

根据 profile binding 和 effective scope 查询课程、课表、关联学生、必要教师、学校、机构、教室、允许的费用、个人资产和家庭资产。不接受客户端传表名或时间范围；所有历史记录按稳定主键排序。

- [ ] **Step 3：实现分块和断点续传**

manifest 固定 snapshot version、schema version、scope hash、table/chunk hash、row count 和 host signature。chunk endpoint 只接受该 manifest 中的 chunk id；重复下载幂等，任一 hash 错误拒绝 commit。

- [ ] **Step 4：实现账户分区原子切换**

下载到 `snapshots/staging/<snapshot-id>`，完成全部 hash 和签名验证后关闭旧 DB、备份当前 active、原子 rename staging 为 active、记录 snapshot receipt，再把 account-installation state 的 `business_state/initialized_snapshot_version/initialized_snapshot_hash` 更新为 active 和当前值。

- [ ] **Step 5：实现权限变化**

scope 扩大产生增补快照；scope 缩小先构建新快照，再切换并把越权草稿移动到 `quarantine/<event-id>`。隔离草稿只读、可查看原因和导出，不可同步回主机。

- [ ] **Step 6：同步门禁**

`desktopAuthorityClient` 和 `desktopCommandOutbox` 必须同时验证 active session、active account-device link、active account-installation state、active installation、snapshot scope/version 和用户确认；不得静默推送离线修改。

- [ ] **Step 7：运行**

Run: `node backend/src/services/authorizedSnapshotService.test.js && node src/services/authorizedSnapshotClient.test.js && node scripts/authorizedSnapshotBusinessE2e.test.js`  
Expected: 全历史授权数据存在，越权行和所有题目实体为零；中断后可续传，损坏后不切换。

- [ ] **Step 8：提交**

```bash
git add shared/authorizedSnapshotProtocol.js backend/src/services/authorizedSnapshotService.js backend/src/routes/authorizedSnapshots.js src/services/authorizedSnapshotClient.mjs backend/src/services/authorityProjectionSourceService.js src/services/browserDatabase.ts src/services/desktopCommandOutbox.mjs src/services/desktopAuthorityClient.mjs public/accountPartitionVault.js backend/src/services/authorizedSnapshotService.test.js src/services/authorizedSnapshotClient.test.js scripts/authorizedSnapshotBusinessE2e.test.js
git commit -m "feat: 实现账户全量授权快照初始化"
```

### Task 17：建立学校规范名、别名和联网候选治理

**Files:**
- Create: `backend/src/services/schoolCanonicalizationService.js`
- Create: `backend/src/services/schoolSuggestionProvider.js`
- Create: `backend/src/routes/schoolCanonicalization.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `backend/src/routes/students.js`
- Modify: `src/pages/StudentList.tsx`
- Create: `miniapp/src/pages/profile/index.tsx`
- Create: `miniapp/src/pages/profile/index.config.ts`
- Create: `miniapp/src/pages/profile/index.scss`
- Modify: `src/components/SchoolAliasReviewPanel.tsx`
- Test: `backend/src/services/schoolCanonicalizationService.test.js`
- Test: `backend/src/routes/schoolCanonicalization.http.test.js`
- Test: `scripts/schoolCanonicalizationBusinessE2e.test.js`

- [ ] **Step 1：写唯一性和冲突测试**

规范学校唯一键为 `authority_id + administrative_code + normalized_canonical_name`。同名不同区不合并；同区相同规范名不能重复；一个 active alias 只能映射一个 canonical school。

- [ ] **Step 2：创建表和兼容字段**

创建 `canonical_schools`、`school_aliases`、`school_alias_submissions`。students 及其他实际存在 school 字段的业务记录增加 `school_raw/school_alias_id/school_id`；旧 `school` 只兼容展示，不再用于判同校。

- [ ] **Step 3：实现自由输入**

教学端和小程序提交原始学校名时创建/复用 pending alias submission，不自动创建 canonical school，不因模糊相似自动合并。

- [ ] **Step 4：实现网络候选**

数据主机配置高德 Web Service key；搜索结果只保存 provider、provider_id、名称、地址、行政区和抓取时间。没有 key、超时或限速时页面显示真实不可用状态，手工创建规范学校仍可完成。

- [ ] **Step 5：实现主机审核事务**

选择现有 canonical 或创建 canonical 后映射 alias，事务更新关联记录的 school_id、递增 projection version、写 audit/receipt。合并 canonical 必须预览受影响记录并支持回滚映射。

- [ ] **Step 6：运行**

Run: `node backend/src/services/schoolCanonicalizationService.test.js && node backend/src/routes/schoolCanonicalization.http.test.js && node scripts/schoolCanonicalizationBusinessE2e.test.js`  
Expected: 桌面和小程序不同别名经主机映射后显示同一规范名，raw 输入仍可审计。

- [ ] **Step 7：提交**

```bash
git add backend/src/services/schoolCanonicalizationService.js backend/src/services/schoolSuggestionProvider.js backend/src/routes/schoolCanonicalization.js backend/src/schema.sql backend/src/database.js backend/src/routes/students.js src/pages/StudentList.tsx miniapp/src/pages/profile/index.tsx miniapp/src/pages/profile/index.config.ts miniapp/src/pages/profile/index.scss src/components/SchoolAliasReviewPanel.tsx backend/src/services/schoolCanonicalizationService.test.js backend/src/routes/schoolCanonicalization.http.test.js scripts/schoolCanonicalizationBusinessE2e.test.js
git commit -m "feat: 建立学校规范名和别名治理"
```

### Task 18：题库改为联网使用和签名体系目录缓存

**Files:**
- Create: `shared/questionCatalogProtocol.js`
- Create: `backend/src/services/questionCatalogCacheService.js`
- Create: `backend/src/routes/questionCatalog.js`
- Create: `src/services/questionCatalogCache.mjs`
- Create: `miniapp/src/utils/questionCatalogCache.ts`
- Modify: `backend/src/services/authorityProjectionService.js`
- Modify: `backend/src/routes/questionBank.js`
- Modify: `src/pages/QuestionBankPreview.tsx`
- Modify: `miniapp/src/pages/question-bank/index.tsx`
- Test: `backend/src/services/questionCatalogCacheService.test.js`
- Test: `scripts/questionBankOnlineCacheE2e.test.js`

- [ ] **Step 1：写泄漏断言**

普通授权 snapshot/projection/cache 中禁止出现 `questionId/stem/answer/explanation/assetPath/searchIndex`。目录只允许 subject、grade、textbook、chapter、knowledge/model/method/ability node、version、etag、hash、signature。

- [ ] **Step 2：实现目录 API**

请求必须认证并具备 `question.online.use`；返回 host epoch、catalog version、ETag 和签名。304 时不传正文；新版本先验证签名再替换缓存。

- [ ] **Step 3：实现在线业务门禁**

查询、选题、组卷、试题编辑和导出同时要求在线 session、数据主机健康、题库 authority binding 和移动硬盘 mounted。任一失败返回稳定原因，不回退到本地题目。

- [ ] **Step 4：实现离线 UI**

模块打开先显示缓存目录和“离线缓存目录”标识；搜索、选题、编辑、组卷、导出按钮全部 disabled，并说明需连接数据主机。缓存不存在时显示空态而非虚构体系。

- [ ] **Step 5：限制体系写入**

taxonomy command 只允许 primary-host＋super_admin＋`question.taxonomy.manage`；教学端老师只有在线使用能力，不能修改体系或删除已入库试题。

- [ ] **Step 6：运行**

Run: `node backend/src/services/questionCatalogCacheService.test.js && node scripts/questionBankOnlineCacheE2e.test.js`  
Expected: 在线可用并缓存目录；停主机后只见目录，所有题库操作拒绝；授权快照无题目数据。

- [ ] **Step 7：提交**

```bash
git add shared/questionCatalogProtocol.js backend/src/services/questionCatalogCacheService.js backend/src/routes/questionCatalog.js src/services/questionCatalogCache.mjs miniapp/src/utils/questionCatalogCache.ts backend/src/services/authorityProjectionService.js backend/src/routes/questionBank.js src/pages/QuestionBankPreview.tsx miniapp/src/pages/question-bank/index.tsx backend/src/services/questionCatalogCacheService.test.js scripts/questionBankOnlineCacheE2e.test.js
git commit -m "feat: 收口题库在线使用和目录缓存"
```

### Task 19：实现家庭课表、个人资产、家庭资产和小程序权限表现

**Files:**
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/services/householdService.js`
- Create: `backend/src/services/householdAssetService.js`
- Create: `backend/src/routes/households.js`
- Modify: `backend/src/services/personalAssetRecordService.js`
- Create: `miniapp/src/pages/family/index.tsx`
- Create: `miniapp/src/pages/family/index.config.ts`
- Create: `miniapp/src/pages/family/index.scss`
- Create: `miniapp/src/pages/family-assets/index.tsx`
- Create: `miniapp/src/pages/family-assets/index.config.ts`
- Create: `miniapp/src/pages/family-assets/index.scss`
- Modify: `miniapp/src/app.config.ts`
- Modify: `miniapp/src/custom-tab-bar/index.tsx`
- Modify: `miniapp/src/utils/permission.ts`
- Test: `backend/src/services/householdAssetService.test.js`
- Test: `backend/src/routes/households.http.test.js`
- Test: `miniapp/src/utils/miniappHouseholdAccess.test.js`
- Test: `scripts/familyPermissionBusinessE2e.test.js`

- [ ] **Step 1：迁移资产所有权**

资产表增加 `owner_type IN ('user','household')` 和 `owner_id`；旧 `owner_user_id` 迁移为 user owner。家庭资产必须引用 active household，不能靠角色 admin 判断。

- [ ] **Step 2：实现课表脱敏 DTO**

家庭共享默认只返回时间、展示名、地点和状态；学生电话、学费、课时费、内部备注、其他家庭成员数据均不返回。summary capability 不能调用 detail API。

- [ ] **Step 3：拆分资产 capability**

固定为 personal read/write、household summary read、household detail read、household write、export。写入服务端从 scope 解析 owner，不接受客户端伪造 owner_id。

- [ ] **Step 4：实现小程序页面和导航**

同一路由按 effective access 显示真实可用入口。没有家庭关系时显示加入/等待流程；没有 detail 能力时只显示汇总；没有 write 能力时不渲染编辑按钮且 API 仍返回 403。

- [ ] **Step 5：移除小程序管理员页**

删除 `pages/admin/users/index` 注册和导航。超级管理员通过小程序登录时也只获得该 surface 允许的普通/家庭能力，不能进行主机审核或权限配置。

- [ ] **Step 6：运行**

Run: `node backend/src/services/householdAssetService.test.js && node backend/src/routes/households.http.test.js && node miniapp/src/utils/miniappHouseholdAccess.test.js && node scripts/familyPermissionBusinessE2e.test.js && npm --prefix miniapp run ci:weapp`  
Expected: visitor/teacher/student＋family 组合按 scope 工作，无角色串权和资产越权。

- [ ] **Step 7：提交**

```bash
git add backend/src/schema.sql backend/src/services/householdService.js backend/src/services/householdAssetService.js backend/src/routes/households.js backend/src/services/personalAssetRecordService.js miniapp/src/pages/family/index.tsx miniapp/src/pages/family/index.config.ts miniapp/src/pages/family/index.scss miniapp/src/pages/family-assets/index.tsx miniapp/src/pages/family-assets/index.config.ts miniapp/src/pages/family-assets/index.scss miniapp/src/app.config.ts miniapp/src/custom-tab-bar/index.tsx miniapp/src/utils/permission.ts backend/src/services/householdAssetService.test.js backend/src/routes/households.http.test.js miniapp/src/utils/miniappHouseholdAccess.test.js scripts/familyPermissionBusinessE2e.test.js
git commit -m "feat: 实现家庭共享和家庭资产权限"
```

### Task 20：迁移旧管理员和旧角色/设备兼容字段

**Files:**
- Create: `backend/src/services/legacyAdminMigrationService.js`
- Create: `src/components/LegacyAdminMigrationWizard.tsx`
- Modify: `backend/src/services/authorityMigrationService.js`
- Modify: `backend/src/services/authorizationPolicy.js`
- Modify: `src/pages/AccountAccessCenter.tsx`
- Modify: `scripts/release-matrix.js`
- Test: `backend/src/services/legacyAdminMigrationService.test.js`
- Test: `scripts/legacyAuthorizationRemoval.test.js`

- [ ] **Step 1：生成强制迁移清单**

列出每个旧 admin 的账户、最近登录、teacher/student 档案、资产、家庭候选、旧权限和设备。未明确选择目标角色/关系/能力的账户保持 restricted，不签发新 desktop session。

- [ ] **Step 2：实现逐账户向导**

目标基础角色只能是 teacher、student 或无正式角色；可同时建立 family membership 和可委派 miniapp capability。已有教师档案必须经过活动 profile binding，不复制档案 ID。

- [ ] **Step 3：切换放权真相**

闸门开启后不再从 `users.role`、`users.teacher_id/student_id`、`permissions_data`、旧 device approval 和 `sync_devices.owner_user_id` 放权；兼容字段只读保留一个版本。

- [ ] **Step 4：扫描残留 admin**

测试只允许字符串 admin 出现在历史 schema、迁移器和兼容测试。新 session、capability、导航、miniapp 页面和 authority projection 出现 admin 即失败。

- [ ] **Step 5：运行**

Run: `node backend/src/services/legacyAdminMigrationService.test.js && node scripts/legacyAuthorizationRemoval.test.js && node backend/src/services/authorityMigrationService.test.js`  
Expected: 所有旧 admin 都有明确迁移结果，个人资产、审计和档案 ID 不丢失。

- [ ] **Step 6：提交**

```bash
git add backend/src/services/legacyAdminMigrationService.js src/components/LegacyAdminMigrationWizard.tsx backend/src/services/authorityMigrationService.js backend/src/services/authorizationPolicy.js src/pages/AccountAccessCenter.tsx scripts/release-matrix.js backend/src/services/legacyAdminMigrationService.test.js scripts/legacyAuthorizationRemoval.test.js
git commit -m "refactor: 迁移并停用旧管理员权限"
```


### Task 21：建立真实账户、权限、设备和业务端到端验收

**Files:**
- Create: `scripts/realIdentityDevicePermissionBusinessE2e.js`
- Create: `scripts/realIdentityDevicePermissionBusinessE2e.test.js`
- Create: `scripts/fixtures/identity-device-business-fixture.js`
- Modify: `scripts/real-two-desktop-e2e.js`
- Modify: `package.json`
- Create: `docs/verification-account-permission-device-v2.md`
- Test: `scripts/realIdentityDevicePermissionBusinessE2e.test.js`

- [ ] **Step 1：建立真实进程拓扑**

测试启动临时 Gateway、云 Backend、数据主机 Backend、WebSocket、中继、真实临时 SQLite、临时题库盘、两个 Electron user-data 和小程序 H5/微信开发版。账户、数据库、command、receipt、projection、设备锚、安装 vault、账户分区、快照和 UI 必须走正式代码。

- [ ] **Step 2：限制测试替身**

只有微信登录凭证、高德 POI 和不可控外网可以使用 adapter。adapter 只能返回外部响应，不得直接写 user、profile、device、link、school、asset、command 或 receipt 表。

- [ ] **Step 3：场景 A——无账户档案到新设备可用**

数据主机创建无账户老师和历史课表；教学端注册、自动 teacher 意图、提交 profile claim；未审核只能 onboarding；主机账户中心刷新候选并批准；获取最终 receipt；新设备静默登记、主机授权、下载全部授权历史；确认无其他老师和题库实体。

- [ ] **Step 4：场景 B——卸载重装仍识别同设备**

记录 `device_id/installation_id/anchor fingerprint`，关闭 Electron，删除测试 user-data 中 installation/account 目录但保留专用 CNG 测试 anchor，重新启动并在线登录。断言 device_id 不变、installation_id 变化、旧 installation=replaced、重新下载快照、没有普通设备审批记录。

- [ ] **Step 5：场景 C——锚丢失和硬件候选**

删除专用测试 anchor，使用相同真实硬件采样重新登录。断言 decision=`reinstall_candidate`、新 device/anchor 和替换审计存在、必须重新账户认证、不会继承旧本地草稿。

- [ ] **Step 6：场景 D——克隆和风险阻断**

复制 installation vault 到第二测试 user-data，并用不同测试 anchor 启动。断言 registration/session 返回 `DEVICE_RISK_BLOCKED`；主机“设备与风险”页出现事件；点击“认定克隆并撤销”后收到真实 receipt，原正常 installation 的处置符合选择。

- [ ] **Step 7：场景 E——同机多账户**

同一 anchor/installation 依次登录老师 A 和老师 B。断言一个 device、两个 account-device links、两个 account partitions；A/B 课程、草稿、资产、快照、PIN、offline license 和 outbox 互不可见。

- [ ] **Step 8：场景 F——撤销和30天离线**

只撤销 A link，A 在线立即失效、B 正常；重新授权 A 后签发许可证，测试时钟第29天可离线，第30天锁定，草稿仍在；回拨系统时间被锁定；联网续签后恢复。

- [ ] **Step 9：场景 G——权限和家庭**

visitor 加入家庭，只见指定脱敏课表和资产汇总；主机授予 detail 后小程序生效并高亮额外权限；撤销后 scope version 变化，桌面旧快照重新收缩且越权草稿进入 quarantine。

- [ ] **Step 10：场景 H——学校和题库**

桌面/小程序提交不同学校别名，主机映射后统一；题库在线获取并缓存体系目录，停主机后只显示目录，查询/组卷/导出均拒绝；授权快照扫描不到题目字段和文件。

- [ ] **Step 11：保存可复核证据**

每次运行写入 `output/business-e2e/<run-id>/`：

```text
versions.json
process-topology.json
migration-report.json
api-summary.json
command-receipts.json
device-state-transitions.json
permission-matrix.json
data-leak-assertions.json
screenshots/
run-report.json
```

写入前脱敏密码、token、私钥、PIN、手机号、openid、硬件原值和主机密钥。

- [ ] **Step 12：禁止源码字符串测试冒充 E2E**

`realIdentityDevicePermissionBusinessE2e.test.js` 必须启动主脚本并检查进程退出码、receipt、数据库断言和截图清单；只读取源码并 `includes()` 的测试不能计入发布门禁。

- [ ] **Step 13：运行**

Run: `npm run test:real-identity-device-permission-business`  
Expected: PASS；任何页面无真实接口、command 无 receipt、主机未落库、越权、串分区、题目泄漏或虚假截图清单都使退出码非零。

- [ ] **Step 14：提交**

```bash
git add scripts/realIdentityDevicePermissionBusinessE2e.js scripts/realIdentityDevicePermissionBusinessE2e.test.js scripts/fixtures/identity-device-business-fixture.js scripts/real-two-desktop-e2e.js package.json docs/verification-account-permission-device-v2.md
git commit -m "test: 增加账户权限设备真实业务验收"
```

### Task 22：备份、迁移、统一发布和回滚验证

**Files:**
- Modify: `scripts/release-matrix.js`
- Modify: `scripts/check_deploy_readiness.js`
- Modify: `scripts/check_miniapp_release.js`
- Modify: `scripts/verify-installed-primary-host-runtime.js`
- Modify: `docs/release-version-matrix.md`
- Modify: `docs/verification-account-permission-device-v2.md`

- [ ] **Step 1：建立发布前阻断清单**

数据主机、云 Backend 和 Gateway 分别备份数据库；导出旧 admin、空档案角色、重复联系方式、旧设备授权、pending challenge、孤儿 grant/lease、单账户 sync device、学校别名冲突。任一 unresolved P0 阻止发布。

- [ ] **Step 2：在副本预演迁移**

运行账户/档案、设备、管理员、学校和资产迁移两次；比较业务 ID、记录数、外键、审计、题库 authority binding 和 host epoch。预演不得触碰正式数据库或移动硬盘题库目录。

- [ ] **Step 3：运行完整测试门禁**

Run:

```bash
npm test
npm run typecheck
npm run test:authority-architecture
npm run test:desktop-identity
npm run test:real-identity-device-permission-business
npm --prefix miniapp run ci:weapp
npm run test:release-matrix
```

Expected: 全部 PASS；原有依赖旧审批语义的测试必须已重写或明确迁移，不能简单删除覆盖率。

- [ ] **Step 4：按兼容顺序部署**

```text
兼容云 Backend/Gateway
  -> 数据主机备份和迁移向导
  -> 数据主机真实设备/题库/权限验收
  -> 小程序开发版构建上传并核验
  -> 教学端 OSS 更新 feed
  -> 观察迁移成功率
  -> 开启旧普通设备路由 410
```

- [ ] **Step 5：数据主机真实验收**

核验 host epoch、主机私钥、题库盘、账户中心、设备风险中心、档案审核、身份认领、家庭权限、学校治理、投影签名、设备 registration receipt、snapshot receipt 和审计截图。

- [ ] **Step 6：阿里云真实验收**

核验公网/内网健康、限速、WebSocket、中继、bootstrap token 隔离、receipt 校验、设备撤销、410 旧接口、日志脱敏；确认云端没有全量业务库、客户端私钥和硬件原值。

- [ ] **Step 7：微信小程序真实验收**

核验 visitor/teacher/student/family、角色申请、身份认领、共享课表、个人/家庭资产、题库在线/缓存目录、无权限和离线状态。上传成功不等于审核发布。

- [ ] **Step 8：构建和发布桌面端**

Run:

```bash
npm run dist:win:host
npm run dist:win
npm run publish:desktop-host-update
npm run publish:desktop-update
npm run rebuild:node
npm run verify:electron-native-abi
```

Expected: host/client 安装包、latest.yml、OSS feed 和 native ABI 校验全部通过。

- [ ] **Step 9：更新版本矩阵和回滚点**

记录云端版本、数据主机版本、schema version、小程序上传版本、桌面 feed 版本、迁移完成率和证据目录。任一适用端未完成只能标记“部分发布”或“受阻”。

- [ ] **Step 10：最终提交和推送**

```bash
git status --short
git add scripts/release-matrix.js scripts/check_deploy_readiness.js scripts/check_miniapp_release.js scripts/verify-installed-primary-host-runtime.js docs/verification/account-permission-device-trust-rollout.md docs/release-version-matrix.md docs/verification-account-permission-device-v2.md
git commit -m "release: 发布账户权限与持久设备信任架构"
git push gewu master
```

执行前必须确认前述各 Task 已分别提交，且上述显式路径之外的改动均为用户或其他任务所有；不得用 `git add -A` 混入无关工作树内容。

只有四端证据齐全、真实业务 E2E 通过且 Node native 环境恢复后才能执行并宣称发布完成。

## 9. 真实入口—接口—权威结果—业务测试映射

| 功能 | 真实用户入口 | 正式接口/命令 | 权威结果 | 必须通过的真实验收 |
| --- | --- | --- | --- | --- |
| 无账户排课档案 | StudentList/TeacherList | `profile.unclaimed.create` | teachers/students，无 account binding | 可排课但不能登录 |
| 教师注册 | 教学端身份门 | account register | user/credential/teacher intent/claim | 注册后课程仍 403 |
| 档案候选刷新 | 主机账户中心 | refresh matches command | 候选证据和冲突 | 多候选 UI/API 都禁批 |
| 档案批准 | 主机账户中心 | approve command | profile binding/audit/receipt | receipt 后才开放 scope |
| 微信身份认领 | 小程序＋主机账户中心 | identity claim command | account identity/audit | 批准前不能进入目标账户 |
| 额外权限 | 主机权限编辑器 | access override command | capability/scope/version | 高亮且高危能力不可授予 |
| 家庭关系 | 主机家庭页 | household command | membership/scope | 小程序只见共享范围 |
| 首次新设备 | 教学端身份门自动流程 | device registration command | device/install/link receipt | 无人工审批，主机离线不放行 |
| 卸载重装同设备 | 教学端重新登录 | anchor proof＋registration | 同 device、新 installation | CNG anchor 保留时稳定识别 |
| 锚丢失重装 | 教学端重新登录 | hardware evidence host command | reinstall candidate/audit | 重新认证，不继承本地草稿 |
| 克隆阻断 | 自动＋主机风险中心 | risk resolve command | blocked/revoke receipt | 复制 vault 不能直接使用 |
| 同机多账户 | 教学端账户切换器 | account-device link | 一 device、多 links | 分区、PIN、快照、草稿隔离 |
| 撤销单账户 | 本人设备页/主机中心 | link revoke | 单 link/session/license revoked | 同设备其他账户正常 |
| 撤销整台设备 | 主机风险中心 | device revoke | device/all links revoked | 全账户失效并留审计 |
| 30天离线 | 教学端离线身份门 | host signed offline license | 本地许可 | 29天可用，30天锁定保草稿 |
| 首次授权数据 | 初始化页 | snapshot manifest/chunks/commit | 原子快照/receipt | 全历史授权范围且无题库 |
| 权限收缩 | 自动初始化页 | replacement snapshot | 新 active snapshot/quarantine | 越权行消失，草稿不丢 |
| 学校归一 | 主机学校别名页 | canonicalization command | canonical/alias/business IDs | 两端统一且保留 raw |
| 题库目录 | 桌面/小程序题库页 | catalog API | 签名只读缓存 | 离线只看目录 |
| 题库使用 | 在线题库页 | question API/host task | 数据主机题库结果 | 主机/题库盘不可用即拒绝 |
| 家庭资产 | 小程序家庭资产页 | household asset API | household-owned records | 汇总/明细/写入严格分离 |
| 旧管理员迁移 | 主机迁移向导 | migration command | 新角色/关系/能力 | 无决定则 restricted |
| 主机迁移恢复 | 主机安全中心 | primary-host routes | host epoch/credential receipt | 普通设备自动注册不能替代 |

任何一行缺少真实可达页面、后端鉴权、数据主机权威事务、最终 receipt 或真实业务测试，都不能标记完成。

## 10. 设备安全不变量

1. 账户密码/微信身份只证明人，设备锚只证明持有原设备环境，安装密钥只证明当前安装；三者不得互相替代。
2. hardware fingerprint 永远不能单独签发 session、link、offline license 或业务 scope。
3. TPM/CNG 私钥、安装私钥、账户数据密钥、PIN、主机私钥不得进入 Renderer、日志、审计、云数据库或测试证据。
4. software fallback 不保证卸载清数据后仍可识别；这种情况只能依赖硬件候选并重新在线认证。
5. “同一设备”按当前 Windows 用户＋设备锚定义；切换 Windows 系统用户默认视为新的设备环境。
6. 一台 trusted device 可以有多个 account-device links；一个账户也可以有多台设备。
7. 设备全局撤销和账户 link 撤销是两个不同命令，不得复用含糊的 `revokeDevice`。
8. installation 未 active、link 未 active、account-installation state 未 active、profile binding 缺失或 snapshot 未 committed 时，不能进入业务工作台。
9. 数据主机身份、迁移和恢复永远不走普通设备自动登记分支。
10. 离线许可固定最长30天，不滑动；高危操作、同步和题库永远需要在线短会话。
11. 旧 pending approval 不继承信任；旧 active authorization 也必须在线证明后才能迁移。
12. 客户端请求中的 user/role/device/installation/teacher/student/owner/scope 全部由服务端签名上下文覆盖。

## 11. 执行阶段和回滚边界

1. **身份权限基础：Task 1–6。** 新表双写/双读，建立真实账户中心，旧字段尚不删除。
2. **设备信任核心：Task 7–14。** 先上线 V2 表和客户端能力，再开放静默登记、重装识别、离线许可和风险中心。
3. **迁移和授权数据：Task 15–16。** 旧设备在线迁移，全量快照成为业务门禁，旧审批开始 410。
4. **业务治理：Task 17–20。** 学校、题库、家庭资产、小程序和旧管理员完成。
5. **验收发布：Task 21–22。** 真实多进程 E2E、备份、四端部署、版本矩阵和回滚证据。

回滚时只回滚代码路径，不删除已经创建的新表、device/link/profile binding、receipt、审计或迁移账本。V2 已迁移账户不得静默降级回无范围约束的旧设备授权。

## 12. 计划自检门禁

- 规格覆盖：账户、档案、默认角色、家庭关系、细粒度能力、数据范围、设备持久锚、安装实例、同机多账户、重装、克隆、撤销、30天离线、全量快照、题库、学校和资产均有独立 Task。
- 设备覆盖：旧表、旧路由、旧 UI、旧 vault、Gateway 唯一约束、sync owner、outbox 和旧测试均有迁移/退役路径。
- 入口覆盖：普通设备不再有审批入口；真正风险阻断有数据主机处置入口和 receipt；设备本人撤销与全局撤销入口分离。
- 数据覆盖：账户本地分区、association、scope/access version 和 snapshot commit 同时成为业务门禁。
- 测试覆盖：单元、真实 SQLite HTTP、Windows CNG、Electron 多账户、重装、克隆、30天时钟、跨端权限和真实打包应用分层存在。
- 发布覆盖：云、数据主机、小程序、教学端 OSS feed 和 native ABI 均有证据；任一失败不宣称完整发布。



























