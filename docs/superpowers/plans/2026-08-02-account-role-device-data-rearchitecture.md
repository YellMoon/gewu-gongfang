# 账户、档案、家庭权限、设备与授权数据重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将账户、角色、教师/学生档案、家庭权限、普通桌面设备、授权数据副本、题库在线访问、学校名称和家庭资产收敛为一套由数据主机最终授权、所有入口真实存在、所有权限由后端强制执行并具有真实业务端到端测试的多端架构。

**Architecture:** `users.id` 是不可替换的账户主体，`teachers.id/students.id` 是不可替换的业务档案主体；角色标签、档案绑定、能力、数据范围、家庭关系和终端准入分别建模。阿里云负责账户认证和中继，数据主机负责档案绑定、权限决定、授权投影和题库权威数据；普通桌面在账号认证后静默登记设备公钥并取得数据主机签名的 30 天离线租约，不再人工审批普通设备。

**Tech Stack:** Electron 28、React 18、TypeScript 4.9、Ant Design 5、Node.js、Express、SQLite/better-sqlite3、WebSocket、Taro 3/微信小程序、Playwright、现有 authority command/projection 协议、Windows safeStorage。

---

## 1. 最终讨论结论

### 1.1 账户与档案

- 不使用“备用账户 ID”。真实账户 ID 和教师/学生档案 ID 都保持稳定，后续只改变关系表。
- 超级管理员和老师可先创建没有账户、没有设备的教师/学生档案供排课使用。
- 教学工作端首次启用时，老师可注册账号并填写自身档案申请；教学端强制申请意图为 `teacher`。
- 小程序首次注册可选择学生、老师或仅使用个人/家庭功能；角色标签可立即建立，但角色本身不泄露业务数据。
- 教师/学生业务权限要求“有效角色 + 数据主机已审核的活动档案绑定 + 可计算的数据范围”。只有角色、没有档案绑定时只能进入申请/等待页面。
- 自助“创建自身档案”先形成申请。如果已有唯一匹配档案则绑定；如果没有候选，超级管理员可在同一审核事务中创建档案并绑定。云端不能直接写权威教师/学生表。

### 1.2 匹配与审核

- 手机号、人工填写的微信号只作匹配线索，不作主键。
- 微信 `openid/unionid` 是登录凭据，不能与人工填写的微信号字符串比较。
- 联系方式保存原值、规范值、来源和验证状态。手填手机号标记 `self_asserted`，不能伪称短信已验证。
- 只有精确规范化联系方式相交、档案未被其他活动账户占用、账户未绑定其他同类档案、角色/租户/档案数据无冲突时才能批准。
- 多候选、已占用、互相矛盾的已确认联系方式、行版本过期都会禁用 UI 按钮；绕过 UI 调批准接口也必须失败。
- 游客提出角色申请和注册时默认角色提出的档案申请复用同一审核引擎。

### 1.3 角色、关系和终端

- 正式基础角色为 `super_admin`、`teacher`、`student`；没有正式角色授权时派生为 `visitor`。
- `admin` 停止新授予；存量账号经过迁移向导处理后，从正式运行时删除。
- “家人”是可叠加关系标签，不是互斥角色；同一个人可以同时是老师和家人。
- 数据主机端只允许超级管理员；教学工作端只允许已绑定档案的老师；小程序允许所有账户登录。
- 超级管理员可在数据主机给用户增加或关闭允许委派的小程序能力；角色提供默认能力组合。
- 档案审核、权限规则管理、主机迁移恢复、学校真名治理、题库体系修改、备份恢复和权威全库访问不可额外委派。

### 1.4 权限公式

```text
有效能力 =
  终端能力白名单
  ∩ ((角色默认能力 ∪ 家庭关系默认能力 ∪ 用户显式允许) - 用户显式禁止)

最终数据 =
  能力涉及的数据类型
  ∩ 角色数据范围
  ∩ 家庭/共享数据范围
  ∩ 数据主机确认的资源范围
```

“模块勾选”只是管理 UI。实际保存的是操作能力和数据范围。例如资产必须拆为个人读写、家庭汇总读取、家庭明细读取、家庭写入和导出。

### 1.5 普通桌面设备

- 取消普通桌面申请、批准和拒绝；保留公钥、最后在线、撤销和风险审计。
- 新设备先用账号密码或已登录小程序身份证明账户，再为 `{installationId,userId}` 生成独立 Ed25519 密钥对。
- 私钥只保存在 safeStorage 保护的本机账户分区；数据主机和云只保存公钥。
- 同一电脑允许多账户登录，显示提示但不阻止；每个账户有独立密钥和加密分区。
- 新设备首次业务登录必须联网。数据主机不可达时只显示“账户已验证，等待数据主机签发授权和首次数据”。在线会话和同步命令租约继续保持分钟/小时级，30 天只用于签名离线许可证，绝不能把写命令授权延长到 30 天。
- 数据主机用自己的 host signing key 签发 30 天离线租约；到期锁定业务页面和同步，但保留数据和草稿。
- 这项选择有明确安全代价：设备完全离线时无法即时收到撤权，普通业务缓存最迟在 30 天租约到期时停止访问。权限版本变化在线立即失效；数据主机管理、档案审核、权限管理、题库体系和备份恢复从不允许离线执行。
- 数据主机设备仍保留严格 host epoch、迁移、恢复和私钥保护，不受普通设备简化影响。

### 1.6 新设备数据

- 新设备下载账户权限范围内全部结构化业务数据，不按时间窗口截断。
- 包含课程、课表、关联学生、必要教师/学校/机构/教室、授权费用和个人/家庭资产。
- 不包含题目、答案、解析、图片和题库附件。
- 下载使用签名 manifest、稳定排序、分块、哈希、断点续传和原子切换。
- 权限扩大补齐范围；权限缩小清除活动缓存中的越权数据，把未同步草稿移入只读加密隔离区。
- 新设备不能恢复旧设备从未同步的草稿，界面必须明确提示。

### 1.7 题库

- 题库实际操作要求在线、数据主机健康、移动硬盘挂载并且 authority binding 正确。
- 普通授权投影不包含完整试题，也不建立题目索引或正文离线缓存；本轮只缓存体系目录。
- 体系目录持久只读缓存，包含科目、年级、教材、章节和知识/模型/方法/能力节点及版本、哈希、签名；不含题干和附件。
- 打开模块先显示缓存，再检查 ETag/版本。离线时标记“缓存目录”，查询、选题、编辑、组卷、导出全部禁用。
- 体系定义只允许数据主机超级管理员修改；老师可按业务规则在线使用题库，但不能修改体系定义或从普通端删除已入库试题。

### 1.8 学校

