# Task: 2026-07-11 Unified Role and Data Scope Authorization

Status: implementation in progress

## Objective

Replace the disconnected desktop, miniapp, invitation, and module-permission systems with one enforced role and data-scope model for super administrators, administrators, teachers, students, and pending users. Remove menu structure management, isolate teacher-owned business data across desktop/miniapp/sync, protect host-committed question-bank deletion, verify both runtimes, and publish the completed desktop update.

## Confirmed constraints

- Phone `13732250653` is the fixed super administrator; only super administrators may review users or change roles and teacher bindings.
- Ordinary administrators retain full business-data access but no user-review authority.
- Teacher accounts bind by normalized phone to exactly one `teacher_id` and have the same functional permissions on desktop and miniapp.
- Teacher business data is limited to their own courses and input; question-bank content is not teacher-scoped.
- Only the primary local data host desktop may delete questions already committed to the question-bank drive.
- Other devices may freely modify only their own unsynchronized local question drafts; host writes are revalidated and source-attributed.
- Students retain the current own-data read and limited-task model.
- Remove invitee/invited, invitation authorization, local module grants, and all other old permission systems.
- Preserve the local host as business-data authority and require explicit user confirmation before client changes sync upward.

## Execution checklist

- [x] Inspect current desktop, miniapp, gateway, backend, database, and sync permission paths.
- [x] Confirm roles, teacher identity binding, administrator boundary, teacher parity across clients, and question-bank exception.
- [x] Write and self-review the design specification.
- [x] Obtain review of the written design specification.
- [x] Write a file-level TDD implementation plan.
- [x] Create a database rollback snapshot before schema migration.
- [x] Add failing tests for the shared role and approval policy.
- [ ] Implement role migration, fixed super-admin enforcement, pending state, and unique teacher binding.
- [ ] Add failing tests for teacher row/data scope and source attribution.
- [ ] Implement authoritative read/write data scoping and filtered aggregation.
- [x] Add failing tests for scoped host download and validated client upload.
- [x] Implement sync scoping, source metadata, rejection, and review queue behavior.
- [ ] Add failing tests for question local-draft versus host-committed deletion rules.
- [ ] Implement question storage-state and host-desktop-only committed deletion protection.
- [ ] Add failing UI/navigation regression tests.
- [ ] Remove menu structure management and all obsolete permission/invitation surfaces.
- [ ] Build desktop and miniapp review workbenches from the real authorization APIs.
- [ ] Run targeted tests, `npm test`, desktop build, miniapp typecheck, and release checks.
- [ ] Verify real desktop and miniapp/H5 UI for all roles and key failure/empty states, retaining screenshots or check records.
- [ ] Commit and push `gewu/master`.
- [ ] Bump/package the Windows desktop app, publish the OSS update feed, rebuild Node native dependencies, and verify artifacts.

## Bottom-level logic

- Construct authorization context from authenticated server state, never request-body role or ownership fields.
- Resolve teachers only when one normalized phone maps to one teacher record; otherwise leave the user pending.
- Apply teacher scope at repository/query and write-validation boundaries, before aggregation.
- Derive course-related ownership through `courses.teacher_id`; use explicit owner/source fields for user-entered non-course data.
- Revalidate every uploaded mutation against current host relationships and record actor/device/operation provenance.
- Distinguish device-local question drafts from host-committed question records.
- Require both primary-host identity and desktop client identity for committed-question deletion.
- Enforce all sensitive rules server-side; UI visibility is not an authorization mechanism.

## Validation plan

- Prove each new policy with a failing test before implementation and a passing test afterward.
- Test super-admin-only review from desktop and miniapp API paths.
- Test teacher cross-scope reads, writes, aggregates, downloads, and uploads are rejected or excluded.
- Test source metadata and conflict/rejection records survive persistence and reload.
- Test question deletion across local draft, host desktop, client desktop, miniapp, and relay contexts.
- Search for and reject residual menu-manage, invitee/invited authorization, invitation UI, and `permissions_data` runtime references.
- Render and exercise affected pages at desktop and narrow widths with console inspection.

## Rollback and publish notes

- Authoritative production database backup verified before schema or migration mutations: `/root/scheduling-data/prod/scheduling-pre-unified-auth-20260711-204817.db` (692,224 bytes; `test -s` and `stat` passed). Restore it to `/root/scheduling-data/prod/scheduling.db` while the service is stopped if rollback is required.
- Use additive schema changes; do not delete legacy browser storage keys during migration so code rollback remains possible.
- Keep implementation commits scoped so identity, data scope, sync, question bank, and UI can be audited and reverted independently.
- Follow the project default `gewu/master` push, Windows package, OSS feed publication, and post-package native dependency verification workflow only after the full implementation is verified.

### Task 1 evidence: backup and pure authorization policy

