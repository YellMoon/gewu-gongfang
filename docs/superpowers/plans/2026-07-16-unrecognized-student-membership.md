# 未认可学生、公开申请与双手机号学生账户 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/scheduling` Backend 建立强制微信手机号验证、真实未认可学生会话、学生/家长双身份、公开申请、权威主机建档、会员标记和固定示例题沙箱，并完成小程序全页面验证与多端统一发布。

**Architecture:** Backend 是小程序唯一认证、申请、会员、登录事件和体验沙箱服务；Gateway 只保留兼容边界并把旧审核体验路由永久关闭为 410。本地数据主机通过现有 V2 云任务领取 `identity-provisioning`，幂等创建或复用权威学生/老师档案；Backend 仅在主机完成后原子启用正式身份。小程序所有角色共用同一认证会话框架，未认可令牌只进入服务端白名单和受限学生壳层。

**Tech Stack:** Node.js、Express、better-sqlite3、JWT HS256、React/Taro/TypeScript、微信 `wx.login` + `getPhoneNumber`、现有 V2 cloud-relay task protocol、现有 DOCX/PDF 公式导出运行时、Node `assert` 集成测试、微信开发者工具与 miniprogram-automator。

---

## 文件边界

- `backend/src/database.js` 只负责向前迁移和低层数据库访问，不承载申请状态机。
- `backend/src/services/miniappIdentityService.js` 负责手机号/openid 事务绑定、两类令牌、登录事件与认证版本。
- `backend/src/services/miniappApplicationService.js` 负责申请校验、修订、状态机和最小字段投影。
- `backend/src/services/identityProvisioningService.js` 只在本地权威主机执行学生/老师幂等收敛。
- `backend/src/services/miniappProvisioningReconciler.js` 只在云端 Backend 把已完成任务原子收敛为正式身份与会员。
- `backend/src/services/unrecognizedExperienceData.js` 保存四道脱敏固定示例题；运行时不得读取 D 盘、移动硬盘或真实快照。
- `backend/src/services/unrecognizedExperienceSandbox.js` 负责会话隔离、限流、临时任务与文件生命周期。
- `backend/src/routes/miniappApplications.js` 同时暴露申请人自助接口和管理员审核接口，但权限检查分别独立。
- `backend/src/routes/unrecognizedExperience.js` 只暴露固定体验白名单。
- `miniapp/src/utils/accountExperience.js` 取代 `reviewExperience.js` 中的审核码/合成角色语义，只识别真实 `token_use=unrecognized-student`。
- `miniapp/src/pages/account-application/*` 是申请表与状态页；新增后 `app.config.ts`、页面清单和覆盖测试必须同步从 16 页更新为 17 页。
- 每个任务的提交是本地可回滚点；只有 Task 13 的统一矩阵全部通过后才推送 `gewu/master` 和执行外部发布，避免中间不兼容版本进入正式更新通道。

### Task 1: 建立向前兼容的数据模型

**Files:**
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Create: `backend/src/miniappIdentitySchema.test.js`
- Modify: `package.json`

- [x] **Step 1: 写出迁移失败测试**

测试创建旧版最小 SQLite，再实例化 `DatabaseService`，断言新列、表、索引和旧数据迁移均存在：

```js
const requiredUserColumns = ['identity_kind', 'auth_version', 'disabled_at'];
const requiredStudentColumns = ['parent_phone', 'parent_phone_normalized', 'parent_relation'];
const requiredTables = [
  'miniapp_login_events',
  'miniapp_role_applications',
  'account_memberships',
  'identity_provisioning_receipts',
];
assert.deepStrictEqual(missingColumns(db, 'users', requiredUserColumns), []);
assert.deepStrictEqual(missingColumns(db, 'students', requiredStudentColumns), []);
for (const table of requiredTables) assert.ok(tableExists(db, table), table);
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node backend/src/miniappIdentitySchema.test.js`

Expected: FAIL，首个错误为 `identity_kind` 或 `miniapp_login_events` 不存在。

- [x] **Step 3: 在 schema 和幂等迁移中加入完整结构**

`users` 增加 `identity_kind TEXT`、`auth_version INTEGER NOT NULL DEFAULT 1`、`disabled_at TEXT`；`students.phone` 继续作为学生手机号，新增家长字段。新增表的核心 DDL 固定为：

```sql
CREATE TABLE IF NOT EXISTS miniapp_login_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  phone_normalized TEXT NOT NULL,
  identity_kind TEXT,
  result_code TEXT NOT NULL,
  session_id TEXT,
  miniapp_version TEXT,
  platform TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS miniapp_role_applications (
  id TEXT PRIMARY KEY,
  applicant_user_id TEXT NOT NULL,
  application_type TEXT NOT NULL CHECK(application_type IN ('student','teacher')),
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  verified_phone_normalized TEXT NOT NULL,
  student_phone_normalized TEXT,
  parent_phone_normalized TEXT,
  applicant_identity_kind TEXT,
  host_task_id TEXT,
  host_entity_id TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  rejection_reason TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_memberships (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS identity_provisioning_receipts (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(application_id, revision, request_hash)
);
```

增加活动申请、登录事件保留、会员主体和 receipt 索引；`host_heartbeats` 增加 `capabilities TEXT`。迁移必须只用 `CREATE TABLE IF NOT EXISTS`、缺列 `ALTER TABLE ADD COLUMN` 和可重复执行的 `INSERT OR IGNORE`，不得删除旧列或旧表。

- [x] **Step 4: 加入现有账号会员迁移规则**

只迁移具有有效映射的正式身份：学生以 `student_id`、老师以 `teacher_id`、管理员以 `user.id` 建立 `existing_approval` 会员；正式学生/老师缺少业务 ID 时设为 `manual_resolution_required`、`login_enabled=0` 并递增 `auth_version`。合成 `review-demo:*` 用户不迁移。

- [x] **Step 5: 运行迁移测试确认 GREEN**

Run: `node backend/src/miniappIdentitySchema.test.js && node backend/src/databaseAuthorization.test.js && node backend/src/databaseImportSafety.test.js`

Expected: 三项均 PASS，旧数据库初始化两次结果一致。