- 各端允许自由填写学校原始名称；原始输入先成为别名。
- 数据主机维护规范学校和别名映射。学生保存 `school_raw/school_alias_id/school_id`。
- 规范学校唯一性按“行政区划 + 规范化全称”，避免全国同名误合并。
- 模糊匹配和网络搜索只能给候选，不能自动合并。
- 数据主机可配置高德 Web 服务 Key 获取 POI 名称、地址、行政区和 ID；未配置时明确显示不可用，手工治理仍可完成。

### 1.9 家庭课表和资产

- 建立家庭实体和成员关系；关系可叠加任意基础角色，默认只在小程序生效。
- 课表共享绑定明确 teacher/student 档案，默认只返回时间、展示名、地点和状态，不返回学生电话、学费、课时费和内部备注。
- 个人资产归 `user_id`，家庭资产归 `household_id`。家庭汇总、明细和写入分别授权。

## 2. 当前项目已确认的差距

- `authority_role_bindings` 仍把角色与 `subject_id` 混在一起，且允许教师/学生无档案时产生活动授权。
- `AuthorityRoleApplicationsPanel` 已有真实审核投影和命令草稿入口，但仍有“直接授予管理员”，并挂在设备中心内部。
- `desktop_identity_challenges/desktop_device_authorizations` 仍要求普通设备微信验证和另一设备批准。
- `deviceLeaseService` 当前最大租约仅 1 小时，不是确认的 30 天模型。
- `authorizationPolicy/effectiveCapabilities`、Gateway、miniapp 权限和多处导航仍包含 `admin`。
- `authorityProjectionService` 会给 admin/super_admin 投影完整题目和 taxonomy。
- `schools` 只有 name 精确字符串，学生仍直接保存 `school`。
- 资产只有 `owner_user_id`，没有 household 所有权和家庭数据范围。
- 小程序仍注册 `pages/admin/users/index`，与“敏感管理只在数据主机”冲突。

## 3. 本计划替代的旧设计

- 替代 `docs/superpowers/specs/2026-07-30-user-identity-role-scope-architecture.md` 中正式 admin 和管理员全量权限。
- 替代 `docs/superpowers/specs/2026-07-17-desktop-human-identity-multi-device-design.md` 中普通设备人工批准和 14 天离线；保留主机迁移/恢复安全设计。
- 替代角色表的 `subject_id` 直接充当档案绑定真相。
- 替代普通授权投影携带完整题库。
- 替代学校名称精确字符串即同一学校。

## 4. 目标状态机

```text
账户：account_registered -> intended_role_assigned -> profile_claim_submitted
    -> host_received -> candidate_ready | candidate_conflict | no_candidate
    -> approved_existing | approved_create | rejected -> profile_binding_active

设备：account_authenticated_online -> local_key_created -> public_key_registered
    -> host_authorization_pending -> initial_snapshot_downloading -> online_ready
    -> offline_ready(<=30天) -> offline_locked(>30天或撤权)
```

角色标签不等于业务授权；`profile_binding_active` 才产生 teacher/student 数据范围。普通设备没有 `pending_approval/approved_by_other_device`。

## 5. 目标核心表

```sql
CREATE TABLE authority_profile_bindings (
  profile_binding_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('teacher','student')),
  profile_type TEXT NOT NULL CHECK(profile_type IN ('teacher','student')),
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('candidate','active','rejected','revoked')),
  match_evidence_json TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX idx_profile_binding_active_profile
  ON authority_profile_bindings(authority_id,profile_type,profile_id) WHERE status='active';
CREATE UNIQUE INDEX idx_profile_binding_active_user_role
  ON authority_profile_bindings(authority_id,user_id,role) WHERE status='active';

CREATE TABLE households (
  household_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE authority_user_capability_overrides (
  override_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  surface TEXT NOT NULL CHECK(surface IN ('miniapp','desktop-client','primary-host')),
  reason TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE authority_data_scope_grants (
  scope_grant_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('self','teacher_profile','student_profile','household')),
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE account_device_registrations (
  registration_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked','retired')),
  credential_version INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(authority_id,installation_id,user_id),
  UNIQUE(authority_id,key_fingerprint)
);

CREATE TABLE account_identity_claims (
  identity_claim_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  applicant_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('wechat_openid','wechat_unionid')),
  provider_subject_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  reject_reason TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_identity_claim_live_subject
  ON account_identity_claims(authority_id,provider,provider_subject_hash)
  WHERE status IN ('pending','approved');
```

另建 `account_credentials`、`account_contact_points`、`profile_contact_points`、`household_memberships`、`canonical_schools`、`school_aliases`；资产表增加 `owner_type/owner_id`。旧字段在兼容阶段保留，但不能继续作为放权依据。

## 6. 文件边界

- 新共享契约：`shared/accessModel.js`、`shared/profileBindingProtocol.js`、`shared/authorizedSnapshotProtocol.js`、`shared/questionCatalogProtocol.js`。
- 新后端核心：`accountCredentialService.js`、`accountIdentityClaimService.js`、`profileContactService.js`、`profileBindingService.js`、`effectiveAccessService.js`、`householdService.js`、`silentDeviceRegistrationService.js`、`offlineLeaseService.js`、`authorizedSnapshotService.js`、`schoolCanonicalizationService.js`、`questionCatalogCacheService.js`。
- 新数据主机页面：`src/pages/AccountAccessCenter.tsx`，含档案审核、用户权限、家庭和学校别名标签页。
- 新教学端服务：`accountAuthClient.mjs`、`silentDeviceClient.mjs`、`authorizedSnapshotClient.mjs`、`questionCatalogCache.mjs`。
- 新小程序页面：`pages/family/index`、`pages/family-assets/index`。

---

## 7. 分模块实施步骤
### Task 1：统一契约和可回滚数据库迁移

