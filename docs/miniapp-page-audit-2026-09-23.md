# Miniapp page-detail audit — Sep 23, 2026

Scope: existing UI, wording, fit, interactions and role boundaries. No redesign
of original desktop business behavior. Source coverage is not visual acceptance.
Official DevTools agent CLI, confirmed AppID wx3d570539bbe6ba1b, dist project,
URL checks enabled. All listed Sep 23 role runs restored the original session.
Cloud-signed existing test sessions verify UI/cloud authorization; they do not
prove WeChat phone consent/login. No business rows were created or changed.

## Fixed finding: statistics loading, refresh and stale responses (8.8.9)

The real TSX test first failed because initial render showed zero income before
the cloud response. The correction keeps the existing completed-lesson filter,
tuition calculation, type/month groups, sort order and normal card layout.
Page entry/return and native pull-down now refresh once; request sequence and
account-session guards discard late responses after hide, unmount, superseding
requests or account/access changes. Failed requests distinguish saved data from
no available cache; retrying a genuinely empty cloud projection still shows zero.
The React review keeps these requests in lifecycle/action handlers rather than
duplicating an initial effect request.

Passed: statsRefresh.test.js (initial loading, return, native refresh, boolean
failure and thrown error, no-cache retry, verified empty data, racing requests,
identity changes and denied access); financial pre-read access; test:miniapp-ui;
test:miniapp-cloud-read including PostgreSQL/export checks; miniapp typecheck;
weapp build; independent version tests; git diff --check. A first build reported
shared-style ordering warnings; matching the existing shared/Forbidden import
order removed those warnings in the next successful build.

Real DevTools teacher session, AppID wx3d570539bbe6ba1b, URL checks unchanged:
`gewu-stats-refresh-20260923-pug48qqb/report.json`, ok=true. Actual cloud reads
were used before/after deliberate wx.request 503 failure injection. Native
startPullDownRefresh triggered the page handler; retry was tapped; navigating
away and back to the same stats page triggered a new request. This is request
failure testing, not physical device offline testing. No business mutations.
Request mocks, test-cache values and the original login were restored.

All five screenshots were individually inspected: cached-data banner and retry
fit without overlap/clipping; successful state retains the original card layout.
Local screenshot hashes (same evidence directory):

- 01-cloud-statistics.png: b997a1cd908bfee81869de593051b6130b664f11a54fa7f87adaf942290188fc
- 02-failed-refresh-with-cache.png: 0821ba5ae07c80f9e5c9cb4d177c5ff6032351247e3e1ad858ca9b747c491e3c
- 03-failed-refresh-no-cache.png: 6499c77363846a157c1b42e03814e008c6eb15876194fd72e83d3ebc1fb8fa1e
- 04-real-cloud-retry-recovered.png: ffbfb8cb56167221fa09b644304c9e4cd9fe11f6c553e8fe15ce41fa899697a3
- 05-return-refresh-failure.png: b07c0f9957a798b8d1e1a7518a85bfd424423665a3d164130e200f842e09e9f9

Miniapp-only patch 8.8.8 -> 8.8.9. No desktop/cloud/NAS/API/schema changes.
Source cdbead73cd5ba0e1eb1239b978b6fe924d5b1c55 was pushed to gewu/master.
Guarded fixed-egress CI upload rebuilt the package and passed compatibility and
public health checks before/after upload; receipt finalized at
2026-09-23T08:18:34.663Z, exit 0. Evidence:
`gewu-miniapp-889-upload-20260923-axrr2a8g/active.json`, miniapp verified,
releaseLevel development, version 8.8.9. Other unchanged targets remain pending
in this new manifest; no full-matrix/formal-release claim. Remaining:
physical offline/cold-auth behavior, rendered loading capture, exact touch-target
measurements and other rows in the page inventory. No all-page completion claim.

## Fixed finding: payment filters silently stopped after 20 students

