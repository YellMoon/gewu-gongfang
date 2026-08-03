# 账户、权限、教师注册与持久设备信任重构最终 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把账户、角色、教师/学生档案、教学端注册自动建档、精确候选匹配、家庭关系、细粒度能力、数据范围、普通桌面设备、30 天离线访问、授权数据副本、题库、学校和家庭资产统一为一套由数据主机最终授权、卸载重装可安全识别、所有入口真实可达且具有真实业务端到端证据的多端架构。

**Architecture:** `users`、`teachers/students`、基础角色、档案绑定、注册解析状态、家庭关系、能力、数据范围、可信设备、安装实例和账户设备关联分别建模。教学端注册是可重试的跨控制面流程：云端创建账户与已验证联系方式，数据主机在权威事务中精确查重，零候选时自动创建并绑定教师档案，有候选时只创建匹配申请；只有收到数据主机 receipt 才显示注册完成。普通桌面以 Windows 持久设备锚证明“同一 Windows 设备环境”，以安装 Ed25519 密钥证明“当前安装实例”，以签名权限上下文驱动本地路由，以服务端中间件对每次 API 统一鉴权；云端只认证、中继和保存控制面镜像，不成为权威业务库。

**Tech Stack:** Electron 28、React 18、TypeScript 4.9、Ant Design 5、Node.js、Express、SQLite/better-sqlite3、WebSocket、Taro 3/微信小程序、Windows CNG/TPM、PowerShell/.NET CNG bridge、Electron safeStorage、Ed25519、Playwright。

---

## 0. 替代关系和执行边界

- 本计划同时替代 `docs/superpowers/plans/2026-08-02-account-role-device-data-rearchitecture.md` 和 `docs/superpowers/plans/2026-08-02-account-permission-device-trust-rearchitecture-v2.md`，前两版仅作讨论和审计记录，不再作为执行基准。
- 本计划替代普通桌面“微信扫码、等待另一设备/超级管理员批准、激活设备”的流程；数据主机 bootstrap、主机迁移、主机损坏恢复和 host epoch 安全流程不取消。
- 本轮规划不实施代码。执行时每个 Task 必须先写失败测试，再实现，再验证，再提交；任何测试未通过不得继续发布步骤。
- 工作区现有未提交内容属于用户，不得清理、回退或覆盖。实现阶段先用独立 worktree/`codex/account-permission-device-trust` 分支记录基线 `git status --short`，每个 Task 只提交其显式文件；Task 1–21 的提交是可审查检查点，不单独部署或发布不完整版本，统一发布只在 Task 22 的兼容矩阵和真实验收通过后进行。

## 1. 最终业务结论

### 1.1 账户、角色和档案

- 不使用备用账户 ID。`users.id`、`teachers.id`、`students.id` 都是不可替换主体 ID，只有关系记录可新增、撤销或替换。
- 超级管理员和已绑定老师可在数据主机/教学端创建没有账户、没有设备的教师或学生档案，档案可立即排课。
- 教学端允许未登录用户注册。注册固定获得 `teacher` 基础角色；数据主机未发现精确联系方式候选时，在同一权威事务中自动创建教师档案、建立活动绑定和默认数据范围，receipt 返回后注册即完成，无需超级管理员批准。
- 若数据主机发现一个或多个精确联系方式候选，教学端不得创建重复档案，只创建档案匹配申请并显示真实审核进度；超级管理员在数据主机账户中心处理。已验证手机号或微信 provider identity 的精确证据可在无底层冲突时批准；手工填写微信号的精确一致只负责阻止重复建档，必须补充可验证证据后才能批准。姓名、拼音、学校等模糊相似只用于排序和提示，不能单独阻止自动建档，也不能作为批准依据。
- 小程序可选择 teacher、student 或仅个人/家庭用途；仅个人/家庭用途不写正式角色 grant，effective role 为 `visitor`。小程序 teacher/student 继续走档案申请，不复用教学端“零候选自动建档”特权。
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

- 数据主机 UI 只允许 `super_admin`。教学工作端的身份区允许未登录用户和处于注册解析中的账户访问；正常注册完成后已经具有活动 teacher 档案绑定，可进入所有符合 teacher 默认 capability、数据范围及在线条件的业务页面。存在精确候选而待匹配的账户只能访问身份区。小程序允许所有账户登录。
- 档案审核、账户身份审核、权限规则、主机迁移恢复、学校规范名治理、题库体系修改、备份恢复不可委派。
- “模块授权”只是 UI 分组，落库必须是具体 capability、surface、scope、reason、expires_at 和审计。

### 1.2.1 教学端身份区、业务页面和统一鉴权

- “今日工作台”只代表 `PageKey='today'` 的首页，不代表整个教学端，也不是其他页面的前置页面。
- `DesktopIdentityGate` 只负责注册、登录、候选匹配状态、设备初始化、快照初始化、离线解锁和账户切换；满足启动条件后加载业务应用。
- 正常教学端注册只有在账户、teacher 角色、教师档案、活动绑定、默认范围和主机 receipt 全部完成后才返回 `registration_state='completed'`。云端账户已创建但主机尚未处理时只能称为“账户已创建，教师注册待完成”。
- 页面不逐页联网查询 `user_id/teacher_id`。登录、注册完成或权限刷新时一次性加载签名 `AccessContext`；中央路由守卫读取内存缓存的 capability/surface/scope 判断导航和直达路由。
- 每个 API 请求仍必须由服务端统一验证 session、账户、角色、档案绑定、设备/安装状态、capability、scope 和版本。客户端提交的 `user_id/teacher_id/student_id/owner_id/device_id/authority_id/scope` 不能成为授权依据，必须被服务端上下文覆盖或拒绝。
- 离线时由本地主进程验证签名离线许可并只打开当前账户加密分区；页面仍通过统一数据 facade 读取授权快照，不直接选择本地身份或分区。

### 1.3 设备的四层身份

| 层 | 标识/密钥 | 生命周期 | 作用 |
| --- | --- | --- | --- |
| 设备锚 | CNG/TPM 非导出密钥及 `anchor_fingerprint` | 跨软件卸载重装；清 TPM/换主板/主动清除后失效 | 证明同一 Windows 用户＋设备安全环境 |
| 安装实例 | `installation_id`＋Ed25519 安装密钥 | 每次安装生成；应用数据清除后变化 | 证明当前安装实例，签桌面会话和命令 |
| 账户设备关联 | `user_id + device_id` | 登录后创建，可单独撤销 | 表示某账户允许在某设备使用 |
| 账户本地分区 | `partition_id`＋独立数据密钥＋本地解锁因子 | 每账户独立 | 隔离缓存、草稿、快照和离线许可 |

- 私钥全部留在客户端或数据主机本地；云端和数据主机数据库只保存客户端公钥、指纹和状态。
- TPM 可用时使用 `Microsoft Platform Crypto Provider`；不可用时降级为 Windows Software KSP 的非导出持久键。两者都失败时依次使用 Windows Credential Manager/DPAPI 软件锚和 safeStorage 文件兜底，并明确标记 `software_fallback` 及具体存储风险等级。
- 硬件原始字段不写日志、不上传云数据库。客户端经端到端 host command 把一次性采样送达数据主机；主机以 authority 专属 HMAC 生成组件 token，只持久化 token 和匹配结果。
- 设备名称、操作系统、应用版本、SMBIOS UUID、主板/BIOS 序列号、系统盘和网络信息只用于展示和风险判断，永远不能独立证明账户或授予权限。

### 1.4 新设备、重装和同机多账户

```text
账户在线认证；注册路径先完成教师档案自动建档绑定或原档案匹配
  -> 创建 bootstrap-only token（只可初始化，不能访问业务 API）
  -> 打开/创建设备锚
  -> 创建 installation_id 和安装密钥
  -> 数据主机比较设备锚与硬件 token
  -> same_device | reinstall_candidate | new_device | risk_blocked
  -> 创建/恢复 account-device link，并返回 host receipt
  -> 创建账户本地分区并设置本地 PIN
  -> 签发仅可拉取初始化数据的 initialization session
  -> 下载、验签并原子提交全量授权结构化快照
  -> 缓存签名 AccessContext；签发正式在线 session 和最长 30 天离线许可
  -> snapshot_ready 后加载符合权限的教学业务页面
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

## 3. 最终核心表和唯一性

以下是执行时必须保持一致的最小字段；迁移可增加审计字段，但不得改变语义。

```sql
CREATE TABLE teacher_registration_attempts (
  attempt_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN (
    'account_created','host_pending','auto_profile_created',
    'profile_match_pending','profile_conflict','resolving_after_review',
    'completed','rejected','expired'
  )),
  contact_set_hash TEXT NOT NULL,
  host_command_id TEXT,
  host_receipt_id TEXT,
  teacher_id TEXT,
  profile_claim_id TEXT,
  idempotency_key TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(authority_id,user_id,idempotency_key)
);

CREATE TABLE authority_profile_claims (
  claim_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  requested_role TEXT NOT NULL CHECK(requested_role IN ('teacher','student')),
  source TEXT NOT NULL CHECK(source IN ('desktop_teacher_registration','miniapp_application','manual_claim')),
  state TEXT NOT NULL CHECK(state IN (
    'resolving','auto_created','profile_match_required','conflict','bound','rejected','expired'
  )),
  selected_profile_id TEXT,
  host_receipt_id TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE profile_claim_match_candidates (
  candidate_id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  profile_type TEXT NOT NULL CHECK(profile_type IN ('teacher','student')),
  profile_id TEXT NOT NULL,
  match_kind TEXT NOT NULL CHECK(match_kind IN ('exact_verified_contact','rank_only')),
  contact_type TEXT,
  contact_token TEXT,
  rank_metadata_json TEXT NOT NULL,
  profile_row_version INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  FOREIGN KEY(claim_id) REFERENCES authority_profile_claims(claim_id)
);
CREATE UNIQUE INDEX idx_profile_claim_candidate
  ON profile_claim_match_candidates(claim_id,profile_type,profile_id,match_kind);

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
    CHECK(status IN ('pending_host','active','blocked','replaced','revoked')),
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
    CHECK(business_state IN (
      'onboarding','profile_match_required','snapshot_required',
      'snapshot_downloading','active','offline_locked','revoked'
    )),
  access_version INTEGER NOT NULL,
  capability_hash TEXT,
  scope_hash TEXT,
  context_hash TEXT,
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
  context_hash TEXT NOT NULL,
  snapshot_version INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','expired','revoked')),
  CHECK(julianday(expires_at) > julianday(issued_at)),
  CHECK(julianday(expires_at) <= julianday(issued_at, '+30 days')),
  signature TEXT NOT NULL,
  FOREIGN KEY(account_device_link_id) REFERENCES account_device_links(account_device_link_id),
  FOREIGN KEY(account_installation_state_id) REFERENCES account_installation_states(account_installation_state_id),
  FOREIGN KEY(installation_id) REFERENCES device_installations(installation_id)
);
CREATE UNIQUE INDEX idx_offline_license_one_active
  ON offline_access_licenses(authority_id,user_id,installation_id)
  WHERE status='active';
