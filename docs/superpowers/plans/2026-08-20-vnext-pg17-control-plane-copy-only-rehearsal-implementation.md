# PostgreSQL 17 vNext 控制面 Copy-Only 迁移演练实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用完全合成的 SQLite source 与 disposable PG17 target 验证控制面迁移映射、冲突、重放和回滚，而不读取或改变真实数据。

**Architecture:** `controlPlaneCopyOnlyRehearsal` 自己创建 closure-branded synthetic source assertion；它仅能配合同一 disposable runtime 签发的 rehearsal target facade 使用。runtime facade 将 fixture-provisioner 的能力封装为固定 SQL manifest，演练只在单个 target transaction 中插入 allow-list 行并返回脱敏、冻结的证明报告。

**Tech Stack:** Node.js CommonJS、`better-sqlite3` memory database、`pg@8.23.0`、现有 disposable PostgreSQL 17 Docker runtime、node `assert`。

**Current implementation status (2026-08-20):** The delivered scope is `profile-binding metadata boundary-verified`: a synthetic, disposable target atomically verifies the identity topology, the capability plus revoked-or-expired historical authorization closure, and opaque `profileBindings`. Active profile bindings are non-authorizing account-to-profile links. Active role/override/scope input still fails closed and no default capability is generated. Nonempty verified contacts, receipts, audit events, and outbox events fail closed; sessions, reauthentication, policy, and trust evidence are not written. The eight `legacy*` collections remain redacted count/hash inventory only. This is not a complete rehearsal, real-data migration, or release evidence.

---

### Task 1: 写 source 与 target 边界的失败测试

**Files:**
- Create: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`
- Modify: `shared/vnext-pg17/disposableRuntime.test.js`

- [ ] **Step 1: 写 source brand 与 target brand 红测**

在新 focused test 中要求如下 API：

```js
const rehearsal = require('./controlPlaneCopyOnlyRehearsal');
const source = rehearsal.createVNextPg17SyntheticControlPlaneSource(snapshot);
const target = runtime.createVNextPg17CopyOnlyRehearsalTarget(handle);
await rehearsal.rehearseVNextPg17ControlPlaneCopy({ source, target });
```

用 `{}`、`{ ...source }`、另一 source factory、另一 runtime target、raw handle、Proxy source 和 closed target 分别断言稳定的 `VNEXT_PG17_COPY_REHEARSAL_INPUT_INVALID`，并在每例前后读取 target 全关系行 hash，确认零写。

- [ ] **Step 2: 写 source 只读、unknown collection 与 active 授权红测**

建立包含一个 authority、account、device、installation、link、non-active role/override/scope 历史、capability、profile、contact 和 inert archive count 的合法 source。分别加入 `businessCourses`、第二 authority、active role grant、active override、active scope、raw mutable source row，要求创建或演练失败；source logical fingerprint 和 source SQLite 全表逻辑快照不变。

- [ ] **Step 3: 写 rehearsal runtime SQL 闭集红测**

在 `disposableRuntime.test.js` 要求 runtime-issued rehearsal facade 只接收同 runtime target，拒绝 raw client/fixture handle 与任意 `ALTER`、`GRANT`、`SET ROLE`、`COPY`、`CALL`、`CREATE TEMP` 和未列入 manifest 的 `INSERT`。要求 trace 显示固定 `BEGIN`、全限定 `INSERT/SELECT`、`COMMIT/ROLLBACK`。

- [ ] **Step 4: 运行 RED**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js; node shared/vnext-pg17/disposableRuntime.test.js`

Expected: 新 module/factory/facade 尚不存在，且失败原因是缺少 API，而不是 Docker、真实数据或权限。

### Task 2: 实现 opaque source 与受限 rehearsal facade

