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