- [x] Locate the authoritative database path and create a non-destructive timestamped backup.
- [x] Add failing tests for fixed super-admin promotion/review, normalized unique teacher binding, roles, and data scopes.
- [x] Implement the pure authorization policy without schema or database migration.
- [x] Verify the focused test and the existing full test suite.
- RED: `node backend/src/services/authorizationPolicy.test.js` exited 1 with `Cannot find module './authorizationPolicy'` before implementation.
- GREEN: `node backend/src/services/authorizationPolicy.test.js` exited 0 with `authorization policy checks passed`.
- Full regression: `npm test` exited 0 on 2026-07-11.
- Review RED: after requiring structured teacher-binding results and deleted-teacher exclusion, `node backend/src/services/authorizationPolicy.test.js` exited 1 because the implementation still returned the raw teacher record.
- Review GREEN: the same focused command exited 0 after `resolveTeacherBinding` returned `{ ok, teacherId/code }` without throwing and ignored teachers with `deleted` set to `true` or `1`.
- Quality RED: boundary tests made `node backend/src/services/authorizationPolicy.test.js` exit 1 with a `TypeError` from `roleForUser(null)` before hardening.
- Quality GREEN: the focused command exited 0 after rejecting empty phones and invalid teacher IDs, safely handling null/non-object inputs and invalid teacher collections, and preserving explicit invalid-role precedence over `user_type`.

### Task 2 evidence: authorization schema and database persistence

- [x] Add additive user review/binding columns plus authorization audit and sync rejection tables.
- [x] Migrate legacy roles safely, promote only the fixed super-admin, and bind teachers only on one active phone match.
- [x] Add review/list/context/audit/rejection DatabaseService methods with parameterized SQL and stable error codes.
- [x] Preserve fixed super-admin miniapp login compatibility and update affected seed/login expectations.
- [x] Add the focused database authorization test to `test:backend` and run all requested regressions.
- RED: `node backend/src/databaseAuthorization.test.js` exited 1 with `users should include teacher_id` before schema/database implementation.
- GREEN: `node backend/src/databaseAuthorization.test.js` exited 0 with `database authorization checks passed`.
- Focused regressions: authorization, `databaseMiniappAdminSeed`, `databaseImportSafety`, and `miniappPhoneLogin` all exited 0 on 2026-07-11.
- Full regression: `npm test` exited 0 in 37.1 seconds on 2026-07-11.
- Quality review RED: the focused authorization database test exited 1 because a normalized duplicate fixed phone remained `admin/approved`; miniapp access and cloud relay tests also exited 1 because `super_admin` lacked existing admin abilities.
- Quality review GREEN: focused database, miniapp access/auth, cloud relay client/host/route, seed, import, phone login, and pure authorization policy tests all exited 0 after canonical identity hardening.
- Canonical evidence: the seed ID is preferred, duplicate fixed-phone rows become pending/disabled, inactive or unreviewed canonical identity cannot review, and ambiguous non-seed identities return `SUPER_ADMIN_IDENTITY_CONFLICT`.
- One-time migration evidence: `authorization_migrations` records `legacy-users-v1`; restart tests preserve post-migration rejected status, role, and manual teacher binding while reasserting only the fixed super-admin safety invariant.
- Boundary evidence: caller device authorization flags are discarded with `trusted: false`; object and JSON-string audit/rejection inputs persist as single-layer valid JSON.
- Quality full regression: `npm test` exited 0 in 14.6 seconds on 2026-07-11.
- Identity closure RED: pure policy lacked the canonical ID export, and a persisted duplicate fixed-phone context incorrectly resolved to `super_admin/all`.
- Identity closure GREEN: persisted-role classification now requires canonical ID plus active/enabled/approved state; duplicate context resolves to `pending/none`, while canonical context resolves to `super_admin/all`.
- The canonical super-admin identity is non-transferable and non-revocable through application state: startup atomically demotes duplicate fixed-phone identities and restores the canonical account to active, enabled, approved `super_admin`; `reviewUser` still rejects downgrade attempts.
- Legacy identity compatibility RED: a single formatted fixed-phone row with a historical noncanonical ID was joined by the exact-phone seed and became locked in a conflict.
- Legacy identity compatibility GREEN: `is_super_admin_identity` plus a partial unique index persists exactly one selected identity; normalized seeding reuses a single legacy fixed-phone row, which remains canonical across restart and can review users.
- Selection order is fixed seed ID, then one persisted identity flag, then one unambiguous fixed-phone legacy row; multiple unflagged noncanonical candidates remain a conflict and are never arbitrarily promoted.
- Index-order RED: a historical database containing two identity flags failed during startup with `UNIQUE constraint failed` before identity recovery could run.
- Index-order GREEN: startup now performs additive schema work, migration, and atomic identity recovery before creating the partial unique index; canonical conflicts retain only the canonical flag, while ambiguous noncanonical conflicts clear all flags and disable every candidate.

### Task 5 evidence: scoped synchronization and provenance

