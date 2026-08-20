# 云端权威 vNext 交付就绪记录

**状态：** 持续维护；本文件记录当前证据与交付门禁，不构成生产发布、数据迁移或云资源创建授权。

## 目标边界

本记录以[云端业务权威总纲](../specs/2026-08-13-cloud-authority-vnext-design.md)和[强制契约](../specs/2026-08-21-vnext-cloud-business-authority-architecture-contract.md)为唯一总体依据。云端数据库承载适用业务数据和题库结构化文字内容的唯一可写权威；账户、设备、权限、会话、审计、任务与正式业务命令均由云端服务裁决。

NAS/存储代理承载题库富媒体、导入原件、Word/PDF 产物、对象校验与备份，不裁决用户、权限或业务事务。旧桌面 SQLite、题库盘和本地数据是受保护的迁移来源、离线草稿缓存与恢复材料，不是新系统的业务权威。

旧的 control-plane-only 路线已降级为局部安全基础：其 PG17 schema、ACL、审计与设备设计可复用，但不能再作为“业务不得上云”或“本地主机裁决业务”的依据。

## 当前可验证成果

| 目标组成 | 当前证据 | 状态与边界 |
| --- | --- | --- |
| PostgreSQL 17 control-plane 基础契约 | M1–M15、精确 catalog/ACL/角色漂移断言、append-only 与 CAS 参考测试位于 `shared/vnext-pg17/` | 仅本地、合成、可销毁 PostgreSQL 17；它是全业务云端 schema 的安全基础，不是最终业务 schema。 |
| 云端业务基础 DDL | `business` 独立账本与 tenant/institution/school/room 四张空表，精确 catalog、PII 列权限、零 seed、控制面隔离、终端回滚和重放测试位于 `shared/vnext-pg17/` | 仅本地、可销毁 PostgreSQL 17；未读取或写入任何旧业务行，不是 source admission、shadow import、RDS schema 或业务 writer。 |
| 身份、设备与权限读取 | branded session verifier、AccessContext、策略/范围/近期重认证读取矩阵 | 只读 boundary；没有真实凭据验证器、token、HTTP/API 或生产连接。新设备在线验证成功后自动登记的运行时流程尚未实现。 |
| 首 authority 与紧急恢复语义 | SQLite 与 PG17 的 bootstrap/recovery reference、备份证据和回滚测试 | 参考实现，不是实际仪式、生产恢复器或云端初始化入口。 |
| 命令耐久事实 | role、policy publication、device-link revoke 的 receipt/audit/outbox/CAS/replay reference 与 PG17 parity | 语义 oracle；现有 writer 零直接 DML、零 procedure `EXECUTE`，不能承担生产命令。 |
| 数据迁移与保留 | synthetic copy-only rehearsal、源隔离、历史权限与 profile/contact 元数据的非激活边界 | 仅证明局部结构；真实业务数据、题库文字、富媒体对象、影子迁移和回滚尚未形成证据。 |
| 统一桌面与多端路径 | `test:authority-architecture` 覆盖旧主机命令、协议、relay、单一桌面构建与小程序的本地契约 | 一份桌面构建可安装在任意电脑；旧主机裁决链路必须被云端业务服务替换。自动化契约不是实际多设备登录、云 relay、NAS 代理或小程序发布证据。 |
| 云端目标与成本 | [生产数据库决策](../specs/2026-08-14-vnext-production-control-plane-database-decision.md) 冻结为同区域/VPC、固定规格按量、跨可用区、TLS 的 RDS PostgreSQL 17 HA | 尚未复核目标地域 SKU/价格，也未创建 RDS、账号、网络、密钥或备份策略。 |

## 未完成且不可替代的交付门禁

### 1. 外部身份与单命令写入准入

当前共享 `vnext_pg17_writer` 登录身份不能让 PostgreSQL 区分具体账户、设备、会话或真人操作。已冻结的 [身份 bridge no-go 决策](../specs/2026-08-20-vnext-pg17-identity-bridge-feasibility-decision.md) 禁止用 JavaScript assertion、`SET LOCAL`、session ID、预计算 hash、普通 receipt 或表级 DML 绕过该缺口。

