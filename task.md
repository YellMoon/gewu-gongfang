# Task: 2026-07-11 Unified Role and Data Scope Authorization

Status: design approved; implementation plan pending written-spec review

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
- [ ] Create a database rollback snapshot before schema migration.
- [ ] Add failing tests for the shared role and approval policy.
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

- Preserve a database backup before schema or migration mutations and record its exact path.
- Use additive schema changes; do not delete legacy browser storage keys during migration so code rollback remains possible.
- Keep implementation commits scoped so identity, data scope, sync, question bank, and UI can be audited and reverted independently.
- Follow the project default `gewu/master` push, Windows package, OSS feed publication, and post-package native dependency verification workflow only after the full implementation is verified.

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
