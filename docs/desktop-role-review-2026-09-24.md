# Desktop role review and device page verification (UTF-8)

## Scope and source

Desktop patch candidate 8.9.9. Cloud 8.11.22, miniapp 8.8.25 development and
storage proxy 8.8.3 are unchanged. No teaching workflow, database schema,
authority contract or NAS image change. Unrelated dirty files and protected
output directories are excluded. Publication remains pending until installer,
packaged startup and OSS byte verification receipts exist.

The review title is now `申请审核`, without a duplicate outer card or visible
internal application IDs. Confirmation identifies the applicant and role.
Unknown transport errors no longer display raw error messages. Login-device
copy no longer describes manual device approval or internal cloud architecture.
Literal JSX Unicode escapes in the current-device and action labels are fixed.
React-derived confirmation copy does not introduce duplicate state/effects.

## Actual cross-end rejection and retry

`gewu-application-real-20260924-haycat1y/report.json` records success against
production cloud 8.11.22: student application submitted in DevTools, actual
isolated Electron main/preload/runtime/panel rejection, editable rejected form,
corrected name, new application ID, actual native approval, same-ticket approved
state and student home entry. Cancel leaves the application pending. Rejection
does not grant a formal role. This is fixture-session coverage, not WeChat phone
consent or a full desktop-navigation test.

Exact fixture cleanup: accounts/applications/grants/profiles/contacts all zero;
active temporary sessions/links/installations/devices all zero; simulator login
and cache restored; cleanupFailures empty. The rejected/editable and approval
confirmation screenshots were inspected. The rejection confirmation capture
contains an in-flight animation and is not settled visual acceptance evidence.

## Complete device-page runtime

Read-only run `gewu-device-page-20260924-KmPajY` used actual Electron main/preload,
the whole IdentityDeviceCenter page and production device API (HTTP 200), not
mocked responses. It found 198 unpaginated history rows pushing review off-screen.
The pagination regression first failed, then passed after limiting each page to
five records without deleting/hiding history.

Final run `gewu-device-page-20260924-Jkgq5u` verifies five rendered device rows,
next-page and previous-page navigation, the review heading inside the 900px-high
test window, current-device presentation, unique headings and successful live
refresh. `01-device-page.png` was inspected. Session receipt
`gewu-device-page-session-20260924-ei1ky_16/receipt.json` confirms all four active
fixture device/session counts zero. No user device was revoked. This verifies
the full page in an isolated renderer entry, not the full application shell.

## Current checks and remaining work

Passed: npm run typecheck; npm run test:identity-device-center;
AuthorityRoleApplicationsPanel.test; desktopAuthorityRuntime.test;
update-version.test; independent-release-version.test; release-matrix.test;
publish-oss-feed.test. All changes remain a desktop-only patch.

Still open: full desktop navigation, cold authentication, physical-device
picker/keyboard/phone-consent checks, remaining role/page audit states and
whole-project independent acceptance. Do not infer full multi-end completion.