- [x] Validate every direct and relay-host mutation inside `applySyncChanges` before the business write transaction commits.
- [x] Persist rejection reasons and additive record provenance with the business write transaction.
- [x] Scope incremental pulls for approved administrators and teachers; reject missing authorization context.
- [x] Bind one-time sync authorization tokens to user, teacher, device, scope, and expiry.
- [x] Preserve explicit preview confirmation and prove cancellation performs no push.
- [x] Keep legacy queued operations readable while adding actor/device/operation candidate fields; server identity always overrides them.
- Security default: the current desktop shell has no unified persisted login-session provider. Direct and relay upload therefore fail with `AUTHORIZATION_CONTEXT_REQUIRED` unless the caller injects a Bearer session and authenticated device context; local phone/role fields are never used as authority.
- RED: `node backend/src/services/syncScopeService.test.js` initially exited 1 because `syncScopeService` did not exist.
- GREEN: sync scope pure/integration, incremental sync, transports, mutation queue, one-click confirmation, and cloud relay path checks pass.
- Typecheck note: standalone TypeScript 4.9 cannot parse the installed newer `@types/node/ffi.d.ts`; the production build is used as the project compilation check.
- Authorization closure: relay payload role/teacher claims are never trusted. The host reloads the approved active user and owned active device, verifies the current teacher binding, and atomically consumes a host-issued user/device/teacher/scope token. Queued work fails closed after revocation, rebinding, device spoofing, expiry, or token reuse.
- Delivery-removal closure: additive `sync_delivery_scope` records only IDs actually delivered to each actor/device. Later pulls emit minimal delete tombstones for deleted or relationship-transferred records, including after process restart; records never visible to that recipient produce no tombstone.
- Shared question-bank scope is intentional: teachers may create/update shared questions and delete unsynchronized local drafts. Task 6, not teacher ownership, distinguishes and protects host-committed deletion.
- Review RED: the integration test exited 1 because unauthenticated `applySyncChanges` still wrote; tombstone and token-consumption assertions were then added before implementation.
- Review GREEN: focused sync scope, relay-path, atomic token reuse, revocation/rebinding/device mismatch, provenance, and restart-persistent tombstone tests exit 0.
- Reachable direct authorization: `SyncSettings` resolves the current structured desktop session at call time; each direct push registers the session device, requests a fresh host one-time token with its Bearer session, and immediately consumes it. Missing session data fails with `AUTHORIZATION_CONTEXT_REQUIRED`.
- Relay assertion closure: cloud relay binds devices to its persisted approved user, creates a short-lived HMAC assertion from the server-side user/task/device plus nonce, and the host timing-safe verifies and uniquely consumes that nonce before reloading its own user/device authorization. Clients never receive a host database token or supply a signature.
- Tenant ledger migration: `sync_delivery_scope` now keys tenant plus actor/device/table/record. Startup transactionally migrates legacy rows to tenant `default`; tests preserve legacy rows and prove another tenant cannot emit or lose tombstones during a default-tenant pull.
- Desktop pairing closure: backend and formal gateway expose identical public-limited start/exchange and super-admin-only approve/reject paths. Only a client-generated secret hash is stored; pairing codes cannot exchange sessions, raw secrets are timing-safe verified, exchange is single-use, and successful approval binds the device owner before issuing a 30-minute session.
- Reachable desktop flow: SyncSettings provides a minimal phone/start/code/manual-refresh interaction. Successful exchange writes the structured session consumed by direct and cloud transports; approval is never automatic.
- Formal gateway relay closure: gateway now owns the production cloud device registration and desktop-sync request paths, verifies persisted approved identity plus device ownership, and stores a server-generated HMAC assertion. Anonymous, cross-owner, and missing-secret requests are rejected in the HTTP suite.
- Device review closure: backend and gateway expose super-admin-only safe pending pairing lists and current-code approve/reject actions without returning secret hashes. Desktop PermissionManager and miniapp admin users use these real APIs; first approval relies on the existing verified-phone miniapp canonical super-admin and no HTTP bootstrap bypass exists.
- Cloud polling/provision closure: formal gateway polling returns pending/completed state only to the creator or an administrator. Gateway signs the approved pairing identifier into relay assertions; after verification and nonce consumption, the host may provision the first owner-bound trusted device and records an audit, while tampering, unapproved devices, and owner conflicts cannot create or rebind devices.
- Approval reachability: desktop pairing review resolves the configured host first and cloud second, producing an absolute HTTP(S) API URL under Electron `file:`; browser HTTP(S) uses its origin. No localhost is hardcoded.
- Durable approval semantics: an approved gateway pairing remains device approval evidence after the original exchange window, while pending pairings cannot relay and exchange still enforces expiry. Gateway approval rejects a conflicting existing device owner before any pairing/device/audit mutation and idempotently preserves the same owner.
- Upload ownership hardening: host validation checks existing ownership before candidate payloads, ignores delete ownership claims, and rejects immutable ownership-link changes. Teacher-created courses receive the authenticated teacher binding server-side; shared questions remain the documented exception.
- Pairing/security hardening: pending approval uses compare-and-set state/expiry conditions, pending pairing codes have a collision-cleaned partial unique index with bounded random retry, and pairing/device/sync payload inputs have explicit length/count/byte limits. Desktop session JWTs require configured secrets and strict HS256 issuer/audience/token-use claims while legacy non-desktop sessions retain compatibility.
- Gateway pairing quality closure: the gateway phone validator uses the real `/^1\d{10}$/` regex and has a direct service plus HTTP start test. Both exchange routes verify configured JWT signing, pairing state, and persisted active user before timing-safe secret verification and CAS consumption, so configuration or user failures never burn the one-time pairing.

### Task 3 evidence: unified local and gateway review authorization