**Files:**
- Create: `shared/accessModel.js`
- Create: `shared/profileBindingProtocol.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Test: `backend/src/services/accessSchemaContract.test.js`
- Test: `backend/src/services/accountRoleProfileMigration.test.js`

- [ ] 先写失败测试：正式角色只有 super_admin/teacher/student；无档案 teacher/student 只能得到 onboarding；目标新表、唯一索引和旧库幂等迁移存在。
- [ ] 运行 `node backend/src/services/accessSchemaContract.test.js && node backend/src/services/accountRoleProfileMigration.test.js`，确认因契约/表缺失而失败。
- [ ] 在 `shared/accessModel.js` 固定角色、终端、能力目录、角色默认组合和不可委派能力；加入 `profile.unclaimed.create`，允许超级管理员和已绑定老师创建没有账户/设备的排课档案；不允许数据库任意新增能力字符串。
- [ ] 在 schema 和 `DatabaseService` 幂等迁移中创建新表；为活动 account phone/openid/unionid 增数据库唯一约束，profile 联系方式允许重复但必须触发候选冲突；只新增，不删除旧 `users.role`、`subject_id`、设备审批和 `students.school`。
- [ ] 在本任务立即冻结旧 `/api/admin/users/:id/review` 写入并要求题库 GET 认证，防止后续迁移期间继续产生双重真相；Task 4A 再完成所有路由的统一能力/scope 适配。
- [ ] 迁移旧 `authority_role_bindings`：只有非空且存在的 teacher/student subject 才写活动档案绑定；空 subject 只保留角色标签；重复/缺失档案写报告并使预演失败。
- [ ] 在隔离数据库副本运行迁移两次，验证记录数、外键、唯一性、历史业务 ID 和审计不变。
- [ ] 运行 `npm run test:authority-architecture`；预期全部通过。
- [ ] 提交 `feat: 建立账户角色档案分离契约`。

### Task 2：档案申请、候选匹配和数据主机审核闭环

**Files:**
- Create: `backend/src/services/profileContactService.js`
- Create: `backend/src/services/profileBindingService.js`
- Create: `backend/src/services/accountIdentityClaimService.js`
- Create: `backend/src/routes/profileClaims.js`
- Create: `backend/src/routes/accountIdentityClaims.js`
- Create: `backend/src/routes/hostAccountAccess.js`
- Modify: `backend/src/services/roleApplicationService.js`
- Modify: `backend/src/services/authorityCommandRegistry.js`
- Modify: `backend/src/services/authorityProjectionSourceService.js`
- Modify: `backend/src/app.js`
- Test: `backend/src/services/profileBindingService.test.js`
- Test: `backend/src/routes/profileClaims.http.test.js`
- Test: `backend/src/routes/hostAccountAccess.http.test.js`

- [ ] 先写失败测试：唯一手机号、微信号规范匹配、无候选、多候选、档案占用、账户已绑其他档案、并发占用、行版本过期、重复批准幂等、拒绝原因必填。
- [ ] 手机号规范化为大陆号码；微信号只做 NFKC、trim、ASCII 小写。姓名/拼音/学校相似度只能排序提示，不能满足批准条件。
- [ ] `POST /api/profile-claims` 接收 requestedRole 和 proposedProfile；服务端从会话覆盖 user/authority/source。教学端只允许 teacher，小程序允许 teacher/student。
- [ ] 新增真实命令：`profile-claim.submit.v1`、`refresh-matches.v1`、`approve-existing.v1`、`approve-create.v1`、`reject.v1`、`profile-binding.revoke.v1`。
- [ ] 云端只排队和中继；数据主机命令处理器才可写 teachers/students/profile bindings。
- [ ] 修复现有小程序登录直接绑定 openid 的旁路：新 visitor 可绑定首次创建的自身账户；已有密码账户必须用密码确认后绑定微信；无法用密码确认时创建 `account-identity-claim` 并在数据主机账户中心审核，批准前不覆盖原账户 openid、不签发原账户正式角色令牌。
- [ ] 修复 `roleApplicationService.approve()`：不能再通过 `subjectId=null` 生成正式业务范围。`resolveActingScope()` 对缺档案角色返回 `kind:'onboarding'`。
- [ ] “绑定已有档案”事务内重算候选、校验唯一、写绑定、递增 grant/auth version、撤销旧会话、写审计并发布投影。
- [ ] “创建并绑定”只在无精确候选时允许；同一事务创建档案和活动绑定，任一步失败全部回滚。
- [ ] 保留并测试排课档案独立创建：超级管理员和已绑定老师可通过真实 StudentList/TeacherList 命令创建无账户、无设备档案；创建结果可立即排课，但不会自动创建账户或绑定关系。
- [ ] Host API 提供分页、待审数、刷新候选、冲突详情、两种批准、拒绝和撤销；同时检查 primary-host、active epoch、super_admin、近期会话和命令签名。
- [ ] 运行 `node backend/src/services/profileBindingService.test.js && node backend/src/routes/profileClaims.http.test.js && node backend/src/routes/hostAccountAccess.http.test.js && npm run test:authority-architecture`。
- [ ] HTTP 测试必须使用真实临时 SQLite、Express router、command inbox 和 receipt，不能用内存数组模拟审核成功。
- [ ] 提交 `feat: 实现账户档案匹配审核闭环`。

### Task 3：教学工作端账号注册和自身档案申请

**Files:**
- Create: `backend/src/services/accountCredentialService.js`
- Create: `backend/src/routes/accountAuth.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/app.js`
- Create: `src/services/accountAuthClient.mjs`
- Create: `src/services/profileClaimClient.mjs`
- Modify: `src/components/DesktopIdentityGate.tsx`
- Create: `src/components/TeacherAccountOnboarding.tsx`
- Test: `backend/src/services/accountCredentialService.test.js`
- Test: `backend/src/routes/accountAuth.http.test.js`
- Test: `src/components/TeacherAccountOnboarding.test.js`

- [ ] 先写失败测试：手机号规范化、密码规则、重复账户、错误密码限速、禁用、密码版本变化、教学端强制 teacher、注册后课程 API 为 403、私钥字段上传被拒。
- [ ] 建 `account_credentials(user_id,password_hash,password_version,failed_attempts,locked_until,password_changed_at,created_at,updated_at)`。
- [ ] 使用已有 `bcryptjs`，cost=12；密码、hash、完整认证 body 不进入日志、审计或 command envelope。
- [ ] 实现 `POST /api/auth/account/register`：创建账户、teacher 角色标签和档案申请，不创建业务权限。
- [ ] 实现 `POST /api/auth/account/login`：验证账号密码，只签发短期设备登记令牌。
- [ ] 实现修改/恢复密码：当前密码、已登录小程序近期会话或数据主机一次性重设令牌三选一；手填手机号不能单独找回。
- [ ] 教学端身份门提供“登录账号”“注册老师账号”“等待档案审核”三条真实路径。
- [ ] 后端返回 `account_ready/profile_pending/profile_conflict/profile_rejected/teacher_ready`；只有 teacher_ready 挂载业务 App。
- [ ] 运行 `node backend/src/services/accountCredentialService.test.js && node backend/src/routes/accountAuth.http.test.js && node src/components/TeacherAccountOnboarding.test.js && npm run typecheck`。
- [ ] 提交 `feat: 支持教学端老师账号和档案申请`。

### Task 4：家庭关系、按用户能力和数据范围

**Files:**
- Create: `backend/src/services/effectiveAccessService.js`
- Create: `backend/src/services/householdService.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/services/authorizationPolicy.js`
- Modify: `backend/src/services/authorityAccessService.js`
- Modify: `backend/src/services/dataScopeService.js`
- Modify: `backend/src/services/miniappAccessPolicy.js`
- Modify: `gateway/src/services/authorizationPolicy.js`
- Test: `backend/src/services/effectiveAccessService.test.js`
- Test: `backend/src/services/householdService.test.js`
- Test: `gateway/src/services/effectiveAccessParity.test.js`

- [ ] 先写失败矩阵：老师+家人、游客+家人、额外小程序资产权限不能登录桌面、deny 覆盖 allow、高危能力不可委派、家庭课表只限指定档案、汇总不等于明细、伪造 scope 被覆盖。
- [ ] 完整创建 household membership、capability override 和 data scope grant 表，所有变更记录 granted_by/reason/expiry/audit。
- [ ] 实现 `resolveEffectiveAccess()`，返回 baseRoles、relationships、capabilities、逐能力 scopes、来源和 grantVersion。
- [ ] 固定默认组合：super_admin@host；已绑定 teacher@desktop；student@miniapp；visitor@miniapp；family@miniapp 只通过明确 scope 共享数据。
- [ ] 不可委派清单至少含 profile review、access manage、taxonomy manage、school alias manage、host manage、backup manage。
- [ ] 删除 `grantAdmin()` 新入口和命令；旧 admin 只返回 `legacy_admin_migration_required`，不能签发新 admin 桌面会话。
- [ ] Backend、Gateway、host 使用同一 fixture 得到同一能力和 scope；Gateway 只能验证主机签名结果，不能放大。
- [ ] 运行 `node backend/src/services/effectiveAccessService.test.js && node backend/src/services/householdService.test.js && node gateway/src/services/effectiveAccessParity.test.js && node scripts/authorityRoleMatrixE2e.test.js`。
- [ ] 提交 `feat: 建立家庭关系与按用户权限范围`。

### Task 4A：封闭双重角色真相、旧审核写口和原始 REST 越权旁路

**Files:**
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
- Modify: `backend/src/services/miniappIdentityService.js`
- Modify: `gateway/src/middleware/permission.js`
- Test: `backend/src/routes/unifiedAccessBoundary.http.test.js`
- Test: `backend/src/routes/legacyReviewRetirement.http.test.js`
- Test: `backend/src/routes/miniappIdentityClaim.http.test.js`

- [ ] 枚举 `backend/src/app.js` 和 Gateway 挂载的每条业务路由，建立“能力、读 scope、写 scope、终端、主机要求”清单；没有清单项的路由默认拒绝。
- [ ] 先写真实 HTTP 失败测试：未登录 GET 题库/学生被拒；老师不能读写其他老师课程、学生、缴费和学校管理；伪造 teacher_id/owner_user_id 无效；super_admin 只在允许终端通过。
- [ ] 新建统一 `requireCapabilityAndScope(capability, resourceResolver)` 中间层，服务端从会话和权威绑定构造上下文，覆盖客户端 tenant/role/teacher/student/owner/device 字段。
- [ ] 原始 students/teachers/courses/schedules/payments/consumptions/schools 路由逐条接入能力和行级范围；无法安全适配的旧写口返回 410，并引导到 authority command。
- [ ] `/api/question-bank` 所有 GET 也必须认证并检查 `question.online.use`；不能利用 `requireWriteAccess` 对 GET 直接放行。
- [ ] 修复 `requireCoreReadAccess` 的角色集合和 super_admin 判断，删除 admin/operator 旧默认放权。
- [ ] 冻结 `/api/admin/users/:id/review`、旧 teacher binding 和旧 role mutation 写口，统一返回 410；唯一写入真相是 profile claim/role/access authority command。
- [ ] 小程序已有账户的 openid 绑定必须走密码确认或真实 identity claim 审核；`accountIdentityClaimService` 只保存 provider subject 的不可逆摘要，原始 openid 只在加密身份表中保存；受限 identity-claim token 不得读取原账户业务数据。Task 5 账户中心提供待审入口、冲突信息、批准/拒绝和 receipt。
- [ ] 运行 `node backend/src/routes/unifiedAccessBoundary.http.test.js && node backend/src/routes/legacyReviewRetirement.http.test.js && node backend/src/routes/miniappIdentityClaim.http.test.js && npm run test:backend`。
- [ ] 提交 `security: 封闭旧审核和业务路由授权旁路`。
### Task 5：数据主机“账户与权限中心”真实入口

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
- Delete after replacement: `src/components/AuthorityRoleApplicationsPanel.tsx`
- Test: `src/pages/AccountAccessCenter.test.js`
- Test: `src/components/ProfileClaimReviewPanel.test.js`
- Test: `src/components/AccountIdentityClaimReviewPanel.test.js`

- [ ] 用真实临时后端写页面失败测试：侧栏可达、待审角标、候选刷新、冲突禁用、批准 receipt、状态刷新。
- [ ] 数据主机侧栏新增“账户与权限”；教学端不渲染，直接构造 page key 也被路由守卫拒绝。
- [ ] 账户列表支持姓名/手机号/角色/绑定/家庭/额外权限筛选；展开显示默认、额外 allow、deny、范围、终端、授权人、原因、有效期和审计。
- [ ] 增加“账户身份绑定”待审标签页，处理既有账户的微信 openid identity claim；批准事务必须重新校验目标账户未绑定其他 openid，显示最终 receipt。
- [ ] 档案审核显示精确匹配证据和全部冲突；提供刷新、绑定已有、创建并绑定、拒绝。只有草稿没有最终 host receipt 时不得显示“审核成功”。
- [ ] 能力编辑器按具体操作展开：角色默认灰色、关系默认绿色、额外允许蓝色、显式禁止红色；保存必须选 scope 并填原因。
- [ ] 家庭管理从真实账户中添加成员，选择课表档案和资产范围；没有账户的人只提示先注册，不虚构用户。
- [ ] 从 IdentityDeviceCenter 移出角色审核，并删除“直接授予管理员”。设备页面仅保留设备记录/撤销和主机迁移恢复。
- [ ] 运行 `node src/pages/AccountAccessCenter.test.js && node src/components/ProfileClaimReviewPanel.test.js && npm run typecheck && node scripts/hostIdentityUiProfile.js`。
- [ ] 保存宽屏和 1280×720 的待审、冲突、空态、失败、处理中和成功 receipt 截图。
- [ ] 提交 `feat: 建立数据主机账户与权限中心`。
### Task 6：普通设备静默登记和 30 天离线租约

**Files:**
- Create: `backend/src/services/silentDeviceRegistrationService.js`
- Create: `backend/src/services/offlineLeaseService.js`
- Create: `backend/src/routes/desktopDeviceRegistration.js`
- Modify: `backend/src/services/desktopIdentityService.js`
- Modify: `backend/src/services/desktopSessionService.js`
- Modify: `backend/src/services/deviceLeaseService.js`
- Modify: `public/desktopIdentityVault.js`
- Modify: `public/preload.js`
- Modify: `public/electron.js`
- Create: `src/services/silentDeviceClient.mjs`
- Modify: `src/services/desktopIdentityPartition.mjs`
- Modify: `src/components/DesktopIdentityGate.tsx`
- Test: `backend/src/services/silentDeviceRegistrationService.test.js`
- Test: `backend/src/services/offlineLeaseService.test.js`
- Test: `scripts/realMultiAccountSingleDeviceE2e.test.js`

- [ ] 先写失败测试：新设备离线首次登录拒绝、账号后登记公钥、私钥上传拒绝、同机两账户独立密钥、同账户多设备、30 天边界、grantVersion 失效、撤销保留草稿、primary-host 不能静默自报。
- [ ] Electron 主进程为每个 `{installationId,userId}` 生成 Ed25519 密钥；私钥经 safeStorage 保护，renderer 只调用签名 IPC。
- [ ] 登录返回一次性 registration token；客户端提交 installation ID、显示名、公钥和账户认证证明，服务端静默 upsert `account_device_registrations`。
- [ ] 数据主机拿到公钥后验证角色、活动档案绑定和授权版本，签发在线会话与离线租约，无超级管理员按钮。
- [ ] 保持在线 desktop session 和 authority command lease 的短有效期；`deviceLeaseService` 只做命名/边界兼容，不把命令租约扩展为 30 天。30 天由独立 `offlineLeaseService` 实现。
- [ ] 离线租约字段固定为 authority/user/registration/role/profileBinding/grantVersion/scopeFingerprint/issuedAt/expiresAt，使用当前 host epoch 私钥签名，客户端用 host 公钥验证。
- [ ] 有效期固定 `30 * 24 * 60 * 60 * 1000`；到期业务锁定，草稿和缓存不删除。
- [ ] 同设备第二账户显示提示并建立新分区；分区 key 包含 authority/user/registration，不以可猜 user ID 作为加密密钥。
- [ ] 旧普通设备 approve/reject 路径返回 410 `ORDINARY_DEVICE_APPROVAL_RETIRED`；主机 bootstrap/transfer/recovery 保持原流程。
- [ ] 运行 `node backend/src/services/silentDeviceRegistrationService.test.js && node backend/src/services/offlineLeaseService.test.js && node public/desktopIdentityVault.test.js && node scripts/realMultiAccountSingleDeviceE2e.test.js && npm run test:desktop-identity`。
- [ ] 真实 E2E 启动 Electron，让两个账号登录同一安装目录，验证两个服务端 registration、两个加密分区、没有普通设备待审记录。
- [ ] 提交 `feat: 普通设备改为账号认证后静默登记`。

### Task 7：新设备全量授权结构化数据初始化

**Files:**
- Create: `shared/authorizedSnapshotProtocol.js`
- Create: `backend/src/services/authorizedSnapshotService.js`
- Create: `backend/src/routes/authorizedSnapshots.js`
- Modify: `backend/src/services/authorityProjectionService.js`
- Modify: `backend/src/services/authorityProjectionSourceService.js`
- Modify: `backend/src/services/authorityProjectionPublisherService.js`
- Create: `src/services/authorizedSnapshotClient.mjs`
- Modify: `src/services/authorityProjectionCacheAdapter.mjs`
- Modify: `src/services/desktopCacheProjection.mjs`
- Modify: `src/services/browserDatabase.ts`
- Create: `src/components/InitialDataBootstrap.tsx`
- Test: `backend/src/services/authorizedSnapshotService.test.js`
- Test: `src/services/authorizedSnapshotClient.test.js`
- Test: `scripts/realNewDeviceAuthorizedDataE2e.test.js`

- [ ] fixture 包含三年前和当天记录、两位老师、完整题库、个人/家庭资产；先写测试要求老师 1 得到全部年份自身范围，不得得到老师 2 和题库实体。
- [ ] 定义 `gewu.authorized-snapshot.v1`：full kind、authority/user/registration、role/profileBinding、grantVersion、scopeFingerprint、hostEpoch、sourceVersion、collections/chunks/hash/signature/excludedDomains。
- [ ] 从普通投影删除 questions/question_contents/question_assets；题库目录走独立协议。
- [ ] 服务端先 `resolveEffectiveAccess()` 再查询可见行，不能加载全量后交前端过滤；集合稳定排序并分块记录 SHA-256、字节和数量。
- [ ] 客户端下载临时分区，逐块校验；全部通过后事务切换 active snapshot。失败保留旧完整快照和续传状态。
- [ ] 云只下发当前 host epoch 签名且 grantVersion/scopeFingerprint 一致的快照；没有合格快照返回 `INITIAL_SNAPSHOT_HOST_REQUIRED`。
- [ ] 权限扩大下载新增范围；缩小移除活动缓存越权行，并把旧未同步草稿放 `revoked-scope-drafts` 隔离区，提供导出/丢弃/等待重授权，绝不自动同步。
- [ ] 运行 `node backend/src/services/authorizedSnapshotService.test.js && node src/services/authorizedSnapshotClient.test.js && node scripts/realNewDeviceAuthorizedDataE2e.test.js`。
- [ ] E2E 使用两个 Electron user-data 目录和真实主机进程；第二台能打开历史课表，本地数据中不存在其他老师和题库实体。
- [ ] 提交 `feat: 新设备初始化全部授权结构化数据`。

### Task 8：学校真名、别名和联网候选

**Files:**
- Create: `backend/src/services/schoolCanonicalizationService.js`
- Create: `backend/src/services/schoolSuggestionProvider.js`
- Create: `backend/src/routes/schoolCanonicalization.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/routes/students.js`
- Modify: `backend/src/routes/schools.js`
- Modify: `backend/src/database.js`
- Modify: `src/pages/SchoolManager.tsx`
- Modify: `src/pages/StudentList.tsx`
- Modify: `src/services/browserDatabase.ts`
- Modify: `miniapp/src/types/index.ts`
- Modify: `miniapp/src/pages/student-detail/index.tsx`
- Test: `backend/src/services/schoolCanonicalizationService.test.js`
- Test: `backend/src/routes/schoolCanonicalization.http.test.js`
- Test: `scripts/realSchoolAliasE2e.test.js`

- [ ] 先写失败测试：全半角/空格、相同别名、异地同名、“一中/第一中学”不自动合并、离线别名同步、映射后统一展示且保留原值。
- [ ] 建 `canonical_schools`：authority、canonical/normalized name、country/province/city/district、address、provider/place ID、status；唯一键含行政区和规范名。
- [ ] 建 `school_aliases`：raw/normalized、canonical ID、source surface、pending/mapped/ignored、occurrence count、first/updated time。
- [ ] students 新增 `school_raw/school_alias_id/school_id`；题目或其他业务表凡存在 school 字段也增加同样的 raw/alias/id 关系，但题库学校元数据仍只存数据主机；旧 school 只作兼容展示，不再判同校。
- [ ] 桌面和小程序任意输入先创建 alias draft；主机 upsert alias，若已有映射则写 school_id，否则保持待归一。
- [ ] SchoolManager 增加待处理别名页：来源、次数、关联学生、候选；真实操作含映射已有、创建并映射、忽略、撤销错误映射和规范学校合并，均显示影响数和审计。
- [ ] 数据主机配置 `GEWU_AMAP_WEB_SERVICE_KEY`；provider 调高德地点搜索 v5，8 秒超时、24 小时缓存、限速。未配置/配额/网络错误分别显示；结果只作候选。
- [ ] 运行 `node backend/src/services/schoolCanonicalizationService.test.js && node backend/src/routes/schoolCanonicalization.http.test.js && node scripts/realSchoolAliasE2e.test.js`。
- [ ] E2E 从教学端和小程序提交两个别名，主机映射后两端显示同一规范名，数据库保留两个 raw alias。
- [ ] 提交 `feat: 建立学校真名与别名治理`。

### Task 9：题库在线使用和只读体系缓存

**Files:**
- Create: `shared/questionCatalogProtocol.js`
- Create: `backend/src/services/questionCatalogCacheService.js`
- Create: `backend/src/routes/questionCatalog.js`
- Modify: `backend/src/routes/questionBank.js`
- Modify: `backend/src/services/questionBankService.js`
- Modify: `backend/src/services/questionBankStorageService.js`
- Create: `src/services/questionCatalogCache.mjs`
- Modify: `src/pages/QuestionBank.tsx`
- Modify: `src/pages/QuestionBankEdit.tsx`
- Modify: `src/pages/QuestionBankPaper.tsx`
- Modify: `src/components/TaxonomyManager.tsx`
- Modify: `miniapp/src/pages/question-bank/index.tsx`
- Modify: `miniapp/src/utils/api.ts`
- Test: `backend/src/services/questionCatalogCacheService.test.js`
- Test: `backend/src/routes/questionCatalog.http.test.js`
- Test: `src/services/questionCatalogCache.test.js`
- Test: `scripts/realQuestionBankOnlineCacheE2e.test.js`

- [ ] 先写失败测试：首次无缓存离线、已有缓存离线、ETag 304、版本更新原子替换、损坏回退、主机在线但题库盘缺失、普通老师改体系 403、host super_admin 改体系成功、业务快照无题目。
- [ ] 目录只含 subjects/chapters/taxonomy systems/nodes/knowledge/model 的 ID、名称、父级、排序、状态、教材/年级；按规范 JSON 求 SHA-256 并由 host epoch 签名。
- [ ] 实现 `GET /api/question-catalog/version` 和 `GET /api/question-catalog`；返回 host/storage/operationsAvailable 状态并支持 If-None-Match。
- [ ] 查询、选题、录入、编辑、组卷、导出统一检查在线会话、`question.online.use`、主机健康和题库盘绑定；缓存不能充当题目数据源。
- [ ] 所有 taxonomy/subject/chapter/knowledge/model 写路由共用 `assertQuestionTaxonomyManager()`，要求 primary-host + super_admin + manage capability + active epoch；HTTP、命令处理器、存储层三重检查。
- [ ] 桌面/小程序打开先渲染签名缓存再查版本；离线显示“缓存目录，仅供查看”，实际操作按钮禁用且不发请求。
- [ ] 运行 `node backend/src/services/questionCatalogCacheService.test.js && node backend/src/routes/questionCatalog.http.test.js && node src/services/questionCatalogCache.test.js && node scripts/realQuestionBankOnlineCacheE2e.test.js`。
- [ ] E2E 挂载隔离题库目录，在线缓存后停止主机；只显示目录且操作不可发起；恢复并改体系后只更新目录。
- [ ] 提交 `feat: 题库改为在线使用并缓存体系目录`。

### Task 10：家庭课表、个人资产和家庭资产

**Files:**
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/services/personalAssetAccountService.js`
- Modify: `backend/src/services/personalAssetRecordService.js`
- Create: `backend/src/services/householdAssetService.js`
- Create: `backend/src/services/sharedScheduleService.js`
- Modify: `backend/src/services/authorityProjectionService.js`
- Modify: `backend/src/services/authorityBusinessMutationService.js`
- Modify: `src/pages/PersonalAssets.tsx`
- Create: `miniapp/src/pages/family/index.tsx`
- Create: `miniapp/src/pages/family-assets/index.tsx`
- Modify: `miniapp/src/pages/assets/index.tsx`
- Modify: `miniapp/src/app.config.ts`
- Modify: `miniapp/src/utils/miniappUiPageInventory.js`
- Test: `backend/src/services/householdAssetService.test.js`
- Test: `backend/src/services/sharedScheduleService.test.js`
- Test: `scripts/realFamilyMiniappE2e.test.js`

