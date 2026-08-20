# PostgreSQL 17 数据库侧身份 Bridge 可行性决策

**状态：** 已冻结的 no-go 决策；当前不引入数据库侧写入准入 bridge。

## 决策

当前项目不为 PostgreSQL 17 control-plane 引入数据库侧身份 bridge，也不实现任何 owner-owned command procedure。`vnext_pg17_writer` 继续保持 `USAGE + SELECT`、零直接 DML、零函数 `EXECUTE`。

这是一个明确的安全与成本决策，不是延期后默认降级为表级写入。只要生产调用仍通过共享 writer 登录身份，数据库就不能区分不同账户、设备、会话或真人操作；任何以参数、session ID、nonce、hash、`SET LOCAL` 或 JavaScript assertion 补足该缺口的做法都不被接受。

## 现有边界

本地 disposable PG17 已有 M1–M15 exact catalog、verifier-only readiness、zero-direct-DML writer ACL，以及 `account_device_link.revoke` canonical parity evidence。它们证明：

- PostgreSQL 可只读重建规范命令、receipt、audit、outbox、CAS 与 replay 所需的耐久事实；
- writer 不能直接改表；
- 但 writer 是共享部署登录身份，不能让数据库知道具体调用者；
- 现有 trusted assertion 和 AccessContext 是 JavaScript 进程内边界，不是 PostgreSQL 能独立验证的调用者认证材料。

因此这些成果不能被解释为“已可安全执行生产写命令”。

## 候选比较

| 候选 | 可行性 | 安全结论 | 成本与运维 | 决定 |
| --- | --- | --- | --- | --- |
| owner 表中的一次性 bearer ticket | 表面可实现 | 不可接受。共享 writer 没有调用者身份；先拿到未消费 ticket 的人可抢先消费，无法防读取后转用；签发也仍依赖外部可信边界。 | 低实现成本，但会制造高风险伪安全与恢复负担。 | 拒绝。 |
| 数据库内验证签名的 ticket | 当前不可行 | 需要可信签名验证器、密钥保护、轮换和签发撤销链；当前 PG17 contract 不允许 `pgcrypto`、自定义扩展或未审计的密钥机制。 | 新增密钥生命周期、审计、恢复和部署成本，且本地 reference 无法证明真实安全性。 | 当前拒绝。 |
| 每会话独立 DB principal 或 mTLS 证书映射 | 原理上可行 | 数据库连接可携带非共享主体，理论上可绑定账户/设备/会话；仍必须防证书转用、池污染、角色提升和过期会话。普通设备级 mTLS 只认证数据库客户端，并不自动绑定真人账户、当前 session/reauth 或具体命令；缺少该权威绑定时同样拒绝。 | 高：独立认证签发、证书/身份生命周期、连接隔离、TLS/CA、RDS 兼容性、监控、撤销与灾难恢复。 | 只作为未来独立架构候选，不进入当前步骤。 |

没有第四个低成本快捷方案。共享数据库角色加 application name、client IP、`current_setting`、JWT/opaque assertion 参数、预计算 JSON/SHA、表内 session ID 或普通 receipt，均不能成为数据库侧身份来源。

## 冻结的禁止事项

在新的独立身份架构通过设计、实现和审计前，以下行为一律禁止：

- 新建 ticket/nonce/admission 表、Migration 16、存储过程、函数 `EXECUTE`、`PUBLIC EXECUTE` 或 writer 表级 DML；
- 给 writer、runtime、verifier、migrator、owner 或 fixture-provisioner 增加成员关系、默认 ACL、`SET ROLE`、`TEMP`、DDL 或泛化 SQL 能力；
- 把 JavaScript AccessContext、session ID、role/capability、reauth 时间、哈希、时间戳、布尔“已认证”标志或 `SET LOCAL` 当作 procedure 的可信身份；
- 把 fixture-provisioner、owner 或 migrator 用作生产调用身份；
- 连接、探测或创建真实 RDS/ECS/证书/密钥/CA/API/业务数据环境。

## 重新开启评估的条件

只有一个新的、独立批准的架构任务同时提供下列内容，才可重新评估单一命令的 procedure：

1. 非共享、可认证的数据库调用主体，以及其签发、绑定、到期、撤销、轮换和故障恢复方案；
2. writer 无法创建、读取后转用、调换、升级或通过连接池/会话设置伪造该主体的可执行证明；
3. PostgreSQL、TLS、连接池、RDS SKU、secret/CA 管理和真实 non-production 环境的成本与运维预算；
4. 对 account/device/installation/link/session、完整九版本、policy revision、reauth、命令绑定和单次消费的端到端威胁模型；
5. synthetic disposable 与独立 non-production RDS 中的负权限、并发、CAS、replay、rollback、catalog drift 与恢复证据；
6. 用户对新增认证主体、证书/密钥托管、费用和真实云验证的独立授权。

在这些条件满足之前，正确的下一步不是实现另一条写命令，而是继续维护和验证当前只读 control-plane 契约。任何未来业务或云部署任务也不得绕过这项 no-go 决策。

## 非目标

本决策不创建或修改 PG schema、角色、ACL、函数、container、依赖、连接池、服务端、HTTP/API、ECS/RDS、备份、证书、密钥或数据。它不读取桌面 SQLite、D 盘、NAS、移动硬盘题库、真实用户/会话或业务记录，也不改变现有本地业务运行路径。