- [x] Add authenticated local user listing and canonical-super-only review endpoints with stable error codes.
- [x] Build `req.authz` from persisted identity; body role/actor/teacher claims are ignored and a node-role header alone never proves primary-host status.
- [x] Return one effective capability contract for pending, student, teacher, admin, and super-admin; gateway never grants committed-question deletion.
- [x] Mirror additive review columns and canonical authorization policy in gateway while retaining legacy grant tables for rollback without consulting them at runtime.
- RED: local route test exited 1 because the old write middleware returned `FORBIDDEN`; gateway policy test exited 1 because the policy module did not exist.
- GREEN: `node backend/src/routes/adminUsers.test.js` and `node gateway/src/services/authorizationPolicy.test.js` exited 0 on 2026-07-11.
- Security evidence: unauthenticated review returns 401; ordinary admin returns 403 `SUPER_ADMIN_REQUIRED`; forged body actor/host and `x-node-role` do not elevate; pending capabilities are empty.
- Host evidence: committed-question deletion defaults denied and is available locally only when server config explicitly enables trusted-host resolution and the registered `sync_devices` record is trusted host plus desktop client context.
- Regression evidence: pure authorization, database authorization, miniapp auth/access, and gateway cloud-relay tests exited 0 on 2026-07-11.
- Full regression: `npm test` exited 0 in 14.1 seconds on 2026-07-11 after updating the permissions-route security assertion from optional to required authentication.
- Bypass-review RED: ghost canonical JWT returned 403 instead of 401, pending gateway roles still had capabilities, and legacy role/grant endpoints returned 200 and performed writes.
- Bypass-review GREEN: required auth now rejects identities missing from persistent storage with 401; optional auth yields no identity/capabilities; gateway requires approved, active, login-enabled persisted state for every role.
- Legacy endpoint closure: `PUT /users/:id/type` returns 410 `LEGACY_ROLE_ENDPOINT_DISABLED`; grant/revoke endpoints return 410 `LEGACY_PERMISSION_GRANTS_DISABLED` and tests prove zero writes to `user_permissions`.
- Review regression: ordinary gateway admin receives 403 `SUPER_ADMIN_REQUIRED`, canonical super succeeds through `PATCH /api/admin/users/:id/review`, and approved ordinary admin retains read-only user-list access.
- Closure verification: focused backend route, gateway policy, gateway legacy-endpoint, authorization/database/cloud-relay tests passed; `npm test` exited 0 in 13.4 seconds on 2026-07-11.
- Quality-hardening RED: persisted pending/disabled local roles retained capabilities; compatibility permissions exceeded the capability contract; gateway legacy fixed-phone rows were not promoted; review wrote no audit record.
- Quality-hardening GREEN: persisted local roles now require approved, active, login-enabled state; pure no-id policy fixtures remain compatible but cannot review; permissions are a direct capability projection.
- Device replay closure: even a known trusted `sync_devices` host ID plus desktop header cannot produce `question-bank:delete-committed`; request host authorization remains hard-false until Task 6 introduces a non-replayable request credential.
- User-list closure: backend and gateway select explicit management fields, omit OpenID/UnionID, validate filters, cap search/page size, and return `items/total/page/pageSize` with a `users` compatibility alias.
- Gateway identity closure: additive startup migration normalizes the fixed phone, preserves one unambiguous legacy identity, refuses arbitrary conflict selection, restores active approved canonical state, and creates a single-identity partial unique index.
- Gateway review closure: fixed/canonical identity is immutable; role update and `authorization_audit_log` insertion execute in one database transaction.
- Quality verification: focused local policy/routes/database and gateway migration/hydration/policy/admin/cloud-relay tests passed; `npm test` exited 0 in 15.6 seconds on 2026-07-11.

---

# Task: 2026-07-10 miniapp publish and business fixes

## Goal

Complete the current release after WeChat upload whitelist is ready:
- Check whether a useful WeChat miniapp development skill exists and install it only if it is clearly relevant.
- Change fee/revenue statistics course filter options to cover all courses, not only unsettled/current courses.
- Reduce exported schedule-list weekly course cell width so the exported table is closer to the course text width.
- Seed miniapp admin login access for phone numbers `13732250653` and `18257136756`.
- Rebuild, deploy, upload miniapp, publish desktop update if version changes, commit and push `gewu/master`.

## Constraints

- Do not expose `.env.local` secrets or private keys.
- Keep student miniapp permissions scoped to own schedule and question-bank limited operations.
- Preserve the local-data-host architecture: desktop host is authoritative; Aliyun is relay/API/snapshot.
- Follow existing project patterns and tests.

## Implementation Checklist

- [x] Inspect installable skills for miniapp-specific support.
- [x] Locate revenue/fee filter option source and add a failing regression test.
- [x] Locate schedule-list export sizing and add a failing regression test.
- [x] Locate miniapp auth/admin bootstrap path and add a failing regression test.
- [x] Implement the three fixes.
- [x] Run targeted tests, `npm test`, miniapp build/release check.
- [x] Upload miniapp after whitelist confirmation.
- [x] Bump/package if needed, deploy cloud/backend/desktop update feed, install local host.
- [x] Commit and push `gewu/master`.

## Review Follow-up (2026-07-11)

- [x] Add verified WeChat phone binding for preauthorized miniapp admins.
- [x] Preserve explicit account disable/delete state across backend restarts.
- [x] Align production backend port defaults and harden deploy env loading.
- [x] Sync root/backend versions and build desktop version `5.12.0`.
- [x] Re-run full tests, TypeScript checks, and miniapp release build.
- [x] Add `WECHAT_APPSECRET` to `.env.local` without sharing it in chat.
- [x] Deploy backend `5.12.0`, upload miniapp `5.12.0`, and publish/install the desktop update.
- [x] Commit and push the final release to `gewu/master`.

## Validation

- Targeted tests for each changed behavior pass.
- `npm test` passes.
- `npm --prefix miniapp run typecheck` and `npm run miniapp:release-check` pass.
- Public `/scheduling/api/health` reports the final version.
- Miniapp upload succeeds or any remaining platform-side blocker is clearly reported.

## Rollback Notes