```

数据主机另建 `device_fingerprint_observations`，只保存 authority-HMAC 后的组件 token、质量、观察时间和比较结果；云端只保存最终 `risk_state/risk_evidence_json`，不保存硬件原值。

所有激活状态必须在同一数据主机事务内核对一致性：`account_installation_states.user/device/installation/link` 必须指向同一 authority；installation 必须属于该 device，link 必须属于该 user＋device；`profile_binding_id` 必须是该 user 的 active teacher binding；snapshot 的 user、binding、access/capability/scope hash 必须与 AccessContext 相同。通过复合唯一键＋外键（SQLite 不足处用事务内断言和触发器）阻止交叉拼接。只有 snapshot receipt 已提交、状态为 `active` 且哈希一致时才能创建一条 active offline license；替换快照或提升版本时在同一事务撤销旧许可。

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
  -> identity_shell
  -> account_registering | account_authenticating
  -> teacher_profile_resolving | bootstrap_authenticated
  -> profile_match_pending | bootstrap_authenticated
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
- `TEACHER_REGISTRATION_HOST_PENDING`：账户已创建但数据主机尚未完成教师注册解析。
- `PROFILE_MATCH_REVIEW_REQUIRED`：存在已验证手机号或微信身份的精确未绑定候选，必须匹配原档案。
- `PROFILE_MATCH_CONFLICT`：候选已绑定、联系方式归属或底层字段冲突，禁止批准。
- `PROFILE_MATCH_EVIDENCE_REQUIRED`：只有手工微信号等未验证精确证据，需补证或判定非同一人。
- `ACCESS_CONTEXT_STALE`：签名权限上下文版本或哈希过期，必须原子刷新。
- `PAGE_ACCESS_DENIED`：当前 surface、能力或 scope 不允许访问该页面。
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
| 教师注册 | 教学端身份门 | `POST /api/account-sessions/register` | account＋registration attempt；不能提前显示完成 |
| 自动解析档案 | 身份门自动执行 | host `teacher-registration.resolve.v1` | 零精确候选时 teacher profile＋binding＋role/scope receipt |
| 申请匹配原档案 | 身份门候选状态页 | 自动创建 claim；用户确认联系方式 | profile claim；不创建重复 profile |
| 审核档案匹配 | 数据主机账户与权限中心 | `profile-claim.refresh-matches.v1` / `approve-existing.v1` | binding＋access version＋receipt |
| 合并重复档案 | 数据主机档案匹配页 | `profile-merge.preview.v1` / `profile-merge.apply.v1` | 冲突清单；事务迁移引用＋保留档案＋审计 receipt |
| 账号登录 | 教学端身份门 | `POST /api/account-sessions/login` | bootstrap token；不含业务数据 |
| 加载权限上下文 | 身份门/权限刷新 | `GET /api/account-sessions/context` | 签名 AccessContext；路由不逐页查 ID |
| 访问业务页面 | 侧栏、首页卡片或直接 page key | 中央 route manifest＋业务 API | 本地路由判断；服务端每次请求再鉴权 |
| 静默设备登记 | 身份门自动执行 | `POST /api/device-registrations`＋host command | device/install/link receipt |
| 等待主机 | 身份门状态页 | `GET /api/device-registrations/:id` | pending/receipt/reject |
| 同机第二账户 | 账户切换器 | `POST /api/account-device-links` | 新 link，不覆盖旧 link |
| 首次数据 | 初始化页 | snapshot manifest/chunks | 原子授权快照＋snapshot receipt |
| 获取/续签离线许可 | 身份门在线状态 | `POST /api/account-sessions/offline-license` | 主机签名 30 天许可＋receipt；旧 active 许可失效 |
| 查看本人设备 | 教学端账户菜单 | `GET /api/me/devices` | 当前账户 link 范围 |
| 查看全局设备风险 | 数据主机设备与风险中心 | host access API | trusted device、installation、link、风险审计 |
| 撤销账户关联 | 本人设备页/主机中心 | `POST /api/account-device-links/:id/revoke` | link revoked＋会话失效 |
| 撤销整台设备 | 主机设备与风险中心 | `POST /api/trusted-devices/:id/revoke` | device/install/all links revoked |
| 处理风险阻断 | 主机设备与风险中心 | host `device-risk.resolve.v1` | receipt；不能只改 UI 状态 |
| 主机迁移恢复 | 主机安全中心 | 现有 primary-host routes | host epoch/credential receipt |

所有 `*.http.test.js` 必须从正式 `backend createApp()` 或 Gateway app 启动后请求已挂载 URL，并穿过真实 auth/permission/relay middleware；直接实例化 router、直接调用 service 或 mock 写数据库只能算单元测试，不能证明入口可达。所有 host command E2E 必须经过 registry→relay/inbox→processor→receipt 消费完整链路。

### 6.1 签名权限上下文契约

注册完成、登录、切换账户、权限刷新和离线解锁只在边界处构造一次权限上下文；页面不能自行拼装：

```ts
type AccessContext = Readonly<{
  tokenUse: 'desktop-session' | 'desktop-initialization-session' | 'offline-access';
  userId: string;
  authorityId: string;
  hostEpoch: number;
  activeRole: 'super_admin' | 'teacher' | 'student' | 'visitor';
  surface: 'primary-host' | 'desktop-client' | 'miniapp';
  profileBinding: null | { type: 'teacher' | 'student'; id: string; bindingId: string };
  capabilities: readonly string[];
  scopes: readonly { type: string; ids: readonly string[] }[];
  authVersion: number;
  accessVersion: number;
  credentialVersion: number;
  capabilityHash: string;
  scopeHash: string;
  contextHash: string;
  deviceId: string | null;
  installationId: string | null;
  accountInstallationStateId: string | null;
  snapshotVersion: number | null;
  snapshotHash: string | null;
  issuedAt: string;
  expiresAt: string;
}>;
```

- 在线上下文来自服务端签名 session；Electron main 验签并通过只读 preload API 暴露规范字段，Renderer 不接触私钥和原始令牌。
- 离线上下文来自主机签名 offline license＋已提交 snapshot manifest；两者的 user/device/installation/binding/version/hash 必须一致。
- `AppShell`、首页卡片和直接导航共用一个 page access manifest；上下文变化时一次性重新计算导航。不得让每个页面各自请求 `/me` 或查询绑定。
- 页面本地允许只是体验门禁。所有业务 HTTP/host command 仍在服务端重新计算/验证有效权限，并把 actor 和 owner 字段替换为服务端上下文。
- `auth_version/access_version/credential_version` 变化、账户切换、link/device 撤销或 snapshot 被替换时，中央 store 原子失效；当前页无权后跳转到稳定的无权限页，不泄漏旧页面缓存。

### 6.2 教学端页面能力清单

`shared/pageAccessManifest.js` 必须覆盖 `src/navigation/appNavigation.tsx` 的每一个 `PageKey`；新增页面未登记时测试和应用启动都失败。以下是最终默认值，额外授权只能在 surface 上界内生效：

| PageKey | 页面 | surface | 所需能力/处理 |
| --- | --- | --- | --- |
| `today` | 今日工作台 | host、teacher desktop | `dashboard.read`；只是普通首页 |
| `course-calendar` | 课程表 | host、teacher desktop | `schedule.read`；编辑另查 `schedule.write` |
| `schedule-list` | 排课列表 | host、teacher desktop | `schedule.read`；写入另查 `schedule.write` |
| `course-info` | 课程信息 | host、teacher desktop | `course.read`；写入另查 `course.write` |
| `student` | 学生档案 | host、teacher desktop | `profile.student.read`；新建未绑定档案另查 `profile.unclaimed.create` |
| `teacher` | 老师档案 | host、teacher desktop | `profile.teacher.read`；新建未绑定档案另查 `profile.unclaimed.create` |
| `school` | 学校 | host、teacher desktop | teacher 默认 `resource.school.read`；规范名治理仅 host `school.canonical.manage` |
| `address` | 上课地址 | host、teacher desktop | `resource.location.read`；写入另查 `resource.location.write`，写入受 teacher scope 限制 |
| `institution` | 机构 | host、teacher desktop | `resource.institution.read`；写入另查 `resource.institution.write`，写入受 teacher scope 限制 |
| `payment` | 缴费 | host、teacher desktop | `finance.payment.read`＋本人课程范围；写入另查 `finance.payment.write` |
| `revenue-statistics` | 费用统计 | host、teacher desktop | `finance.statistics.read`＋本人课程范围 |
| `personal-assets` | 个人资产 | host、teacher desktop | `asset.personal.read`；写入另查 `asset.personal.write`，导出另查 `asset.personal.export`，owner 强制为当前 user |
| `question-bank-tools` | 题库工具 | host、teacher desktop | 打开需 `question.online.use`；导入、体系管理按钮分别二次检查 |
| `question-bank-preview` | 试题库 | host、teacher desktop | `question.online.use`；必须主机和题库盘在线 |
| `question-bank-paper` | 组卷 | host、teacher desktop | `question.paper.compose`；导出另查 `question.export` |
| `question-bank-import` | 试题导入 | host 或获额外授权的 teacher desktop | `question.content.import`＋在线主机任务 |
| `question-bank-edit` | 试题编辑 | host 或获额外授权的 teacher desktop | `question.content.write`＋在线主机任务 |
| `question-bank-audit` | 题库审核 | primary host | `question.audit`，不可作为 teacher 默认能力 |
| `my-devices` | 本人设备 | teacher desktop | `device.self.read`；撤销另查 `device.self.revoke`，只返回当前账户 link |
| `device-risk` | 设备与风险中心 | primary host | `device.risk.resolve`，不可委派 |
| `identity-devices` | 主机安全中心 | primary host | `host.manage`；只处理 primary-host bootstrap/transfer/recover/epoch |
| `quarantined-drafts` | 隔离草稿 | teacher desktop | `draft.quarantine.read`；导出另查 `draft.quarantine.export`，仅当前账户分区 |
| `cloud-sync` | 同步确认 | teacher desktop | `sync.review`；必须由用户确认后提交 outbox |
| `permission` | 账户与权限 | primary host | `access.manage`，不可委派 |
| `system-params` | 系统参数 | primary host | `host.settings.manage`，不可委派 |
| `operate-log` | 操作日志 | primary host | `audit.read`；普通老师只在本人设备页看自己的安全事件 |

默认 teacher capability bundle 必须与上表一致；隐藏入口和禁用按钮不能代替 API 鉴权。页面内混合多个操作时，每个按钮和对应 API 分别检查能力，不能因为页面可打开就默认页面内全部可写。
## 7. 文件职责边界

- `shared/accessModel.js`：角色、surface、capability、scope、teacher 默认组合和不可委派能力。
- `shared/signedAccessContextProtocol.js`：AccessContext canonical payload、签名、哈希、版本和在线/离线验证规则。
- `shared/teacherRegistrationProtocol.js`：教学端注册 attempt、状态转换、完成不变量和稳定错误码。
- `shared/pageAccessManifest.js`：全部 PageKey 的 surface、页面读取能力和页面内动作能力。
- `backend/src/services/teacherRegistrationService.js`：零精确候选自动建档绑定与候选 claim 的数据主机权威事务。
- `backend/src/services/profileMergeService.js`：重复教师档案的预检、冲突阻断、引用迁移、保留档案和审计 receipt。
- `backend/src/services/businessRouteAccessManifest.js`：全部业务 API/command 的 capability、scope、owner 和在线要求。
- `src/services/desktopAccessContext.mjs`：一次加载、只读订阅和原子失效的桌面权限上下文。
- `src/components/PageAccessBoundary.tsx`：侧栏、首页卡片和直接 page key 共用的体验门禁；不替代后端鉴权。
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


### Task 1：冻结账户—角色—档案—页面能力与注册状态契约

**Files:**
- Create: `shared/accessModel.js`
- Create: `shared/profileBindingProtocol.js`
- Create: `shared/teacherRegistrationProtocol.js`
- Create: `shared/signedAccessContextProtocol.js`
- Create: `shared/pageAccessManifest.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Test: `backend/src/services/accessSchemaContract.test.js`
- Test: `backend/src/services/accountRoleProfileMigration.test.js`
- Test: `shared/pageAccessManifest.test.js`
- Test: `shared/teacherRegistrationProtocol.test.js`
- Test: `shared/signedAccessContextProtocol.test.js`

- [ ] **Step 1：写身份区、业务区和注册完成条件失败测试**

```js
assert.deepStrictEqual(ACCESS_ROLES, ['super_admin', 'teacher', 'student']);
assert.strictEqual(resolveActiveRole([]), 'visitor');
assert.strictEqual(resolveSurfaceAccess({ surface: 'desktop-client', zone: 'identity' }).allowed, true);
assert.strictEqual(resolveSurfaceAccess({
  surface: 'desktop-client', zone: 'business', role: 'teacher', profileBinding: null
}).allowed, false);
assert.strictEqual(resolveSurfaceAccess({
  surface: 'desktop-client', zone: 'business', role: 'teacher',
  profileBinding: { type: 'teacher', id: 't-1' }
}).allowed, true);
assert.throws(() => normalizeTeacherRegistration({
  state: 'completed', teacherId: null, profileBindingId: null, hostReceiptId: null
}), /TEACHER_REGISTRATION_COMPLETION_INVALID/);
```

- [ ] **Step 2：运行并确认失败原因正确**

Run: `node backend/src/services/accessSchemaContract.test.js && node shared/teacherRegistrationProtocol.test.js`  
Expected: FAIL，原因是 zone 和注册协议尚不存在，而不是模块加载或语法错误。

- [ ] **Step 3：实现 capability 目录和 teacher 默认组合**

```js
const ACCESS_ROLES = Object.freeze(['super_admin', 'teacher', 'student']);
const EFFECTIVE_ROLES = Object.freeze([...ACCESS_ROLES, 'visitor']);
const SURFACES = Object.freeze(['primary-host', 'desktop-client', 'miniapp']);
const NON_DELEGABLE = Object.freeze([
  'profile.review', 'identity.review', 'access.manage', 'device.risk.resolve',
  'host.manage', 'host.settings.manage', 'school.canonical.manage',
  'question.taxonomy.manage', 'question.audit', 'audit.read', 'backup.manage'
]);
const VISITOR_MINIAPP_DEFAULTS = Object.freeze([
  'account.self.read', 'asset.personal.read', 'asset.personal.write', 'asset.personal.export'
]);
const STUDENT_MINIAPP_DEFAULTS = Object.freeze([
  'account.self.read', 'schedule.read',
  'asset.personal.read', 'asset.personal.write', 'asset.personal.export'
]);
const TEACHER_DEFAULTS = Object.freeze([
  'dashboard.read', 'schedule.read', 'schedule.write', 'course.read', 'course.write',
  'profile.student.read', 'profile.teacher.read', 'profile.unclaimed.create',
  'resource.school.read', 'resource.location.read', 'resource.location.write',
  'resource.institution.read', 'resource.institution.write',
  'finance.payment.read', 'finance.payment.write', 'finance.statistics.read',
  'asset.personal.read', 'asset.personal.write', 'asset.personal.export',
  'question.online.use', 'question.paper.compose', 'question.export',
  'sync.review', 'device.self.read', 'device.self.revoke',
  'draft.quarantine.read', 'draft.quarantine.export'
]);
```

数据库拒绝目录外 capability；不可委派能力即使被手工写入 override 也不生效并产生安全审计。`question.content.import` 和 `question.content.write` 可以额外授予 teacher，但 `question.taxonomy.manage` 和 `question.audit` 只在 primary-host 生效。

- [ ] **Step 4：创建档案、联系方式、注册、权限覆盖和家庭关系表**

创建 `authority_profile_bindings`、`account_contact_points`、`profile_contact_points`、`teacher_registration_attempts`、`authority_profile_claims`、`profile_claim_match_candidates`、`authority_user_capability_overrides`、`authority_data_scope_grants`、`households`、`household_memberships`。每个 contact point 必须有 `contact_type/normalized_value_or_token/verification_state/verification_method/source/verified_at/verified_by/evidence_token/row_version`；验证码和明文 provider subject 不落库。claim 与 candidate 必须保存证据等级、不可逆 evidence token、候选 row version、冲突码、计算时间和最终处置。活动档案与注册幂等索引固定为：

```sql
CREATE UNIQUE INDEX idx_profile_binding_active_profile
ON authority_profile_bindings(authority_id,profile_type,profile_id)
WHERE status='active';
CREATE UNIQUE INDEX idx_profile_binding_active_user_role
ON authority_profile_bindings(authority_id,user_id,role)
WHERE status='active';
CREATE UNIQUE INDEX idx_teacher_registration_idempotency
ON teacher_registration_attempts(authority_id,user_id,idempotency_key);
```

只有 registration completed 状态必须同时具有 `teacher_id/profile_binding_id/host_receipt_id`；其他状态不得签业务 session。

- [ ] **Step 5：实现签名 AccessContext 和完整 PageKey manifest 契约**

`shared/signedAccessContextProtocol.js` 固定 canonical JSON、`context_hash`、签名算法、key id、有效期和 auth/access/credential/capability/scope/snapshot version 绑定；在线 session 与离线 license 共用字段验证但使用不同 `token_use`，字段缺失、重排后哈希不一致、旧 host epoch 或未知 key id 均拒绝。

`shared/pageAccessManifest.js` 登记全部 PageKey、surface、页面读取能力和页面内写能力。测试解析 `src/navigation/appNavigation.tsx` 的 PageKey union，与 manifest 做双向差集；任何新增页面未登记时 CI 失败。`today` 只需要 `dashboard.read`，不能成为其他页面父权限。

- [ ] **Step 6：迁移旧角色但不产生空档案放权**

旧 role binding 的 subject 存在且档案有效时迁移活动 binding；subject 为空时保留基础角色标签但 effective scope 为空并标记 `profile_resolution_required`。旧 admin 留给 Task 20 人工迁移。重复、悬空和跨类型引用写迁移报告并阻止切换。

- [ ] **Step 7：运行契约和迁移测试**

Run: `node backend/src/services/accessSchemaContract.test.js && node backend/src/services/accountRoleProfileMigration.test.js && node shared/pageAccessManifest.test.js && node shared/teacherRegistrationProtocol.test.js && node shared/signedAccessContextProtocol.test.js && npm run test:authority-architecture`  
Expected: PASS；重复迁移幂等，全部 PageKey 已登记，空 binding 不产生业务 scope。

- [ ] **Step 8：提交**

```bash
git add shared/accessModel.js shared/profileBindingProtocol.js shared/teacherRegistrationProtocol.js shared/signedAccessContextProtocol.js shared/pageAccessManifest.js backend/src/schema.sql backend/src/database.js backend/src/services/accessSchemaContract.test.js backend/src/services/accountRoleProfileMigration.test.js shared/pageAccessManifest.test.js shared/teacherRegistrationProtocol.test.js shared/signedAccessContextProtocol.test.js
git commit -m "feat: 冻结账户档案注册与页面权限契约"
```
### Task 2：实现未绑定排课档案、精确联系方式候选和主机审核闭环

**Files:**
- Create: `backend/src/services/profileContactService.js`
- Create: `backend/src/services/profileBindingService.js`
- Create: `backend/src/services/profileMergeService.js`
- Create: `backend/src/services/profileContactMigrationService.js`
- Create: `backend/src/routes/profileClaims.js`
- Create: `backend/src/routes/hostAccountAccess.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/identityProvisioningService.js`
- Modify: `backend/src/services/miniappApplicationReviewService.js`
- Modify: `backend/src/services/roleApplicationService.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityProjectionSourceService.js`
- Modify: `backend/src/routes/students.js`
- Modify: `backend/src/routes/teachers.js`
- Modify: `src/pages/StudentList.tsx`
- Modify: `src/pages/TeacherList.tsx`
- Test: `backend/src/services/profileContactService.test.js`
- Test: `backend/src/services/profileBindingService.test.js`
- Test: `backend/src/services/profileMergeService.test.js`
- Test: `backend/src/services/profileContactMigrationService.test.js`
- Test: `backend/src/services/identityProvisioningService.test.js`
- Test: `backend/src/routes/profileClaims.http.test.js`
- Test: `scripts/realUnclaimedProfileE2e.test.js`

- [ ] **Step 1：写候选分类、误匹配和并发批准失败测试**

```js
assert.deepStrictEqual(classifyMatches({
  verifiedAccountContacts: [{ type: 'phone', normalized: '13800000000' }],
  profiles: [{ id: 't1', name: '张伟', school: '一中', contacts: [] }]
}).blocking, []); // 同名同校不阻止自动建档
assert.deepStrictEqual(classifyMatches({
  verifiedAccountContacts: [{ type: 'phone', normalized: '13800000000' }],
  profiles: [{ id: 't1', contacts: [{ type: 'phone', normalized: '13800000000', active: true }] }]
}).blocking.map(x => x.profileId), ['t1']);
await assert.rejects(() => approveExisting({ claimId: 'c1', profileId: 't-used' }), {
  code: 'PROFILE_ALREADY_BOUND'
});
```

另测并发审批同一 claim 只有一个成功；候选在审批前被修改或绑定时必须 row_version/CAS 失败。

- [ ] **Step 2：实现可审计联系方式规范化**

账户手机号只接受验证码 proof；profile 侧手机号可来自原档案，但必须规范化并保存来源/更新时间。微信身份以 provider subject/unionid 的不可逆 authority token 比较，不把 openid 当人工微信号。人工微信号做 NFKC、trim、ASCII 小写：账户与 profile 精确相同时进入 `blockingUnverifiedExactEvidence`，阻止教学端自动建重复档案，但 `approvable=false`，必须通过绑定微信 provider、验证手机号或其他既有强证据升级后才能批准。姓名、拼音、学校和昵称只产生 `rankEvidence`，永不进入任何 blocking exact evidence。

