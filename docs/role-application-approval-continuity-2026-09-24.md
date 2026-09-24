# Role approval continuity

Date: 2026-09-24. Scope: own application result reading across approval.

Inspection found that mine() reused visitor-only authorization. Approval creates
the live role grant immediately, and cloud-context re-reads grants for every
signed session. Thus the same valid applicant ticket became forbidden when
checking its successful result. The existing mock tests never changed roles
after approval and did not catch this transition.

A regression using the actual signed miniapp account service failed with
CLOUD_ROLE_APPLICATION_ACCESS_DENIED. It now verifies teacher/student/family
approval, the unchanged signed token, own result, another account's isolation,
disabled/invalid session rejection, and refusal of a second formal-role submit.
The real HTTP route returns 200/approved for reading and 403 for resubmission.

Only mine() now uses the verified current account rather than requiring no
roles. Submission remains visitor-only. The repository still derives account
from the verified token and tenant from server configuration. No request accepts
an arbitrary account identifier. No SQL, role grant or profile creation rules
changed, and no new endpoint or migration was added.

Tests passed: miniappRoleApplicationService (includes continuity), full
test:role-applications, miniappCloudAccountService, update-version and independent
release version. PostgreSQL assertions additionally prove approved history is
readable for its own account and absent for another tenant/account.

Automatic classification is a cloud patch, 8.11.21 to 8.11.22 (gateway package
tracks the cloud component). Desktop 8.9.8, miniapp 8.8.24 and NAS 8.8.3 unchanged.
Six unrelated tracked modifications and protected untracked work are excluded.

## Frozen tests and production deployment (UTF-8)

Commit fb38070aaf47fa53fabdbd3098b2b93139b54974 passed all 183 cloud
lifecycle commands from committed sources only. Receipt directory:
`gewu-assets-frozen-tests-20260923-4_rmocxr`.

Cloud 8.11.22 was deployed from that commit, exit 0, and the cloud target is
verified in `gewu-cloud-81122-release-20260924-4o8nj699/active.json` at
2026-09-24T01:44:20Z. Public/private health, authority permissions, retired
gateway endpoints and WebSocket rejection passed. Fresh public health also
returned 8.11.22 at 01:48:24Z. Existing migrations were skipped, not reapplied.

Pre-migration backup `/root/scheduling-backups/postgres/20260924-014305`
was restore-verified before promotion. Dump SHA256:
`92bdcf77b641ed097fef45d6ab10bf93dfdbf07bda1cbe365b330c8f55716f4e`.
The prior business container/image remains the rollback target. This is a
cloud-only compatible patch, not a whole-project completion claim.

## Actual application and approved entry (UTF-8)

DevTools used the existing strict-domain dist project for AppID
wx3d570539bbe6ba1b. All accounts in these checks were newly marked test
fixtures; no real account, role or profile was reassigned. No SMS or WeChat
phone-consent flow was simulated as successful. Short-lived cloud-signed test
sessions were provisioned deliberately; application writes used the real UI.

Baseline `gewu-application-real-20260924-lw54mbxc` passed actual teacher/new
submission, desktop review HTTP approval, same-ticket result and live-role
reads, formal-role resubmit rejection, and miniapp denial at desktop review.
It exposed an approved screen requiring another login with no corresponding
action. The existing visitor home also bypasses formal authorization refresh,
so simply returning home would not fix the stored visitor identity.

Miniapp 8.8.25 repairs that existing flow with Enter Home. Its click reads the
cloud context for the captured session, validates the same account and formal
profile, then uses the existing session committer. No role is inferred from
the form and no business command is submitted. Navigation failure retains the
refreshed valid session for retry. Hidden/stale/account-changed replies cannot
commit; double taps are locked, and return after a hidden request restores the
button. Pending/approved wording no longer promises automatic updates then
asks for another login. React interaction guidance kept this in the button
handler rather than an effect that could repeat the transition.

Actual TSX regression first failed on the missing action, then on a disabled
button after hiding. Final tests pass teacher/student/family mapping, failed
authorization, mismatched account, still-visitor result, double tap, hide,
unmount, replaced session and navigation failure/retry. Full miniapp UI tests,
typecheck, weapp build, auth-session/authorization regressions and independent
version/release-matrix checks passed. Automatic classification selected patch.

Final source-pinned real run `gewu-application-real-20260924-uff9dva8` passed:
filled form -> submitted -> real desktop review HTTP -> approved -> actual
Enter Home click -> teacher home without a new login. All four screenshots
were individually inspected. The same signed ticket returned the new teacher
role; reapplication and miniapp access to desktop review returned 403.
Test account/application/grant/profile remaining counts are all zero; temporary
desktop device/session/link/installation active counts are zero. Original auth
and every original sch_ cache entry matched before and after simulator refresh.
No actual desktop review-window click is claimed; review used its production API.

Earlier attempts are retained honestly: `m_dsdwh8` failed in the harness by
reading roles at the wrong response level, before submission; cloud cleanup
was zero. `a2m983q9` completed the business checks but failed its post-refresh
verification with transient `wx is not defined`; cloud/device cleanup was zero.
A later read confirmed no signed-in test account. The successful baseline and
final run boundedly retry only that transient observation and prove exact
pre/post-refresh restoration. They do not relabel those earlier runs as passes.