- Code rollback is normal git revert of the release commit.
- Cloud backend rollback should restore previous PM2 code and keep DB snapshot policy unchanged.
- Desktop update rollback can republish the previous `latest.yml` if needed.

---

# Task: 2026-07-11 Desktop Sync Page Simplification

Status: implemented, verified, packaged, published, and pushed

## Objective

Simplify the desktop data-sync page by adapting its default content to the configured device role and replacing the ambiguous group of sync controls with one clearly explained primary workflow.

## Execution checklist

- [x] Inspect the current sync page and underlying one-click sync behavior.
- [x] Confirm role-aware information architecture.
- [x] Confirm the client-side primary action and its data-direction wording.
- [x] Write and review the design specification.
- [x] Write an implementation plan.
- [x] Add focused tests before changing production behavior.
- [x] Implement the role-aware simplified page.
- [x] Verify unit tests, build, desktop and narrow rendered layouts, and primary interactions.
- [x] Commit and push to `gewu/master`.
- [x] Bump the desktop version, package Windows installer, publish the OSS update feed, rebuild Node native dependencies, and verify the release output.

## Bottom-level logic

- Reuse the existing `runOneClickSync` workflow: preview, confirm, upload pending local operations, pull host operations, merge/apply locally.
- Determine the surface from `runtimeConfig.nodeRole`.
- Client devices get one primary bidirectional-sync action.
- The primary host gets request-processing and conflict-review entry points.
- Directional and destructive maintenance actions remain accessible only in a collapsed advanced section.
- Do not change synchronization protocols, conflict policy, authorization requirements, queue retention, or cloud-relay behavior.

## Validation plan

- Unit-test role presentation and primary-action copy where practical.
- Run sync service tests and the production build.
- Render the affected desktop route and verify client/host states, desktop/narrow viewports, console health, and at least one primary interaction.
- Check loading, offline/waiting, empty, error, disabled, conflict, and confirmation states supported by available fixtures/runtime state.

## Rollback and publish notes

- Preserve unrelated user changes and inspect the worktree before each commit.
- The implementation can be rolled back as a single focused commit if needed.
- Follow project policy for `gewu/master`, Windows packaging, OSS desktop update publication, and post-package native dependency restoration.

## Question deletion cleanup and teacher import attribution

- [x] Removed unreachable legacy single-delete and batch-delete branches from both question-bank pages.
- [x] Added a real HTTP import check/commit test using a temporary database and an approved teacher paired-desktop JWT.
- [x] Verified unauthenticated commit is rejected without inserting questions and authenticated commit persists token-derived source device and owner user IDs.
- [x] Added the focused HTTP test to `test:question-deletion`.
# 2026-07-11 老师业务数据域隔离证据

- `node backend/src/services/dataScopeService.test.js`：老师课程依赖链、支付安全默认、个人资产、公共题库、读写断言通过。当前真实 host snapshot 构造未包含用户作答表，因此不将合成作答字段作为完成证据。
- `node gateway/src/routes/cloudRelay.test.js`：真实 cloud relay 过滤函数 teacher snapshot 通过。
- 统计输入证据：裁剪后的 schedules/assetRecords 汇总仅包含 t1（课时费 100、学费 500、资产 10）。桌面 UI 会话接入不在本任务范围，未声称桌面 UI 已完成隔离。
- 审查修复：gateway/backend snapshot read 强制持久化 approved active 用户；unknown/pending fail closed。学生与老师均使用明确字段 allowlist，未知数组和预聚合 stats 不透传；`scopedFinancials` 从裁剪后的 schedules/payments/assets 重算。
- 学生快照统一：真实 enrollment 以 `schedule_id + student_id` 经允许排课过滤（兼容 `course_id`）；学生、课程、排课、老师由共享 service 做安全字段白名单脱敏，payments/consumptions/assets 继续按原学生策略清空。unknown/pending 返回空 payload，仅 approved student（包括未绑定学生）保留公共题库。
- 云中继加固：gateway 主机 heartbeat/snapshot publish/task list/task complete 使用 timing-safe host token 且缺配置 fail closed；真实 HTTP 测试覆盖匿名、错误 token、正确 token及任务 owner 边界。gateway 内置独立 scope service，并以 parity test 防止与 backend 行为漂移。公共题库和关联基础数据逐表投影；金额忽略非有限值、保留负数并按 id 去重；同时出现 course/schedule 时以 schedule 归属为准并拒绝冲突。
- 资源投影补全：题库图片资源保留渲染所需 URL/data URL、mime/type、尺寸和 alt 的 snake/camel 字段，继续排除对象键、内部路径及 hash；学生关联 room/institution/school 只保留安全名称字段。普通用户任务结果查询在 SQL 层附加规范化 owner 条件，跨用户返回不可枚举的 404。

---

# Task: 2026-07-11 统一角色、审核与老师数据权限

Status: implemented, verified, packaged, published, and pushed