- [ ] **Step 3：建立唯一 authority commands**

```js
[
  'profile.unclaimed.create.v1', 'profile-claim.submit.v1',
  'profile-claim.refresh-matches.v1', 'profile-claim.approve-existing.v1',
  'profile-claim.approve-create.v1', 'profile-claim.reject.v1',
  'profile-claim.request-evidence.v1',
  'profile-merge.preview.v1', 'profile-merge.apply.v1'
].forEach(type => registry.require(type));
```

`approve-create` 只服务于小程序/人工档案申请；教学端注册零候选必须由 Task 3 自动处理，不进入人工创建列表。若教学端被未验证精确证据阻断，超级管理员可 `request-evidence`；只有所有候选经证据重算均明确为 `not_match/invalid` 后，才转 Task 3 的 `teacher-registration.resolve-create-after-review.v1`，避免死锁并保留“曾命中精确候选”的审计。云端只保存 command inbox/镜像，只有数据主机处理器可写 profile、binding 和 receipt。

- [ ] **Step 4：迁移旧联系方式并保留证据等级**

把现有 `teachers.phone/students.phone` 和人工微信号迁入 profile contact points，状态一律为 `unverified_legacy`，保存来源表/主键/迁移批次，绝不伪造成 verified。按本计划的保守策略，旧文本与新账户输入精确一致时进入“阻止自动建重复档案但不可批准”的未验证候选；它必须可通过补证或全部判非后的注册续办收敛。迁移两次幂等，空值、占位号码、重复归属和跨 profile 同号进入报告，不覆盖原字段。

- [ ] **Step 5：实现无账户档案创建**

`StudentList`、`TeacherList` 通过真实 command 创建没有账户、角色、设备和 binding 的档案；服务端从 session 写 creator/authority/scope，忽略客户端 owner。档案立即可排课。老师默认可创建未绑定教师/学生档案，但只能在当前 authority 范围操作。

- [ ] **Step 6：收口现有 provisioning 和申请服务**

`identityProvisioningService` 不再按手机号自行“找到或创建并绑定”，只能调用新的 contact/binding 服务。`miniappApplicationReviewService`、`roleApplicationService` 复用相同候选分类、唯一索引、row_version、audit 和 receipt。删除三套不同匹配语义，并写旧入口不能绕过冲突检查的回归测试。

- [ ] **Step 7：实现主机人工审核和多候选收敛事务**

账户中心刷新时重新计算候选。批准已有档案执行 `BEGIN IMMEDIATE`，再检查 verified account contact、active profile contact、证据等级、现有 binding、row_version 和冲突，然后写 binding、递增 auth/access version、撤销旧 session/license、发布 projection 和 receipt。`blockingUnverifiedExactEvidence` 永远不能单独批准；UI/API 只能请求补证或标记非匹配。多个可批准精确候选必须选择并填写理由；未选候选记录为 `not_selected`，候选失效后不能静默自动合并。

若多个候选其实是重复档案，超级管理员先执行 `profile-merge.preview.v1`，预览所有课程、课表、学生关联、缴费、学校、附件、草稿和 binding 的引用迁移及字段冲突；任何两个非空且不等价的关键字段、双方已有不同 active binding、跨 authority 或未知引用都阻止 apply。`profile-merge.apply.v1` 在单一事务内重验 row_version，选择保留档案，迁移明确列出的外键，把重复档案标为 `merged` 并保存 `merged_into_profile_id`，写不可变 audit/receipt；事务失败零写入。合并完成后必须重新 refresh claim，不能把 merge 当作绑定批准。

- [ ] **Step 8：运行真实 HTTP、迁移、合并和排课测试**

Run: `node backend/src/services/profileContactService.test.js && node backend/src/services/profileBindingService.test.js && node backend/src/services/profileMergeService.test.js && node backend/src/services/profileContactMigrationService.test.js && node backend/src/services/identityProvisioningService.test.js && node backend/src/routes/profileClaims.http.test.js && node scripts/realUnclaimedProfileE2e.test.js`  
Expected: PASS；同名同校不误拦，精确联系方式产生候选，已绑定/并发冲突阻断；多候选可选定单一原档案或先安全合并后再绑定；无账户档案可真实排课。

- [ ] **Step 9：提交**

```bash
git add backend/src/services/profileContactService.js backend/src/services/profileBindingService.js backend/src/services/profileMergeService.js backend/src/services/profileContactMigrationService.js backend/src/routes/profileClaims.js backend/src/routes/hostAccountAccess.js backend/src/app.js backend/src/services/identityProvisioningService.js backend/src/services/miniappApplicationReviewService.js backend/src/services/roleApplicationService.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityProjectionSourceService.js backend/src/routes/students.js backend/src/routes/teachers.js src/pages/StudentList.tsx src/pages/TeacherList.tsx backend/src/services/profileContactService.test.js backend/src/services/profileBindingService.test.js backend/src/services/profileMergeService.test.js backend/src/services/profileContactMigrationService.test.js backend/src/services/identityProvisioningService.test.js backend/src/routes/profileClaims.http.test.js scripts/realUnclaimedProfileE2e.test.js
git commit -m "feat: 统一未绑定档案和精确候选审核"
```
### Task 3：实现教学端注册即自动建档绑定的可重试完整流程

**Files:**
- Create: `backend/src/services/accountCredentialService.js`
- Create: `backend/src/services/teacherRegistrationService.js`
- Create: `backend/src/routes/accountSessions.js`
- Create: `backend/src/routes/accountIdentityClaims.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/identityProvisioningService.js`
- Modify: `backend/src/services/miniappIdentityService.js`
- Modify: `backend/src/services/miniappApplicationService.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityHostCommandProcessor.js`
- Modify: `miniapp/src/pages/login/index.tsx`
- Modify: `src/components/DesktopIdentityGate.tsx`
- Modify: `src/services/desktopIdentityClient.mjs`
- Modify: `src/services/desktopIdentityError.mjs`
- Test: `backend/src/services/teacherRegistrationService.test.js`
- Test: `backend/src/routes/accountSessions.http.test.js`
- Test: `backend/src/routes/accountIdentityClaims.http.test.js`
- Test: `miniapp/src/utils/miniappAccountRegistration.test.js`
- Test: `src/components/DesktopTeacherRegistration.test.js`
- Test: `scripts/desktopTeacherRegistrationBusinessE2e.test.js`

- [ ] **Step 1：写零候选自动完成和精确候选暂停测试**

```js
const fresh = await registerTeacher({
  phone: '13800000000', phoneProof: verifiedProof, name: '新老师', idempotencyKey: 'r1'
});
assert.strictEqual(fresh.registrationState, 'completed');
assert.ok(fresh.teacherId);
assert.ok(fresh.profileBindingId);
assert.ok(fresh.hostReceiptId);
assert.strictEqual((await getSchedules(fresh.statusToken)).status, 403);
const ready = await initializeDevicePinAndSnapshot(fresh);
assert.strictEqual((await getSchedules(ready.desktopSession)).status, 200);

const matched = await registerTeacher({
  phone: '13900000000', phoneProof: matchedProof, name: '已有老师', idempotencyKey: 'r2'
});
assert.strictEqual(matched.registrationState, 'profile_match_pending');
assert.strictEqual(matched.teacherId, null);
assert.strictEqual((await getSchedules(matched.statusToken)).status, 403);
```

必须另测：同名/同校但联系方式不匹配自动创建；一个/多个已验证精确候选；只有手工微信号精确相同则暂停且不可批准，补证后可批准，判定均非同一人后可 `resolve-create-after-review`；候选已绑定别人、原绑定属于当前 user、主机离线、receipt 丢失重试、同 idempotency key 不同 payload、并发双击注册。

- [ ] **Step 2：实现账户凭据和“注册完成”定义**

密码使用 Argon2id；依赖不可用才使用带参数版本的 `crypto.scrypt`。账户和已验证联系方式先在云控制面幂等创建，状态为 `teacher_registration_pending`；此时只签发 status/bootstrap token。UI 只有收到主机 completed receipt、活动 teacher binding 和默认 scope 后才显示“教师注册完成”。主机不可达时显示“账户已创建，等待数据主机完成教师注册”，不能回退为本地建档。

- [ ] **Step 3：实现 `teacher-registration.resolve.v1` 主机事务**

`teacher-registration.resolve.v1` 是唯一允许 registration-bootstrap token 调用的主机 onboarding command：必须同时验证账户状态、已验证联系方式 proof、attempt id、idempotency key、nonce、过期和限速；它与设备注册解耦，不要求或信任 installation key，不能携带业务 capability，也不能提交客户端指定 teacher_id。主机解密证据后执行 `BEGIN IMMEDIATE`：

```text
已存在当前 user 的 active teacher binding
  -> 幂等返回原 teacher/binding
零 blocking exact candidate
  -> 创建 teacher profile/contact
  -> 创建 active profile binding
  -> 创建/确认 teacher role grant
  -> 创建 teacher 默认 data scopes
  -> 递增 auth/access version
  -> 写 audit/projection/receipt
一个或多个 blocking verified/unverified exact candidate
  -> 不创建 teacher profile
  -> 创建 profile claim、证据等级和候选 row version
  -> verified 且无冲突可审核绑定；unverified 只可补证/判非匹配
  -> 返回 profile_match_pending/profile_conflict receipt
```

教师档案 name 使用注册表单的必填真实姓名；phone 只取 verified account contact；subject/hourly_rate/notes 初始为空，用户进入业务应用后自行补充。`teacher-registration.resolve-create-after-review.v1` 只允许原 attempt 处于 `profile_match_pending` 且全部候选最新状态为 `not_match/invalid`：主机重新计算必须为零 blocking candidate，以原 attempt/idempotency key 和 row_version CAS 推进到 `resolving_after_review`，复用同一建档绑定事务并返回 completed receipt；任何新候选或数据库错误整笔回滚。该命令同时登记在 `shared/teacherRegistrationProtocol.js`、registry 和 processor，不能从普通 profile claim 伪造调用。

- [ ] **Step 4：实现教学端身份门状态和恢复**

`DesktopIdentityGate` 明确呈现：填写注册资料、联系方式验证、正在连接数据主机、自动建档完成、发现原教师档案待匹配、候选冲突、主机离线可重试、设备初始化、快照下载。`profile_match_pending` 页面提供刷新、查看脱敏匹配证据、退出和联系超级管理员，不加载业务 `App`。completed 后继续设备登记和快照；快照 ready 后默认进入 `today`，但用户可直接进入任何 manifest 允许的其他页面。

- [ ] **Step 5：保持小程序申请语义独立**

小程序 teacher/student 可以直接获得所选基础角色标签，personal_family 不写正式角色而解析为 visitor；teacher/student 仍通过 profile claim 审核档案。小程序不能调用教学端自动建档命令。微信身份覆盖现有账户必须先验证密码；不能验证时建立 `account_identity_claims`，批准前只能读取 claim 状态。

- [ ] **Step 6：实现 token 和数据边界**

status/bootstrap token 不含 teacher scope、离线能力和业务 snapshot 权限。completed receipt 只把注册阶段推进到设备初始化，并允许后续 device-bootstrap；不得在设备、PIN、快照完成前签正式业务 session。候选待审账户可以具有 teacher 角色标签，但 effective capability 为空；任何 `teacher_id=null` 的业务 API、offline license 或 snapshot 请求返回 `PROFILE_BINDING_REQUIRED`。正式 session 在 Task 10/16 的 snapshot receipt 后签发，其 `teacher_id/binding_id/auth/access/credential version` 与 capability/scope/context/snapshot hash 必须和主机镜像一致。

- [ ] **Step 7：运行服务、UI 和真实业务测试**

Run: `node backend/src/services/teacherRegistrationService.test.js && node backend/src/routes/accountSessions.http.test.js && node backend/src/routes/accountIdentityClaims.http.test.js && node miniapp/src/utils/miniappAccountRegistration.test.js && node src/components/DesktopTeacherRegistration.test.js && node scripts/desktopTeacherRegistrationBusinessE2e.test.js`  
Expected: PASS；零精确候选无需人工批准即完成教师建档绑定，但必须继续完成设备、PIN 和快照后才可读本人课表；精确候选绝不重复建档，主机离线不虚假完成，重试不产生重复账户/profile/binding。

- [ ] **Step 8：提交**

```bash
git add backend/src/services/accountCredentialService.js backend/src/services/teacherRegistrationService.js backend/src/routes/accountSessions.js backend/src/routes/accountIdentityClaims.js backend/src/app.js backend/src/services/identityProvisioningService.js backend/src/services/miniappIdentityService.js backend/src/services/miniappApplicationService.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityHostCommandProcessor.js miniapp/src/pages/login/index.tsx src/components/DesktopIdentityGate.tsx src/services/desktopIdentityClient.mjs src/services/desktopIdentityError.mjs backend/src/services/teacherRegistrationService.test.js backend/src/routes/accountSessions.http.test.js backend/src/routes/accountIdentityClaims.http.test.js miniapp/src/utils/miniappAccountRegistration.test.js src/components/DesktopTeacherRegistration.test.js scripts/desktopTeacherRegistrationBusinessE2e.test.js
git commit -m "feat: 实现教学端教师注册自动建档绑定"
```
### Task 4：建立签名权限上下文、家庭/额外权限和中央页面守卫

**Files:**
- Create: `backend/src/services/effectiveAccessService.js`
- Create: `backend/src/services/householdService.js`
- Create: `src/services/desktopAccessContext.mjs`
- Create: `public/accessContextVerifier.js`
- Modify: `shared/signedAccessContextProtocol.js`
- Create: `src/components/PageAccessBoundary.tsx`
- Create: `src/pages/ForbiddenPage.tsx`
- Modify: `backend/src/services/authorizationPolicy.js`
- Modify: `backend/src/routes/accountSessions.js`
- Modify: `gateway/src/middleware/permission.js`
- Modify: `miniapp/src/utils/permission.ts`
- Modify: `src/App.tsx`
- Modify: `src/layout/AppShell.tsx`
- Modify: `src/navigation/appNavigation.tsx`
- Modify: `src/pages/TodayWorkbench.tsx`
- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Modify: `src/custom.d.ts`
- Test: `backend/src/services/effectiveAccessService.test.js`
- Test: `backend/src/services/householdService.test.js`
- Test: `gateway/src/services/effectiveAccessParity.test.js`
- Test: `src/services/desktopAccessContext.test.js`
- Test: `shared/signedAccessContextProtocol.test.js`
- Test: `public/accessContextVerifier.test.js`
- Test: `src/components/PageAccessBoundary.test.js`
- Test: `scripts/desktopPageAccessBusinessE2e.test.js`

- [ ] **Step 1：写三端一致 effective access fixture**

```js
const fixture = {
  surface: 'miniapp', role: 'teacher', profileBindingId: 'pb1',
  roleCapabilities: ['schedule.read', 'asset.personal.read'],
  relationshipCapabilities: ['asset.household.summary.read'],
  allows: ['asset.household.detail.read'], denies: ['schedule.read'],
  scopes: [{ type: 'household', ids: ['h1'] }]
};
assert.deepStrictEqual(evaluate(fixture).capabilities.sort(), [
  'asset.household.detail.read', 'asset.household.summary.read', 'asset.personal.read'
]);
```

- [ ] **Step 2：实现权限优先级、家庭范围和签名上下文**

固定 `surface allow-list ∩ ((role defaults ∪ household defaults ∪ allows) - denies)`；deny 优先，过期 override 不参与。家庭成员引用真实 user，课表共享引用明确 profile，家庭资产引用 household。`GET /api/account-sessions/context` 只从服务端当前表构造 AccessContext，不接受客户端 role/profile/scope；响应为 `payload＋key_id＋signature`，必须用 `shared/signedAccessContextProtocol.js` canonicalize/verify，并把 capability/scope/context hash 与 session 和 snapshot 绑定。

- [ ] **Step 3：实现中央 store，禁止页面重复查询身份**

Electron main 的 `accessContextVerifier.verifyAndInstallAccessContext()` 先验证 key id、签名、tokenUse、hostEpoch、有效期、user/device/installation/binding、auth/access/credential version、capability/scope/context hash 和 snapshot version/hash；通过后只把冻结的规范字段经 preload `accessContext.getSnapshot()/subscribe()` 暴露，原始 token/signature 不进 Renderer。篡改签名、旧 epoch、错误 snapshot hash、跨账户/installation 重放一律原子清空上下文和已开分区。

