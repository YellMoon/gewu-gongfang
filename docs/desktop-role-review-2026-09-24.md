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

## Desktop publication verified (UTF-8)

Source `b8325f4a2db5efdd2a796fce2b76e8304df80b89` was archived into independent
build directory `D:/gewu-desktop-899-20260924-jzi00yvw`. Dependencies were copied,
not linked, so Electron ABI rebuilds could not alter the working directory.
All six protected tracked dirty files remained byte-identical. All protected
untracked output work was excluded from the archive and untouched.

`dist:win` exited 0, including optimized production renderer compilation,
Electron root/backend ABI verification and installer generation. Node ABI was
restored and verified in both the build and original workspace; post-build
identity tests passed. A fresh isolated packaged process reached the normal
password/WeChat-scan login screen; no blocking console/page errors or obsolete
generic identity failure. `packaged-login.png` was visually inspected. No user
installation/profile was changed. This is startup, not authenticated navigation.

`publish-receipt.json` reports upload exit 0 and complete public-download byte
verification. Installer `GewuGongfang-Desktop-8.9.9-x64.exe`: 150,306,948 bytes,
SHA-256 `ae56f249fd47431635f887e31fd2c6cf8c3ae12585f8e3a348f277a18410640a`.
Both public latest and archived 8.9.9 feeds match the local SHA-512 and filename.
The previous 8.9.8 feed is saved as `previous-public-latest.yml` for rollback;
previous release artifacts were retained.

Matrix `active.json` contains desktop 8.9.9, cloud 8.11.22, storage proxy 8.8.3
and miniapp 8.8.25 development. The unchanged cloud and miniapp receipts retain
their original verification times, not fabricated redeployments. Fresh public
cloud health and a cloud-recorded NAS heartbeat confirmed retained versions,
3/3/1 storage contracts and the approved parser digest. No NAS update occurred.
Miniapp production review and whole-project acceptance remain incomplete; this
is a verified desktop update within a partial multi-end release.

## Full packaged navigation and cold session recovery (UTF-8)

Two settled runs used the published 8.9.9 unpacked executable from the exact
build above, with its unchanged production renderer, main, preload and login
gate. Each used a fresh isolated user-data directory. Playwright controlled the
actual menu and buttons; no renderer entry replacement or API mocking was used.

| Role | Receipt directory | Result |
| --- | --- | --- |
| Super administrator | `gewu-packaged-navigation-20260924-xs0x9oxt` | Passed |
| Existing marked E2E teacher | `gewu-packaged-navigation-20260924-ak8fzgbn` | Passed |

Both `receipt.json` files report client exit 0 and `ok: true`. `report.json`
records actual online registration, native encrypted credential storage, stock
gate recovery, full application entry, menu navigation to IdentityDeviceCenter,
live device refresh and cold recovery in a second packaged process using the
same new device. Initial and cold-process business projection reads returned
200. No renderer page errors were captured. The first and final test processes
closed. This does not claim that the installer was run on another computer.

The administrator sees five device rows, pagination and the loaded review empty
state. The ordinary teacher has neither administrator switching nor review UI;
the teacher sees the device page and real refresh. Both settled device-page
screenshots and the teacher cold-restart screenshot were inspected. Capturing
waits for the unpinned hover navigation to close and for review loading to end,
not merely for a heading to appear. The original overlay navigation is unchanged.

These are controlled verified-account fixtures followed by the real production
registration/session challenge contracts. They do not test password entry,
WeChat scan/phone consent or physical-device authorization. No formal account was
given a new role. Read-only checks before and after the teacher run confirm the
existing business teacher grant and canonical role grants were unchanged.

Exact cleanup revoked only each newly generated device/installation pair. Both
receipts confirm active sessions, account-device links, installations and devices
are all zero for that pair. Existing devices were not revoked; audit/history rows
remain. Credentials were kept out of reports and screenshots.

New visual findings remain open: the session profile still renders the literal
`Cloud account` from `desktopRegistrationService.js`, and device rows show the
unnamed fallback. Passing navigation/session tests does not close those findings.
Ordinary-teacher navigation is now covered; password/phone-consent authentication,
physical offline/picker/keyboard checks and the remaining multi-page audit are not.
This continuation changes evidence only: no new desktop package, cloud deployment,
miniapp upload or NAS image update is warranted.
