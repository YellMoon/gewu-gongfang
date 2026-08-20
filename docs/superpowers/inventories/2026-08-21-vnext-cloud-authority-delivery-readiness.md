# 云端权威 vNext 交付就绪记录

**状态：** 持续维护；本文件记录当前证据与交付门禁，不构成生产发布、数据迁移或云资源创建授权。

## 目标边界

格物工坊的 vNext 目标是把身份、设备、权限、会话、审计、控制面通信与其耐久证据建立为可验证的云端 control-plane；本地数据主机仍保存完整权威业务数据，移动硬盘题库仍由本地主机统一管理。云端 PostgreSQL 不是业务表、题库文件、个人资产、附件、路径、NAS 或桌面 SQLite 的替代品。

因此，“云端权威”在当前已批准架构中只覆盖 control-plane 的授权判断与跨端协调，不把业务事实错误地迁往云端。任何业务域投影、真实源读取或反向写本地都要单独准入。

## 当前可验证成果

| 目标组成 | 当前证据 | 状态与边界 |
| --- | --- | --- |
| PostgreSQL 17 control-plane 数据契约 | M1–M15、精确 catalog/ACL/角色漂移断言、append-only 与 CAS 参考测试位于 `shared/vnext-pg17/` | 仅本地、合成、可销毁 PostgreSQL 17；尚未应用到 RDS。 |
| 身份、设备与权限读取 | branded session verifier、AccessContext、策略/范围/近期重认证读取矩阵 | 只读 boundary；没有真实凭据验证器、token、HTTP/API 或生产连接。 |
| 首 authority 与紧急恢复语义 | SQLite 与 PG17 的 bootstrap/recovery reference、备份证据和回滚测试 | 参考实现，不是实际仪式、生产恢复器或云端初始化入口。 |
| 命令耐久事实 | role、policy publication、device-link revoke 的 receipt/audit/outbox/CAS/replay reference 与 PG17 parity | 语义 oracle；现有 writer 零直接 DML、零 procedure `EXECUTE`，不能承担生产命令。 |
| 数据迁移与保留 | synthetic copy-only rehearsal、源隔离、历史权限与 profile/contact 元数据的非激活边界 | 不读取真实 SQLite、业务库、题库、NAS、移动盘或桌面数据；未形成真实迁移证明。 |
| 既有本地主机/多端路径 | `test:authority-architecture` 覆盖主机命令、协议、relay、桌面与小程序的本地契约 | 自动化契约不是两台真实电脑、云 relay、生产主机及小程序发布证据。 |
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

### 3. 真实数据迁移与注入

真实迁移只能在逐 relation 准入、脱敏盘点、只读 source snapshot、源/目标指纹、映射 ledger、冲突策略、恢复工件和回滚演练都得到验证之后发生。业务表、题库、附件、个人资产、路径、NAS、移动硬盘和原始联系方式继续默认拒绝；不允许用 synthetic rehearsal 的通过结果暗示真实数据已可导入。

### 4. 多端运行矩阵与发布

发布仍需独立验证本地主机、至少一台其它桌面端、云 relay/ECS、微信小程序、OSS 更新 feed 与版本兼容。每个适用端都要有当前版本、健康、权限和失败恢复证据；任一端未完成时，交付状态只能是“部分发布”或“受阻”。

## 当前执行顺序

1. 持续维护本地 schema、ACL、source-isolation、copy-only 和 authority-protocol 回归门禁。
2. 在存在已批准的外部身份体系、凭据托管和 non-production 云目标后，先完成身份 bridge 的独立设计与攻击证明；仍只针对一个命令。
3. 通过该门禁后，进行单命令 procedure 的 disposable 与 non-production RDS 验证；不授予通用 writer DML。
4. 再进行 control-plane-only 的真实 source 盘点、可回滚迁移和隔离发布矩阵。
5. 只有所有适用端的真实证据完整时，才建立生产 RDS、接入服务、发布桌面/小程序或声明完成。

## 当前停止条件

截至本记录日期，下一项会改变生产安全边界的工作需要尚不存在的外部身份/会话验证体系和真实 non-production 云环境。继续新增本地写入器、真实数据导入器或部署脚本不会缩小这些缺口，反而会绕过已冻结的安全决策。

因此当前允许的自主工作仅限不扩张权限或数据面的契约回归、文档一致性和合成验证维护；一旦新的身份或环境条件实际具备，必须按上述顺序重新进行必要性、成本、安全和质量审计。

## 可复核入口

- `npm.cmd run test:vnext-control-plane-target`：本地 PG17 control-plane 与 reference/migration 契约。
- `npm.cmd run test:authority-architecture`：既有本地主机/跨端 authority 协议契约。
- `npm.cmd test`：仓库完整自动化回归；它不是外部部署或真实数据验证。
- `git diff --check`：提交前的文本与补丁格式检查。