Renderer 的 `desktopAccessContext` 只允许身份门请求 main 安装、刷新、清除，提供同步只读 `getSnapshot/subscribe/can(pageKey)`。App 启动读取一次；页面切换只做内存判断，不逐页请求 `/me` 或重新匹配 teacher。账户切换、权限版本变化、session 到期、link/device 撤销和 snapshot replacement 先清空旧 store、页面缓存及数据库 facade，再安装新上下文。

- [ ] **Step 4：实现导航、直接 page key 和首页卡片同源守卫**

`AppShell` 按 manifest 过滤侧栏；`TodayWorkbench` 只显示可访问卡片；`App.renderPage()` 在 switch 前经 `PageAccessBoundary` 检查。手工触发 `navigate-page` 或构造 page key 不能绕过，统一显示 `ForbiddenPage`，不加载被拒页面数据组件。页面内写按钮按 action capability 二次判断。

- [ ] **Step 5：证明页面守卫不是安全边界**

测试在 Renderer 伪造 AccessContext 打开收费页：即使本地页面被篡改显示，API 仍必须 403 且不返回行。反向测试 manifest 漏掉现有 PageKey 时应用启动测试失败，不能依靠 API 403 掩盖坏导航。

- [ ] **Step 6：删除新 admin 授予并实现版本失效**

删除 `grantAdmin()` 和新 admin 命令；旧 admin session 返回 `LEGACY_ADMIN_MIGRATION_REQUIRED`。普通桌面拒绝 admin/super_admin business surface，数据主机拒绝 teacher。`auth/access/credential version` 任一改变时 session、离线许可和缓存上下文失效。

- [ ] **Step 7：运行上下文、页面与三端一致性测试**

Run: `node backend/src/services/effectiveAccessService.test.js && node backend/src/services/householdService.test.js && node gateway/src/services/effectiveAccessParity.test.js && node shared/signedAccessContextProtocol.test.js && node public/accessContextVerifier.test.js && node src/services/desktopAccessContext.test.js && node src/components/PageAccessBoundary.test.js && node scripts/desktopPageAccessBusinessE2e.test.js`  
Expected: PASS；页面切换没有重复身份请求，today 与其他页面平级，导航/直达/首页卡片一致，后端拒绝伪造 ID。

- [ ] **Step 8：提交**

```bash
git add backend/src/services/effectiveAccessService.js backend/src/services/householdService.js src/services/desktopAccessContext.mjs public/accessContextVerifier.js shared/signedAccessContextProtocol.js src/components/PageAccessBoundary.tsx src/pages/ForbiddenPage.tsx backend/src/services/authorizationPolicy.js backend/src/routes/accountSessions.js gateway/src/middleware/permission.js miniapp/src/utils/permission.ts src/App.tsx src/layout/AppShell.tsx src/navigation/appNavigation.tsx src/pages/TodayWorkbench.tsx public/electron.js public/preload.js src/custom.d.ts backend/src/services/effectiveAccessService.test.js backend/src/services/householdService.test.js gateway/src/services/effectiveAccessParity.test.js shared/signedAccessContextProtocol.test.js public/accessContextVerifier.test.js src/services/desktopAccessContext.test.js src/components/PageAccessBoundary.test.js scripts/desktopPageAccessBusinessE2e.test.js
git commit -m "feat: 建立统一权限上下文和页面守卫"
```
### Task 5：封闭旧角色真相和所有业务 API 越权旁路

**Files:**
- Create: `backend/src/middleware/requireCapabilityAndScope.js`
- Create: `backend/src/services/businessRouteAccessManifest.js`
- Create: `shared/authorityCommandAccessManifest.js`
- Create: `gateway/src/services/relayAccessManifest.js`
- Modify: `backend/src/middleware/auth.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityBusinessMutationService.js`
- Modify: `backend/src/services/authorityHostCommandProcessor.js`
- Modify: `gateway/src/middleware/auth.js`
- Modify: `gateway/src/middleware/permission.js`
- Modify: `gateway/src/services/authorizationPolicy.js`
- Modify: `gateway/src/services/authorityRoleMirrorService.js`
- Modify: `gateway/src/routes/cloudRelay.js`
- Modify: `gateway/src/routes/permissions.js`
- Modify: `gateway/src/routes/modules.js`
- Modify: `gateway/src/websocket/authMiddleware.js`
- Modify: `gateway/src/websocket/authorityRelayRouter.js`
- Modify: `backend/src/routes/adminUsers.js`
- Modify: `backend/src/routes/students.js`
- Modify: `backend/src/routes/teachers.js`
- Modify: `backend/src/routes/courses.js`
- Modify: `backend/src/routes/schedules.js`
- Modify: `backend/src/routes/payments.js`
- Modify: `backend/src/routes/consumptions.js`
- Modify: `backend/src/routes/billImport.js`
- Modify: `backend/src/routes/export.js`
- Modify: `backend/src/routes/institutions.js`
- Modify: `backend/src/routes/modules.js`
- Modify: `backend/src/routes/paperArtifactAccess.js`
- Modify: `backend/src/routes/permissions.js`
- Modify: `backend/src/routes/rooms.js`
- Modify: `backend/src/routes/stats.js`
- Modify: `backend/src/routes/schools.js`
- Modify: `backend/src/routes/questionBank.js`
- Modify: `backend/src/routes/unrecognizedExperience.js`
- Modify: `backend/src/routes/miniappApplications.js`
- Modify: `backend/src/routes/miniappAuthorityApplications.js`
- Modify: `backend/src/routes/miniappAuthorityProjection.js`
- Modify: `backend/src/routes/miniappWechatBindings.js`
- Test: `backend/src/routes/unifiedAccessBoundary.http.test.js`
- Test: `backend/src/routes/businessRouteManifest.test.js`
- Test: `backend/src/routes/legacyReviewRetirement.http.test.js`
- Test: `shared/authorityCommandAccessManifest.test.js`
- Test: `gateway/src/services/relayAccessManifest.test.js`
- Test: `gateway/src/routes/unifiedRelayAccessBoundary.test.js`
- Test: `gateway/src/websocket/authorityRelayAuthorization.test.js`

- [ ] **Step 1：建立默认拒绝业务路由清单测试**

解析 `backend/src/app.js` 的全部 `/api` 挂载和 router method，要求每条业务路由登记 method、path、capability、surface、read/write scope、host-online requirement 和 owner resolver；未知业务路由使测试及生产启动检查失败。`authorityCommandAccessManifest` 同样枚举每个 command type 的 actor surface、capability、scope resolver、幂等和 receipt 要求；`relayAccessManifest` 覆盖 Gateway HTTP、WebSocket topic 和 host task。三类入口均默认拒绝，健康、登录、注册状态查询等公共控制路由只能进入显式 allow-list，不能靠缺省放行。

- [ ] **Step 2：写真实越权 HTTP 场景**

```js
assert.strictEqual(await status('GET', '/api/question-bank', null), 401);
assert.strictEqual(await statusAs(teacherA, 'GET', '/api/students?teacher_id=teacher-b'), 403);
assert.strictEqual(await statusAs(teacherA, 'POST', '/api/schedules', { teacher_id: 'teacher-b' }), 403);
assert.strictEqual(await statusAs(teacherPendingMatch, 'GET', '/api/courses'), 403);
assert.strictEqual(await statusAs(visitor, 'GET', '/api/payments'), 403);
```

另测 body/query/header/JWT 伪造 `user_id/teacher_id/student_id/owner_id/device_id/authority_id/role/scope`，服务端必须覆盖为 session context 或因资源不属于 scope 返回 403。

- [ ] **Step 3：实现统一中间件和 SQL 行级限制**

Backend/Gateway 中间件验证 session、账户、活动 profile binding、account-device link、account-installation state、installation/device、host epoch、auth/access/credential version 和 capability；resource resolver 生成参数化 SQL scope。读取和写事务都使用该 scope，禁止先全量查询再在 JS 过滤。`authorityBusinessMutationService` 和 host command processor 必须从已验签 actor context 覆盖 command payload 的 actor/owner/scope，registry 未登记 command 直接拒绝；Gateway cloudRelay/WebSocket 只转发 allow-list 中与同一 context hash/authority/user/installation 绑定的 assertion，不能从 `scope.kind/admin` 或客户端 role 放权。中央 middleware 默认拒绝未登记入口；只有显式公共控制面 allow-list 或已接入 resolver 的业务入口可启动。

- [ ] **Step 4：区分账户 owner 和教师业务主体**

账户设置、本人设备、个人资产以 `user_id` 为 owner；课程、课表、缴费和统计以 binding 中的 `teacher_id` 为主体。两者都从服务端上下文取得。删除所有 `req.body.user_id || req.user.id`、`req.query.teacher_id || req.user.teacher_id` 类型客户端优先表达式。

- [ ] **Step 5：冻结旧审核和原始写口**

`/api/admin/users/:id/review`、旧 teacher binding、旧 role mutation、普通设备 approve/reject 和无法安全适配的原始写口返回 HTTP 410，body 固定含 `replacementRoute/migrationVersion`。唯一角色、档案和权限写入真相是 authority command＋host receipt。

- [ ] **Step 6：收口题库 GET 和目录缓存**

题库正文 GET 检查 `question.online.use`、主机在线、题库 authority binding 和题库盘状态；目录 API 只返回签名 taxonomy catalog。不能出现只保护写接口而 GET 裸奔。

- [ ] **Step 7：运行全路由和越权测试**

Run: `node backend/src/routes/businessRouteManifest.test.js && node shared/authorityCommandAccessManifest.test.js && node backend/src/routes/unifiedAccessBoundary.http.test.js && node backend/src/routes/legacyReviewRetirement.http.test.js && node gateway/src/services/relayAccessManifest.test.js && node gateway/src/routes/unifiedRelayAccessBoundary.test.js && node gateway/src/websocket/authorityRelayAuthorization.test.js && npm run test:backend`  
Expected: PASS；所有业务路由登记完整，待匹配老师无业务数据，伪造 ID/role/scope 均失败，合法老师只得到本人范围。

- [ ] **Step 8：提交**

```bash
git add backend/src/middleware/requireCapabilityAndScope.js backend/src/services/businessRouteAccessManifest.js backend/src/middleware/auth.js backend/src/app.js backend/src/routes/adminUsers.js backend/src/routes/students.js backend/src/routes/teachers.js backend/src/routes/courses.js backend/src/routes/schedules.js backend/src/routes/payments.js backend/src/routes/consumptions.js backend/src/routes/billImport.js backend/src/routes/export.js backend/src/routes/institutions.js backend/src/routes/modules.js backend/src/routes/paperArtifactAccess.js backend/src/routes/permissions.js backend/src/routes/rooms.js backend/src/routes/stats.js backend/src/routes/schools.js backend/src/routes/questionBank.js backend/src/routes/unrecognizedExperience.js backend/src/routes/miniappApplications.js backend/src/routes/miniappAuthorityApplications.js backend/src/routes/miniappAuthorityProjection.js backend/src/routes/miniappWechatBindings.js backend/src/routes/unifiedAccessBoundary.http.test.js backend/src/routes/businessRouteManifest.test.js backend/src/routes/legacyReviewRetirement.http.test.js shared/authorityCommandAccessManifest.js gateway/src/services/relayAccessManifest.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityBusinessMutationService.js backend/src/services/authorityHostCommandProcessor.js gateway/src/middleware/auth.js gateway/src/middleware/permission.js gateway/src/services/authorizationPolicy.js gateway/src/services/authorityRoleMirrorService.js gateway/src/routes/cloudRelay.js gateway/src/routes/permissions.js gateway/src/routes/modules.js gateway/src/websocket/authMiddleware.js gateway/src/websocket/authorityRelayRouter.js shared/authorityCommandAccessManifest.test.js gateway/src/services/relayAccessManifest.test.js gateway/src/routes/unifiedRelayAccessBoundary.test.js gateway/src/websocket/authorityRelayAuthorization.test.js
git commit -m "security: 统一页面后端接口与数据范围鉴权"
```
### Task 6：建立数据主机账户与权限中心及真实审核入口

**Files:**
- Create: `src/pages/AccountAccessCenter.tsx`
- Create: `src/pages/AccountAccessCenter.css`
- Create: `src/components/ProfileClaimReviewPanel.tsx`
- Create: `src/components/AccountIdentityClaimReviewPanel.tsx`
- Create: `src/components/UserCapabilityEditor.tsx`
- Create: `backend/src/services/accountAccessManagementService.js`
- Modify: `backend/src/routes/hostAccountAccess.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityHostCommandProcessor.js`
- Modify: `src/navigation/appNavigation.tsx`
- Modify: `src/App.tsx`
- Modify: `src/layout/AppShell.tsx`
- Modify: `src/pages/IdentityDeviceCenter.tsx`
- Test: `backend/src/routes/hostAccountAccess.http.test.js`
- Test: `src/pages/AccountAccessCenter.test.js`
- Test: `scripts/hostIdentityUiProfile.test.js`
- Test: `scripts/teacherRegistrationHostReviewE2e.test.js`

- [ ] **Step 1：写数据主机真实可达性测试**

以 primary-host runtime＋super_admin session 启动，点击侧栏“账户与权限”，从真实临时 Backend 获取待审数。教学端不渲染入口，直接构造 page key 得到 ForbiddenPage，API 也返回 403；不得直调组件方法代替点击。

- [ ] **Step 2：先实现四个后端已闭环的标签页**

本 Task 只挂载“教师注册记录、档案匹配、账户身份、用户权限”。每页支持分页、筛选、手动刷新、空态、失败、处理中、冲突和最终 receipt；数字徽标来自 `hostAccountAccess` 真实 API。教师注册记录展示自动创建与待匹配结果，但不能编辑已完成 receipt。学校别名、家庭、旧管理员迁移分别在 Task 17、19、20 的后端和 command 完成后作为第五、六、七页挂载，禁止先放空壳入口。

- [ ] **Step 3：实现档案匹配审核 UI**

显示已验证手机号/微信 provider、未验证手工微信号的脱敏证据等级、候选 profile 当前联系方式、全部 binding 冲突和 row version。只有后端 `approvable=true` 时启用“绑定已有档案”；未验证精确项只能“请求补证”或“判定非匹配”，全部判非后才显示 `resolve-create-after-review`。多个可批准候选必须选择。疑似重复档案提供真实“预览合并”入口，展示 Task 2 返回的引用迁移和冲突，只有 `mergeable=true` 才能 apply；合并 receipt 完成后自动重新 refresh claim，再进行绑定。点击任何动作都等待最终 host receipt 后重新读取。姓名/学校相似只能显示为参考，不能启用批准或合并。

- [ ] **Step 4：禁止给教学端零候选增加人工审核**

来源为 `desktop_teacher_registration` 且零精确候选时，记录必须已自动完成，不能进入待审队列，也不能显示“创建并绑定”。只有小程序/人工 profile claim 的零候选允许超级管理员执行 `approve-create.v1`。测试断言正常教学端注册没有任何普通人工审批记录。

- [ ] **Step 5：实现额外权限高亮和范围编辑**

角色默认灰色、家庭默认绿色、显式 allow 蓝色、显式 deny 红色；保存必须选择 surface、资源 scope、原因和可选有效期。真实命令固定为 `account-access.override.upsert.v1`、`account-access.override.revoke.v1`、`account-access.scope.upsert.v1`、`account-access.scope.revoke.v1`，由数据主机事务写 override/scope、递增 access_version、撤销 session/license、发布 projection/audit/receipt。不可委派能力只读展示。页面等待 receipt 后刷新，明确提示 access_version 更新会使旧上下文失效。

- [ ] **Step 6：拆分旧混合入口**

从 `IdentityDeviceCenter` 移除 `AuthorityRoleApplicationsPanel`、直接授予管理员和普通设备 approve/reject。账户/档案进入本中心，设备风险进入 DeviceRiskCenter，主机迁移恢复进入主机安全中心。每个旧入口返回 replacementRoute，不保留隐藏按钮调用旧 API。

- [ ] **Step 7：运行 UI 与真实审核测试并留证**

Run: `node backend/src/routes/hostAccountAccess.http.test.js && node src/pages/AccountAccessCenter.test.js && node scripts/hostIdentityUiProfile.test.js && node scripts/teacherRegistrationHostReviewE2e.test.js && npm run typecheck`  
Expected: PASS；1920×1080 和 1280×720 覆盖自动完成记录、唯一候选、多候选、已绑定冲突、空态、失败、处理中和 receipt 成功；零候选教学端注册无需人工动作。