- [x] 删除菜单结构管理、邀请页面、邀请码授权和任意模块授权矩阵运行时。
- [x] 建立超级管理员、普通管理员、老师、学生、待审核五角色契约。
- [x] 固定 `13732250653` 为不可停用超级管理员，只有超级管理员可审核、分类、停用和审批设备。
- [x] 老师唯一绑定 `teacher_id`，桌面端和小程序能力一致，业务数据与同步范围仅限本人。
- [x] 老师拥有公共题库查看/编辑；已提交试题仅可信本地数据主机桌面端可删除。
- [x] 桌面端和小程序端重建用户审核工作台，普通管理员只读。
- [x] 手机号验证登录改为待审核流程并补齐并发、超时、缺配置和审核后令牌测试。
- [x] 权限缓存 fail closed，冷启动/前台恢复强制刷新，身份或 `teacher_id` 改变时清除旧业务缓存。
- [x] `npm test`、桌面构建、小程序 typecheck、微信发布检查和 H5 构建通过。
- [x] 真实桌面/H5 运行时复验并留下截图；发现并修复桌面 Unicode 字面转义显示缺陷。
- [x] 完成残留审计和验证记录：`docs/verification-2026-07-12-unified-authorization.md`。
- [x] 合并并推送 `gewu/master`。
- [x] 自动递增至 `5.13.0`、构建 Windows 安装包并发布 OSS 更新 feed。
- [x] 修复 packaged smoke 发现的 CommonJS/ESM 空白页，重新打包并覆盖发布。
- [x] 恢复 Node ABI 并验证 `better-sqlite3`。

---

# Task: 2026-07-12 同步与线上小程序认证故障修复

Status: implemented, verified, deployed, packaged, uploaded, and pushed

## Objective

修复桌面“双向同步”失败，以及线上微信小程序仍显示邀请码入口、一键登录返回“无权限访问”的问题，使桌面、本地后端、云端网关和小程序使用同一套 5.13 授权与同步契约。

## Execution checklist

- [x] 采集桌面同步/系统参数错误日志，定位系统参数空白页为题库绑定状态加载期 `null` 崩溃。
- [x] 核对本地桌面版本、本地后端版本、线上健康检查、云端代码版本和小程序已上传版本。
- [x] 验证线上登录页/登录 API 是否仍走旧邀请码和旧 openid 授权流程；源码和云端均已移除运行时邀请码入口，手机端正式线上版生效取决于微信平台发布。
- [x] 为确认的同步与登录根因增加失败回归测试。
- [x] 实现最小根因修复，并确保未审核用户得到明确待审核状态。
- [x] 运行同步、认证、权限、桌面和小程序相关测试与构建。
- [x] 部署云端 backend/gateway，上传新的微信小程序 `5.13.2` 开发版本。
- [x] 在真实桌面/打包运行时复验主流程并记录限制；本机新安装路径健康检查返回 `5.13.2`，正式线上小程序发布状态仍以微信平台为准。
- [x] 提交并推送 `gewu/master`；桌面代码变化已重新发布 OSS 更新包，并按用户本次明确要求上传夸克网盘 `5.13.2`。
- [x] 尝试自动查询/提交微信小程序审核；当前普通小程序凭据返回 `86000 should be called only from third party`，已记录为微信后台/第三方平台权限限制。

## Bottom-level logic

- 微信登录只信任微信官方手机号交换结果；首次用户进入 pending，不签发业务 token。
- 只有超级管理员审核后，用户才按数据库中的角色和绑定身份获得 token/capabilities。
- 桌面同步必须使用持久身份、配对设备和作用域令牌，不接受客户端自报角色或 teacher_id。
- 客户端错误提示必须保留后端稳定错误码，区分未审核、未配对、凭据过期、云端不可达和数据冲突。

## Validation and rollback

- 验证包含真实 HTTP 契约、并发/超时、同步预览与传输、微信小程序构建及线上健康检查。
- 部署前保留现有生产数据库和远端代码备份；云端失败时回滚前一 PM2/容器版本，小程序失败时不提交新审核版本。

## Persistent release matrix

- 微信小程序：Codex 构建、上传、核验。
- 阿里云：Codex 备份、部署、迁移、重启、核验。
- 本地数据主机：Codex 安装/升级并验证本地同步。
- 其他电脑桌面端：Codex 发布 OSS 更新，用户自行更新；不默认上传夸克网盘或另行交付安装包。
- 四端未统一前不得标记完成。
# Task: 2026-07-12 题库公式全链路与所见即所得编辑

Status: active — implementation and multi-end verification in progress

## Objective

统一解析正文和批注中的 OMML、EQ 域与 MathType 为可编辑 LaTeX；建设覆盖题干、选项、小题、答案和解析的所见即所得富文本编辑器；由本地数据主机按用户选择生成公式全部可见、排版稳定的 Word 自带公式、EQ 域、MathType兼容或 LaTeX矢量公式 DOCX/PDF。

## Execution checklist

- [x] 审计现有解析、显示、存储和导出链路。
- [x] 学习 D 盘讲义答案提取项目的 MathType OLE → MathML → EQ/OMML实现。
- [x] 调研合法 MathType SDK与开放 MTEF/OLE生成方案。
- [x] 确认数据主机集中导出、LaTeX权威编辑格式和显示优先回退规则。
- [x] 写出完整设计规范。
- [x] 写出逐步 TDD 实施计划。
- [x] 建立 Word 公式解析样本与自动化测试基座。
- [x] 实现正文/批注共用内容遍历器与 EQ 域状态机。
- [x] 实现 OMML、EQ、MathType → 规范化 LaTeX转换及质量报告。
- [x] 迁移题库富文本与公式数据模型，验证保存、重载和同步兼容性。
- [x] 实现专业桌面所见即所得编辑器并完成真实运行时视觉/交互验证。
- [x] 实现数据主机四格式导出适配器、显示优先回退和失败阻断。
- [x] 将 `C:\Users\83423\Desktop\组卷导出模板.docx` 固化为 Word/PDF 默认组卷模板，支持“答案统一置后”和“每题后紧跟答案块”两种模式。
- [x] 答案置后模式在参考答案开头汇总选择题答案，随后逐题输出答案、【知识点】和【解析】；逐题模式按题目→答案/知识点/解析交错输出。
- [ ] 生成并渲染四类 DOCX/PDF，验证公式数量、字号、基线、裁切和分页。
- [ ] 完成多端任务契约、权限、同步、构建与回归测试。
- [ ] 按统一版本矩阵备份、发布、上传、安装主机并验证 OSS feed。