- [ ] 先写失败测试：本人资产、家庭只汇总、家庭明细、家庭写入四种组合；无明细权限 API 不返回明细；共享课表脱敏；老师+家人角色不互相覆盖。
- [ ] asset account/category/record 增 `owner_type('user','household')/owner_id`；旧 owner_user_id 迁为 user owner，兼容字段保留一版。
- [ ] 资产查询先计算 effective access；个人 owner 强制当前 user；家庭汇总在 SQL 聚合后只返回总额；明细和写入分别检查 capability+household scope。
- [ ] 共享课表按指定 teacher/student scope 生成白名单 DTO：id/start/end/displayTitle/room/status，不下发完整 schedule 再前端删字段。
- [ ] 小程序家庭页显示真实成员、共享课表和授权说明；资产页有“我的/家庭”，汇总-only 显示“未授权查看流水”。
- [ ] 新页面必须注册 `app.config.ts` 和页面清单，覆盖 visitor/teacher/student + family、无家庭、汇总、明细、写入、离线和无权限。
- [ ] 运行 `node backend/src/services/householdAssetService.test.js && node backend/src/services/sharedScheduleService.test.js && node scripts/realFamilyMiniappE2e.test.js && node miniapp/src/utils/miniappUiCoverage.test.js && npm --prefix miniapp run ci:weapp`。
- [ ] E2E 由主机 UI 给真实小程序账户授权；重登后只看到指定课表和汇总，直接请求未授权明细返回 403。
- [ ] 提交 `feat: 支持家庭课表共享与家庭资产`。
### Task 11：统一小程序角色、关系和额外权限体验

