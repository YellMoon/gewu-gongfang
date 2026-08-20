# PostgreSQL 17 设备链接撤销存储过程身份准入规格

**状态：** 已冻结的前置安全规格；当前结论为“不准入实现”。

## 决策

在为 `account_device_link.revoke` 设计或实现 PostgreSQL 存储过程之前，必须先建立一个数据库可独立验证、且 `vnext_pg17_writer` 不能伪造、调换、读取后转用或通过会话设置冒充的调用者身份准入来源。

截至本规格冻结日，项目没有这样的来源。因此本规格**不批准** Migration 16、存储过程、函数执行权限、writer 表级 DML、HTTP/API 接线、真实 RDS/ECS 连接或任何业务数据操作。

刚完成的本地 canonical-parity harness 已证明 PostgreSQL 17 可以只读地重建设备链接撤销的规范请求、结果、审计和 outbox 向量。它不证明数据库能够认证“谁在调用”，也不改变本结论。

## 已知事实与威胁模型

当前本地 PG17 部署角色中：

- `vnext_pg17_writer` 是共享登录身份，只拥有目标 schema 的 `USAGE` 和 M1–M15 表的 `SELECT`；它没有直接 DML 或函数 `EXECUTE`；
- `vnext_pg17_verifier` 也是只读身份；
- `vnext_pg17_owner` 为非登录对象所有者；migrator 与 fixture-provisioner 只能用于受控迁移或本地 synthetic 测试，绝不能成为生产命令身份；
- 链接撤销 reference 需要当前 authority、account、device、installation、link、九个会话版本、policy revision、角色/能力、桌面 surface、未过期 reauthentication、CAS、receipt、audit 与 outbox 同事务成立。

攻击者模型包含已经取得 writer 连接能力、能调用任何获授函数、能选择函数参数、能并发重放先前看到的值、能读取 writer 被允许读取的控制面行，并能尝试 `SET LOCAL` 或任意调用顺序。攻击者不应被假定能修改 owner-owned schema 或直接 DML；如果仅靠这一点就能把错误身份写入，设计仍然失败。

## 被拒绝的伪准入来源

下列值都不是数据库侧身份来源，未来 procedure 不得将其作为授权事实或将其拼入动态 SQL：

| 候选值 | 被拒绝原因 |
| --- | --- |
| 函数参数中的 account、authority、device、link、role、capability、scope、policy revision、版本或重认证时间 | 共享 writer 可以任意伪造或调换。 |
| `sessionId`、session 行、最近重认证行或其 hash | writer 具有读取能力；读取到的 ID/行不能证明当前调用者就是该 session 的主体。 |
| JavaScript AccessContext、opaque assertion、规范 JSON、SHA-256、时间戳或 `reasonCode` | 它们可作为未来已准入调用的输入/审计材料，但数据库不能仅凭调用者传入的字节确认其来源。 |
| `SET LOCAL`、`current_setting`、`application_name`、连接池标签或客户端 IP | writer 可设置、复用或污染这些会话属性；它们不能代表用户身份。 |
| writer、verifier、migrator、owner 或 fixture-provisioner 角色名 | 这些是部署/测试角色，不是一人一会话一操作的身份；migrator、owner、fixture-provisioner 更不得参与生产命令。 |
| 已存 receipt、audit 或 outbox 行 | 它们只证明过去的耐久结果和幂等重放，不能为新的调用签发权限。 |

禁止的快捷方案包括：把 `vnext_pg17_writer` 扩成表级 DML、对 `PUBLIC`/writer 开放泛化 SECURITY DEFINER 函数、接受“调用方已验证”的布尔值、在 procedure 中信任预计算 hash，或把 JS 的任意上下文写入 `SET LOCAL` 后当成认证。

## 唯一可接受的准入来源

未来的身份 bridge 必须提供一个**数据库可验证的、命令专用、单次消费的执行准入事实**。它是 procedure 允许继续的唯一来源；不是现有 writer 登录、函数参数或普通控制面查询的派生物。

该事实至少同时满足以下全部属性：