- [x] **Step 6: 本地提交迁移基线**

```powershell
git add backend/src/schema.sql backend/src/database.js backend/src/miniappIdentitySchema.test.js package.json
git commit -m "自动发布 2026-07-16"
```

### Task 2: 强制手机号验证与两类会话

**Files:**
- Create: `backend/src/services/miniappIdentityService.js`
- Create: `backend/src/services/miniappIdentityService.test.js`
- Create: `backend/src/services/authRateLimiter.js`
- Create: `backend/src/services/authRateLimiter.test.js`
- Modify: `backend/src/routes/auth.js`
- Modify: `backend/src/middleware/auth.js`
- Modify: `backend/src/services/miniappAuthPolicy.js`
- Modify: `backend/src/miniappPhoneLogin.test.js`
- Modify: `package.json`

- [x] **Step 1: 写手机号/openid/令牌 RED 测试**

覆盖缺少 `phoneCode`、新手机号、待绑定手机号、phone/openid 双向冲突、禁用、并发、限流、登录事件和令牌声明：

```js
const login = await service.loginWithVerifiedWechat({
  openid: 'wx-a', phone: '13800138000', miniappVersion: '5.15.0', platform: 'ios',
});
assert.strictEqual(login.user.role, 'student');
assert.strictEqual(login.user.account_state, 'unrecognized');
assert.strictEqual(login.claims.token_use, 'unrecognized-student');
assert.ok(!('phone' in login.claims));
assert.ok(!('openid' in login.claims));
assert.strictEqual(login.claims.iss, 'gewu-miniapp-auth');
assert.strictEqual(login.claims.aud, 'gewu-miniapp-experience');
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node backend/src/services/miniappIdentityService.test.js`

Expected: FAIL with `Cannot find module './miniappIdentityService'`。

- [x] **Step 3: 实现规范化绑定和登录事件事务**

服务导出固定接口：

```js
function createMiniappIdentityService({ db, jwtSecret, now, uuid }) {
  return {
    loginWithVerifiedWechat,
    readIdentityForToken,
    issueFormalToken,
    issueUnrecognizedToken,
    expireLoginEvents,
  };
}
```

`loginWithVerifiedWechat` 必须先按规范化手机号查唯一身份，再校验 openid；空 openid 可绑定，冲突返回 `PHONE_WECHAT_BINDING_CONFLICT` 或 `OPENID_PHONE_BINDING_CONFLICT`，绝不覆盖。微信成功解析手机号后，无论结果为成功、未认可、禁用或冲突，都写 `miniapp_login_events`；事件不得包含 `code`、`phoneCode`、JWT、access token 或完整请求体。

- [x] **Step 4: 实现 auth_version 与令牌防火墙**

未认可令牌声明固定为：

```js
{
  sub: user.id,
  sid: sessionId,
  token_use: 'unrecognized-student',
  auth_version: user.auth_version,
  iss: 'gewu-miniapp-auth',
  aud: 'gewu-miniapp-experience'
}
```

正式令牌使用 `aud='gewu-api'`、`token_use='miniapp-session'`。`attachAuthorizationContext` 每次重新读取用户并比较 `auth_version`；未认可令牌只在账号未禁用且未正式启用时有效，正式令牌必须仍满足 `approved + login_enabled + 有效业务映射`。刷新只能延续同一 `sid` 和同一 token_use，不能把未认可令牌升级为正式令牌。

- [x] **Step 5: 改造 `/api/auth/wechat-login`**

每次新会话都要求同时存在 `code` 和 `phoneCode`；旧“已有 openid 可不验证手机号”分支删除。路由顺序固定为微信 openid 交换、手机号交换、身份服务事务、结果映射。拒绝授权不提交服务端；交换失败返回 `WECHAT_PHONE_EXCHANGE_FAILED`，不伪造含手机号事件。

- [x] **Step 6: 运行身份与旧正式账号回归**

Run: `node backend/src/services/authRateLimiter.test.js && node backend/src/services/miniappIdentityService.test.js && node backend/src/miniappPhoneLogin.test.js && node backend/src/services/miniappAuthPolicy.test.js`

Expected: 全部 PASS；日志断言找不到动态 code、phone code 和 JWT。

- [x] **Step 7: 本地提交认证垂直切片**

```powershell
git add backend/src/services/miniappIdentityService.js backend/src/services/miniappIdentityService.test.js backend/src/services/authRateLimiter.js backend/src/services/authRateLimiter.test.js backend/src/routes/auth.js backend/src/middleware/auth.js backend/src/services/miniappAuthPolicy.js backend/src/miniappPhoneLogin.test.js package.json
git commit -m "自动发布 2026-07-16"
```

### Task 3: 公开申请校验、修订和自助接口

**Files:**
- Create: `backend/src/services/miniappApplicationService.js`
- Create: `backend/src/services/miniappApplicationService.test.js`
- Create: `backend/src/routes/miniappApplications.js`
- Create: `backend/src/routes/miniappApplications.http.test.js`
- Modify: `backend/src/app.js`
- Modify: `package.json`

- [x] **Step 1: 写年级、字段、双手机号和状态机 RED 测试**

```js
assert.strictEqual(gradeYearFor('高一', new Date('2026-09-01T00:00:00+08:00')), 2026);
assert.strictEqual(gradeYearFor('高三', new Date('2026-07-31T00:00:00+08:00')), 2023);
assert.throws(() => validateStudentApplication({
  studentName: '张同学', studentPhone: '13800138000', school: '宁波中学', currentGrade: '高一',
  parentRelation: '妈妈', parentPhone: '13800138000', verifiedPhone: '13800138000',
}), error => error.code === 'STUDENT_PARENT_PHONE_MUST_DIFFER');
```

覆盖学生本人确认已满 14 岁、未满 14 岁只能由家长手机号提交、老师不含 `hourly_rate`、申请人不能传 `student_id/teacher_id/role/balance`、同一用户一个活动申请、同一幂等键同内容复用/不同内容 409、拒绝后新 revision、`provisioning` 后不可自撤回。

- [x] **Step 2: 运行测试确认 RED**

Run: `node backend/src/services/miniappApplicationService.test.js`

