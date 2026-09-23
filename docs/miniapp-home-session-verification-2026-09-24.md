# Home session and retry verification — 2026-09-24

Scope: existing home page only. Preserve role/module policy, dashboard
calculations, desktop business windows, cloud contracts and stored business data.
Miniapp patch 8.8.21 -> 8.8.22; desktop/cloud/NAS versions unchanged.

## Reproduced defects and correction

- A pending logout modal could clear a replacement account. Capture the actual
  session runtime snapshot and require an unchanged session before cleanup.
- Hide/unmount now invalidate pending home loads. A modal from a previous page
  visit is rejected even after returning to the same account: the additional
  hide/show actual-component test failed with three storage removals, then passed
  after checking the captured home-load generation.
- Cloud permission/projection completions are bound to both the current page
  generation and account session. Old completions cannot update the page or
  read another account's derived business cache.
- A legitimate same-account permission-scope change starts one fresh load, not
  the old scope's projection. Repeated changes stop after that retry without
  spinning indefinitely or exposing business data. The loading-screen assertion
  failed before the bounded terminal branch was added, and now passes.
- The existing network Retry action now rechecks permissions and pulls the
  cloud projection; previously it only recounted local cache. Hidden-page Retry
  is inert. No background/offline business submission was added.
- Logout target has a 44px minimum width and height, preserving its existing
  location and appearance. Previous real five-role measurement was 38x28px.
- Pending/unstable authorization no longer renders teaching/financial metric
  cards. A new failing component assertion exposed that branch; cards now
  require confirmed scheduling access. Existing authorized totals and formulas
  are unchanged. Older concurrent requests cannot replace a newer refresh.

## Current local verification

Passed actual TSX home handlers across teacher, super-admin, student, family and
visitor; navigation, financial privacy, cancel/confirm logout, unchanged-invalid
session logout, identity/hide/unmount races, hide/show stale modal, bounded
permission refresh and cloud Retry. The home test remains in test:miniapp-ui.

Passed full `npm run test:miniapp-ui`, miniapp typecheck, API-session and
authorization-session/runtime tests, automatic/independent version tests and
`git diff --check`. Initial weapp 8.8.22 build passed in 15.42 seconds; the
final authorization-metric guard build passed in 15.31 seconds.

Independent read-only regression check of the broader architecture also passed:
desktopCloudBusinessDraft, desktopAuthorityClient, desktopAuthorityRuntime,
desktopAuthorityRuntimeRetirement, browserDatabaseSyncCapture,
browserDatabaseSafety, AuthorityOutboxPanel.confirmation and cloudQuestion.
This is current local regression evidence, not new desktop/cloud deployment or
full production-migration acceptance. Existing Ant Design deprecation warnings
do not change those test exit codes.

## Runtime and release gates

The first five-role real-cloud DevTools attempt found
no runtime for the dist project before any test session was injected; the
official open_project_window call opened that project, then a new run started.
Do not count that setup failure as a successful runtime check.

`gewu-home-runtime-20260924-7lxsy0jl` passed all five roles' 25 navigation
actions and home returns. All ten top/bottom screenshots were inspected and
logout targets passed the >=44px assertion. S/F/V financial privacy passed.
However, the process exited 1: the restore write and refresh completed, then
the auth readback timed out. Its `ok:true` describes page checks only; absent
restoration fields prevent treating it as a complete successful receipt. An
independent readback subsequently confirmed signed-out state and absent identity,
but cannot retroactively prove exact equality with the original in-memory cache.
No production teaching records were written. The final test runner requires both
restoration booleans for overall success and retries only transient readback,
not writes. Final-build role/metric/touch verification remains in progress.

Final-build `gewu-home-runtime-20260924-2o70sto2` also passed five roles'
metrics, privacy, touch dimensions and return, with ten inspected screenshots.
Its process exited 1 after restoration because the refreshed DevTools context
reported `wx is not defined`; overall ok=false, checksPassed=true. It is not a
complete receipt. The next runner now rereads and compares every restored auth
and scoped-cache value synchronously before refresh (not merely trusting the
write), and records baseline digests plus exact source hashes. This avoids
conflating runtime-context readiness with storage restoration and retains the
same exact-equality requirement.

No development upload or complete home/all-page acceptance is claimed here yet.
Native phone consent, physical offline/touch, strict media download, and the
other open states in the 18-route audit remain separate gates. Sessions used
for automated checks are existing cloud-signed test-account sessions, not a
claim that WeChat phone-login consent was tested.