1. **签发者隔离。** 只有独立、已认证的身份验证边界能签发；writer、verifier、runtime、migrator、owner、fixture-provisioner 均不能创建、修改、代签或提升它。
2. **不可转用。** 它绑定单一 authority、account、device、installation、active link、session、完整九版本向量、policy revision、桌面 surface、命令类型、目标 link、预期目标版本、reason、重认证到期时间与一次性 nonce/事件标识。任一字段替换均无效。
3. **不可读取后重放。** 机密验证材料不能被 writer `SELECT` 取得；即使看见准入记录的非机密标识，writer 也不能提交、复制或再激活它。
4. **数据库内原子消费。** procedure 在一个事务中验证未过期、未消费、所有绑定值与当前父状态一致；以精确 CAS 消费后才更新目标、receipt、audit 与 outbox。并发两次只允许一个成功路径，失败路径不得留下部分写入。
5. **身份不可由会话设置替换。** procedure 只从该准入事实和数据库当前状态重建 actor/权限/版本；不读取调用者设置来取得授权主体，也不允许 `SET ROLE`、动态 SQL 或通用 SQL 入口。
6. **重放边界分离。** 准入事实的单次消费防止新的授权操作被重复执行；命令 receipt 的幂等重放仅在相同 authority、actor、idempotency key 与规范请求下返回已存在的耐久结果，且完整验证 companion。

本规格不假装当前已有符合条件的 bridge。未来选择的机制必须在单独设计中明确其签发链、密钥/认证边界、数据库验证方式、权限模型、失效与轮换、故障恢复和成本；在没有此证明前，procedure 仍不可行。

## 对未来链接撤销 procedure 的硬性合同

只有身份 bridge 通过独立审计后，才可为这一个命令设计一个 owner-owned procedure。该 procedure 必须：

- 仅向精确 writer 身份授予一个固定签名的 `EXECUTE`，并且继续不给 writer 任一表的直接 DML、DDL、`SET ROLE`、`TEMP`、函数泛化执行或成员关系；
- 使用 `SECURITY DEFINER`、固定 `search_path = pg_catalog, pg_temp`、全限定对象名、无动态 SQL、非登录 owner、最小 ACL 与 catalog 精确漂移断言；
- 在同一事务内从已验证准入事实及当前数据库行重建 authority、actor、formal `super_admin`、`device.revoke`、desktop、未过期 reauthentication、target active 状态和 CAS 向量；
- 复用已冻结的 canonical request/result/audit/outbox 字节与 SHA-256 规则，拒绝调用方提交的 actor/权限/版本/哈希 claims；
- 保持 reference 的 self/stale/missing/noop/rejected/accepted、receipt 重放、同 key 冲突、audit/outbox、回滚和并发语义；
- 对 bootstrap、recovery、role、policy 或任何其他命令不产生隐式授权。每个命令都需独立准入设计与审计。

## 将来必须通过的证明

未来 bridge 和 procedure 的实施计划必须先以 synthetic disposable PG17 测试证明：

1. writer 伪造或交换 actor、session、ticket、target、版本、policy revision、reauth 或 reason 时均失败且零写；
2. 准入事实被读取标识、复制、并发使用、过期使用或跨 authority/link 使用时均失败；
3. writer 只有精确 procedure `EXECUTE`，所有目标表的 INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 仍拒绝；
4. procedure 的规范 JSON、SHA-256、receipt、audit、outbox、CAS、幂等、回滚和并发结果逐字段与 SQLite reference 及 PG17 parity vectors 一致；
5. catalog 精确锁定 procedure owner、SECURITY DEFINER、固定搜索路径、签名、函数体哈希、ACL、触发器、角色属性和默认 ACL；任何放宽都 fail closed；
6. 真实 non-production RDS TLS/角色/恢复验证与真实生产授权仍在本地设计之后，绝不由本规格自动触发。

## 范围与非目标

本规格只记录一个安全准入 gate 与威胁模型。它不创建 schema、表、migration、函数、角色、grant、连接池、API、身份验证器、签名、nonce、票据、RDS/ECS 资源、备份或恢复流程。

它不读取或改变桌面 SQLite、D 盘、NAS、移动硬盘题库、用户业务数据、真实账号、真实会话或任何已部署环境。它也不把“未来需设计身份 bridge”误称为已可生产执行的恢复器、主密钥或后门。

## 下一步门禁

下一步只能是一个独立、仍为文档的“身份 bridge 可行性与准入设计”审计：先选择并证明上文唯一可接受的来源能存在，再决定是否值得写任何 DDL 或 procedure 计划。若不能满足全部属性，正式结论是保留 PG17 writer 的零 DML/零 EXECUTE 状态，而不是退回到直接表写入。