## Bottom-level logic

- 编辑只修改 `canonicalLatex` 和结构化富文本，不实时维护四种导出格式。
- 原始 OMML/EQ/OLE/预览保留用于追溯和可见兜底，用户编辑后 LaTeX 为权威语义。
- 输出不得出现任何源码或空白公式；所有可见路径失败时阻止整份文档交付。
- 非主机端只提交任务并下载产物，阿里云只作中继，数据主机从权威快照生成文档。
- 保留旧数据读取兼容，不删除用户原始公式载荷。

## Validation plan

- 解析：正文、批注和表格 × OMML、EQ、MathType × 常见及复杂公式结构。
- 状态：导入 → 持久化 → 重载 → 编辑 → 再保存 → 同步 → UI刷新。
- 文档：四种模式 DOCX/PDF真实渲染与页面截图检查；公式数与模型一致且无裁切、源码或断链图片。
- UI：Electron/浏览器桌面及窄窗口、键盘、焦点、粘贴、图片、公式、保存错误与恢复。
- 发布：桌面、小程序、阿里云、本地数据主机和 OSS feed版本/健康/运行时证据齐全。

## Rollback and publish notes

- 开始前检查并保护脏工作树，不覆盖用户文件。
- 数据迁移只做增量，保留旧字段和原始载荷；部署前备份数据库与代码。
- 各阶段保持可独立回滚提交。发布失败回滚云端版本和 OSS feed，不删除已生成原始题库资源。

### Task 6 验证证据（2026-07-13）

- 唯一 token-derived Word 内容流已替代主流程双读取路径，公式按稳定 ID 与源坐标原位插入。
- 真实 lecture/exam DOCX 覆盖 OMML、EQ、MathType preview-only OLE、批注、表格、选项、小题、子答案、答案与解析。
- 质量报告按 source/status 统计，并包含题号、字段、段落、表格单元格与批注位置；未挂载公式明确标记为 `unknown`。
- Parser discovery 32/32、multipart 路由集成、Node 语法检查与生产构建通过；独立规格审查和代码质量审查通过。

### Task 7 验证证据（2026-07-13）

- 前后端采用一致的 TipTap 节点、标记与属性白名单，拒绝危险 URL 和任意 HTML 属性。
- rich-only 保存、数据库重载、旧客户端字段投影、选项/小题/答案/解析搜索与 derived flags 已通过行为测试。
- 浏览器同步先完整验证再原子应用；非法记录不会造成部分写入，旧客户端局部更新保留未修改 section 的公式、图片、marks 与稳定 ID。
- 增量 `search_text` 迁移按批次短事务回填，使用与新写入相同的纯文本投影并支持重启幂等。
- 聚焦后端/浏览器/同步测试与生产构建通过；独立规格审查和代码质量审查通过。

### Task 9 验证证据（2026-07-13）

- 题干、选项、选项正确性、小题及小题答案、主答案和解析均使用稳定 ID 的结构化 TipTap 编辑器；三处旧的重复公式文本域与重复题干/答案编辑入口已移除。
- 旧题型别名、旧答案与旧公式可投影到新结构；保存、重试、双击保存、未保存离开、TipTap 水合默认值及资源引用 roundtrip 均有行为测试。
- 内部 `question-asset://` 引用在进入 TipTap 前使用安全占位并在持久化输出时恢复，初始化阶段和 React NodeView 阶段均不再触发 CSP 错误或丢失原始资源引用。
- fresh Playwright 真实链路验证：干净取消不弹确认，真实修改后可见确认框计数为 1；公式双击值为 `\\frac{a}{b}`；单选切换、选项上移、小题公式、图片和 720px 窄窗口均通过，console errors 为 0。
- 视觉截图已生成于本地验证目录；其中脏确认截图未可靠呈现确认框，因此该项只采用可见 DOM 计数证据，不把截图误报为视觉证据。
- `test:rich-content`、TypeScript、UI regression、整仓 `npm test` 与生产构建均通过。

### Task 10 验证证据（2026-07-13）

- Word native 与 EQ 模式仅在有真实 OMML 证据时声明成功；项目没有经审计的 MathType writer/fixture，因此 MathType 请求明确回退到 LaTeX 矢量公式并报告 `MATHTYPE_WRITER_UNAVAILABLE`，不伪造 OLE/MTEF。
- 公式准备的 MathML→OMML、manifest policy、KaTeX/MathML/Sharp worker 使用同一硬截止时间；阻塞 worker 与 Python 子进程可终止，Node 事件循环不被同步转换阻塞。
- 最终产物门禁按每个公式索引核对 DOCX 关系、extent/crop、OMML/EQ 容器与 PDF 页、annotation、绘制区域；源码残留、空白公式、断链媒体或索引集合不一致会阻止交付。
- SVG、PNG 与 PDF 对抗覆盖透明/隐藏/零面积、`tRNS` 灰度/RGB/调色板及 1-bit padding、CTM、clip `W n/W f`、框外/页外、无字体资源、开放退化填充与组合 fill/stroke；最终 Python 套件 38/38 通过。
- `paperArtifactService`、整仓 `npm test`、生产构建、独立规格/质量复审与 `git diff --check` 通过。