Removed only `students.slice(0, 20)` from the existing horizontal filter.
Do not widen the cloud projection, change payment calculations or add write UI.
React review retained render-derived filters/totals rather than duplicate state.

- Actual TSX render test failed first: 21 controls vs expected 36 (35 students
  plus All). After the correction, all names appear in source order, Student 35
  selects only its two payments, total is 500, a no-payment student gives the
  empty state, and All restores three payments / total 600. Frozen arrays remain
  unchanged. Denied roles render no payment cards or student filter controls.
- Sorting/render tests are now included in the standard `test:miniapp-ui` gate.
- Passed: payment tests, financial pre-read access tests, `test:miniapp-ui`,
  `test:miniapp-cloud-read` (including real PostgreSQL and export regressions),
  miniapp typecheck, weapp build, version classification and independent-version
  tests, and `git diff --check`.
- Miniapp patch 8.8.7 -> 8.8.8; desktop 8.9.8, cloud 8.11.20, storage 8.8.3 unchanged.
  No protocol or schema change. Development upload is verified below; not fully released.

## Development upload receipt

Source `33425296a12bfe88cdd63f586bc48cc37e847462` pushed to gewu/master.
Existing fixed-egress CI lifecycle rebuilt and release-checked the package,
checked compatibility/public health before and after upload, then finalized
the development receipt at `2026-09-23T07:38:16.531Z`. Exit 0.
Receipt: `gewu-miniapp-888-upload-20260923-3i04_emd/active.json`,
miniapp status verified / version 8.8.8 / releaseLevel development. The receipt
and upload lock were kept outside protected output directories. Unchanged
component receipts were not fabricated or copied into the new manifest.
This is development upload only, not formal release or full UI acceptance.

## Fresh evidence (local temporary-directory basenames)

Screenshots retain real scoped business names locally; do not publish them.

| Receipt directory | Role / screen | Observation and actual action |
| --- | --- | --- |
| gewu-miniapp-page-step-20260923-9edbfq2o | Teacher / settings, 8.8.7 | Version/status/actions fit; no overlap. Refresh and logout not exercised. |
| gewu-miniapp-page-step-20260923-0x0z4n3i | Super admin / payments, 8.8.7 | Empty payment state; source inspection identified 20-student cutoff. |
| gewu-miniapp-page-step-20260923-bh0w956d | Student / payments, 8.8.7 | Denied content; no student list or financial summary. |
| gewu-miniapp-page-step-20260923-9mc3vwin | Super admin / payments, 8.8.8 | 65 cloud-authorized students, 66 controls. Scroll to last, tap, selected state visible; scroll back and tap All. Empty-payment state, no clipping/overlap. |
| gewu-miniapp-page-step-20260923-d5mm38et | Student / payments, 8.8.8 | No financial data/filter rendered; Return Home tapped and home route verified. Explanation/button fit. |
| gewu-miniapp-page-step-20260923-7yf_j04y | Teacher / payments, 8.8.8 | Only one authorized test student / two controls. Select student and restore All passed; long test name remains horizontally scrollable. |
| gewu-miniapp-page-step-20260923-m5rznxcj | Visitor / payments, 8.8.8 | No financial data/filter; application guidance and Return Home fit, Return Home tap succeeds. |
| gewu-miniapp-page-step-20260923-s7pd565r | Family member / payments, 8.8.8 | No financial data/filter; denial text/button fit, Return Home tap succeeds. |

The corrected-version screenshots were individually viewed. Hashes:

- Admin initial: `c2cb0c2bc617aa6875cefe102f367fb8b9233e597e40a863a1ef89cd81100126`.
- Admin last selected: `dd741a1fe9558ee276cbbb3c05d780dca61d17becb18fed83ad0bd499e19eb49`.
- Student denied: `3f84367851e1368705c0cdcba162d894f923c8f3581fc7c708f01cce3342e776`.
- Teacher initial: `2a671105d4e8917417cea0045e681b722e74eb2ead66864ef3080ec9e3302f83`.
- Teacher selected: `51f83126cd18e8448f0acaefa1ecfff701c773a3e9f7a328c9930764eee4113c`.
- Visitor denied: `2dfec1462ff5910e6e033c7e603dcdbc07728042f9b5fb67e96a5173497ad616`.
- Family denied: `99c929ebf7d08caec9392f8472ea36982354bad7a047d86243d5cb118b9c05c9`.

## Complete registered-page checklist, not a completion claim

### Statistics follow-up (8.8.8, unchanged production code)

Current screenshots and real taps, not the historical fixture matrix:

1. Empty state: super admin returned zero completed lessons and zero revenue;
   screenshot `gewu-miniapp-page-step-20260923-zyoalquu/super_admin-pages-stats-index.png`
   matches that result. SHA256 `46d6cf82fc35b76ba56d49e3a82ab39cf545df32e00d1a9649b2c2913fbd18ab`.
2. Non-empty teacher state: created one marked temporary room/course and two
   completed lessons (different months, tuition 100 and 200) through real cloud
   REST, linked only to canonical E2E teacher/student IDs. UI shows 300.00,
   two lessons, one course-type group and two months in descending order.
3. Teacher course-type heading: tap collapses exactly one row; tap again
   restores it. Month heading collapses/restores exactly two rows. Revenue
   summary is unchanged. All three screenshots inspected, no overlap/clipping.
4. Super admin: same exact totals and independent collapse/expand operations
   verified; all three screenshots inspected.
5. Student, family and visitor: no revenue card or group rows; denial message
   and Return Home tap verified independently after the interrupted combined
   run. Visitor gets the existing role-application guidance; family/student
   do not receive that invitation. All three screenshots inspected.

Receipt directories:

- `gewu-miniapp-financial-live-20260923-nc6ntd2g/receipt.json`: the combined run
  completed teacher/admin checks, then failed on the student startup bridge
  (`route:null`, account matched). It correctly remains ok=false. This is not
  a passing five-role receipt. The failed step restored its original session.
- Teacher `gewu-miniapp-page-step-20260923-qwabbf52`: expanded screenshot
  SHA256 `606706798bb6b666e3b7dd3c75efcac04a4eafb43d29533af5e99a001ecfc563`;
  type collapsed `4728e69f5d5c5f9d2a12b699e1485217ea8f778a38d950e247ed63197e2ab3ea`;
  month collapsed `d4e47f666e838e7d36cff41b11fd060bbdf7122956e4ebe660459b84409306f7`.
- Admin `gewu-miniapp-page-step-20260923-hsczik4r`: expanded screenshot
  SHA256 `53eb807fd33dea2946b721517fa83393752bd8aa6bd8ace3b05633bfbec88527`;
  type collapsed `79fbf316580fb6ade34fe971b7e62e4a7c01e710e05f48e848b4b820c6252b7c`;
  month collapsed `d399205499e8915570708554c679c7dcb77516ebb6eb2662b47915e0bf03edee`.
- Independent student recovery `gewu-miniapp-page-step-20260923-22r7bsno`:
  SHA256 `d3d10c3ef54cb74a90650ee28ecb375834bffe2ef15139b0f3a500b0b95f007d`;
  denial/recovery passed and original session restored.
- Family `gewu-miniapp-page-step-20260923-woamlhby`:
  SHA256 `e5e09c1df1d4bc4c496e5e48e40d0a74236925ef5741be1b65a25299e738135b`.
- Visitor `gewu-miniapp-page-step-20260923-j6vv23n2`:
  SHA256 `d09ccbd7620ec5e2066fe586ee9ede4b52a234fb674ae92e86da9585280e2be0`.
  Both denial/recovery checks passed and original sessions were restored.