Expected: FAIL with missing module。

- [x] **Step 3: 实现纯校验和申请服务**

导出固定接口：

```js
module.exports = {
  ACTIVE_APPLICATION_STATUSES,
  gradeYearFor,
  validateStudentApplication,
  validateTeacherApplication,
  createMiniappApplicationService,
};
```

学生 payload 只允许 `studentName, studentPhone, school, currentGrade, gradeYear, parentRelation, parentPhone, parentName, parentWechat, studentSource, notes, guardianConfirmation, applicantAgeConfirmation`；老师只允许 `name, phone, subject, notes`。所有文本 trim 并有明确长度上限，备注为纯文本。

- [x] **Step 4: 实现未认可令牌自助路由**

路由固定为：

```text
GET    /api/miniapp/applications/me
POST   /api/miniapp/applications
POST   /api/miniapp/applications/:id/withdraw
```

三条路由都要求 `token_use=unrecognized-student` 或申请已通过后的同一用户正式令牌；任何查询只返回本人申请。响应状态明确区分 `not_submitted/submitted/provisioning/manual_resolution_required/rejected/withdrawn/approved_relogin_required`。

- [x] **Step 5: 运行服务和 HTTP GREEN 测试**

Run: `node backend/src/services/miniappApplicationService.test.js && node backend/src/routes/miniappApplications.http.test.js`

Expected: PASS；第二个申请人对相同手机号组合只收到 `ACTIVE_APPLICATION_EXISTS`，响应不包含另一申请人的 payload。

- [x] **Step 6: 本地提交申请切片**

```powershell
git add backend/src/services/miniappApplicationService.js backend/src/services/miniappApplicationService.test.js backend/src/routes/miniappApplications.js backend/src/routes/miniappApplications.http.test.js backend/src/app.js package.json
git commit -m "自动发布 2026-07-16"
```

### Task 4: 管理员审核与内部 provisioning 任务

**Files:**
- Create: `backend/src/services/miniappApplicationReviewService.js`
- Create: `backend/src/services/miniappApplicationReviewService.test.js`
- Modify: `backend/src/routes/miniappApplications.js`
- Modify: `backend/src/services/cloudRelayTaskService.js`
- Modify: `backend/src/routes/cloudRelay.js`
- Modify: `backend/src/services/authorizationPolicy.js`
- Modify: `backend/src/routes/miniappApplications.http.test.js`
- Modify: `package.json`

- [x] **Step 1: 写普通管理员与超级管理员边界 RED 测试**

断言普通管理员可审学生/老师公开申请，但不能创建管理员、审核设备或读取登录事件；不能审核自己的认证身份。目标主机离线或心跳未声明 `identity-provisioning-v1` 时申请保持 `submitted`。

```js
const decision = review.approve({ actor: normalAdmin, applicationId: 'app-1' });
assert.strictEqual(decision.application.status, 'provisioning');
assert.strictEqual(decision.task.task_type, 'identity-provisioning');
assert.strictEqual(decision.task.target_host_device_id, 'host-authority');
assert.ok(!('openid' in decision.task.payload));
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node backend/src/services/miniappApplicationReviewService.test.js`

Expected: FAIL with missing service。

- [x] **Step 3: 实现受控审核和任务创建**

服务端审核路由固定为：

```text
GET  /api/miniapp/applications/admin
POST /api/miniapp/applications/:id/approve
POST /api/miniapp/applications/:id/reject
POST /api/miniapp/applications/:id/retry
```

通过只允许申请当前 revision；任务幂等键为 `identity-provisioning:<application_id>:<revision>`，`request_hash` 来自规范化申请快照。任务 payload 只含申请 ID、revision、type、验证后的业务字段、审核人 ID 和 tenant ID，不含 JWT、openid、微信 code。

- [x] **Step 4: 禁止普通云任务入口创建 provisioning**

`POST /api/cloud/tasks` 对 `identity-provisioning` 始终返回 `INTERNAL_TASK_TYPE_FORBIDDEN`；只有 review service 直接调用 `createV2Task`。Gateway 和小程序都不能伪造该任务。

- [x] **Step 5: 运行审核与云任务回归**

Run: `node backend/src/services/miniappApplicationReviewService.test.js && node backend/src/routes/miniappApplications.http.test.js && node backend/src/routes/cloudRelay.http.test.js && node backend/src/services/cloudRelayTaskSchemaMigration.test.js`

Expected: PASS；批准动作不会修改 `login_enabled`、正式角色、会员或业务实体 ID。

- [x] **Step 6: 本地提交审核切片**

```powershell
git add backend/src/services/miniappApplicationReviewService.js backend/src/services/miniappApplicationReviewService.test.js backend/src/routes/miniappApplications.js backend/src/services/cloudRelayTaskService.js backend/src/routes/cloudRelay.js backend/src/routes/cloudRelay.http.test.js backend/src/services/authorizationPolicy.js backend/src/routes/miniappApplications.http.test.js package.json docs/superpowers/plans/2026-07-16-unrecognized-student-membership.md
git commit -m "自动发布 2026-07-16"
```

### Task 5: 本地数据主机幂等建档与绑定

**Files:**
- Create: `backend/src/services/identityProvisioningService.js`
- Create: `backend/src/services/identityProvisioningService.test.js`
- Modify: `backend/src/routes/cloudRelayHost.js`
- Modify: `backend/src/routes/cloudRelayHostTasks.test.js`
- Modify: `backend/src/database.js`
- Modify: `backend/src/services/cloudRelayClient.js`

- [x] **Step 1: 写学生/老师收敛 RED 测试**

覆盖无匹配创建、唯一兼容匹配复用、只补空字段、学生/家长跨列占用、姓名/关系冲突、多匹配、老师空课时费、receipt 重放和结果最小化：

```js
const first = provisioner.provision(taskPayload);
const replay = provisioner.provision(taskPayload);
assert.deepStrictEqual(replay, first);
assert.deepStrictEqual(Object.keys(first).sort(), ['entityId', 'entityType', 'receiptId', 'resultHash']);
assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM students').get().count, 1);
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node backend/src/services/identityProvisioningService.test.js`

Expected: FAIL with missing module。