- [ ] **Step 8：提交**

```bash
git add src/pages/AccountAccessCenter.tsx src/pages/AccountAccessCenter.css src/components/ProfileClaimReviewPanel.tsx src/components/AccountIdentityClaimReviewPanel.tsx src/components/UserCapabilityEditor.tsx backend/src/services/accountAccessManagementService.js backend/src/routes/hostAccountAccess.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityHostCommandProcessor.js src/navigation/appNavigation.tsx src/App.tsx src/layout/AppShell.tsx src/pages/IdentityDeviceCenter.tsx backend/src/routes/hostAccountAccess.http.test.js src/pages/AccountAccessCenter.test.js scripts/hostIdentityUiProfile.test.js scripts/teacherRegistrationHostReviewE2e.test.js
git commit -m "feat: 建立教师注册记录与账户权限中心"
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

`deviceRegistrationSigningPayload()` 必须覆盖 authority、user、device、installation、anchor/install key fingerprint、risk decision、auth/access/credential version、host epoch、issuedAt、expiresAt 和 nonce。`offlineLicenseSigningPayload()` 必须覆盖 user/authority/device/installation/link/account-installation/profile binding、auth/access/credential version、capability/scope/context hash、snapshot version/hash、host epoch、最长 30 天有效期和 token use，禁止调用者附加未登记字段。

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
- Create: `public/windowsCredentialAnchorStore.js`
- Create: `public/windowsHardwareEvidence.js`
- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Modify: `src/custom.d.ts`
- Test: `public/windowsDeviceAnchor.test.js`
- Test: `public/windowsCredentialAnchorStore.test.js`
- Test: `public/windowsHardwareEvidence.test.js`
- Test: `scripts/windowsDeviceAnchorE2e.test.js`
- Test: `scripts/windowsDeviceAnchorInstallerLifecycleE2e.ps1`

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

- [ ] **Step 4：实现可跨卸载保留的 software fallback**

TPM 与 Software KSP 都不可用时生成随机 ECDSA P-256 锚，优先作为 Windows Credential Manager 的 Generic Credential 保存，target 固定 `Gewu.DeviceAnchor.v2`，由 Windows DPAPI 绑定当前 Windows 用户；调用必须走受限 Node/PowerShell bridge 的 stdin，不经命令行、Renderer 或日志。Credential Manager 也不可用时，才由 `safeStorage.encryptString()` 包装并写入独立 `DeviceTrust` 目录；卸载器默认不删除 CNG key/Credential/该目录，只有“清除此设备身份”的显式二次确认操作可删。两种软件路径都固定 `backend:'software_fallback'` 并记录具体 `storageBackend` 风险证据，不能伪称硬件保护。

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

- [ ] **Step 7：真实 Windows 与安装生命周期 E2E**

Run: `node public/windowsDeviceAnchor.test.js && node public/windowsCredentialAnchorStore.test.js && node public/windowsHardwareEvidence.test.js && node scripts/windowsDeviceAnchorE2e.test.js && powershell -ExecutionPolicy Bypass -File scripts/windowsDeviceAnchorInstallerLifecycleE2e.ps1`  
Expected: 连续两次运行 fingerprint 相同；临时复制应用目录不能导出私钥；隔离 VM/CI 中以测试 app id 完成“安装→取指纹→卸载→重装→取指纹”，锚指纹相同但 installation id 不同，主机判为 reinstall；换 Windows 用户或显式清锚后指纹不同。生命周期脚本必须要求 `GEWU_DEVICE_E2E_VM=1`，使用 `Gewu.Test.DeviceAnchor.<run-id>` 和测试 Credential target，备份/恢复测试 userData，只能清理本次 run-id，绝不碰生产键。

- [ ] **Step 8：提交**

```bash
git add public/windows-device-anchor.ps1 public/windowsDeviceAnchor.js public/windowsCredentialAnchorStore.js public/windowsHardwareEvidence.js public/electron.js public/preload.js src/custom.d.ts public/windowsDeviceAnchor.test.js public/windowsCredentialAnchorStore.test.js public/windowsHardwareEvidence.test.js scripts/windowsDeviceAnchorE2e.test.js scripts/windowsDeviceAnchorInstallerLifecycleE2e.ps1
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
- Test: `backend/src/routes/accountSessionInitialization.http.test.js`

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

主机先验证账户活动状态、`teacher_registration_attempt.completed`（注册路径）或既有 active teacher profile binding（登录路径）：缺少 binding 的旧账户只能得到 active account-device link 和 `profile_match_required` account-installation state，不得得到初始化/业务 session、离线许可或快照；已绑定 teacher 的 account-installation state 为 `snapshot_required`。同一事务写 device、installation、account-device link、account-installation state、fingerprint observation、audit 和 signed receipt，并用复合一致性断言阻止跨 user/device/installation/link 拼接。

- [ ] **Step 5：云端消费 receipt**

云端验证 host epoch 和签名后更新控制面镜像。没有 receipt、receipt 字段不全、过期 host epoch 或 user/installation 不一致时，attempt 保持失败并不能签发 desktop session。

- [ ] **Step 6：先签初始化会话，快照提交后再签正式短会话**

设备 host receipt、active binding、`snapshot_required`、主进程已创建账户分区的 `partition_id` 以及 installation key 对 `partition-ready-v1` nonce 的签名证明，才能换取 `token_use:'desktop-initialization-session'`；PIN、KEK、data key 不上传。路由 allow-list 仅含 AccessContext 预览、snapshot manifest/chunks/receipt、分区状态和退出；课程、课表、资产、题库、同步及审核 API 全部 403。客户端提交签名 snapshot receipt，主机重验 manifest hash、binding 和 access/capability/scope hash，在同一事务把 account-installation state 改为 active 后，才签发正式 session。正式 session claims 固定含：

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
  credential_version: credentialVersion,
  capability_hash: capabilityHash,
  scope_hash: scopeHash,
  context_hash: contextHash,
  snapshot_version: snapshotVersion,
  snapshot_hash: snapshotHash
}
```

- [ ] **Step 7：运行真实 HTTP**

Run: `node backend/src/services/deviceRegistrationService.test.js && node backend/src/routes/deviceRegistrations.http.test.js && node backend/src/routes/accountDeviceLinks.http.test.js && node backend/src/routes/accountSessionInitialization.http.test.js`  
Expected: 主机离线返回 pending/required，不伪造成功；设备 receipt 后只有初始化 session，snapshot receipt 成功且状态 active 后才产生正式 session；任意 hash 或外键不一致均零写入。

- [ ] **Step 8：提交**

```bash
git add backend/src/services/deviceTrustService.js backend/src/services/deviceRegistrationService.js backend/src/routes/deviceRegistrations.js backend/src/routes/accountDeviceLinks.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityHostCommandProcessor.js backend/src/services/desktopSessionService.js backend/src/app.js gateway/src/services/authorityDeviceControlMirrorService.js backend/src/services/deviceRegistrationService.test.js backend/src/routes/deviceRegistrations.http.test.js backend/src/routes/accountDeviceLinks.http.test.js backend/src/routes/accountSessionInitialization.http.test.js
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

分别断言两条路径：新用户从注册资料、联系方式验证、教师档案解析进入设备/快照初始化；已有老师从账号登录直接进入设备/快照初始化。主机不可达时不得加载业务 App；risk blocked 必须显示事件编号和“联系超级管理员处理”，不能显示普通设备“等待批准”。

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

收到设备 host receipt 且教师 binding 已确认后，先要求设置本地 PIN 并创建空的账户分区，再用 initialization session 把快照直接写入该加密分区；只有快照验签和原子提交成功才显示在线业务入口。在线可用账号密码重新建立分区；离线只能选择已有分区并用其 PIN 解锁。不存在已提交快照或有效许可证时不显示离线登录按钮。

- [ ] **Step 6：实现初始化门禁**

`registration_state` 不是 completed、profile binding 缺失、PIN/分区未就绪、installation/link 未 active、account-installation state 未 active 或 snapshot 未原子完成时，不加载任何受保护教学业务页面；身份区继续显示可恢复的注册匹配、设备、PIN、下载、校验或重试状态。`today` 与其他业务页面遵循同一门禁，但彼此没有父子授权关系。React 页面隐藏不能替代主进程和 Backend 校验。

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
- Modify: `backend/src/routes/accountSessions.js`
- Modify: `public/accountPartitionVault.js`
- Modify: `src/services/desktopAuthorizationSession.mjs`
- Modify: `src/services/authoritySyncSurfacePolicy.mjs`
- Test: `backend/src/services/offlineAccessLicenseService.test.js`
- Test: `backend/src/routes/offlineAccessLicense.http.test.js`
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

只有数据主机、活动 account-device link、活动 account-installation state、活动 installation、活动 profile binding 和完成的 snapshot 才能签发。正式入口为 `POST /api/account-sessions/offline-license`，只接受当前在线 session 和幂等键，不接受客户端 user/device/binding/snapshot ID；数据主机签名 receipt 返回后由主进程写入当前 account vault。期限固定 `issuedAt + 30 days`，离线使用不滑动续期；签新许可前在同一事务把该 user＋installation 的旧 active 许可置 expired/revoked。

- [ ] **Step 4：绑定权限和快照**

许可包含 capability hash、scope hash、snapshot version/hash、auth/access/credential version。任一不匹配，在线时立即拒绝并清理许可；离线时只能验证本地签名与绑定快照。

- [ ] **Step 5：防系统时间回拨**

账户 vault 保存最近一次主机签名 server time 和最近成功本地时间。当前时间早于已保存时间超过 5 分钟时锁定离线模式；恢复联网后用主机时间重新校准。不能通过手工改系统时间延长许可。

- [ ] **Step 6：明确离线允许操作**

仅允许许可 capability 中的本地读取和普通业务草稿编辑；同步 push/pull、审核、权限、设备处置、题库、导出题库、主机、备份、学校规范治理全部返回 `OFFLINE_OPERATION_FORBIDDEN`。

- [ ] **Step 7：运行**

Run: `node backend/src/services/offlineAccessLicenseService.test.js && node backend/src/routes/offlineAccessLicense.http.test.js && node public/accountPartitionVault.test.js && node scripts/desktopOfflineThirtyDayE2e.test.js`  
Expected: PASS；测试时钟覆盖 29 天、30 天、回拨、续签、撤权后再次联网和离线草稿保留。

- [ ] **Step 8：提交**

```bash
git add backend/src/services/offlineAccessLicenseService.js backend/src/services/deviceLeaseService.js backend/src/services/desktopSessionService.js backend/src/routes/accountSessions.js public/accountPartitionVault.js src/services/desktopAuthorizationSession.mjs src/services/authoritySyncSurfacePolicy.mjs backend/src/services/offlineAccessLicenseService.test.js backend/src/routes/offlineAccessLicense.http.test.js public/accountPartitionVault.test.js scripts/desktopOfflineThirtyDayE2e.test.js
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
- Modify: `src/App.tsx`
- Modify: `shared/pageAccessManifest.js`
- Modify: `backend/src/routes/accountDeviceLinks.js`
- Create: `backend/src/routes/hostDeviceRisk.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/deviceTrustService.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Test: `src/pages/MyDevices.test.js`
- Test: `src/pages/DeviceRiskCenter.test.js`
- Test: `src/navigation/devicePageRoutes.test.js`
- Test: `backend/src/routes/hostDeviceRisk.http.test.js`
- Test: `scripts/deviceRevocationE2e.test.js`

- [ ] **Step 1：写撤销范围测试**

撤销 account-device link 只终止该 user 在该 device 的 session/license，其他 user link 保持 active；撤销 trusted device 必须递增 credential_version，撤销所有 installation、link、session 和 license。

- [ ] **Step 2：实现本人设备页和真实路由**

教学端账户菜单、侧栏和直接 `navigate-page('my-devices')` 都由 `src/App.tsx` 注册到同一个页面；可查看当前账户关联的设备名称、最近在线、anchor backend、安装版本和状态，允许“退出此设备”和“撤销其他设备上的本账户”。不得看到同设备其他账户身份。manifest、导航、App switch 任一缺项都让 route contract 测试失败。

- [ ] **Step 3：实现数据主机设备与风险中心和真实路由**

`device-risk` 只在 primary-host surface 注册，固定三个标签页：“可信设备、安装实例、风险事件”。可展开查看账户关联，但手机号脱敏。normal/watch 设备不出现批准按钮；只有 blocked risk event 显示“确认本人重装”“认定克隆并撤销”“保持阻断”。直接 page key、浏览器刷新和侧栏入口都必须命中真实组件，teacher desktop 直达返回稳定无权限页。

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

Run: `node src/pages/MyDevices.test.js && node src/pages/DeviceRiskCenter.test.js && node src/navigation/devicePageRoutes.test.js && node backend/src/routes/hostDeviceRisk.http.test.js && node scripts/deviceRevocationE2e.test.js`  
Expected: PASS；普通设备不出现人工审批，风险阻断有真实入口、命令、receipt 和状态刷新。

- [ ] **Step 8：提交**

```bash
git add src/pages/MyDevices.tsx src/pages/DeviceRiskCenter.tsx src/pages/DeviceRiskCenter.css src/pages/IdentityDeviceCenter.tsx src/services/identityDeviceCenterPolicy.mjs src/navigation/appNavigation.tsx src/App.tsx shared/pageAccessManifest.js backend/src/routes/accountDeviceLinks.js backend/src/routes/hostDeviceRisk.js backend/src/app.js backend/src/services/deviceTrustService.js backend/src/services/authorityCommandRegistry.js src/pages/MyDevices.test.js src/pages/DeviceRiskCenter.test.js src/navigation/devicePageRoutes.test.js backend/src/routes/hostDeviceRisk.http.test.js scripts/deviceRevocationE2e.test.js
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
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityHostCommandProcessor.js`
- Modify: `gateway/src/routes/cloudRelay.js`
- Modify: `gateway/src/services/cloudRelayTaskService.js`
- Create: `src/services/authorizedSnapshotClient.mjs`
- Create: `src/services/quarantinedDraftsClient.mjs`
- Create: `src/pages/QuarantinedDrafts.tsx`
- Create: `src/pages/QuarantinedDrafts.css`
- Modify: `backend/src/services/authorityProjectionSourceService.js`
- Modify: `src/services/browserDatabase.ts`
- Modify: `src/services/desktopCommandOutbox.mjs`
- Modify: `src/services/desktopAuthorityClient.mjs`
- Modify: `public/accountPartitionVault.js`
- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Modify: `src/App.tsx`
- Modify: `src/navigation/appNavigation.tsx`
- Modify: `shared/pageAccessManifest.js`
- Test: `backend/src/services/authorizedSnapshotService.test.js`
- Test: `src/services/authorizedSnapshotClient.test.js`
- Test: `src/pages/QuarantinedDrafts.test.js`
- Test: `gateway/src/routes/authorizedSnapshotsRelay.http.test.js`
- Test: `scripts/authorizedSnapshotBusinessE2e.test.js`

- [ ] **Step 1：写 manifest 契约**

```js
assert.deepStrictEqual(manifest.excludedKinds, [
  'questions', 'question_answers', 'question_explanations',
  'question_assets', 'question_index'
]);
assert.strictEqual(manifest.historyWindow, 'all');
assert.ok(manifest.hostEpoch);
assert.ok(manifest.accessVersion);
assert.ok(manifest.capabilityHash && manifest.scopeHash && manifest.contextHash);
assert.ok(manifest.tables.every(t => t.rowCount >= 0 && t.sha256));
assert.ok(manifest.signature);
```

- [ ] **Step 2：生成全历史授权集合**

根据 profile binding 和 effective scope 查询课程、课表、关联学生、必要教师、学校、机构、教室、允许的费用、个人资产和家庭资产。不接受客户端传表名或时间范围；所有历史记录按稳定主键排序。

- [ ] **Step 3：实现分块和断点续传**

manifest 固定 user/authority/profile binding、host epoch、snapshot/schema/access version、capability/scope/context hash、table/chunk hash、row count、key id 和 host signature，并与 initialization session 中的签名 AccessContext 逐字段一致。manifest/chunk 由 Gateway cloudRelay 以 initialization assertion 转发到当前 authority 主机，不能从云镜像拼装；chunk endpoint 只接受该 manifest 中的 chunk id。最终 `authorized-snapshot.commit.v1` command 经 registry/processor 到主机核验并产生 receipt；重复下载/commit 幂等，任一签名、epoch、身份或 hash 错误拒绝。

