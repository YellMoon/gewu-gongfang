# 首四张业务基础表：迁移批次、隔离区与可恢复影子导入准入设计

**状态：** 设计冻结；仅定义未来本地合成/可销毁影子环境的准入合同。它不授权读取 `D:\新建文件夹\gewu-gongfang`、创建 RDS、写入任何真实云端行、部署导入器或发布客户端。

## 目标与非目标

本设计只覆盖已具备本地可销毁 DDL 证据的四个关系：`tenants`、`institutions`、`schools`、`rooms`。目标是在未来使每一条准入行都能被确定地追溯、重放、隔离、对账，并在尚未有后续业务写入时安全撤回影子结果。

它不覆盖其余十四个 canonical 业务关系、题库文字、题库富媒体、账户/会话/设备、权限、业务 API、生产写入身份、真实 RDS、NAS、增量追赶或正式切换。旧 SQLite 和任何恢复包仍是受保护的迁移来源，不是新系统权威。

## 方案选择

1. **推荐：独立 migration-admission 边界。** 未来使用独立 schema、独立 manifest/catalog 和封闭影子执行器保存批次与行级结果；四张业务表保持其现有独立 DDL ledger。这使行准入不会偷渡为业务 runtime 的普通写权限。
2. **不采用：复用旧 inventory bundle 当作行导入协议。** `migrationBundleProtocol` 的 inventory-only 覆盖、泛 ledger 状态和文件工作流不能证明目标库中同事务的行幂等、隔离或条件性撤回。它最多可在独立审计后复用 canonical JSON/SHA-256 表示及密封包思路。
3. **不采用：直接对 business 表批量写入。** 这会绕过 source 指纹、逐行 hash、隔离、quarantine、重放冲突与恢复证据，也会把当前零业务写能力误作导入授权。

## 未来边界与身份

未来实现必须新增独立、版本化且可哈希的 `migration_admission` schema/manifest/catalog，且由其自身不可变、连续版本的 DDL apply ledger 证明 fresh/reapply 与 manifest 一致；不得复用或修改 `vnext_control_plane` M1--M15、`business.business_schema_migrations` 或已冻结四表 migration。DDL trigger 只保护连续版本与 hash 形状，apply/assert 边界以固定 manifest 比对精确 hash，避免自引用 hash。其执行器只能接收已验证的合成影子 batch capability，不能接收 SQL、连接串、路径、任意 callback、任意业务 writer 或调用方选定的 relation。

影子执行器只可指向每次新建且可销毁的 local disposable PostgreSQL 17 数据库。它必须拒绝非空目标、错误 catalog、错误 manifest、错误 schema、跨 runtime capability、已关闭 capability、并发重入和不确定事务终端。它不能成为 RDS、业务 runtime 或生产导入器的适配器。

## Batch 身份与不可变账本

每个 batch 必须有不可变、非敏感的 `batch_id`，并精确绑定以下已验证事实：

- source snapshot identity、分别不可变的 before/after inventory hash 与 source table-contract fingerprint；
- source-table catalog hash；
- 四个 relation 各自的 mapper version；
- 已应用 business DDL manifest hash；
- 影子目标 identity、创建时间和用户确认事实的最小 hash；
- canonical bundle hash、签名/密封 envelope identity（如未来启用）；
- 影子目标 identity/用户确认绑定、上述全部事实（含 before/after inventory、source schema）的 canonical `batch_request_sha256`（同一目标内唯一且由纯输入合同逐字段重算）；
- 执行结果的 count、stable-key-set hash 与 canonical logical hash（只进入不可变 event，不回写 batch 身份）。

batch 身份表本身不可更新或删除。状态由独立、只追加的 batch-event 账本表达；每个 event 记录 batch、严格递增 sequence、闭合状态、闭合 event code、event hash 与有限时间。初始状态只能为 `prepared/PREPARED`，随后只能 `prepared → running → reconciled|quarantined|failed|abandoned`；仅已 reconciled 的 batch 可追加 `rolled_back`。失败 event code 只可为 `SOURCE_SNAPSHOT_CHANGED`、`SOURCE_SCHEMA_DRIFT`、`TARGET_CATALOG_DRIFT`、`TARGET_NONEMPTY`、`RECONCILIATION_MISMATCH` 或 `TRANSACTION_UNCERTAIN`；其他状态使用与状态一一对应的闭合 code。任何未定义状态、跳号或非法转换都失败关闭。普通日志、receipt、audit/outbox 不得保存源路径、原始行、联系方式、自由文本、密钥或密封 payload。