- [x] **Step 3: 实现本地主机事务与 receipt**

学生使用现有 `students.phone` 作为学生手机号，新增 `parent_phone`；同时查询 `phone_normalized` 与 `parent_phone_normalized` 的交叉占用。创建学生时写 `grade_year` 并用现有学校服务自动维护学校；主机用同一 9 月学年算法复核。老师按规范化手机号唯一匹配，创建时显式写 `hourly_rate: null`。

冲突错误固定为 `STUDENT_PROFILE_CONFLICT`、`STUDENT_PHONE_CROSS_OCCUPIED`、`TEACHER_PROFILE_CONFLICT`；错误中不得回传完整现有档案。

- [x] **Step 4: 接入 V2 主机处理链和心跳能力**

`processMiniappTask` 增加：

```js
if (task.task_type === 'identity-provisioning') {
  return identityProvisioningService.provision({
    ...task.payload,
    requestHash: task.request_hash,
  });
}
```

主机 heartbeat 增加 `capabilities: ['identity-provisioning-v1', ...existing]`。继续复用现有 claim token、租约续期、row_version CAS、完成/失败与进程重启流程。

- [x] **Step 5: 运行本地主机 GREEN 与重启回归**

Run: `node backend/src/services/identityProvisioningService.test.js && node backend/src/routes/cloudRelayHostTasks.test.js && node backend/src/services/cloudRelayClient.test.js`

Expected: PASS；重复 claim 和重复完成不创建第二个实体。

- [x] **Step 6: 本地提交主机切片**

```powershell
git add backend/src/services/identityProvisioningService.js backend/src/services/identityProvisioningService.test.js backend/src/routes/cloudRelayHost.js backend/src/routes/cloudRelayHostTasks.test.js backend/src/database.js backend/src/services/cloudRelayClient.js
git commit -m "自动发布 2026-07-16"
```

### Task 6: 云端 reconciler 原子启用双身份与会员

**Files:**
- Create: `backend/src/services/miniappProvisioningReconciler.js`
- Create: `backend/src/services/miniappProvisioningReconciler.test.js`
- Modify: `backend/src/routes/cloudRelay.js`
- Modify: `backend/src/routes/miniappApplications.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/miniappIdentityService.js`

- [x] **Step 1: 写原子收敛 RED 测试**

覆盖学生两条身份共享 `student_id`、另一手机号 openid 为空、同一学生一条 student/一条 parent、手机号冲突整笔回滚、老师唯一绑定、会员共享、崩溃后重放、旧令牌失效：

```js
const result = reconciler.reconcileCompletedTask('task-1');
const identities = db.prepare('SELECT * FROM users WHERE student_id=? ORDER BY identity_kind').all(result.entityId);
assert.deepStrictEqual(identities.map(row => row.identity_kind), ['parent', 'student']);
assert.strictEqual(new Set(identities.map(row => row.student_id)).size, 1);
assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM account_memberships WHERE subject_type='student' AND subject_id=?").get(result.entityId).count, 1);
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node backend/src/services/miniappProvisioningReconciler.test.js`

Expected: FAIL with missing module。

- [x] **Step 3: 实现单事务收敛**

reconciler 重新校验 `application.status='provisioning'`、revision、task ID、result hash 和实体类型；再创建/复用两条身份、写 `identity_kind`、业务 ID、正式 `role/user_type`、`review_status='approved'`、`login_enabled=1`、会员和审计，最后标记申请 `approved`。任一身份冲突回滚并改为 `manual_resolution_required`，不允许半启用。

- [x] **Step 4: 加入完成回调、启动和列表读取重放**

V2 task 完成后调用一次；Backend 启动和管理员申请列表读取前扫描终态未收敛任务。重复执行必须返回相同 approved 状态，不重复增 auth_version 或会员。

- [x] **Step 5: 运行 reconciler 与鉴权回归**

Run: `node backend/src/services/miniappProvisioningReconciler.test.js && node backend/src/services/miniappIdentityService.test.js && node backend/src/routes/cloudRelay.http.test.js && node backend/src/routes/miniappApplications.http.test.js`

Expected: PASS；审核前令牌不能因数据库状态改变而获得正式能力，用户必须重新验证手机号登录。

- [x] **Step 6: 本地提交原子启用切片**

```powershell
git add backend/src/services/miniappProvisioningReconciler.js backend/src/services/miniappProvisioningReconciler.test.js backend/src/routes/cloudRelay.js backend/src/routes/miniappApplications.js backend/src/app.js backend/src/services/miniappIdentityService.js
git commit -m "自动发布 2026-07-16"
```

### Task 7: 固定示例题与 Backend 隔离导出沙箱

**Files:**
- Create: `backend/src/services/unrecognizedExperienceData.js`
- Create: `backend/src/services/unrecognizedExperienceData.test.js`
- Create: `backend/src/services/unrecognizedExperienceSandbox.js`
- Create: `backend/src/services/unrecognizedExperienceSandbox.test.js`
- Create: `backend/src/routes/unrecognizedExperience.js`
- Create: `backend/src/routes/unrecognizedExperience.http.test.js`
- Modify: `backend/src/app.js`
- Move: `gateway/assets/fonts/NotoSansCJKsc-Regular.otf` → `backend/assets/fonts/NotoSansCJKsc-Regular.otf`
- Move: `gateway/assets/fonts/OFL.txt` → `backend/assets/fonts/OFL.txt`
- Move: `gateway/assets/fonts/README.md` → `backend/assets/fonts/README.md`

- [ ] **Step 1: 固定授权源文件证据和四题边界**

Run:

```powershell
python -X utf8 scripts/inspect-paper-template.py "D:\题库测试文件\试卷格式\2026届浙江宁波市高三第二学期高考与选考模拟考试（二模）物理试卷.docx"
```

Expected: 能定位题号 1、2、4、11 及答案 A、C、B、AC；第 2 题运行时数据不含照片 relationship 或图片文件。把源 SHA-256 和人工核对结果只写进测试注释，不写绝对 D 盘路径到生产数据。

- [ ] **Step 2: 写固定数据 RED 测试**