- [ ] **Step 4：实现账户分区原子切换**

设置 PIN 并创建账户分区后，使用 initialization session 下载到 `snapshots/staging/<snapshot-id>`；完成全部 hash、签名、host epoch 和 AccessContext 一致性验证后关闭旧 DB、保留可回滚的上一 active、原子 rename staging 为 active，并向主机提交带 manifest hash 的 snapshot receipt。主机在同一事务更新 account-installation state 的 `business_state/initialized_snapshot_version/initialized_snapshot_hash`，撤销旧 license，返回正式在线 session 和签名 AccessContext；客户端收到回执后才删除 staging/超期备份并进入业务区。

- [ ] **Step 5：实现权限变化**

scope 扩大产生增补快照；scope 缩小先构建新快照，再切换并把越权草稿移动到 `quarantine/<event-id>`。建立真实 `quarantined-drafts` 页面：侧栏仅在存在隔离记录时显示，直接 PageKey 始终可由 manifest 守卫；页面读取主进程按当前账户分区返回的只读 metadata/内容，显示来源业务、隔离原因、原 scope、时间和 hash，可逐条导出经用户选择的文件，但不可编辑、复制回 active 草稿或同步。Renderer 不能传任意目录，导出路径由系统保存对话框选择；清理只能在成功导出或明确放弃后由主进程二次确认并写本地待上传审计。

- [ ] **Step 6：同步门禁**

`desktopAuthorityClient` 和 `desktopCommandOutbox` 必须同时验证 active session、active account-device link、active account-installation state、active installation、snapshot scope/version 和用户确认；不得静默推送离线修改。

- [ ] **Step 7：运行**

Run: `node backend/src/services/authorizedSnapshotService.test.js && node src/services/authorizedSnapshotClient.test.js && node src/pages/QuarantinedDrafts.test.js && node gateway/src/routes/authorizedSnapshotsRelay.http.test.js && node scripts/authorizedSnapshotBusinessE2e.test.js`  
Expected: 全历史授权数据存在，越权行和所有题目实体为零；中断后可续传，损坏、旧 epoch、错误账户或 context hash 不切换；scope 收缩后隔离页可真实查看/导出但不能同步。

- [ ] **Step 8：提交**

```bash
git add shared/authorizedSnapshotProtocol.js backend/src/services/authorizedSnapshotService.js backend/src/routes/authorizedSnapshots.js backend/src/app.js src/services/authorizedSnapshotClient.mjs src/services/quarantinedDraftsClient.mjs src/pages/QuarantinedDrafts.tsx src/pages/QuarantinedDrafts.css backend/src/services/authorityProjectionSourceService.js src/services/browserDatabase.ts src/services/desktopCommandOutbox.mjs src/services/desktopAuthorityClient.mjs public/accountPartitionVault.js public/electron.js public/preload.js src/App.tsx src/navigation/appNavigation.tsx shared/pageAccessManifest.js backend/src/services/authorizedSnapshotService.test.js src/services/authorizedSnapshotClient.test.js src/pages/QuarantinedDrafts.test.js scripts/authorizedSnapshotBusinessE2e.test.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityHostCommandProcessor.js gateway/src/routes/cloudRelay.js gateway/src/services/cloudRelayTaskService.js gateway/src/routes/authorizedSnapshotsRelay.http.test.js
git commit -m "feat: 实现账户全量授权快照初始化"
```

### Task 17：建立学校规范名、别名和联网候选治理

**Files:**
- Create: `backend/src/services/schoolCanonicalizationService.js`
- Create: `backend/src/services/schoolSuggestionProvider.js`
- Create: `backend/src/routes/schoolCanonicalization.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityHostCommandProcessor.js`
- Modify: `gateway/src/routes/cloudRelay.js`
- Create: `src/services/schoolCanonicalizationClient.mjs`
- Modify: `miniapp/src/utils/api.ts`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `backend/src/routes/students.js`
- Modify: `backend/src/routes/teachers.js`
- Modify: `backend/src/services/teacherRegistrationService.js`
- Modify: `src/pages/StudentList.tsx`
- Modify: `src/pages/TeacherList.tsx`
- Modify: `src/components/DesktopIdentityGate.tsx`
- Create: `miniapp/src/pages/profile/index.tsx`
- Create: `miniapp/src/pages/profile/index.config.ts`
- Create: `miniapp/src/pages/profile/index.scss`
- Modify: `miniapp/src/app.config.ts`
- Create: `src/components/SchoolAliasReviewPanel.tsx`
- Modify: `src/pages/AccountAccessCenter.tsx`
- Test: `backend/src/services/schoolCanonicalizationService.test.js`
- Test: `backend/src/services/schoolFieldCoverage.test.js`
- Test: `backend/src/routes/schoolCanonicalization.http.test.js`
- Test: `gateway/src/routes/schoolCanonicalizationRelay.http.test.js`
- Test: `src/services/schoolCanonicalizationClient.test.js`
- Test: `miniapp/src/utils/miniappUiCoverage.test.js`
- Test: `src/pages/AccountAccessCenter.school.test.js`
- Test: `scripts/schoolCanonicalizationBusinessE2e.test.js`

- [ ] **Step 1：写唯一性和冲突测试**

规范学校唯一键为 `authority_id + administrative_code + normalized_canonical_name`。同名不同区不合并；同区相同规范名不能重复；一个 active alias 只能映射一个 canonical school。

- [ ] **Step 2：创建表和兼容字段**

创建 `canonical_schools`、`school_aliases`、`school_alias_submissions`。students、teachers 以及 schema 扫描发现的每一个 school 字段都增加 `school_raw/school_alias_id/school_id`；旧 `school` 只兼容展示，不再用于判同校。`schoolFieldCoverage.test.js` 维护显式字段清单，出现未接入 canonical ID 的新 school 字段时 CI 失败。

- [ ] **Step 3：实现自由输入**

教学端教师注册表单、教师/学生档案编辑和小程序 profile 页面都允许自由填写 `school_raw`；桌面 client 和 `miniapp/src/utils/api.ts` 调用云端 API，Gateway 以签名上下文转发 `school.alias.submit.v1` 到当前 authority 主机，后端创建/复用 pending alias submission，不自动创建 canonical school，不因模糊相似自动合并。教师注册自动建档事务同时保存 raw/alias submission，学校字段缺失或待规范化不阻止注册；`miniapp/src/app.config.ts` 必须注册 profile 页面，UI coverage 校验路由、角色归属、空态和失败态。

- [ ] **Step 4：实现网络候选**

数据主机配置高德 Web Service key；搜索结果只保存 provider、provider_id、名称、地址、行政区和抓取时间。没有 key、超时或限速时页面显示真实不可用状态，手工创建规范学校仍可完成。

- [ ] **Step 5：实现主机审核事务**

registry/processor 固定登记 `school.alias.submit.v1`、`school.alias.map.v1`、`school.canonical.create.v1`、`school.canonical.merge.v1`。选择现有 canonical 或创建 canonical 后映射 alias，事务更新关联记录的 school_id、递增 projection version、写 audit/receipt；合并 canonical 必须预览受影响记录并支持回滚映射。后端闭环完成后把 `SchoolAliasReviewPanel` 作为 AccountAccessCenter 第五页真实挂载，徽标、列表、候选、批准、失败和 receipt 全部来自正式 route；直达/刷新无假数据。

- [ ] **Step 6：运行**

Run: `node backend/src/services/schoolCanonicalizationService.test.js && node backend/src/services/schoolFieldCoverage.test.js && node backend/src/routes/schoolCanonicalization.http.test.js && node gateway/src/routes/schoolCanonicalizationRelay.http.test.js && node src/services/schoolCanonicalizationClient.test.js && node miniapp/src/utils/miniappUiCoverage.test.js && node src/pages/AccountAccessCenter.school.test.js && node scripts/schoolCanonicalizationBusinessE2e.test.js`  
Expected: 桌面和小程序不同别名经主机映射后显示同一规范名，raw 输入仍可审计。

- [ ] **Step 7：提交**

```bash
git add backend/src/services/schoolCanonicalizationService.js backend/src/services/schoolSuggestionProvider.js backend/src/routes/schoolCanonicalization.js backend/src/app.js backend/src/schema.sql backend/src/database.js backend/src/routes/students.js backend/src/routes/teachers.js backend/src/services/teacherRegistrationService.js src/pages/StudentList.tsx src/pages/TeacherList.tsx src/components/DesktopIdentityGate.tsx miniapp/src/pages/profile/index.tsx miniapp/src/pages/profile/index.config.ts miniapp/src/pages/profile/index.scss miniapp/src/app.config.ts src/components/SchoolAliasReviewPanel.tsx src/pages/AccountAccessCenter.tsx backend/src/services/schoolCanonicalizationService.test.js backend/src/services/schoolFieldCoverage.test.js backend/src/routes/schoolCanonicalization.http.test.js miniapp/src/utils/miniappUiCoverage.test.js src/pages/AccountAccessCenter.school.test.js scripts/schoolCanonicalizationBusinessE2e.test.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityHostCommandProcessor.js gateway/src/routes/cloudRelay.js src/services/schoolCanonicalizationClient.mjs miniapp/src/utils/api.ts gateway/src/routes/schoolCanonicalizationRelay.http.test.js src/services/schoolCanonicalizationClient.test.js
git commit -m "feat: 建立学校规范名和别名治理"
```

### Task 18：题库改为联网使用和签名体系目录缓存

**Files:**
- Create: `shared/questionCatalogProtocol.js`
- Create: `backend/src/services/questionCatalogCacheService.js`
- Create: `backend/src/services/legacyQuestionProjectionPurgeService.js`
- Create: `backend/src/routes/questionCatalog.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityHostCommandProcessor.js`
- Modify: `backend/src/services/authorityProjectionSourceService.js`
- Modify: `backend/src/services/dataScopeService.js`
- Modify: `gateway/src/services/dataScopeService.js`
- Modify: `gateway/src/routes/cloudRelay.js`
- Modify: `gateway/src/services/cloudRelayTaskService.js`
- Modify: `src/services/browserDatabase.ts`
- Modify: `miniapp/src/utils/authorityProjectionCache.js`
- Modify: `miniapp/src/utils/api.ts`
- Create: `src/services/questionCatalogCache.mjs`
- Create: `miniapp/src/utils/questionCatalogCache.ts`
- Modify: `backend/src/services/authorityProjectionService.js`
- Modify: `backend/src/routes/questionBank.js`
- Modify: `src/pages/QuestionBankTools.tsx`
- Modify: `src/pages/QuestionBankImport.tsx`
- Modify: `src/pages/QuestionBankPreview.tsx`
- Modify: `src/pages/QuestionBankEdit.tsx`
- Modify: `src/pages/QuestionBankPaper.tsx`
- Modify: `src/pages/AuditCenter.tsx`
- Modify: `miniapp/src/pages/question-bank/index.tsx`
- Test: `backend/src/services/questionCatalogCacheService.test.js`
- Test: `backend/src/services/legacyQuestionProjectionPurgeService.test.js`
- Test: `gateway/src/routes/questionCatalogRelay.http.test.js`
- Test: `src/services/questionCatalogCache.test.js`
- Test: `miniapp/src/utils/questionCatalogCache.test.js`
- Test: `src/pages/questionBankPageAccess.test.js`
- Test: `scripts/questionBankOnlineCacheE2e.test.js`
- Test: `scripts/questionDataLeakMigrationE2e.test.js`

- [ ] **Step 1：写泄漏断言**

普通授权 snapshot/projection/cache 中禁止出现 `questionId/stem/answer/explanation/assetPath/searchIndex`。目录只允许 subject、grade、textbook、chapter、knowledge/model/method/ability node、version、etag、hash、signature。

- [ ] **Step 2：版本化清除旧题库投影和普通端缓存**

迁移器扫描云 Backend/Gateway 旧 projection、普通桌面 IndexedDB/SQLite/缓存资产目录和小程序 `authorityProjectionCache`，删除题干、答案、解析、附件、搜索索引及旧目录结构，并把旧题库 snapshot/projection API 固定为 410；只清普通端/云端副本，绝不触碰数据主机移动硬盘权威题库目录。每个清理目标先记录类型、数量、hash 和迁移账本，失败阻止切换；缓存清理幂等。发布门禁在数据库和磁盘上扫描禁止字段、文件扩展和已知索引 magic，命中即失败。

- [ ] **Step 3：实现目录 API 和跨端中继**

请求必须认证并具备 `question.online.use`；Gateway 只把请求中继到当前 authority 主机或返回已验签且未过期的 host response，不从旧 projection 提取目录。返回 authority id、host epoch、catalog version、ETag、body hash、key id 和签名；桌面和 `miniapp/src/utils/api.ts` 走正式 API。桌面缓存只能写入当前 account partition，缓存键含 user/authority/host epoch；小程序缓存键同样含当前 user/authority，登出或切换账户先关闭旧 store。收到 304 前必须先验证本地正文 hash、原签名、当前 host epoch 和权限仍有效；缓存缺失/损坏/旧 epoch 时忽略 304，强制无条件重取。新版本在 staging 验签后原子替换，绝不跨账户复用。

- [ ] **Step 4：实现在线业务门禁**

查询、选题、组卷、导出、导入和试题编辑同时要求在线 session、数据主机健康、题库 authority binding 和移动硬盘 mounted。打开页面只检查页面能力；每个动作再分别检查 `question.online.use`、`question.paper.compose`、`question.export`、`question.content.import`、`question.content.write`。任一失败返回稳定原因，不回退到本地题目。

- [ ] **Step 5：实现离线 UI**

模块打开先显示缓存目录和“离线缓存目录”标识；搜索、选题、编辑、组卷、导出按钮全部 disabled，并说明需连接数据主机。缓存不存在时显示空态而非虚构体系。

- [ ] **Step 6：限制体系写入**

registry/processor 显式登记 `question.taxonomy.upsert.v1`、`question.audit.decide.v1`、`question.content.import.v1`、`question.content.write.v1` 和 `question.paper.compose.v1`。taxonomy 只允许 primary-host＋super_admin＋`question.taxonomy.manage`；题库审核只允许 primary-host＋`question.audit`。teacher 默认只有在线检索、选题、组卷和导出；超级管理员可额外授予指定 teacher import/write，但操作仍通过在线主机任务，不能修改体系、执行审核或删除已提交试题。

- [ ] **Step 7：运行**

Run: `node backend/src/services/questionCatalogCacheService.test.js && node backend/src/services/legacyQuestionProjectionPurgeService.test.js && node gateway/src/routes/questionCatalogRelay.http.test.js && node src/services/questionCatalogCache.test.js && node miniapp/src/utils/questionCatalogCache.test.js && node src/pages/questionBankPageAccess.test.js && node scripts/questionBankOnlineCacheE2e.test.js && node scripts/questionDataLeakMigrationE2e.test.js`  
Expected: 旧云/桌面/小程序题目副本清零且数据主机权威题库不受影响；在线可用并缓存目录；304 不重复正文，损坏/旧 epoch 自动重取；A/B 账户和不同 authority 缓存互不可见；停主机后只见当前账户已验签目录，所有题库操作拒绝；授权快照无题目数据。

- [ ] **Step 8：提交**

```bash
git add shared/questionCatalogProtocol.js backend/src/services/questionCatalogCacheService.js backend/src/routes/questionCatalog.js backend/src/app.js src/services/questionCatalogCache.mjs miniapp/src/utils/questionCatalogCache.ts backend/src/services/authorityProjectionService.js backend/src/routes/questionBank.js src/pages/QuestionBankTools.tsx src/pages/QuestionBankImport.tsx src/pages/QuestionBankPreview.tsx src/pages/QuestionBankEdit.tsx src/pages/QuestionBankPaper.tsx src/pages/AuditCenter.tsx miniapp/src/pages/question-bank/index.tsx backend/src/services/questionCatalogCacheService.test.js src/services/questionCatalogCache.test.js miniapp/src/utils/questionCatalogCache.test.js src/pages/questionBankPageAccess.test.js scripts/questionBankOnlineCacheE2e.test.js backend/src/services/legacyQuestionProjectionPurgeService.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityHostCommandProcessor.js backend/src/services/authorityProjectionSourceService.js backend/src/services/dataScopeService.js gateway/src/services/dataScopeService.js gateway/src/routes/cloudRelay.js gateway/src/services/cloudRelayTaskService.js src/services/browserDatabase.ts miniapp/src/utils/authorityProjectionCache.js miniapp/src/utils/api.ts backend/src/services/legacyQuestionProjectionPurgeService.test.js gateway/src/routes/questionCatalogRelay.http.test.js scripts/questionDataLeakMigrationE2e.test.js
git commit -m "feat: 收口题库在线使用和目录缓存"
```