## 行级准入与重放

每条候选记录的唯一事实为：`batch_id + source_relation + source_primary_key_hash`。行账本至少记录 canonical source hash、目标 stable identity/hash、relation mapper version、归一化 outcome code、quarantine reference 与提交时间。`admitted` 行必须有非空 target identity、target logical hash 和唯一 `ADMITTED` code；`quarantined` 行必须没有 target 字段且使用闭合 quarantine code。每一条 quarantined 行必须恰有一条同键 quarantine，admitted 行则不得有 quarantine；此配对在提交时由延迟约束守卫验证。

- 同一唯一事实且 canonical source hash 相同：只允许返回已有结果，零额外 business 写入。
- 同一唯一事实但 hash 不同：固定为冲突，不能覆盖、合并或猜测。
- 缺字段、空 stable ID、无效 UTC 时间、无效布尔/整数/decimal、重复目标身份、缺 tenant、目标 hash 不匹配或不在 approved mapper 中：只准进入 quarantine 或使 batch 失败；绝不静默修复。

依赖顺序固定为 `tenants → institutions → schools → rooms`。`institutions`、`schools`、`rooms` 只能引用同一 batch 中已被验证的 tenant；跨 tenant、跨 batch 或猜测式关联一律拒绝。

## 隔离区与敏感数据

quarantine 只保存稳定、最小、非敏感的 relation、source primary-key hash、canonical hash、枚举失败码及密封工件引用。原始行、联系方式与可能含 PII 的 notes 只能在未来另行批准的加密 sealed artifact 中保存；它们不得进入 PostgreSQL 普通列、通用日志、错误、outbox、审计或导出。

失败码必须是固定枚举，至少覆盖 `SOURCE_SNAPSHOT_CHANGED`、`SOURCE_SCHEMA_DRIFT`、`SOURCE_ROW_INVALID`、`DEPENDENCY_MISSING`、`IDENTITY_CONFLICT`、`CANONICAL_HASH_CONFLICT`、`TARGET_CATALOG_DRIFT`、`TARGET_NONEMPTY`、`RECONCILIATION_MISMATCH` 与 `TRANSACTION_UNCERTAIN`。

## 对账、恢复与撤回

在 batch 变为 `reconciled` 前，执行器必须在独立只读事务中重读目标，逐 relation 比对 source/target 的 row count、stable-key set 与 canonical logical hash。四项结果均一致才可报告影子成功。

“可恢复”有两层，不能混用：

1. **合成影子环境：** 任何写阶段失败、hash 不匹配或事务不确定都要 rollback；终端不确定时 capability 必须 poison/close。确认成功的影子 batch 可通过销毁整套 disposable target 撤回。
2. **未来真实切换：** 不能笼统删除已导入行。只有目标仍无后续业务写入、batch/target hash 与版本完全匹配、恢复工件通过验证且获得单独授权时，才可执行条件性撤回并写入恢复 receipt；否则只允许停止切换、保留证据并走人工恢复流程。

## 开始读取旧数据盘前的硬门禁

以下全部完成前，任何 D 盘读取、SQLite 快照、真实 source export 或真实 cloud shadow 都不被允许：

1. 本设计对应的独立实施计划、TDD 和审计通过。
2. 用户一次性指定精确只读根/文件；realpath allow-list、SQLite WAL/SHM、一致快照与 source before/after fingerprint 均可验证。
3. 四张实际 source 表的 DDL fingerprint 与已批准逐列映射完全一致。
4. PII/密封工件的加密、访问、留存和销毁合同已单独批准。
5. disposable shadow executor 已证明 failure/poison/replay/quarantine/reconciliation/rollback 全部失败关闭。
6. 对真实 source read 和任何真实 RDS shadow 分别获得独立授权。

## 后续验证合同

未来第一份实现计划必须先搭建合成 batch fixtures，而不是连接旧 source。它应证明：四关系的依赖顺序、重复重放、hash 冲突、缺 tenant、逐类 quarantine、全量重读对账、每个写阶段 rollback、终端不确定 poison、目标非空拒绝、catalog drift 拒绝以及整套 disposable target 销毁后无残留。只有这些测试和独立审计通过，才可申请真实 source 的一次性只读授权。