在能够证明一个独立、数据库可验证、命令绑定、单次消费且 writer 无法创建、读取后转用、调换或伪造的执行准入事实之前：

- 不创建 M16、ticket/admission 表、函数、procedure 或 writer `EXECUTE`；
- 不将任何本地 PG17 reference mutation 接入 API、ECS 或 RDS；
- 不把 bootstrap、recovery、policy、role 或 device-link revoke 声称为可生产执行。

这是安全前置条件，而不是可通过增加 writer 表级权限跳过的待办项。

### 2. 真实非生产 RDS 验证

在任何生产创建前，必须先有独立、可销毁的 non-production RDS 验证目标。它需要目标地域/VPC、固定 HA TLS 能力、最小可用规格与价格复核、隔离凭据、RPO/RTO、备份保留、恢复目标、网络白名单和 secret/CA 管理方案。

验证必须证明 M1–M15 的迁移及 catalog 在真实 TLS/角色模型下成立，并覆盖只读 verifier、负权限、备份恢复与连接/故障行为。当前本地 Docker 测试不能替代这一步。

### 3. 云端完整业务 schema、真实数据迁移与注入

真实迁移只能在完整业务 schema、逐 relation 准入、脱敏盘点、只读 source snapshot、源/目标指纹、映射 ledger、冲突策略、恢复工件和回滚演练都得到验证之后发生。学生、教师、课程、排课、收费、课耗、资产和题库文字/结构化内容须迁入云端；题库富媒体须经 NAS/存储代理以对象 ID、版本、大小和哈希迁移与核验。不得用 synthetic rehearsal 的通过结果暗示真实数据已可导入。

### 4. 多端运行矩阵与发布

发布仍需独立验证同一桌面构建在多台隔离电脑上的在线登录、自动设备登记、离线草稿与确认提交、云端业务服务、NAS/存储代理、微信小程序、OSS 更新 feed 与版本兼容。这里的“多台电脑”是同一安装包的多设备行为验证，不是两套 host/client 安装包。每个适用端都要有当前版本、健康、权限和失败恢复证据；任一端未完成时，交付状态只能是“部分发布”或“受阻”。

## 当前执行顺序

1. 以云端业务权威总纲重建完整业务 schema、迁移与发布实施计划；M1–M15 仅作为可复用安全基础。
2. 在已批准的外部身份体系、凭据托管和 non-production 云目标中，验证新设备在线登录后的自动登记、云端逐请求鉴权与最小权限业务写入路径。
3. 按业务域完成云端 schema、影子迁移、增量追赶、空库恢复和回滚演练；题库文字进入云端，富媒体进入 NAS/存储代理。
4. 迁移统一桌面离线草稿、确认提交、云端同步、NAS 存储任务和小程序受限业务能力。
5. 只有所有适用端的真实证据完整时，才建立生产 RDS、接入服务、发布桌面/小程序或声明完成。

## 当前停止条件

截至本记录日期，完整云端业务 schema、真实业务迁移、NAS 存储代理、外部身份体系、non-production 云环境与真实多端发布仍未完成。旧 control-plane-only 路线已停止作为总体实施路径；任何新工作都必须先证明它推动云端业务权威、迁移安全或存储代理边界，而不是重新把业务裁决放回本地主机。

当前可自主推进的是新的云端业务权威实施计划、架构一致性门禁和不触碰真实数据的基础验证；一旦涉及真实身份、云资源、桌面数据、NAS 数据或部署，必须按上述顺序重新进行必要性、成本、安全和质量审计。

## 可复核入口

- `npm.cmd run test:vnext-control-plane-target`：本地 PG17 control-plane 与 reference/migration 契约。
- `npm.cmd run test:authority-architecture`：既有本地主机/跨端 authority 协议契约。
- `npm.cmd test`：仓库完整自动化回归；它不是外部部署或真实数据验证。
- `git diff --check`：提交前的文本与补丁格式检查。