### Task 19：实现家庭课表、个人资产、家庭资产和小程序权限表现

**Files:**
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/services/householdService.js`
- Create: `backend/src/services/householdAssetService.js`
- Create: `backend/src/routes/households.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityHostCommandProcessor.js`
- Modify: `gateway/src/routes/cloudRelay.js`
- Modify: `gateway/src/services/cloudRelayTaskService.js`
- Modify: `miniapp/src/utils/api.ts`
- Modify: `backend/src/services/personalAssetRecordService.js`
- Create: `src/components/HouseholdManager.tsx`
- Modify: `src/pages/AccountAccessCenter.tsx`
- Create: `miniapp/src/pages/family/index.tsx`
- Create: `miniapp/src/pages/family/index.config.ts`
- Create: `miniapp/src/pages/family/index.scss`
- Create: `miniapp/src/pages/family-assets/index.tsx`
- Create: `miniapp/src/pages/family-assets/index.config.ts`
- Create: `miniapp/src/pages/family-assets/index.scss`
- Modify: `miniapp/src/app.config.ts`
- Modify: `miniapp/src/custom-tab-bar/index.tsx`
- Modify: `miniapp/src/utils/permission.ts`
- Test: `backend/src/services/householdService.test.js`
- Test: `backend/src/services/householdAssetService.test.js`
- Test: `backend/src/routes/households.http.test.js`
- Test: `gateway/src/routes/householdsRelay.http.test.js`
- Test: `miniapp/src/utils/miniappHouseholdAccess.test.js`
- Test: `src/pages/AccountAccessCenter.household.test.js`
- Test: `scripts/familyPermissionBusinessE2e.test.js`

- [ ] **Step 1：迁移资产所有权**

资产表增加 `owner_type IN ('user','household')` 和 `owner_id`；旧 `owner_user_id` 迁移为 user owner。家庭资产必须引用 active household，不能靠角色 admin 判断。

- [ ] **Step 2：实现家庭邀请、接受、拒绝、退出和撤销状态机**

`household_memberships.status` 固定为 `invited/active/rejected/revoked/left`。registry/processor 登记 `household.create.v1`、`household.invite.v1`、`household.membership.accept/reject/revoke/leave.v1`、`household.asset.upsert.v1`；家庭 owner 或数据主机超级管理员只能向已有且已验证联系方式的账户创建 invitation。同一 household＋user 只能有一个 invited/active 记录；目标用户必须在小程序明确接受后才 active，pending invitation 不返回课表或资产。小程序 API 经 Gateway relay 到当前 authority 主机，所有转换要求 row_version、原因、actor、时间和 host receipt，重复请求幂等，不能以客户端 role/household_id 越权。后端和 E2E 就绪后把 `HouseholdManager` 作为 AccountAccessCenter 第六页挂载，创建/撤销邀请必须等待真实 receipt。

- [ ] **Step 3：实现课表脱敏 DTO**

家庭共享默认只返回时间、展示名、地点和状态；学生电话、学费、课时费、内部备注、其他家庭成员数据均不返回。`schedule.household.summary.read` 不能调用 detail API；共享目标必须是 membership scope 中显式绑定的 teacher/student profile，不是“同一家所有人的全部课表”。

- [ ] **Step 4：拆分资产与导出 capability**

固定使用 `asset.personal.read/write/export`、`asset.household.summary.read/detail.read/write/export` 和 `schedule.household.summary.read/detail.read/export`，禁止含糊的全局 `export`。每个导出 endpoint 单独鉴权、限制字段和 scope，并记录导出审计；读取或写入服务端从签名上下文解析 owner，不接受客户端伪造 `user_id/owner_id/household_id/profile_id`。

- [ ] **Step 5：实现小程序页面和导航**

同一路由按 effective access 显示真实可用入口。没有家庭关系时显示可操作的邀请/加入说明；有 invitation 时显示接受/拒绝；active 后才显示获授模块。没有 detail 能力时只显示汇总；没有 write/export 能力时不渲染对应按钮且 API 仍返回 403。撤销后当前页面立即清空家庭数据并刷新 AccessContext。

- [ ] **Step 6：移除小程序管理员页**

删除 `pages/admin/users/index` 注册和导航。超级管理员通过小程序登录时也只获得该 surface 允许的普通/家庭能力，不能进行主机审核或权限配置。

- [ ] **Step 7：运行**

Run: `node backend/src/services/householdService.test.js && node backend/src/services/householdAssetService.test.js && node backend/src/routes/households.http.test.js && node gateway/src/routes/householdsRelay.http.test.js && node miniapp/src/utils/miniappHouseholdAccess.test.js && node src/pages/AccountAccessCenter.household.test.js && node scripts/familyPermissionBusinessE2e.test.js && npm --prefix miniapp run ci:weapp`  
Expected: visitor/teacher/student＋family 组合按 scope 工作；invited 阶段零数据，接受后生效，拒绝/退出/撤销后立即失效；summary/detail/write/export 分离，无角色串权和资产越权。

- [ ] **Step 8：提交**

```bash
git add backend/src/schema.sql backend/src/services/householdService.js backend/src/services/householdAssetService.js backend/src/routes/households.js backend/src/app.js backend/src/services/personalAssetRecordService.js src/components/HouseholdManager.tsx src/pages/AccountAccessCenter.tsx miniapp/src/pages/family/index.tsx miniapp/src/pages/family/index.config.ts miniapp/src/pages/family/index.scss miniapp/src/pages/family-assets/index.tsx miniapp/src/pages/family-assets/index.config.ts miniapp/src/pages/family-assets/index.scss miniapp/src/app.config.ts miniapp/src/custom-tab-bar/index.tsx miniapp/src/utils/permission.ts backend/src/services/householdService.test.js backend/src/services/householdAssetService.test.js backend/src/routes/households.http.test.js miniapp/src/utils/miniappHouseholdAccess.test.js src/pages/AccountAccessCenter.household.test.js scripts/familyPermissionBusinessE2e.test.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityHostCommandProcessor.js gateway/src/routes/cloudRelay.js gateway/src/services/cloudRelayTaskService.js miniapp/src/utils/api.ts gateway/src/routes/householdsRelay.http.test.js
git commit -m "feat: 实现家庭共享和家庭资产权限"
```

### Task 20：迁移旧管理员和旧角色/设备兼容字段

**Files:**
- Create: `backend/src/services/legacyAdminMigrationService.js`
- Create: `backend/src/routes/legacyAdminMigrations.js`
- Create: `src/components/LegacyAdminMigrationWizard.tsx`
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/authorityMigrationService.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityHostCommandProcessor.js`
- Modify: `backend/src/services/authorizationPolicy.js`
- Modify: `backend/src/services/userRoleGrantService.js`
- Modify: `backend/src/services/authorityRoleGrantAdapter.js`
- Modify: `backend/src/services/authorityRoleMirrorService.js`
- Modify: `backend/src/services/miniappIdentityService.js`
- Modify: `backend/src/services/miniappAccessPolicy.js`
- Modify: `gateway/src/middleware/auth.js`
- Modify: `gateway/src/middleware/permission.js`
- Modify: `gateway/src/services/authorizationPolicy.js`
- Modify: `gateway/src/services/authorityRoleMirrorService.js`
- Modify: `gateway/src/routes/cloudRelay.js`
- Modify: `gateway/src/routes/permissions.js`
- Modify: `gateway/src/routes/modules.js`
- Modify: `gateway/src/websocket/authMiddleware.js`
- Modify: `gateway/src/websocket/authorityRelayRouter.js`
- Modify: `src/pages/AccountAccessCenter.tsx`
- Modify: `src/services/systemSettingsRolePolicy.mjs`
- Modify: `miniapp/src/utils/permission.ts`
- Modify: `scripts/release-matrix.js`
- Test: `backend/src/services/legacyAdminMigrationService.test.js`
- Test: `backend/src/routes/legacyAdminMigrations.http.test.js`
- Test: `backend/src/services/legacyAdminRuntimeSurface.test.js`
- Test: `gateway/src/services/legacyAdminRuntimeSurface.test.js`
- Test: `scripts/legacyAuthorizationRemoval.test.js`

- [ ] **Step 1：生成强制迁移清单**

列出每个旧 admin 的账户、最近登录、teacher/student 档案、资产、家庭候选、旧权限和设备。未明确选择目标角色/关系/能力的账户保持 restricted，不签发新 desktop session。

- [ ] **Step 2：建立真实盘点 API、authority commands 和第七个主机标签页**

`GET /api/host/account-access/legacy-admin-migrations` 返回真实分页清单；UI 对单个账户调用 `legacy-admin-migration.preview.v1` 取得影响预览，再调用 `legacy-admin-migration.apply.v1` 或 `legacy-admin-migration.restrict.v1`。三个命令必须注册到 registry/processor，要求 primary-host＋super_admin＋近期提权＋row_version＋idempotency key；UI 显示 pending、冲突、失败和签名 host receipt，并能在刷新后恢复状态，不能只改前端标签。

- [ ] **Step 3：实现逐账户迁移事务**

目标基础角色只能是 teacher、student 或无正式角色（运行时解析为 visitor）；可同时创建待目标用户接受的 family invitation 和可委派 miniapp capability，不能由迁移器直接激活家庭数据访问。已有教师/学生档案必须通过 active profile binding；存在多个候选时先走 profile merge/claim，不能复制档案 ID。apply 在 `BEGIN IMMEDIATE` 内重验账户、档案、资产 owner、旧权限、设备和 row_version，写新 role/binding/override/scope、迁移账本、auth/access version、session/license 撤销、projection、audit 和 receipt；任何冲突零写入。相同 idempotency key 重试返回原 receipt。

- [ ] **Step 4：切换放权真相与可回滚闸门**

只有盘点中的每个旧 admin 都为 `migrated` 或 `restricted`、P0 冲突为零、三端兼容测试通过后才开启 authority 级 feature flag。闸门开启后不再从 `users.role`、`users.teacher_id/student_id`、`permissions_data`、旧 device approval 和 `sync_devices.owner_user_id` 放权；兼容字段只读保留一个版本。正式切换前备份三端数据库和迁移账本；回滚只允许关闭 flag 并恢复备份/旧版本，不反向猜测新权限。

- [ ] **Step 5：扫描残留 admin**

测试只允许字符串 admin 出现在历史 schema、迁移器和兼容测试。显式扫描 Backend 的 `userRoleGrantService/authorityRoleGrantAdapter/authorityRoleMirrorService/miniappIdentityService/miniappAccessPolicy`，Gateway 的 auth/permission/authorizationPolicy/authorityRoleMirror/cloudRelay/permissions/modules/WebSocket relay，以及桌面系统设置策略、小程序 permission 和导航；新 session、command、relay assertion、capability、页面或 projection 出现可运行 admin 分支即失败。

- [ ] **Step 6：运行**

Run: `node backend/src/services/legacyAdminMigrationService.test.js && node backend/src/routes/legacyAdminMigrations.http.test.js && node backend/src/services/legacyAdminRuntimeSurface.test.js && node gateway/src/services/legacyAdminRuntimeSurface.test.js && node scripts/legacyAuthorizationRemoval.test.js && node backend/src/services/authorityMigrationService.test.js`  
Expected: 盘点 API、preview、apply/restrict、receipt 和刷新恢复真实可用；所有旧 admin 都有明确迁移结果，未选择者保持 restricted，个人资产、审计和档案 ID 不丢失。

- [ ] **Step 7：提交**

```bash
git add backend/src/services/legacyAdminMigrationService.js backend/src/routes/legacyAdminMigrations.js src/components/LegacyAdminMigrationWizard.tsx backend/src/app.js backend/src/services/authorityMigrationService.js backend/src/services/authorityCommandRegistry.js backend/src/services/authorityHostCommandProcessor.js backend/src/services/authorizationPolicy.js backend/src/services/userRoleGrantService.js backend/src/services/authorityRoleGrantAdapter.js backend/src/services/authorityRoleMirrorService.js backend/src/services/miniappIdentityService.js backend/src/services/miniappAccessPolicy.js src/pages/AccountAccessCenter.tsx src/services/systemSettingsRolePolicy.mjs miniapp/src/utils/permission.ts scripts/release-matrix.js backend/src/services/legacyAdminMigrationService.test.js backend/src/routes/legacyAdminMigrations.http.test.js backend/src/services/legacyAdminRuntimeSurface.test.js scripts/legacyAuthorizationRemoval.test.js gateway/src/middleware/auth.js gateway/src/middleware/permission.js gateway/src/services/authorizationPolicy.js gateway/src/services/authorityRoleMirrorService.js gateway/src/routes/cloudRelay.js gateway/src/routes/permissions.js gateway/src/routes/modules.js gateway/src/websocket/authMiddleware.js gateway/src/websocket/authorityRelayRouter.js gateway/src/services/legacyAdminRuntimeSurface.test.js
git commit -m "refactor: 迁移并停用旧管理员权限"
```


### Task 21：建立真实账户、权限、设备和业务端到端验收

**Files:**
- Create: `scripts/realIdentityDevicePermissionBusinessE2e.js`
- Create: `scripts/realIdentityDevicePermissionBusinessE2e.test.js`
- Create: `scripts/fixtures/identity-device-business-fixture.js`
- Create: `scripts/packagedDesktopIdentityPermissionE2e.js`
- Create: `scripts/packagedDesktopIdentityPermissionE2e.test.js`
- Modify: `scripts/real-two-desktop-e2e.js`
- Modify: `package.json`
- Create: `docs/verification-account-permission-device-final.md`
- Test: `scripts/realIdentityDevicePermissionBusinessE2e.test.js`
- Test: `scripts/packagedDesktopIdentityPermissionE2e.test.js`

- [ ] **Step 1：建立真实进程拓扑**

测试启动临时 Gateway、云 Backend、数据主机 Backend、WebSocket、中继、真实临时 SQLite、临时题库盘、两个 Electron user-data 和小程序 H5/微信开发版。账户、数据库、command、receipt、projection、设备锚、安装 vault、账户分区、快照和 UI 必须走正式代码。

- [ ] **Step 2：限制测试替身**

只有微信登录凭证、高德 POI 和不可控外网可以使用 adapter。adapter 只能返回外部响应，不得直接写 user、profile、device、link、school、asset、command 或 receipt 表。

- [ ] **Step 3：场景 A——零精确候选的教学端注册自动完成**

数据主机没有匹配教师档案。用户在教学端填写真实姓名、学校别名，完成手机号验证并注册；断言账户、teacher role、teacher profile、profile contact、school alias submission、active binding、默认 scope、audit 和 host receipt 都真实落库，UI 才显示教师注册完成。全程不存在 profile approval 记录；随后依次完成设备回执、设置 PIN/建立分区、下载并提交快照，才签正式 session/离线许可。“今日工作台”和其他 teacher 默认页面都可按 manifest 直接进入，host-only 页面不可进入。

- [ ] **Step 4：场景 B——精确候选转超级管理员匹配**

数据主机预建一个同 verified phone 的未绑定 teacher profile 和历史课表。教学端注册后断言没有新 teacher profile，状态为 `profile_match_pending`，只能访问身份区，课程/课表/收费 API 全部 403。超级管理员从真实“账户与权限→档案匹配”页面刷新、选择并批准；receipt 后原 profile 绑定、历史授权快照下载，业务页面才开放。再用只有手工微信号精确相同的候选验证不可批准：补充 verified provider/phone 后可绑定；若证据重算后全部判非，`resolve-create-after-review` 可完成注册。最后建立两个同精确联系方式的重复候选：直接批准必须禁用；真实执行 merge preview，制造字段冲突时 apply 失败零写入，消除冲突后 apply 获得 receipt，刷新 claim 后才能绑定保留档案。

- [ ] **Step 5：场景 C——模糊相似不误阻止自动建档**

预建同名同校但手机号/微信 provider 均不同的教师档案；新用户注册必须走零 blocking candidate 自动建档。断言候选排序可以显示参考警告，但不产生人工待审、不合并两个 profile、两位老师的数据范围互不可见。

- [ ] **Step 6：场景 D——卸载重装仍识别同设备**