**Files:**
- Create: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`
- Modify: `shared/vnext-pg17/disposableRuntime.js`

- [ ] **Step 1: 实现 synthetic SQLite source factory**

在 `controlPlaneCopyOnlyRehearsal.js` 定义固定 collection schema、`createVNextPg17SyntheticControlPlaneSource(snapshot)` 和 closure-private source state。它只创建 `:memory:` SQLite；拒绝 path、handle、环境变量、Proxy/accessor/unknown collection。读取 input 前进行 plain own-data deep snapshot，写入 source 后冻结 source assertion。导出仅供演练器使用的 `is...Source`/`read...Source`，不导出 SQLite handle。

source canonical fingerprint 使用 stable sorted-key JSON + UTF-8 SHA-256，按固定 collection 顺序和 stable ID 排序；inert archive 仅计数/hash，永不返回原 row。

- [ ] **Step 2: 实现 runtime-issued rehearsal target facade**

在 `disposableRuntime.js` 增加 `createVNextPg17CopyOnlyRehearsalTarget(handle)`、`withVNextPg17CopyOnlyRehearsalQuery(target, operation, callback)` 和 trace snapshot helper。WeakMap 将 target 绑定至同 runtime/handle；内部才调用 fixture-provisioner client。

将 query 命令定义为闭集：精确 transaction control、当前 catalog/source verification所需 `SELECT`、和单一 checked-in map 中的 `INSERT INTO vnext_control_plane.<allow-list relation>`。callback 不接触 raw client；每个 statement 与参数数量在执行前验证。拒绝任何未在 map 中的 SQL，尤其 DDL/DCL、角色、trigger、TEMP、CALL/COPY。任何 transaction 不确定、rollback/release 失败都销毁 lease，永不归还。

- [ ] **Step 3: 运行边界绿测**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js; node shared/vnext-pg17/disposableRuntime.test.js`

Expected: brand、source immutability 和 SQL closed-set 测试通过；尚未实现的成功映射测试仍是唯一红项。

### Task 3: 写成功映射与报告的失败测试

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [ ] **Step 1: 写完整 allow-list 成功红测**

用合法 source 覆盖 authority、account、device、installation、link、non-active role/override/scope、capability catalog、profile、contact、receipt/audit/outbox 历史与八项 inert collection。要求 result 精确包含：

```js
{
  status: 'rehearsed', schemaVersion: 5, migrationVersion: 15,
  authorityCount: 1, activeRoleGrantCount: 0,
  activeCapabilityOverrideCount: 0, activeScopeGrantCount: 0,
  activeSessionCount: 0, activeReauthenticationCount: 0,
  outboxDispatchedCount: 0,
  rollback: { attempted: false, restoredEmpty: false }
}
```

同时断言每个 mapping collection 的 count/key-set hash、source before/after fingerprint 相同、inert archive 仅报告 count/hash、target relation row hash 与 source map 相符、result 深冻结。

- [ ] **Step 2: 写 exact retry、nonempty target 和 source mutation 红测**

对两个 fresh target 执行相同 snapshot，要求报告逻辑相同；对已成功 target 的第二次调用要求 `VNEXT_PG17_COPY_REHEARSAL_TARGET_NOT_EMPTY` 且行 hash 不变。source 读开始后用受控 hook 改 source row，要求 `VNEXT_PG17_COPY_REHEARSAL_SOURCE_CHANGED` 且 target 空。

- [ ] **Step 3: 运行 RED**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

Expected: 失败于缺少 rehearsal mapping/report，不得因 source 或 target 被意外写入而通过。

### Task 4: 实现映射、报告与 replay 防护

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`

- [ ] **Step 1: 固定映射 manifest 与 source validation**

用单一 frozen `MAPPING_MANIFEST` 声明 collection、target relation、stable ID、写入列、FK 顺序和 active prohibition。逐 collection 验证 exact own rows、target-valid类型和 authority scope；禁止 source 中 `active` role/override/scope、session/reauth target mapping和第二 authority。不能根据 legacy scalar role、业务 profile 或 inert inventory推断或生成任何 target value。

- [ ] **Step 2: 在单 transaction 内执行 map**

先通过 catalog assertion并读取空 target proof，然后调用 restricted facade，按 manifest 顺序执行 INSERT。每次 INSERT 后写入内存 mapping entry；不创建 target ledger table。写入后 SELECT 每关系的 row count/key-set/canonical relation hash，断言一 authority、零 active authorization/session/reauth，且不 dispatch outbox。

- [ ] **Step 3: 生成脱敏冻结 report**

用 source/target fingerprint、每 collection counts/key hash、mapping ledger hash、inert inventory hash 和 target logical hash生成 frozen report。已成功 target 一律拒绝而不是 merge；两个 fresh exact source 产生相同逻辑 report。

- [ ] **Step 4: 运行绿测**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

Expected: 成功映射、exact fresh retry、nonempty reject、source mutation reject 均通过，source/target边界无泄漏。

### Task 5: 写 rollback/conflict 的失败测试

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

- [ ] **Step 1: 写逐阶段 interruption 红测**

为 mapping manifest 每个 write stage 注入 `afterWrite({ collection })` throw。每例断言 `VNEXT_PG17_COPY_REHEARSAL_ROLLED_BACK`、target 所有 control-plane relation 行数/逻辑 hash 回到空集、source fingerprint 不变、report rollback 为 `{ attempted: true, restoredEmpty: true }`。

- [ ] **Step 2: 写真实冲突红测**

分别构造跨 authority reference、duplicate target-active key、receipt/audit/outbox companion FK 不一致和 stable-ID/source-row-hash collision。每例必须在 target transaction rollback 后失败，禁止修复/合并/第二 authority。

- [ ] **Step 3: 运行 RED**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js`