### Task 11 第一阶段验证证据（2026-07-13）

- 直接导出与 relay host 共用有序、唯一、全量命中的 `questionIds` 解析；重复、缺失、跨租户和无权限草稿选择整体失败，不静默替换题目。
- Backend/Gateway 双 schema 可迁移旧表，V2 任务支持 durable idempotency/request hash、指定 host、原子 claim、lease、claim token、`row_version` CAS、进度、失败、取消与 V1/V2 隔离。
- V2 长渲染使用串行 heartbeat 持续续租并以最新版本完成；续租失败禁止完成并清理孤儿产物。V1（含无 hostId 的旧轮询）也原子领取，旧主机仅在 shared lease 有效期内兼容无 token 完成。
- Cloud client 对非 2xx 与 `success:false` 结构化抛错；backend 完整 HTTP 合同验证同幂等键不同 body 返回 409、missing/non-owner 返回 404、错误 host token 返回 403，测试 bypass 仅可在显式 test 环境启用。
- Backend/Gateway 任务服务文件哈希一致；定向 HTTP/service/schema/client/host 测试、完整 `test:backend`、整仓 `npm test`、生产构建及独立对抗复审通过。
- 第一阶段验收时尚未完成不可变题目快照、artifact repository/授权下载、崩溃恢复与保留清理；这些内容已转入下列 Task 11 第二阶段继续实施，不能仅据第一阶段声明完整任务链路完成。

### Task 11 第二阶段验证证据（2026-07-14）

- 本地主机 writer DB 新增 durable paper job、artifact 与 completion outbox；`relay_scope + cloud_task_id` 唯一，直接导出也使用 actor/tenant/idempotency 派生的本地 durable job，不再绕过仓储链路。
- Claim 后冻结题目顺序、rich JSON、公式、实际模板 SHA 和 renderer/gate 版本；本地、允许的 HTTPS 与 data 图片经既有 SSRF/重定向/magic/大小/超时门禁后复制为内容寻址 blob，复制后再次核对题目与源资产哈希。
- 整卷渲染在可终止 Worker 中运行，父进程独立轮询 cancel/deadline；最终发布采用任务临时目录、可见性 gate、文件与目录 fsync、identity-bound sidecar、发布前 DB CAS 和同卷原子 rename。
- Artifact `staged→verified` 与 job `→completed` 位于同一 immediate transaction；启动对账覆盖 temp-only、staged+temp、final+sidecar、verified 文件缺失及 verified artifact/job processing 等崩溃窗。
- Completion outbox 持久 claim/version/operation/canonical result hash；云端校验 canonical hash并按 operation/hash 幂等 ACK，响应丢失可查询 host-scoped 终态；late cancel 会原子收口为 local cancelled、artifact revoked、outbox terminal_cancelled。
- 下载只接受 DB verified artifactId；独立高熵 HMAC、kid 轮换、`now >= exp` 失效，JWT owner/同租户管理员与 header token 双校验。认证 GET access endpoint 可刷新短 token，URL、outbox、cloud result 与日志均不含 token；旧 filename 匿名读盘路径返回 404。
- Cleanup 保护 active temp 与 pending outbox，处理过期 verified/revoked artifact 与 sidecar，并逐父链拒绝 Windows junction/reparse；retry/outbox 均有最大次数、cap 与 jitter。
- Direct Word/PDF 真实 HTTP 走 bound root→immutable snapshot→Worker→repo，重复幂等键复用同 artifactId；桌面客户端下载使用认证 Blob，410 时换签一次并在 finally revoke object URL。
- Round5 独立锁定复审通过；`test:paper-jobs` 已接入整仓门禁，fresh `npm test`、TypeScript、生产 `craco build`、双 schema/service/HTTP、Node 语法与 diff 检查全部通过。

### Task 11A 验证证据（2026-07-13）

- 默认模板已作为应用资源固化，SHA-256 与用户提供原件一致；运行时不依赖桌面文件路径，并保留模板主题、样式、A4 分节和页脚页码字段，移除了样例教师身份信息。
- “答案统一置后”会先汇总全部选择题答案，再按题号逐题输出答案、【知识点】和【解析】；“逐题显示答案”按题目与对应答案块交错输出。
- Word/PDF、本地主机直出与 relay 任务使用同一答案位置契约；正式桌面请求携带持久化认证会话和设备标识。
- 图片本地优先，受目录边界、junction/symlink、magic bytes、读取前大小、DNS/私网、重定向、流式上限与超时中止门禁保护；必需图片无法安全解析时阻止产物交付。
- PDF 两种答案布局已逐页栅格检查，且长选择题表、图片和公式有页底分页保护；DOCX 已验证 ZIP/关系/媒体/模板保留结构。
- `npm test`、生产构建、四组聚焦测试、独立规格审查及四轮代码质量审查通过。
- 环境限制：LibreOffice 不可用，Word COM 转 PDF 超时，因此 DOCX 尚未完成真实 Word 逐页视觉验收；该项保留在文档渲染矩阵中，不能据此宣称全链路完成。

---