Cleanup is verified despite the interrupted combined audit: exact-ID CAS
deletes removed only the four newly marked test records, original course/room/
schedule ID lists and the original student objects matched, and the temporary
installation/device/session/link active counts are all zero. No existing
business record was overwritten. Earlier harness attempts made no business
records: test-course identity guard rejected one attempt; the next course POST
returned 400 because a real room ID is required. Their cleanup receipts remain
failed, not relabeled successful. The successful seed then used its own room.

Remaining statistics risks, not acceptance claims: the clickable heading uses
the global 42rpx minimum height and looks narrow in these screenshots; inspect
actual touch dimensions before changing it. Source review confirms this page
has no NetworkStatus, pull-to-refresh or loading indicator; offline/failure and
return-to-page freshness still need runtime tests. Numeric groups/collapse
passing is not a claim that the whole statistics page is finished. No code,
component version, deployment, template or NAS change was made for this audit.

All 18 routes from app.config.ts are represented. A/T/S/F/V denote super admin,
teacher, student, family member and visitor; G denotes not signed in. "Pending"
means this audit has not reverified all applicable roles/states/actions, even if
earlier fixtures or individual flows pass. Use the existing inventory for exact
state/route contracts, not as evidence that every screenshot has been inspected.

| Route under pages/ | Roles / boundary | Inspection focus | Sep 23 evidence and remaining gap |
| --- | --- | --- | --- |
| login/index | G | Compact normal login; privacy, denied/failed/retry, phone consent | Pending real consent/error flow |
| login/privacy | G | Readable text, full scroll, return | Pending |
| index/index | A/T/S/F/V | Only real authorized entries; navigation and empty state | Student return-home action verified; full role audit pending |
| forbidden/index | A/T/S/F/V | Reason/application guidance appropriate to role; recovery | Shared denial content checked on payments; dedicated route pending |
| schedule/index | A/T/S/F/V | Original course label/time/address; week/day, empty/offline | Earlier ledger flow exists; this audit pending |
| schedule/detail/index | A/T/S/F | Original details, attendance/fees, missing ID | Earlier ledger flow exists; full states pending |
| schedule/edit/index | A/T/S/F | Core-edit boundary, recovery; no unauthorized save | Pending |
| students/index | A/T | Complete list/search, details, long labels | Pending |
| student-detail/index | A/T/S/F | Scoped balances/history, tabs, missing ID | Earlier ledger flow exists; full states pending |
| courses/index | A/T/S/F | Original course semantics, details and empty state | Earlier ledger flow exists; full states pending |
| teachers/index | A/T | Scope, contact display and long text | Pending |
| payments/index | A/T; deny S/F/V | All authorized filters, counts/totals, empty/loading/offline | A/T filter interaction and S/F/V denial/recovery passed; non-empty/offline runtime checks remain |
| stats/index | A/T; deny S/F/V | Real totals, groups, expansion/collapse, empty state | A/T totals/collapse, A empty, S/F/V denial passed; 8.8.9 T request-failure/cache/retry/native pull/return passed; loading and stale-session unit tests passed; physical offline/loading capture/touch measurements pending |
| question-bank/index | A/T/S/F/V | Desktop-derived filters/options/media, answers toggle, floating basket | Strict media-download gate unresolved; full audit pending |
| question-paper/index | A/T | Edit/reorder, Word/PDF buttons, permission/error recovery | Handler/export regressions pass, strict WeChat download acceptance pending |
| assets/index | A/T | Personal import only, CSV/error/empty state, scope | Pending |
| settings/index | A/T/S/F/V | Actual account/status/actions, role application and logout | T screenshot inspected; remaining roles/actions pending |
| account-application/index | V | Names/phone instead of internal IDs; role choices and errors | Pending |

Earlier 18-image ledger journey: docs/miniapp-student-ledger-2026-09-20.md.
Completed production paper correction: docs/verification-2026-09-20-paper-indent.md.
Do not repeat completed imports/exports to substitute for remaining page tests.