**Files:**
- Create: `miniapp/src/utils/effectiveMiniappAccess.ts`
- Create: `miniapp/src/components/ExtraPermissionBadge.tsx`
- Modify: `miniapp/src/utils/permission.ts`
- Modify: `miniapp/src/utils/miniappAuthorizationRuntime.js`
- Modify: `miniapp/src/utils/miniappAuthorizationSession.js`
- Modify: `miniapp/src/pages/login/index.tsx`
- Modify: `miniapp/src/pages/account-application/index.tsx`
- Modify: `miniapp/src/pages/index/index.tsx`
- Modify: `miniapp/src/pages/settings/index.tsx`
- Modify: `miniapp/src/custom-tab-bar/index.tsx`
- Delete after migration: `miniapp/src/pages/admin/users/index.tsx`
- Delete after migration: `miniapp/src/pages/admin/users/index.scss`
- Modify: `miniapp/src/app.config.ts`
- Modify: `miniapp/src/utils/miniappUiPageInventory.js`
- Test: `miniapp/src/utils/effectiveMiniappAccess.test.js`

- [ ] 先写角色+关系矩阵：super_admin/teacher/student/visitor 分别叠加 family；本地不得自行推导服务端未返回能力；grantVersion 降低清理缓存；额外能力高亮但角色标签不变。
- [ ] 首次注册显示“学生/老师/仅个人家庭功能”；前两者创建角色标签和档案申请，第三种派生 visitor；已有账户不重复选择。
- [ ] 申请页区分“角色标签已建立”和“档案待绑定”，显示主机接收、候选冲突、批准、拒绝原因和重新提交。
- [ ] 首页、tab、页面守卫和请求统一消费服务端签名 authorization snapshot；前端隐藏之外后端继续校验。
- [ ] 删除小程序管理员用户管理页、路由、API 和页面清单项；super_admin 在小程序也不能做档案/家庭/学校治理。
- [ ] 更新全页面清单，逐页覆盖五类基础身份、family 叠加、无权限、离线、缓存目录和有限写入；所有 navigateTo 状态页必须注册。
- [ ] 运行 `node miniapp/src/utils/effectiveMiniappAccess.test.js && node miniapp/src/utils/miniappAccessPolicy.test.js && node miniapp/src/utils/miniappUiCoverage.test.js && npm --prefix miniapp run ci:weapp`。
- [ ] 提交 `feat: 小程序统一角色关系与额外权限`。

