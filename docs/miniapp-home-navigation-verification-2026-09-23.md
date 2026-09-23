# Miniapp home navigation 8.8.21

## Scope and reproduced defect

The existing home cards for formal roles passed tab routes to Taro.navigateTo.
The student/family shortcut cards did the same. Those routes are registered in
the actual app.config.ts tab bar and must use switchTab. Visitor cards already
used the correct operation. No routes, permissions, business data or desktop
windows need to change.

The real DevTools audit `gewu-home-runtime-20260923-qqc119lm` observed teacher
schedule/question cards remaining on home. The actual-component regression
`homeNavigationRuntime.test.js` reproduced the same boundary failure before
the fix: `teacher: /pages/schedule/index must use switchTab`.

Only these existing handlers were corrected: module cards switchTab for
scheduling/question bank; other modules retain navigateTo. Student/family
shortcuts switchTab; staff detail-page shortcuts retain navigateTo. Existing
visuals and role/module checks remain unchanged.

## Verification

- Actual TSX handlers execute for teacher, super admin, student, family member
  and visitor. The test derives tab routes from app.config.ts and rejects the
  wrong platform navigation method. It checks every card/shortcut target,
  excludes staff financial content for S/F/V and verifies visitor home does not
  request teaching projections.
- Added the test to the existing home UI suite entry. Full miniapp UI tests,
  typecheck and independent/automatic version tests pass.
- Automatic classification selects miniapp patch 8.8.20 -> 8.8.21. Desktop
  8.9.8, cloud 8.11.21 and NAS 8.8.3 remain unchanged.

The final weapp build passed (22.27s). Final real-cloud DevTools runtime
`gewu-home-runtime-20260923-v3s1jmiu` completed with ok=true, five roles,
businessWrites=false, authRestored=true and storageRestored=true. All 25 actual
card/shortcut transitions passed: seven each for teacher/admin, four each for
student/family, three for visitor. Every role returned to home. All ten final
top/bottom screenshots were individually inspected; staff financial/global
metrics were absent from S/F/V. Existing test accounts were reused, with no
new teaching records or production imports/exports.

The baseline runner read routes immediately after taps; its non-tab false
results are not accepted as separate defects. The final runner polls the
expected route with a bounded wait, and all those non-tab routes passed.

Source `073cb00949f0b8a00fdfa2936ca8e94f213927d9` is pushed to gewu/master.
The first 8.8.21 upload attempt (`gewu-miniapp-8821-upload-20260923-7h3jpbvb`)
stopped during the pre-upload build: its OS-lock owner process 25352 is absent,
no matching uploader/build process remains, the manifest is pending with no
receipt, and its log ends before build completion. The same-version retry
`gewu-miniapp-8821-upload-20260923-otveqiao` succeeded and finalized its receipt
after post-upload health checks at `2026-09-23T23:06:09.191Z` (Sep 24 locally).
Its manifest marks miniapp 8.8.21 verified at development level. No cloud,
desktop or NAS deployment was needed or performed for this miniapp-only fix.

This does not claim real phone login, physical touch, file downloads or complete
home/all-page acceptance.

## Next home audit boundary

Code inspection also finds that home's logout callback does not yet have the
captured-session guard used by settings/index.tsx. Its cloud-load generation is
page-local rather than explicitly bound to a session snapshot. Those asynchronous
account-switch cases still need failing actual-component tests and correction;
successful navigation must not be used to mark the whole home page complete.
The real baseline also measured the existing logout control at 38x28px for
all five roles. Its touch size/native confirmation and the account-switch cases
remain follow-up corrections, not navigation acceptance claims.
