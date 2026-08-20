# PostgreSQL 17 vNext 控制面 Copy-Only 迁移演练设计

**状态：** 已冻结的本地 synthetic 演练规格；不构成真实数据迁移、生产注入或发布授权。

## 决策

实现一个只在测试中可用的控制面 copy-only 演练器。它从 closure-branded、内存中的 synthetic legacy SQLite 快照读取；仅向 closure-branded、可销毁的 PostgreSQL 17 disposable target 写入。它不接受路径、连接串、环境变量、CLI 参数、真实 SQLite handle 或原始 PG client。

该演练器直接兑现控制面计划中的 source fingerprint、mapping ledger、replay/conflict 与 rollback artifact 要求，同时不依赖被否决的 PG writer/procedure 身份路径。它不导入业务域、题库、文件、财务、桌面 profile、真实 session/token 或任意真实用户数据。

## 候选比较

1. 直接实现 PG procedure 或 writer DML：拒绝。数据库侧身份 bridge 目前正式 no-go，直接写会绕过身份准入门禁。
2. 提前导出业务域或做真实 shadow import：拒绝。业务 repository、catch-up、恢复和切换门禁尚未具备，且会触碰必须保留的桌面业务数据。
3. 连接真实 RDS/ECS 或做多端发布：拒绝。云身份、成本、TLS、备份恢复与部署授权均未完成。
4. **选定：synthetic control-plane copy-only rehearsal。** 已有精确 M1–M15 schema/catalog、disposable PG17 target 和本地 SQLite 依赖；成本近乎为零，且能验证迁移的关键安全属性。

## 边界和对象

新增一个 `shared/vnext-pg17/` 演练模块、一个只供测试创建的 synthetic source factory，以及对应 focused test。source factory 以 memory-only `better-sqlite3` 建立固定的 `legacy_control_plane_*` 表，返回 opaque source assertion；演练模块只接受该 assertion 与同一 disposable runtime 签发的 target handle。两种品牌均使用模块私有 WeakMap/WeakSet，不能由 `{}`、复制对象、跨 factory 句柄或 Proxy 伪造。

目标数据库必须：

- 已通过精确 M1–M15 catalog assertion；
- 在演练前没有任何 control-plane data rows，只有迁移 ledger/schema metadata；
- 由 disposable runtime 签发的 rehearsal 专用 facade 写入；该 facade 不暴露通用 fixture-provisioner，也不能被其他 module、raw client 或另一 runtime 使用；
- facade 在实际 query 前记录 runtime-issued trace，并且只允许单一 transaction 内的精确全限定 `INSERT` 与预定义 `SELECT`。它拒绝 DDL、DCL、`SET ROLE`、trigger disable、`CALL`、`COPY`、临时对象和任意未列入 manifest 的 SQL；
- 在成功、失败或中断后由 disposable runtime 销毁。演练器不返回该 facade、数据库身份、连接参数、SQL、源值或原始行。

source 永远以 SQLite read-only transaction 读取；演练前后均计算全 source table/row logical fingerprint。演练结束只返回深冻结、脱敏的计数、stable-ID/key-set 哈希、mapping-ledger 哈希、目标逻辑哈希、source fingerprint 和 rollback 状态，不返回真实/原始记录。

## 固定 source allow-list 与映射

source factory 的允许 collection 是下表的映射 collection 与后文的 inert archive collection 的并集；任何其他 collection、缺失必需映射 collection、重复表名或业务域 collection 都是 `VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID`：

| Source collection | Target relation | 处理 |
| --- | --- | --- |
| `authorities` | `vnext_authorities` | 必须恰一条 active authority；stable ID 原样映射。 |
| `accounts` | `vnext_accounts` | 仅该 authority 的 active/inactive opaque account 事实。 |
| `trustedDevices` | `vnext_trusted_devices` | 仅 device 身份/版本/状态。 |
| `installations` | `vnext_device_installations` | 仅 installation key/fingerprint/版本/状态。 |
| `links` | `vnext_account_device_links` | 仅 authority-local account/device/install 绑定与版本。 |
| `roleGrants` | `vnext_role_grants` | 只保留已验证的 formal-vNext 非 active 历史；拒绝 legacy scalar role 和任何 active grant。 |
| `capabilityCatalog` | `vnext_capability_catalog` | 仅显式 capability 事实；不 seed 默认能力。 |
| `capabilityOverrides` | `vnext_capability_overrides` | 只保留非 active 历史 allow/deny；拒绝 active override。 |
| `dataScopeGrants` | `vnext_data_scope_grants` | 只保留非 active 历史 opaque scope hash；拒绝 active scope，不关联业务表。 |
| `profileBindings` | `vnext_profile_bindings` | 保留 opaque teacher/student profile binding，不创建业务 profile。 |
| `verifiedContacts` | `vnext_verified_contacts` | 只保留 opaque hash/evidence，不含电话或微信原文。 |
| `receipts`、`auditEvents`、`outboxEvents` | 三个授权 evidence relation | 只导入已自洽的既有耐久 evidence；不派发 outbox。 |