### Task 12：旧管理员、旧普通设备审批和旧字段受控迁移

**Files:**
- Create: `backend/src/services/legacyAdminMigrationService.js`
- Create: `src/components/LegacyAdminMigrationWizard.tsx`
- Modify: `backend/src/services/authorityMigrationService.js`
- Modify: `backend/src/services/userRoleGrantService.js`
- Modify: `backend/src/services/desktopIdentityService.js`
- Modify: `backend/src/services/desktopSessionService.js`
- Modify: `backend/src/routes/adminUsers.js`
- Modify: `backend/src/routes/permissions.js`
- Modify: `gateway/src/routes/admin.js`
- Modify: `gateway/src/routes/permissions.js`
- Modify: `src/pages/PermissionManager.tsx`
- Modify: `scripts/release-matrix.js`
- Test: `backend/src/services/legacyAdminMigrationService.test.js`
- Test: `scripts/legacyAuthorizationRemoval.test.js`

- [ ] 先写迁移测试：旧 admin 全部进入清单；迁移前不能签发新 admin 桌面会话；必须为每人明确选择 visitor/teacher/student、家庭关系和能力；个人资产和审计不丢。
- [ ] 数据主机迁移向导展示每个旧 admin 的最近登录、档案、资产、可能家庭关系和旧权限；逐个确认，没有决定的账户保持受限状态。
- [ ] 旧普通设备在下一次账号在线登录时转换为 account device registration；无法证明账户归属的不自动激活，但保留本地数据和草稿。
- [ ] 切换闸门后不再用 `users.role`、legacy teacher/student scalar、permissions_data、旧普通 device approval 放权；兼容字段只读保留一个版本。
- [ ] 删除管理员授予、邀请码/模块矩阵、普通设备批准、普通管理员审核和小程序管理员页；旧 HTTP 返回 410 和真实替代入口。
- [ ] 运行 `node backend/src/services/legacyAdminMigrationService.test.js && node scripts/legacyAuthorizationRemoval.test.js && node backend/src/services/authorityMigrationService.test.js`。
- [ ] 扫描仅允许 `admin` 出现在迁移、历史 schema 和兼容测试，不允许出现在新能力、导航和会话签发。
- [ ] 提交 `refactor: 迁移并停用旧管理员和设备审批`。

