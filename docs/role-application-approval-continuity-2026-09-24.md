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

Development upload for 8.8.25 remains pending. Student/family production
application/review UI, desktop reviewer UI, cold login and physical-device
picker/keyboard/consent checks remain open. This is not whole-page-matrix or
whole-project acceptance.