```js
assert.deepStrictEqual(samples.map(item => item.id), [
  'experience-physics-2026-nb2-01',
  'experience-physics-2026-nb2-02',
  'experience-physics-2026-nb2-04',
  'experience-physics-2026-nb2-11',
]);
assert.deepStrictEqual(samples.map(item => item.answer), ['A', 'C', 'B', 'AC']);
assert.ok(samples.every(item => item.sourceLabel === '示例题（不属于正式题库）'));
assert.ok(samples.every(item => !JSON.stringify(item).includes('D:\\')));
```

- [ ] **Step 3: 创建最小脱敏数据文件**

每题仅包含：

```js
{
  id,
  number,
  type,
  stemRichContent,
  options: [{ key: 'A', contentRichContent }],
  answer,
  explanationRichContent,
  sourceLabel: '示例题（不属于正式题库）',
}
```

使用现有 Word 解析器恢复 OMML/EQ 为可编辑 LaTeX；不得把整卷、照片、页眉页脚、学校/姓名栏或其他题目写入该文件。

- [ ] **Step 4: 把现有审核沙箱重构为真实会话沙箱**

复用原有 30 分钟过期、会话 owner、限流、请求体上限、取消和跨会话下载拒绝，但命名空间改成 `unrecognized-experience`，owner 必须等于未认可令牌 `sid`。任务仅接受四个固定 ID，禁止访问 `readonly_snapshots`、`miniapp_tasks`、题库盘或本地主机。

- [ ] **Step 5: 暴露 Backend 白名单路由**

```text
GET  /api/experience/questions
POST /api/experience/tasks
GET  /api/experience/tasks/:id/result
POST /api/experience/tasks/:id/cancel
GET  /api/experience/artifacts/:id
```

Word/PDF 走现有公式导出运行时，但产物只落 Backend 临时目录，过期清理，不上传 OSS，不写业务库。

- [ ] **Step 6: 运行数据、沙箱和导出 GREEN 测试**

Run: `node backend/src/services/unrecognizedExperienceData.test.js && node backend/src/services/unrecognizedExperienceSandbox.test.js && node backend/src/routes/unrecognizedExperience.http.test.js`

Expected: PASS；覆盖列表、组卷、Word、PDF、取消、过期、跨会话、越界 ID、大小限制和无 D 盘依赖。

- [ ] **Step 7: 本地提交体验沙箱切片**

```powershell
git add backend/src/services/unrecognizedExperienceData.js backend/src/services/unrecognizedExperienceData.test.js backend/src/services/unrecognizedExperienceSandbox.js backend/src/services/unrecognizedExperienceSandbox.test.js backend/src/routes/unrecognizedExperience.js backend/src/routes/unrecognizedExperience.http.test.js backend/src/app.js backend/assets/fonts gateway/assets/fonts
git commit -m "自动发布 2026-07-16"
```

### Task 8: Backend 白名单防火墙与 Gateway 410 tombstone

**Files:**
- Create: `backend/src/middleware/unrecognizedStudentGuard.js`
- Create: `backend/src/middleware/unrecognizedStudentGuard.test.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/routes/miniappFirewall.test.js`
- Modify: `gateway/src/routes/reviewDemo.js`
- Modify: `gateway/src/routes/reviewDemo.http.test.js`
- Modify: `gateway/src/middleware/auth.js`
- Modify: `gateway/src/app.js`
- Modify: `scripts/check_review_demo.js`
- Modify: `scripts/check_review_demo.test.js`

- [ ] **Step 1: 写未认可直连绕过 RED 测试**