### Task 13：真实业务端到端验收

**Files:**
- Create: `scripts/realAccountProfileBindingE2e.js`
- Create: `scripts/realFamilyPermissionE2e.js`
- Create: `scripts/realAuthorizedSnapshotE2e.js`
- Create: `scripts/realSchoolCanonicalizationE2e.js`
- Create: `scripts/realQuestionBankCacheE2e.js`
- Create: `scripts/realIdentityPermissionBusinessE2e.js`
- Create: `scripts/realIdentityPermissionBusinessE2e.test.js`
- Modify: `package.json`
- Modify: `docs/release-version-matrix.md`

- [ ] 启动真实 Gateway、云 Backend、数据主机 Backend、WebSocket、中继、两个 Electron user-data 和 Taro H5/微信开发版；使用临时 SQLite 和题库盘。
- [ ] 只有微信/高德外部边界可使用 adapter；账户、命令、审核、数据库、投影、UI、同步都必须走正式代码。
- [ ] 场景 A：主机创建无账户教师和历史课表；教学端注册、申请；未审核只有 onboarding；主机真实入口刷新并批准；receipt 完成；新设备静默登记并下载全部授权数据；打开历史课表；无其他老师/题库泄漏。
- [ ] 场景 B：两个档案同手机号，UI 禁用批准；直接 API 409；清理冲突后可批准；拒绝场景在申请人页面显示真实原因。
- [ ] 场景 C：visitor 小程序加入家庭，只共享指定课表和家庭汇总；不能看学生隐私、家庭明细或登录桌面；增加明细后生效且主机高亮额外权限。
- [ ] 场景 D：同机第二账户提示并隔离；租约内离线可用；测试时钟超过 30 天锁定但草稿仍在；在线恢复；撤销一设备不影响另一设备。
- [ ] 场景 E：桌面和小程序提交学校别名，主机映射后统一；题库在线缓存目录，停主机后只显示目录且操作禁用，恢复后只更新目录。
- [ ] 每次运行保存到 `output/business-e2e/<run-id>/`：版本、迁移报告、API 摘要、command/receipt ID、权限矩阵、泄漏断言、截图和 JSON 报告；先脱敏密码、token、私钥和手机号。
- [ ] package scripts 增 `test:real-identity-permission-business` 和 `test:release-identity-permission`，后者串联 authority、desktop identity、真实 E2E 和 miniapp CI。
- [ ] 运行 `npm run test:release-identity-permission`。任一审核只有草稿无 receipt、缺可达入口、直接 API 越权、旧 admin 仍放权都必须失败。
- [ ] 提交 `test: 增加账户权限架构真实业务验收`。