Expected: 失败于没有 rollback/hook/conflict 实现，不得留下 target 行。

### Task 6: 实现 rollback、trace 及 aggregate 注册

**Files:**
- Modify: `shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.js`
- Modify: `shared/vnext-pg17/runPg17IntegrationTests.test.js`
- Modify: `package.json`

- [ ] **Step 1: 实现 fail-closed rollback artifact**

在唯一 transaction catch 中 rollback；读取 target empty proof、比较 source before/after fingerprint，并创建只含固定 code/stage/hash/count的冻结 artifact。若 rollback或target empty proof失败，销毁 target lease并返回稳定 unavailable code，不泄漏 SQL/row/connection detail。

- [ ] **Step 2: 注册 focused suite 与 aggregate**

让 `runPg17IntegrationTests.js` 在既有 runtime 中运行 copy-only suite，且 orchestration test 以 injected stub 验证单次 runtime 生命周期和顺序。将 `test:vnext-pg17`/`test:vnext-control-plane-target` 保持为唯一 aggregate；不得让普通 SQLite tests 隐式启动 Docker。

- [ ] **Step 3: 运行集成绿测**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js; node shared/vnext-pg17/runPg17IntegrationTests.test.js; npm.cmd run test:vnext-pg17`

Expected: focused、runner orchestration 与 disposable aggregate 全部通过，且 Docker cleanup 没有遗留目标。

### Task 7: 文档、审计、验证与发布

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-vnext-control-plane-first.md`
- Modify: this plan

- [ ] **Step 1: 记录边界与非声明**

记录该演练仅对 synthetic source 与 disposable target 有效；它不迁移真实桌面/业务数据，不激活 legacy session/权限，不创建生产 writer/procedure，也不构成 RDS/多端发布证据。

- [ ] **Step 2: 运行完整验证与双审计**

Run: `node shared/vnext-pg17/controlPlaneCopyOnlyRehearsal.test.js; node shared/vnext-pg17/disposableRuntime.test.js; node shared/vnext-pg17/catalogAssertion.test.js; npm.cmd run test:vnext-control-plane-target; git diff --check`

要求 5.6-sol 先做必要性、再做安全/质量审计。若发现问题，先添加可观察的红测，再做最小修复并重新运行所有命令。记录 `npm.cmd test` 的结果；若触及无关旧失败，只如实记录，不修改业务路径。

- [ ] **Step 3: 提交并推送**

只暂存本演练模块、测试、runtime受限 facade、runner/package 与相关文档；使用 `自动发布 2026-08-20` 提交信息，推送 `HEAD:master` 至 `gewu`。GitHub 网络失败时保留已提交本地 commit、不得重写历史，恢复后重试同一推送。不得打包 Electron、发布 OSS、连接 RDS/ECS或读取真实数据。

## Plan self-review

- 所有 target 写入必须通过 runtime-issued SQL manifest；演练模块、writer与外部调用者都不能获得通用 fixture client。
- source is memory-only and synthetic; source rows、业务表、legacy session/device grants均不具备生产激活路径。
- scope的唯一 persistent target 是 disposable PG17；M1–M15 SQL、writer ACL、身份 bridge no-go和真实环境边界不修改。