遍历正式业务路由，使用有效未认可令牌请求课程、学生、老师、财务、真实题库、快照、云任务、设备配对、同步和管理员 API，预期全为 403；只允许 auth/me、applications/me、applications submit/withdraw 和 experience 五类路由。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node backend/src/middleware/unrecognizedStudentGuard.test.js && node backend/src/routes/miniappFirewall.test.js`

Expected: FAIL，现有 optionalAuth 或正式业务路由接受未认可令牌。

- [ ] **Step 3: 实现默认拒绝的路由白名单**

```js
const ALLOWED = [
  ['GET', /^\/api\/auth\/me$/],
  ['GET', /^\/api\/miniapp\/applications\/me$/],
  ['POST', /^\/api\/miniapp\/applications(?:\/[^/]+\/withdraw)?$/],
  ['GET', /^\/api\/experience\//],
  ['POST', /^\/api\/experience\//],
];
```

Guard 必须在所有正式业务 router 之前运行；未列路由统一 `UNRECOGNIZED_SCOPE_FORBIDDEN`。身份切换时正式缓存由客户端清理，但服务端防火墙独立成立。

- [ ] **Step 4: 永久关闭 Gateway 审核体验入口**

`/api/auth/review-demo`、`/api/review-demo/*` 固定返回 HTTP 410 + `REVIEW_DEMO_REMOVED`；Gateway auth 对 `unrecognized-student` 和旧 `review-demo` token 都返回 401，不读取 Backend 身份表，不签发小程序 token。

- [ ] **Step 5: 运行双服务边界 GREEN 测试**

Run: `node backend/src/middleware/unrecognizedStudentGuard.test.js && node backend/src/routes/miniappFirewall.test.js && node gateway/src/routes/reviewDemo.http.test.js && node scripts/check_review_demo.test.js`

Expected: PASS；代码扫描确认小程序认证、申请、会员和体验 API 仅指向 `/scheduling` Backend。

- [ ] **Step 6: 本地提交防火墙切片**

```powershell
git add backend/src/middleware/unrecognizedStudentGuard.js backend/src/middleware/unrecognizedStudentGuard.test.js backend/src/app.js backend/src/routes/miniappFirewall.test.js gateway/src/routes/reviewDemo.js gateway/src/routes/reviewDemo.http.test.js gateway/src/middleware/auth.js gateway/src/app.js scripts/check_review_demo.js scripts/check_review_demo.test.js
git commit -m "自动发布 2026-07-16"
```

### Task 9: 小程序会话、API 路由和唯一登录动作

**Files:**
- Create: `miniapp/src/utils/accountExperience.js`
- Create: `miniapp/src/utils/accountExperience.test.js`
- Modify: `miniapp/src/utils/api.ts`
- Modify: `miniapp/src/utils/authSession.ts`
- Modify: `miniapp/src/utils/miniappAuthorizationRuntime.js`
- Modify: `miniapp/src/utils/miniappAuthorizationRuntime.test.js`
- Modify: `miniapp/src/utils/miniappApiSessionRuntime.js`
- Modify: `miniapp/src/utils/miniappApiSessionRuntime.test.js`
- Modify: `miniapp/src/pages/login/index.tsx`
- Modify: `miniapp/src/pages/login/index.scss`
- Modify: `miniapp/src/utils/miniappPhoneLogin.test.js`
- Modify: `miniapp/src/app.tsx`

- [ ] **Step 1: 写登录页和会话 RED 测试**

断言无体验码、无角色选择、无静默无手机号登录；唯一主按钮是 `openType="getPhoneNumber"`。未认可响应必须持久化真实 identity 并清理上一正式身份的课程、财务、权限、题库任务和下载缓存。

```js
assert.ok(loginPage.includes('openType="getPhoneNumber"'));
assert.ok(!loginPage.includes('reviewDemoApi'));
assert.ok(!loginPage.includes('体验码'));
assert.deepStrictEqual(accountCapabilities(unrecognized), [
  'experience:read', 'profile-application:read', 'profile-application:submit',
  'sample-questions:view', 'sample-paper-export',
]);
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node miniapp/src/utils/accountExperience.test.js && node miniapp/src/utils/miniappPhoneLogin.test.js`

Expected: FAIL with missing module or legacy review code present。

- [ ] **Step 3: 用真实账户体验语义替换 reviewExperience**

`isUnrecognizedIdentity` 只接受服务端返回的 `account_state='unrecognized'`、`token_use='unrecognized-student'` 和固定 capabilities；不接受 `id` 前缀、客户端 role、`read_only` 或合成 marker。API 路由把体验操作映射到 `/api/experience/*`，正式操作继续 `/api/cloud/*`。

- [ ] **Step 4: 改造登录与错误文案**

按钮文案“验证手机号并登录”。处理 `PHONE_AUTHORIZATION_REQUIRED`、`WECHAT_PHONE_EXCHANGE_FAILED`、双向绑定冲突、`ACCOUNT_DISABLED`、`AUTH_RATE_LIMITED` 和网络错误。成功未认可与正式账号都通过同一原子 session committer，先 invalidate、清业务缓存、清权限、写 identity/token，再 reLaunch；审核通过后旧 token 401 时清缓存并回登录页。

- [ ] **Step 5: 统一所有认证/申请/体验 API 到 Backend**

删除 `DEFAULT_REVIEW_BASE_URL` 和 `reviewDemoApi`；新增 `applicationApi`、`experienceApi`。测试生产 base URL 必须为 `https://physicsedu.xyz/scheduling`，不能命中根域 Gateway。

- [ ] **Step 6: 运行小程序会话 GREEN 测试**

Run: `node miniapp/src/utils/accountExperience.test.js && node miniapp/src/utils/miniappPhoneLogin.test.js && node miniapp/src/utils/miniappAuthorizationRuntime.test.js && node miniapp/src/utils/miniappApiSessionRuntime.test.js && node miniapp/src/utils/miniappApiRoutingRuntime.test.js`

Expected: PASS；身份切换测试证明上一账号缓存不可见。

- [ ] **Step 7: 本地提交小程序认证切片**

```powershell
git add miniapp/src/utils/accountExperience.js miniapp/src/utils/accountExperience.test.js miniapp/src/utils/api.ts miniapp/src/utils/authSession.ts miniapp/src/utils/miniappAuthorizationRuntime.js miniapp/src/utils/miniappAuthorizationRuntime.test.js miniapp/src/utils/miniappApiSessionRuntime.js miniapp/src/utils/miniappApiSessionRuntime.test.js miniapp/src/pages/login/index.tsx miniapp/src/pages/login/index.scss miniapp/src/utils/miniappPhoneLogin.test.js miniapp/src/app.tsx
git commit -m "自动发布 2026-07-16"
```

### Task 10: 未认可学生壳层、申请页、会员标记与管理员审核 UI

**Files:**
- Create: `miniapp/src/pages/account-application/index.tsx`
- Create: `miniapp/src/pages/account-application/index.scss`
- Create: `miniapp/src/pages/account-application/index.config.ts`
- Create: `miniapp/src/pages/account-application/applicationRuntime.js`
- Create: `miniapp/src/pages/account-application/applicationRuntime.test.js`
- Create: `miniapp/src/components/AccountStatusBanner.tsx`
- Create: `miniapp/src/components/MembershipBadge.tsx`
- Modify: `miniapp/src/app.config.ts`
- Modify: `miniapp/src/custom-tab-bar/index.tsx`
- Modify: `miniapp/src/custom-tab-bar/roleTabBar.test.js`
- Modify: `miniapp/src/pages/index/index.tsx`
- Modify: `miniapp/src/pages/schedule/index.tsx`
- Modify: `miniapp/src/pages/students/index.tsx`
- Modify: `miniapp/src/pages/courses/index.tsx`
- Modify: `miniapp/src/pages/payments/index.tsx`
- Modify: `miniapp/src/pages/stats/index.tsx`
- Modify: `miniapp/src/pages/question-bank/index.tsx`
- Modify: `miniapp/src/pages/settings/index.tsx`
- Modify: `miniapp/src/pages/admin/users/index.tsx`
- Modify: `miniapp/src/pages/admin/users/index.scss`
- Modify: `miniapp/src/pages/admin/users/adminReviewCoordinator.test.js`
- Modify: `miniapp/src/utils/miniappAccessPolicy.test.js`

- [ ] **Step 1: 写申请状态和导航 RED 测试**

申请 runtime 用显式状态联合：

```js
const states = [
  'loading', 'not_submitted', 'invalid', 'submitting', 'submitted', 'provisioning',
  'manual_resolution_required', 'rejected', 'withdrawn', 'approved_relogin_required',
  'offline', 'network_error',
];
for (const state of states) assert.ok(copyForApplicationState(state));
```

断言学生申请字段、家长代学生、未满 14 岁监护确认、老师无课时费、拒绝原因、修订重提、withdraw、重复点击锁和 provisioning 文案。

- [ ] **Step 2: 运行 UI 纯逻辑 RED 测试**

Run: `node miniapp/src/pages/account-application/applicationRuntime.test.js && node miniapp/src/custom-tab-bar/roleTabBar.test.js && node miniapp/src/utils/miniappAccessPolicy.test.js`

Expected: FAIL with missing page/runtime。

- [ ] **Step 3: 注册第 17 页并实现申请表/状态页**

路由为 `pages/account-application/index`。未认可设置页和首页的“申请正式账号”使用 `navigateTo` 到该已注册页。学生表单必填姓名、学生手机号、学校、年级、爸爸/妈妈、家长手机号；老师表单必填姓名和锁定手机号，科目/备注选填，DOM 和文案中均不得出现课时费。

- [ ] **Step 4: 实现未认可学生壳层和真实空态**

Tab 只保留首页、课程表、题库、设置；首页显示“体验账号”和固定说明，课程/学生/老师/财务/统计不请求正式 API并显示明确空态。题库正式区为空，单独展示四道“示例题（不属于正式题库）”，组卷/Word/PDF 只调用 `experienceApi`。

- [ ] **Step 5: 实现管理员公开申请区域**

普通管理员能查看/批准/拒绝学生和老师申请；超级管理员额外看到冲突处理、用户禁用和设备配对。学生卡展示申请人身份、必要手机号审核视图、学校、年级/入学年份和家长关系；老师卡不展示课时费。批准/拒绝/重试都有 operation lock 和确认框，`provisioning` 显示主机/阶段/错误码。

- [ ] **Step 6: 只在账号名称旁显示会员标记**

`MembershipBadge` 仅由服务端 `membership.status==='active'` 渲染；首页卡片、导航、弹窗和其他页面不得出现价格、购买、续费、套餐或权益承诺。

- [ ] **Step 7: 运行 UI GREEN 与文案真实性扫描**

Run: `node miniapp/src/pages/account-application/applicationRuntime.test.js && node miniapp/src/custom-tab-bar/roleTabBar.test.js && node miniapp/src/utils/miniappAccessPolicy.test.js && node miniapp/src/pages/admin/users/adminReviewCoordinator.test.js && node miniapp/src/utils/miniappHomeVisual.test.js`

Expected: PASS；源码扫描不存在审核体验码、合成角色、老师课时费或虚构会员购买入口。

- [ ] **Step 8: 本地提交 UI 切片**

```powershell
git add miniapp/src/pages/account-application miniapp/src/components/AccountStatusBanner.tsx miniapp/src/components/MembershipBadge.tsx miniapp/src/app.config.ts miniapp/src/custom-tab-bar miniapp/src/pages/index miniapp/src/pages/schedule miniapp/src/pages/students miniapp/src/pages/courses miniapp/src/pages/payments miniapp/src/pages/stats miniapp/src/pages/question-bank miniapp/src/pages/settings miniapp/src/pages/admin/users miniapp/src/utils/miniappAccessPolicy.test.js
git commit -m "自动发布 2026-07-16"
```

### Task 11: 隐私保留、页面清单和可执行发布门禁

**Files:**
- Create: `backend/src/services/miniappPrivacyRetention.js`
- Create: `backend/src/services/miniappPrivacyRetention.test.js`
- Modify: `miniapp/src/utils/miniappUiPageInventory.js`
- Modify: `miniapp/src/utils/miniappUiCoverage.test.js`
- Modify: `scripts/check_miniapp_release.js`
- Modify: `scripts/check_miniapp_release.test.js`
- Modify: `scripts/check_miniapp_review_readiness.js`
- Modify: `scripts/check_miniapp_review_readiness.test.js`
- Modify: `docs/miniapp-review-guide.md`
- Create: `docs/verification-2026-07-16-unrecognized-student-membership.md`

- [ ] **Step 1: 写 180 天保留 RED 测试**

断言登录事件手机号、拒绝/撤回 payload、已批准稳定 180 天 payload 都按规则删除或匿名化；认证身份手机号和审计摘要保留。临时 code/JWT 从不入表。

- [ ] **Step 2: 实现可重复执行的保留任务**

```js
function runMiniappPrivacyRetention(db, now) {
  return {
    loginEventsRedacted,
    rejectedPayloadsRedacted,
    approvedPayloadsRedacted,
  };
}
```

任务启动时运行一次，并可由运维脚本调用；只输出数量和结构化结果，不输出手机号或 payload。

- [ ] **Step 3: 更新平台隐私字段清单与用户告知**

文档逐项列出手机号、学生姓名、学校、年级、家长手机号/关系、老师姓名/科目/备注的用途、管理员可见范围、本地主机写入和保存期限；明确未满 14 岁由家长提交。发布检查扫描代码字段与文档字段一致。

- [ ] **Step 4: 更新 17 页面覆盖门禁**

页面清单以 `app.config.ts` 为源，覆盖 17 个注册页面以及源码 `navigateTo/redirectTo/reLaunch/switchTab` 目标。矩阵角色至少包含：未认可学生、受认可学生、家长、老师、普通管理员、超级管理员；状态至少包含空态、离线、无权限、有限写入、申请所有状态。

- [ ] **Step 5: 运行隐私与覆盖 GREEN 测试**

Run: `node backend/src/services/miniappPrivacyRetention.test.js && node miniapp/src/utils/miniappUiCoverage.test.js && node scripts/check_miniapp_release.test.js && node scripts/check_miniapp_review_readiness.test.js`

Expected: PASS，页面数为 17，零未注册跳转，零缺失角色/状态记录。

- [ ] **Step 6: 本地提交隐私和门禁切片**

```powershell
git add backend/src/services/miniappPrivacyRetention.js backend/src/services/miniappPrivacyRetention.test.js miniapp/src/utils/miniappUiPageInventory.js miniapp/src/utils/miniappUiCoverage.test.js scripts/check_miniapp_release.js scripts/check_miniapp_release.test.js scripts/check_miniapp_review_readiness.js scripts/check_miniapp_review_readiness.test.js docs/miniapp-review-guide.md docs/verification-2026-07-16-unrecognized-student-membership.md
git commit -m "自动发布 2026-07-16"
```

### Task 12: 全量自动化、真实微信逐页验证和安全探针

**Files:**
- Modify: `docs/verification-2026-07-16-unrecognized-student-membership.md`
- Modify: `task.md`
- Create: `output/miniapp-5.15.0-ui-coverage/` screenshots and sanitized console logs

- [ ] **Step 1: 运行聚焦测试和静态检查**

Run:

```powershell
node backend/src/services/miniappIdentityService.test.js
node backend/src/services/miniappApplicationService.test.js
node backend/src/services/miniappApplicationReviewService.test.js
node backend/src/services/identityProvisioningService.test.js
node backend/src/services/miniappProvisioningReconciler.test.js
node backend/src/routes/unrecognizedExperience.http.test.js
node backend/src/middleware/unrecognizedStudentGuard.test.js
node miniapp/src/utils/miniappUiCoverage.test.js
npm --prefix miniapp run typecheck
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行项目全量测试**

Run: `npm test`

Expected: exit 0；不得用跳过测试或更新快照掩盖失败。

- [ ] **Step 3: 构建生产小程序并运行发布门禁**

Run: `npm run miniapp:release-check`

Expected: WeApp 构建成功，API base 为 `https://physicsedu.xyz/scheduling`，无 review-demo 入口，17 页面覆盖通过。

- [ ] **Step 4: 用真实微信运行时逐页采集证据**

分别以未认可学生、正式学生、家长、老师、普通管理员、超级管理员打开适用页面；所有 17 页至少有一种角色证据，差异路由分别检查。截图命名使用 `<role>-<route>-<state>.png`。必须检查未认可直连无真实数据、申请全状态、会员标记位置、四示例题、Word/PDF、空态、离线、无权限、有限写入；首页不得代替其余页面。

- [ ] **Step 5: 运行安全与数据泄露探针**

用未认可 token 直连 Backend 正式 API 和 Gateway，断言正式 Backend 403、Gateway 401、旧审核路由 410。检查服务器日志和数据库事件不含微信 code、phoneCode、JWT、access token、完整请求体；示例题服务在无 D 盘挂载环境仍通过。

- [ ] **Step 6: 更新验证文档和任务清单**

记录每条命令、版本、截图绝对路径、HTTP 状态、数据库迁移计数、阻断与回滚点。只把有当前证据的 `task.md` 项标记完成。

- [ ] **Step 7: 本地提交验证证据**

```powershell
git add docs/verification-2026-07-16-unrecognized-student-membership.md task.md
git commit -m "自动发布 2026-07-16"
```

### Task 13: 统一版本构建、推送和多端发布

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/generated/version.ts`
- Modify: `docs/verification-2026-07-16-unrecognized-student-membership.md`
- Modify: `task.md`

- [ ] **Step 1: 按语义版本规则递增补丁版本**

使用 `auto-version-bump` 判定本次为兼容功能升级，预期从 `5.14.4` 升到 `5.15.0`；运行版本脚本后核对 `package.json`、锁文件、小程序版本和健康接口一致。

- [ ] **Step 2: 阿里云部署前备份**

备份 Backend/Gateway 代码和两套 SQLite，运行 `PRAGMA quick_check`；验证备份目录、大小和哈希后才迁移。把备份路径和 quick_check 结果写入验证文档，不记录密钥。

- [ ] **Step 3: 部署 Backend 兼容层和 Gateway tombstone**

先部署 Backend schema/auth/application/sandbox，再部署 Gateway 410；迁移、重启后验证内网和公网 `/api/health`、正式旧账号登录、未认可登录、申请、主机任务、Gateway 拒绝契约。

- [ ] **Step 4: 升级指定本地数据主机**

先备份本地权威数据库，安装本次版本且保留数据目录/设备配置；验证本地健康、D 盘权威库、移动硬盘题库、缓存、备份目标、同步和 heartbeat `identity-provisioning-v1`。用隔离验收身份跑一次学生或老师建档/绑定任务并清理临时验收记录。

- [ ] **Step 5: 上传小程序并核验**

Run: `npm run miniapp:upload`

Expected: 微信开发者工具上传成功，AppID、版本、包大小和上传时间有证据；随后尝试审核/发布。若白名单、平台或权限阻断，记录精确错误并标记“部分发布/受阻”。

- [ ] **Step 6: 构建并发布 OSS 桌面更新**

Run:

```powershell
npm run dist:win
npm run publish:desktop-update
npm run rebuild:node
```

Expected: 安装包、`latest.yml`、远端 HTTP 200、文件大小和 SHA-512 一致；`better-sqlite3` 恢复 Node ABI 并通过相关 backend/database smoke。

- [ ] **Step 7: 最终全量验证、提交与推送**

Run:

```powershell
npm test
git status --short
git add -A
git commit -m "自动发布 2026-07-16"
git push gewu master
```

Expected: 测试 exit 0；推送后 `gewu/master` 与 HEAD 一致。提交前确认不纳入 `.playwright-cli/` 临时状态、未筛选 `output/`、本地凭据或 D 盘源文件；只提交明确验证证据。

- [ ] **Step 8: 按统一矩阵给出最终状态**

只有小程序上传/审核、阿里云、数据主机、OSS/ABI 均有当前版本证据时写“已发布完成”；任一外部端未完成则写“部分发布”或“受阻”，列出仍旧版本、错误码和下一安全动作。

---

## 自审结果

- 设计目标、非目标、双手机号、老师无课时费、主机权威、会员独立、固定示例题、隐私保留、Gateway tombstone、17 页面覆盖和统一发布均映射到具体任务。
- 所有后端状态和错误都由服务端产生；小程序不自报角色、手机号、会员或业务实体 ID。
- 任务类型、函数名、状态名和错误码在后续任务中沿用前面定义，未引入第二套认证库或第二套任务协议。
- 本计划选择同一任务内 `superpowers:executing-plans` 内联执行，因为用户已授权连续执行且不希望再就常规实现细节提问；不创建并行写同一工作区的子任务。