记录 `device_id/installation_id/anchor fingerprint`，关闭 Electron，删除测试 user-data 中 installation/account 目录但保留专用 CNG 测试 anchor，重新启动并在线登录。断言 device_id 不变、installation_id 变化、旧 installation=replaced、重新下载快照、没有普通设备审批记录。

- [ ] **Step 7：场景 E——锚丢失和硬件候选**

删除专用测试 anchor，使用相同真实硬件采样重新登录。断言 decision=`reinstall_candidate`、新 device/anchor 和替换审计存在、必须重新账户认证、不会继承旧本地草稿。

- [ ] **Step 8：场景 F——克隆和风险阻断**

复制 installation vault 到第二测试 user-data，并用不同测试 anchor 启动。断言 registration/session 返回 `DEVICE_RISK_BLOCKED`；主机“设备与风险”页出现事件；点击“认定克隆并撤销”后收到真实 receipt，原正常 installation 的处置符合选择。

- [ ] **Step 9：场景 G——同机多账户**

同一 anchor/installation 依次登录老师 A 和老师 B。断言一个 device、两个 account-device links、两个 account partitions；A/B 课程、草稿、资产、快照、PIN、offline license 和 outbox 互不可见。切换账户必须先清空 AccessContext 和数据 facade。

- [ ] **Step 10：场景 H——撤销和30天离线**

只撤销 A link，A 在线立即失效、B 正常；重新授权 A 后签发许可证，测试时钟第29天可离线，第30天锁定，草稿仍在；回拨系统时间被锁定；联网续签后恢复。

- [ ] **Step 11：场景 I——逐页面权限、API 鉴权和家庭额外授权**

测试从 `shared/pageAccessManifest.js`、`backend/src/services/businessRouteAccessManifest.js` 和 `shared/authorityCommandAccessManifest.js` 自动生成全量矩阵，不手写少数页面：对每个 PageKey 断言侧栏/首页卡片/直接导航的真实 DOM，对每个 action capability 调正式 HTTP/command 并核对 2xx/403、receipt 和数据库结果；manifest 新增项未产生场景即失败。统计全部页面切换，断言不重复请求 `/me/context`；篡改 page key、query/body 中的 teacher_id/user_id/owner_id 和 Renderer AccessContext，后端仍拒绝越权。主机向 visitor 创建家庭 invitation：接受前家庭 API 零数据；小程序明确接受后只见指定脱敏课表/资产汇总。主机授予 detail/export 后入口生效并高亮，撤销后页面即时清空、snapshot 收缩，越权草稿进入可真实查看/导出的 quarantine 页且不能同步。

- [ ] **Step 12：场景 J——学校和题库**

桌面注册、档案编辑和小程序提交不同学校别名，主机映射后统一；题库在线获取并缓存体系目录，304 不重复正文，破坏缓存或切换 host epoch 后强制重取，切换 A/B 账户不串目录。停主机后只显示当前账户已验签目录，查询/组卷/导出均拒绝；授权快照扫描不到题目字段和文件。

- [ ] **Step 13：场景 K——旧管理员真实迁移与运行时退役**

准备一个有个人资产、设备、教师候选和旧权限的 admin。主机第七个“旧管理员迁移”标签读取真实清单，preview 后选择 teacher/visitor、档案处理、待接受家庭邀请和明确 miniapp capabilities；apply receipt 后验证资产 owner/审计不丢、session 版本失效。另一个未选择账户执行 restrict；开启 cutover flag 后任何旧 admin 路由、页面和 session 均不能放权，关闭 flag＋恢复测试备份可回滚。

- [ ] **Step 14：保存可复核证据**

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

- [ ] **Step 15：禁止源码字符串测试冒充 E2E**

`realIdentityDevicePermissionBusinessE2e.test.js` 必须启动主脚本并检查进程退出码、receipt、数据库断言和截图清单；只读取源码并 `includes()` 的测试不能计入发布门禁。`packagedDesktopIdentityPermissionE2e` 预先校验 dist-host/dist 安装产物、测试 app id 和隔离 VM 防护，在 Task 22 构建后以安装后的 exe 和独立 userData 重跑零候选注册、精确候选、设备/PIN/首次快照、同机双账户、全部页面守卫和离线解锁；源码 Electron 启动结果不能替代它。

- [ ] **Step 16：运行**

Run: `npm run test:real-identity-device-permission-business`  
Expected: PASS；任何页面无真实接口、command 无 receipt、主机未落库、越权、串分区、题目泄漏或虚假截图清单都使退出码非零。

- [ ] **Step 17：提交**

```bash
git add scripts/realIdentityDevicePermissionBusinessE2e.js scripts/realIdentityDevicePermissionBusinessE2e.test.js scripts/fixtures/identity-device-business-fixture.js scripts/real-two-desktop-e2e.js package.json docs/verification-account-permission-device-final.md scripts/packagedDesktopIdentityPermissionE2e.js scripts/packagedDesktopIdentityPermissionE2e.test.js
git commit -m "test: 增加账户权限设备真实业务验收"
```

### Task 22：备份、迁移、统一发布和回滚验证

**Files:**
- Modify: `scripts/release-matrix.js`
- Modify: `scripts/check_deploy_readiness.js`
- Modify: `scripts/check_miniapp_release.js`
- Modify: `scripts/verify-installed-primary-host-runtime.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/release-version-matrix.md`
- Modify: `docs/verification-account-permission-device-final.md`
- Create: `docs/verification/account-permission-device-trust-rollout.md`

- [ ] **Step 1：建立发布前阻断清单**

先运行 `npm run release:prepare` 建立本次发布矩阵，再运行 `python scripts/backup-cloud-release.py` 和 `node scripts/backup-local-host-release.js`；Gateway 备份由后续 `scripts/deploy_gateway.py` 在上传前强制创建。数据主机、云 Backend 和 Gateway 的数据库/代码备份必须分别产生路径、hash、quick_check 和只读恢复验证证据；同时导出旧 admin、空档案角色、重复联系方式、旧设备授权、pending challenge、孤儿 grant/lease、单账户 sync device、学校别名冲突。任一备份无回执或 unresolved P0 阻止发布。

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

- [ ] **Step 4：封版、固定版本并推送可部署源码**

按 `auto-version-bump` 规则统一递增根包、host/client 构建和小程序上传版本；运行 `git diff --check`，确认工作树只含本计划文件。显式暂存 Task 22 的脚本、版本和验证文档，创建 release candidate commit；随后执行 `git fetch gewu master` 和 `git merge-base --is-ancestor gewu/master HEAD`，只有远端 master 是当前 HEAD 祖先时才运行 `git push gewu HEAD:master`。记录 commit SHA；远端已前进时停止并先安全整合，禁止 force push。后续所有部署必须声明并核对同一 SHA。

- [ ] **Step 5：按兼容顺序部署云端**

```text
python scripts/deploy.py deploy
  -> python scripts/deploy_gateway.py
  -> node scripts/check_deploy_readiness.js
  -> 核对 backend/gateway release receipt、内外网 health 和版本
  -> 若任一步失败，停止后续端发布并按已记录备份回滚
```

兼容云端必须先识别旧/新协议，但 cutover flag 保持关闭；随后才升级数据主机、上传小程序和发布教学端。观察 V2 注册/迁移成功率并确认旧客户端最低兼容窗口后，最后开启旧普通设备路由 410。

- [ ] **Step 6：数据主机升级和真实验收**

运行 `node scripts/prepare-isolated-primary-host.js` 构建隔离 runtime，先在副本迁移并验收，再运行 `node scripts/promote-primary-host-runtime.js` 安装到本机数据主机，最后运行 `node scripts/verify-installed-primary-host-runtime.js`。核验 host epoch、主机私钥、题库盘、账户中心、设备风险中心、档案审核、身份认领、家庭权限、学校治理、投影签名、device/snapshot receipt 和审计截图；任何脚本需要交互参数时以其当前配置/usage 为准并把实际命令记录到 rollout 文档，不猜测参数。

- [ ] **Step 7：阿里云真实验收**

核验公网/内网健康、限速、WebSocket、中继、bootstrap token 隔离、receipt 校验、设备撤销、410 旧接口、日志脱敏；确认云端没有全量业务库、客户端私钥和硬件原值。

- [ ] **Step 8：微信小程序真实验收**

先运行 `npm run miniapp:release-check`，再运行 `npm run miniapp:upload`，保存平台返回的版本/上传回执，并运行 `node scripts/check_miniapp_review_readiness.js`。用开发版核验 visitor/teacher/student/family、邀请接受、角色申请、身份认领、共享课表、个人/家庭资产、题库在线/缓存目录、无权限和离线状态。上传成功不等于审核发布；若白名单、审核或发布权限阻断，只能标记“部分发布/受阻”。

- [ ] **Step 9：构建和发布桌面端**

Run:

```bash
npm run dist:win:host
npm run dist:win
npm run test:packaged-identity-device-permission
npm run publish:desktop-host-update
npm run publish:desktop-update
npm run rebuild:node
npm run verify:electron-native-abi
```

Expected: host/client 安装包完成；隔离 Windows VM 中安装后的教学端注册—设备—PIN—快照—页面/API—双账户—离线链路 PASS；随后 latest.yml、OSS feed 和 native ABI 校验全部通过。

- [ ] **Step 10：更新版本矩阵和回滚点**

记录云端版本、数据主机版本、schema version、小程序上传版本、桌面 feed 版本、迁移完成率和证据目录。任一适用端未完成只能标记“部分发布”或“受阻”。

- [ ] **Step 11：收口发布状态、最终证据提交和推送**

四端均成功时运行 `npm run release:complete`；任一端失败时不要调用 complete，把矩阵写成“部分发布/受阻”并记录回滚或续作入口。然后：

```bash
git status --short
git add scripts/release-matrix.js scripts/check_deploy_readiness.js scripts/check_miniapp_release.js scripts/verify-installed-primary-host-runtime.js package.json package-lock.json docs/verification/account-permission-device-trust-rollout.md docs/release-version-matrix.md docs/verification-account-permission-device-final.md
git commit -m "release: 记录账户权限与持久设备信任发布证据"
git fetch gewu master
git merge-base --is-ancestor gewu/master HEAD
git push gewu HEAD:master
```

执行前必须确认前述各 Task 已分别提交，且上述显式路径之外的改动均为用户或其他任务所有；不得用 `git add -A` 混入无关工作树内容，不得 force push。

只有四端证据齐全、真实业务 E2E 通过、安装包/feed/小程序上传回执存在且 Node native 环境恢复后才能标记并宣称“发布完成”。

## 9. 真实入口—接口—权威结果—业务测试映射

| 功能 | 真实用户入口 | 正式接口/命令 | 权威结果 | 必须通过的真实验收 |
| --- | --- | --- | --- | --- |
| 无账户排课档案 | StudentList/TeacherList | `profile.unclaimed.create` | teachers/students，无 account binding | 可排课但不能登录 |
| 教师注册零精确候选 | 教学端身份门 | `account register`＋`teacher-registration.resolve.v1` | user/teacher role/new profile/binding/scope/receipt | 无人工审批，快照后 teacher 默认页面可用 |
| 教师注册有精确候选 | 教学端身份门＋主机账户中心 | registration status＋profile claim/evidence commands | 不建新 profile；强证据批准或全部判非后新建 | 未验证微信号不能单独绑定，也不会形成注册死锁 |
| 模糊相似档案 | 教学端身份门 | registration resolve | 独立新 profile/binding | 同名同校不误拦且数据不串 |
| 页面权限上下文 | 教学端侧栏/首页卡片/直接 page key | signed AccessContext＋page manifest | 本地统一路由状态 | 切页不重复查 ID，伪造上下文仍被 API 拒绝 |
| 档案候选刷新/重复档案 | 主机账户中心 | refresh＋merge preview/apply commands | 候选证据、冲突、保留档案和 receipt | 多候选必须选择；重复先安全合并，冲突时 UI/API 都禁批 |
| 档案批准 | 主机账户中心 | approve command | profile binding/audit/receipt | receipt 后才开放 scope |
| 微信身份认领 | 小程序＋主机账户中心 | identity claim command | account identity/audit | 批准前不能进入目标账户 |
| 额外权限 | 主机权限编辑器 | access override command | capability/scope/version | 高亮且高危能力不可授予 |
| 家庭关系 | 主机家庭页＋小程序家庭页 | invitation/accept/reject/revoke commands | membership/scope/audit | 接受前零数据，撤销后即时失效 |
| 首次新设备 | 教学端身份门自动流程 | device registration＋snapshot receipt | device/install/link/account-installation receipt | 无人工审批；PIN/快照前无正式 session，主机离线不放行 |
| 卸载重装同设备 | 教学端重新登录 | anchor proof＋registration | 同 device、新 installation | CNG anchor 保留时稳定识别 |
| 锚丢失重装 | 教学端重新登录 | hardware evidence host command | reinstall candidate/audit | 重新认证，不继承本地草稿 |
| 克隆阻断 | 自动＋主机风险中心 | risk resolve command | blocked/revoke receipt | 复制 vault 不能直接使用 |
| 同机多账户 | 教学端账户切换器 | account-device link | 一 device、多 links | 分区、PIN、快照、草稿隔离 |
| 撤销单账户 | 本人设备页/主机中心 | link revoke | 单 link/session/license revoked | 同设备其他账户正常 |
| 撤销整台设备 | 主机风险中心 | device revoke | device/all links revoked | 全账户失效并留审计 |
| 30天离线 | 教学端离线身份门 | host signed offline license | 本地许可 | 29天可用，30天锁定保草稿 |
| 首次授权数据 | 初始化页 | snapshot manifest/chunks/commit | 原子快照/receipt | 全历史授权范围且无题库 |
| 权限收缩 | 自动初始化页＋隔离草稿页 | replacement snapshot＋本地受限导出 IPC | 新 active snapshot/quarantine | 越权行消失，草稿可查看/导出但不可同步 |
| 学校归一 | 主机学校别名页 | canonicalization command | canonical/alias/business IDs | 两端统一且保留 raw |
| 题库目录 | 桌面/小程序题库页 | catalog API | 按账户/authority/host epoch 隔离的签名只读缓存 | 304/损坏/换 epoch 正确，离线只看当前账户目录 |
| 题库使用 | 在线题库页 | question API/host task | 数据主机题库结果 | 主机/题库盘不可用即拒绝 |
| 家庭资产 | 小程序家庭资产页 | household asset API | household-owned records | 汇总/明细/写入/导出严格分离 |
| 旧管理员迁移 | 主机迁移向导 | migration command | 新角色/关系/能力 | 无决定则 restricted |
| 主机迁移恢复 | 主机安全中心 | primary-host routes | host epoch/credential receipt | 普通设备自动注册不能替代 |

任何一行缺少真实可达页面、后端鉴权、数据主机权威事务、最终 receipt 或真实业务测试，都不能标记完成。

## 10. 设备安全不变量

1. 账户密码/微信身份只证明人，设备锚只证明持有原设备环境，安装密钥只证明当前安装；三者不得互相替代。
2. hardware fingerprint 永远不能单独签发 session、link、offline license 或业务 scope。
3. TPM/CNG 私钥、安装私钥、账户数据密钥、PIN、主机私钥不得进入 Renderer、日志、审计、云数据库或测试证据。
4. Credential Manager/DPAPI software fallback 通常可跨普通应用卸载保留，但清 Windows 凭据/用户配置后会失效；safeStorage 文件兜底不保证卸载清数据后仍可识别。锚失效时只能依赖硬件候选并重新在线认证。
5. “同一设备”按当前 Windows 用户＋设备锚定义；切换 Windows 系统用户默认视为新的设备环境。
6. 一台 trusted device 可以有多个 account-device links；一个账户也可以有多台设备。
7. 设备全局撤销和账户 link 撤销是两个不同命令，不得复用含糊的 `revokeDevice`。
8. installation/link 未 active、PIN/账户分区未就绪、account-installation state 未 active、profile binding 缺失或 snapshot 未 committed 时，不能加载任何受保护 teacher 业务页面，也不能签正式 session/offline license；身份区仍可用。
9. 数据主机身份、迁移和恢复永远不走普通设备自动登记分支。
10. 离线许可固定最长30天，不滑动；高危操作、同步和题库永远需要在线短会话。
11. 旧 pending approval 不继承信任；旧 active authorization 也必须在线证明后才能迁移。
12. 客户端请求中的 user/role/device/installation/teacher/student/owner/scope 全部由服务端签名上下文覆盖；页面本地上下文不能替代服务端逐请求鉴权。

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