### Task 14：迁移、备份、统一部署和多端发布

**Files:**
- Modify: `scripts/release-matrix.js`
- Modify: `scripts/check_deploy_readiness.js`
- Modify: `scripts/check_miniapp_release.js`
- Modify: `scripts/verify-installed-primary-host-runtime.js`
- Create: `docs/verification-2026-08-02-account-role-device-data.md`
- Modify: `docs/release-version-matrix.md`

- [ ] 分别备份数据主机、云控制面和 Gateway 数据库；在副本预演，输出旧 admin、重复联系方式、无档案角色、设备转换和学校别名报告；未处理冲突阻止正式迁移。
- [ ] 运行 `npm test && npm run typecheck && npm --prefix miniapp run ci:weapp && npm run test:release-identity-permission && npm run test:release-matrix`。
- [ ] 部署顺序：兼容云 Backend/Gateway -> 数据主机升级和迁移向导 -> 小程序开发版上传核验 -> 教学端 OSS feed -> 关闭旧写路径。
- [ ] 数据主机真实验收：题库盘、host epoch、账户中心、档案审核、家庭授权、学校配置、投影签名、截图和 receipt。
- [ ] 阿里云真实验收：公网/内网健康、限速、WebSocket、快照、授权失效、410 旧接口、日志脱敏；云端无全量业务库和客户端私钥。
- [ ] 微信真实验收：visitor/teacher/student/family、申请、共享课表、个人/家庭资产、题库在线/缓存目录；上传成功不等于审核发布。
- [ ] 构建并发布：`npm run dist:win:host && npm run dist:win && npm run publish:desktop-host-update && npm run publish:desktop-update && npm run rebuild:node`。
- [ ] 更新版本矩阵。任一端未完成只能标记“部分发布/受阻”。
- [ ] 全部通过后提交 `release: 发布统一账户权限与设备架构` 并 `git push gewu master`。

## 8. 真实入口—后端—权威数据—业务测试映射

| 功能 | 真实用户入口 | 后端入口 | 权威结果 | 真实业务验收 |
| --- | --- | --- | --- | --- |
| 无账户排课档案 | 主机/教学端 StudentList、TeacherList | profile-unclaimed authority command | teachers/students，无 account binding | 创建后可排课，不产生账户、设备或业务登录权 |
| 老师注册 | 教学端身份门 | `/api/auth/account/register` | users/credential/role/claim | 注册后课程仍 403 |
| 微信身份认领 | 小程序登录恢复页、主机账户身份绑定页 | `/api/account-identity-claims` + command | identity claim/account identity/audit | 批准前无法进入目标账户，receipt 后才切换身份 |
| 档案申请 | 教学 onboarding、小程序申请页 | `/api/profile-claims` + command | 主机 profile claim | 云排队、主机接收、申请人状态一致 |
| 档案审核 | 主机账户与权限中心 | host access + receipt | profile binding + audit | UI 批准后 receipt 和权限同时生效 |
| 候选刷新 | 审核行刷新按钮 | host match refresh | 候选证据/冲突 | 多候选 UI/API 都不能批准 |
| 家庭授权 | 主机家庭标签页 | household/access command | membership/capability/scope | 小程序只见共享范围 |
| 额外权限 | 主机用户权限树 | access override command | override/audit/authVersion | 高亮且高危能力不可授予 |
| 新设备 | 教学端账号登录 | account login + silent register | registration/public key | 无普通设备人工审核，同机隔离 |
| 30 天离线 | 教学端离线身份门 | host signed lease verify | 本地签名租约 | 30 天内可用，过期锁定保草稿 |
| 首次数据 | 教学端初始化页 | snapshot manifest/chunks | 本地原子快照 | 全历史授权范围、无越权和题库 |
| 学校归一 | 主机学校别名页 | canonicalization route | canonical/alias/student IDs | 两端统一展示且保留 raw |
| 题库缓存 | 桌面/小程序题库页 | catalog route | 本地签名只读缓存 | 离线只看目录、操作全禁用 |
| 家庭资产 | 小程序家庭资产页 | household asset service | household-owned records | 汇总/明细/写入严格分离 |

任何一项缺少真实 UI 入口、服务端接口、权威落库或 receipt、端到端测试，都不能标记为完成。

## 9. 执行阶段与回滚边界

1. **身份基础：Task 1–3。** 新表和双读上线，教学端可注册，旧端仍兼容读取。
2. **权限设备：Task 4、4A–7。** 家庭能力、路由授权收口、主机账户中心、静默设备和全量快照完成。
3. **业务治理：Task 8–11。** 学校、题库目录、家庭资产和小程序完成。
4. **切换发布：Task 12–14。** 迁移旧 admin/设备路径，跑真实业务 E2E，统一发布。

每阶段都先备份并记录回滚点。Task 12 前不删除旧字段；Task 13 通过前不关闭兼容读取；Task 14 四端证据齐全前不宣称完成。

## 10. 计划自检标准

- 规格覆盖：本次讨论的账户/档案、默认角色、普通设备、30 天离线、全量授权数据、题库缓存、学校别名、管理员退出、家人权限和家庭资产均有对应 Task。
- 入口覆盖：每个审核/授权/归一操作均指定真实页面、接口、权威落库和 receipt。
- 安全覆盖：UI 隐藏不作为鉴权；所有高危能力不可委派；所有 scope 由服务端覆盖客户端输入。
- 测试覆盖：单元测试、真实 SQLite HTTP 集成、真实 Electron/小程序 UI、跨进程 E2E 和真实发布验证分层存在。
- 回滚覆盖：新表先加、旧字段兼容读取、迁移副本预演、数据库备份、分阶段关闭旧路径。