## Development delivery (UTF-8)

Miniapp 8.8.25 was uploaded and its deferred receipt finalized successfully at
2026-09-24T02:06:05.761Z from commit
324338cbef6964bdb1ee507ed0a019815377dad4, pushed to gewu/master.
Receipt/manifest directory: `gewu-miniapp-8825-upload-20260924-4sy7n82t`.
The release runner required exact source hashes from the final real UI test,
all zero fixture cleanup counts, restored auth/cache, and a clean miniapp
source tree. Existing fixed-egress pre/post health gates passed; upload is
development level, not formal WeChat release. Desktop 8.9.8 and NAS 8.8.3
were not rebuilt or replaced for this compatible flow correction.

## Student and family production continuation (UTF-8)

Student run `gewu-application-real-20260924-86nqcevz` and family-member run
`gewu-application-real-20260924-gipno6ef` both completed on cloud 8.11.22 and
miniapp 8.8.25. Each used the actual form, submitted state, production desktop
review HTTP, approved state and Enter Home action without replacing the ticket
or logging in again. All eight screenshots were individually inspected.
The student landed in student scope; the family member landed in family scope
and cloud context identified exactly the newly created student with guardian
relationship. Formal reapplication and miniapp access to desktop review were
both rejected with 403. Source hashes match the delivered application page.

The family student's profile was created through the production desktop REST
contract with only a new fixture guardian contact in slot 2. Two earlier runs
(`y7_vwu5v`, `sufqadfk`) failed before form submission because the harness had
incorrectly used student-only slot 1 for that guardian. The second receipt
records 400 / CLOUD_BUSINESS_INPUT_INVALID. This was a fixture correction,
not a product contract or permission change, and neither run is called a pass.

All successful and failed runs verified zero remaining fixture accounts,
applications, grants, profiles and contacts; temporary desktop device/session/
link/installation active counts are zero. The original simulator login and
all original sch_ cache entries were restored and checked after refresh.
No real account or profile was reassigned, and no phone-consent flow is claimed.

## Native desktop review interaction (UTF-8)

`gewu-application-real-20260924-ddl3k703` completed the student flow with
actual Electron review clicks, not a direct approval HTTP call in the runner.
It launched the existing Electron main module with an isolated temporary
userData directory, reused the unchanged preload IPC, authority runtime and
actual AuthorityRoleApplicationsPanel, and fetched live desktop session
context. Only the renderer entry and in-memory test-session setup were supplied
by the harness. The embedded local cache backend was disabled for this focused
test; no native-module rebuild or desktop installation was performed.

Clicking Confirm Approval opened the real confirmation modal. Cancel kept the
exact application pending (verified by production readback). A second click
and confirmation removed it from the pending list, and the miniapp then read
approved and entered student home with the original ticket. Source SHA256 for
the actual main/preload/runtime/component/session modules is in the nested
desktop-review/report.json. The process exited zero, fixtures were removed,
temporary device sessions revoked and the original simulator state restored.

The first native attempt `xv86ccjm` hit a harness navigation race with the
main startup loadFile. The second `snw4wd6o` incorrectly expected activeRole
inside a v1 ticket. Both failed before review and cleaned up completely. The
successful runner creates a separate isolated review window and reads the
live session-context endpoint; it does not relax the product's authorization.

Three native screenshots were inspected. The interaction is verified, but
the first modal/list screenshots caught animation transitions and are not
claimed as settled visual acceptance. Existing review wording still exposes
cloud terminology and the internal application ID as a large primary column;
these remain user-facing audit findings, not a completed design review.

Family-member native run `gewu-application-real-20260924-zyza7ml7` also passed
the full submission -> actual Electron review -> same-ticket formal entry
chain. It additionally opened and cancelled the reject dialog before approving;
the row remained pending, as did the explicit production read after approval
cancel. Final confirmation removed only this marked application from pending.
The three native screenshots disable animations and wait for modal closure;
these and all four miniapp screenshots were individually inspected. All five
fixture entity counts and four active-device counts are zero, auth/cache
restored and cleanupFailures empty. Source-pinned nested and outer receipts
are retained together. The UTF-8 form and button labels render correctly,
while the wording/internal-ID audit findings above remain unresolved.

Current verification reruns: AuthorityRoleApplicationsPanel.test,
applicationPageRuntime.test, desktopAuthorityRuntime.test and
miniappUiCoverage.test all passed. This continuation changes only evidence
documents, so no desktop/miniapp/cloud/NAS version or release was repeated.
Full desktop navigation, reject-submit/retry, cold login and physical-device
picker/keyboard/consent checks remain open. This is not whole-page-matrix or
whole-project acceptance.

## Follow-up: rejection retry and desktop review copy (UTF-8)

The formerly open rejection/edit/resubmit chain and reviewer wording/internal-ID
findings are now verified in `desktop-role-review-2026-09-24.md`. The complete
device-page production-read test additionally found and fixed unbounded device
history pushing review off-screen. Full-shell navigation and cold/physical-device
checks remain open. Desktop 8.9.9 publication requires its separate build/OSS
receipts; the application-flow tests alone do not prove publication.