精确 inert archive collection 为可为空的 `legacySessions`、`legacyDeviceGrants`、`legacyOfflineLicenses`、`legacyCredentials`、`legacyTokens`、`legacyPasswords`、`legacyPrivateKeys` 和 `legacyBackups`。它们只进入**inert archive inventory**：报告记录 collection count/hash，不保留行内容，且永不向任何 PG17 relation 写入。`legacySessions`、`legacyDeviceGrants`、offline license、credential、token、password、private key、backup 内容及任意业务 collection 不得伪装成映射 collection。

因此演练绝不激活旧 session、重认证、设备授权或离线许可；成功 target 中 `activeRoleGrantCount`、`activeCapabilityOverrideCount`、`activeScopeGrantCount`、`activeSessionCount` 和 `activeReauthenticationCount` 均必须为零。

source values必须已符合目标表已冻结的类型、时间、hash、FK、唯一性和 lifecycle 约束。演练器不猜测、不修复、不合并、不生成 ID、不正则化原文、不把冲突改成默认值。它按 target FK 顺序写入 collection，并以 stable ID、collection、source-row canonical hash、target-key canonical hash 和 outcome 形成 mapping ledger。

## 原子性、冲突与重放

每次演练在 target 的单一 transaction 内执行。演练开始前必须确认 target 数据区完全为空、source只有一 authority、target catalog/ACL 精确。中途出现任一 source drift、unknown collection、行 hash 不一致、跨 authority reference、duplicate active key、目标约束错误、mapping ledger collision、hook interruption或逻辑 hash 不等价时：

1. rollback target transaction；
2. 再断言 target data rows 回到空集，schema/ledger/catalog 没有变化；
3. 重算 source fingerprint，若与开始不同，报告 `SOURCE_CHANGED`；
4. 返回固定、脱敏的 rollback artifact，包含 failure stage/code、before/after target logical hash 与 source before/after fingerprint。

同一 source snapshot 对一个空 target 的 exact 重试产生同一逻辑 report；它不会创建第二 authority，也不会产生另一套 stable IDs。对已成功写入的同一个 target 再调用则明确拒绝，不尝试 merge 或补写。不同 snapshot、相同 stable ID 或相同 active unique key 的冲突必须 fail closed 并留在 rollback artifact 中。

## 可验证报告

成功报告至少包含：

- `status: 'rehearsed'`、固定 schema version 5 与 migration version 15；
- source before/after fingerprint（相同）、source collection counts 和 inert archive counts/hash；
- 每个允许 collection 的 input count、mapped count、stable key-set hash；
- canonical mapping-ledger hash、target logical relation hash 与 row-count map；
- `authorityCount: 1`、`activeRoleGrantCount: 0`、`activeCapabilityOverrideCount: 0`、`activeScopeGrantCount: 0`、`activeSessionCount: 0`、`activeReauthenticationCount: 0`、`outboxDispatchedCount: 0`；
- `rollback: { attempted: false, restoredEmpty: false }`。

失败报告或错误不包含 source row、SQL、文件路径、凭据、手机号、profile ID 原文、hash 原文或数据库连接信息。它只公开固定 code 和上文允许的脱敏 stage/count/hash。所有输出均深冻结。

## 测试合同

测试仅创建 synthetic source 和 disposable PG17。至少证明：

1. 成功映射后的 source fingerprint、ID/key-set、count 与 target logical hashes 相符，target catalog仍精确，且没有 session/reauth/outbox dispatch；
2. source 前后行/表快照完全不变；目标已成功时重新执行被拒绝，fresh target 的 exact snapshot 重演得到相同 report；
3. unknown/business collection、第二 authority、cross-authority FK、duplicate active key、row hash collision、来源中途变更和 source/target品牌伪造均零写失败；
4. 每个 target write stage 的 injected interruption均完整 rollback，并得到恢复空 target 的 artifact；
5. legacy session/device grant archive只出现在脱敏 inventory，formal role/override/scope 历史均保持 non-active，绝不写 active session、reauth、token、license或权限；
6. runtime-issued query trace只包含固定 transaction、全限定 INSERT 与预定义 SELECT；任何 DDL/DCL/角色切换/trigger bypass/未列 SQL 均 fail closed；
7. target catalog/ACL drift、非空 target、raw client/path/env/config injection、异常读写/clock/hook均 fail closed；
8. disposable runtime cleanup、现有 M1–M15 manifest/catalog、PG target aggregate和 diff check继续通过。

## 非目标与后续门禁

本演练器不是生产 importer、迁移 CLI、自动 repair、业务 repository、shadow/catch-up、真实数据库备份、RDS/ECS 操作、writer procedure、API、outbox dispatcher、桌面发布或多端切换。它不将任何 rehearsal 输出视为可用于真实注入的 artifact。

只有本演练器的覆盖、独立质量审计和真实业务域 repository/restore/catch-up 门禁均通过后，才可单独讨论一个真实 source adapter 或 non-production shadow rehearsal。PG writer/procedure identity no-go 决策在该过程中保持不变。
