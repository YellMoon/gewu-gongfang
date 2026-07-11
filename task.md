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
- [ ] Add failing tests for scoped host download and validated client upload.
- [ ] Implement sync scoping, source metadata, rejection, and review queue behavior.
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
