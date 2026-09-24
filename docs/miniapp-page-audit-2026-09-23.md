# Miniapp page-detail audit — Sep 23, 2026

Scope: existing UI, wording, fit, interactions and role boundaries. No redesign
of original desktop business behavior. Source coverage is not visual acceptance.
Official DevTools agent CLI, confirmed AppID wx3d570539bbe6ba1b, dist project,
URL checks enabled. Successful role runs restore their original session; the
explicitly failed teaching-page baseline cleanup below is an exception.
Cloud-signed existing test sessions verify UI/cloud authorization; they do not
prove WeChat phone consent/login. Baseline checks were read-only; later reversible
test writes and their cleanup are explicitly recorded in their sections.

## Question filter miss and restricted-role recovery (8.8.18, UTF-8)

Real teacher baseline `gewu-question-runtime-20260923-9st7onfu` reads 40 of
108 questions from the production API. Answer expansion/collapse, local basket
add/remove/drawer, secondary-filter sheet and native pull work. Searching an
unmatched string wrongly displayed "题库中暂无题目"; its screenshot was inspected.
The earlier `g2dza7xy` harness failed because its helper rejected compound CSS
selectors; it is not relabeled as a page failure or a successful full run.
Both baseline runs restored original auth and scoped storage.

Actual TSX regression first failed on the wrong empty message, then passed
all five roles, source/text filtering, clear action, true empty library and
loading/offline/denied states. The fix derives empty-filter state from existing
state (no new effect/state or API) and adds a local Clear Filters recovery.
Full UI tests, question display/basket/cloud-delivery regressions, typecheck,
weapp build and independent-version checks pass. Full miniapp-cloud-read suite,
including isolated PostgreSQL and paper-export regression, also passes.
Miniapp alone is 8.8.18. Source `2756ca32` is pushed to gewu/master;
guarded development upload verified `2026-09-23T13:49:10.958Z`, pre/post health
gates passed. Manifest/receipt: `gewu-miniapp-8818-upload-20260923-hdjmniym`.
Desktop 8.9.8, cloud 8.11.21 and NAS 8.8.3 unchanged. Not a full-release claim.

Final-build combined run `sjoz2yo5` passed teacher/admin real reads, default
collapsed answers, toggles, local basket add/remove/drawer, corrected unmatched
search recovery and native pull. Its student branch then failed in the harness:
an unquoted no-space arrow expression crossed cmd.exe's redirection boundary.
It remains an overall failed receipt (two completed cases), original auth/storage
restored. The expression helper now forces a quoted argument; remaining S/F/V
run separately. This failure does not justify repeating the completed A/T cases.
The next `ugbrc264` student run captured a real native permission modal but the
assertion failed because identity setup had refreshed away the earlier mock.
Moving mock installation after identity setup resolved the harness issue; the
failed receipt/screenshot remain preserved and original auth/storage restored.

`ojhr4o9l` passed S/F/V: formal roles read 40 rows, visitor reads 20; answers
default collapsed and toggle, restricted basket action writes no selection,
unmatched search shows the corrected message and Clear Filters restores the
list; native pull passes. Nine screenshots individually inspected, plus all nine
completed teacher/admin case screenshots from `sjoz2yo5`. Auth/storage restored;
no cloud business writes or mocked projection/question responses. The native
modal is controlled only to capture parameters/cancel; phone consent is not tested.
S/F/V report SHA256:
`b9e1e5eabfa2ed42ef5eb8743faeaebd571b080bc3330d5699fdd39912dcbc00`.

This audit also found the old student/family "去申请" action leads to the
visitor-only application page, which relaunches Login for formal roles. A second
actual-component red/green test now preserves visitor application but gives
formal roles a non-navigating "知道了" explanation requiring a teacher account.
No role grant or application eligibility changed. Final UI/typecheck/build pass.
Prompt-only final-build follow-up `gk5sfrhe` passed S/F/V: formal accounts receive
"知道了" with no cancel/route change; visitor retains "去申请". Real page button
handlers used, only native modal response controlled/cancelled; no basket writes.
Original auth/scoped storage restored. No new phone-consent or native-modal
visual acceptance claimed. UTF-8 evidence remains separate from media delivery.

Strict download-domain failure is NOT bypassed. Real screenshots show missing
question media; neither media quality nor full question-bank visual acceptance
is claimed. No new import/export/cloud business mutation was performed.

## Student detail and boundary recovery (8.8.17, UTF-8)

The detail page previously loaded only on mount, lacked its own pre-read page
permission gate, discarded usable cache on failed refresh and did not guard
already-rendered data against account changes. It now uses verified page access
and session/request sequencing. Show/native pull refreshes read-only projection;
hide/unmount invalidates late responses; only the same still-authorized account
can read scoped cache. Cached failures carry a notice; uncached failures offer
retry, not false empty records. Missing/no-ID records offer Return Home.
Student fields, staff-only notes/source, balances, payment units and grades remain.
No cloud write, schema, role grant, desktop business window or NAS change.

The retired schedule edit route remains read-only; Return falls back to Home
when directly opened without a previous page. Actual TSX tests first failed on
visitor pre-read denial and rejected root navigation, then passed roles/tabs/
record filtering/cache/retry/native pull/return/missing ID and stale identity,
hide/unmount/permission/request-order races. Tests use actual studentDisplay.ts,
including hours vs currency. The older static refresh assertion now checks the
cache-aware branch backed by behavioral tests. Both new tests are in UI pretest.

Official DevTools real-cloud run `gewu-detail-runtime-20260923-w492u3y1`
passed 18 cases across A/T/S/F/V, exit 0. Four formal roles read the existing
marked test student's real zero balances and empty payment/grade tabs, native
pull, missing/no-ID recovery, normal and root edit-boundary Return. T/S/F cannot
read an unrelated student ID from the admin result. Visitor detail displays
denial/application guidance. All five roles passed the dedicated forbidden route
and Return Home. Teacher exercised controlled HTTP 503 with/without cache and
retried against the real cloud successfully. No business writes. All 19 PNGs
individually inspected; original signed-out auth/cache restored and equal.
Report SHA256: `52b7b3813a2e20d3dd5b6ae08b07aa60d004b63817ea59428a7e26e7114a1693`.

Failed runs retained: `6g29x7st` and `oilsmo3x` reached real details but timed out
waiting for the new missing-record selector. The latter screenshot showed the
old page without Return Home while current dist contained it. Official
cleanCompileCache (not storage/auth cleanup) followed by refresh resolved the
stale compiled page. `lfbfh9ya` checked root-return too early; its failure
screenshot and route already show Home. Harness now waits for the Home selector
before checking the final route. All three restored auth/cache.

Full UI/typecheck/weapp build, display/desktop-grade parity, page access,
API/auth session and independent-version tests pass. Visual review found small
detail tabs/recovery targets; page-local minimum heights now 88rpx with
regressions. Final touch-size run `gewu-detail-runtime-20260923-48n62ih9`
passed for teacher/student on the final build: recovery action 98 x 45px,
each tab 117 x 45px. All four final screenshots individually inspected; all
three tabs remain operable, missing-record recovery works, auth/cache restored,
no business writes. Report SHA256:
`eccd0c21411a916274fb769da8e65e0962999502d719c7c185c59a8971b7e7e4`.
Full UI tests rerun after the final touch patch and passed. Source `77cdee1f`
is pushed to gewu/master. Guarded miniapp 8.8.17 development upload is verified
at `2026-09-23T13:15:32.490Z`; manifest/receipt:
`gewu-miniapp-8817-upload-20260923-6qen3__m`. Pre/post health gates pass.
Desktop 8.9.8, cloud 8.11.21 and NAS 8.8.3 unchanged. This is UTF-8 evidence,
not a full-release claim.
After the official compile-cache refresh and final touch checks, the strict
download-domain probe still exits 1 with
`REAL_MINIAPP_DOWNLOAD_DOMAIN_NOT_ALLOWED:downloadFile:https://physicsedu.xyz`.
URL checking remains enabled. No new export/download acceptance is claimed.
Physical offline, phone consent/cold authentication and full app audit remain
open. No new non-empty ledger fixtures were created; earlier real ledger receipt
and current actual-component tests remain separate evidence.

## Real personal asset import and populated layout (8.8.16, UTF-8)

DevTools + public cloud 8.11.21 run `gewu-assets-real-20260923-54svwujq`
passed nine cases, exit 0. The actual page reads a temporary CSV, parses it,
derives its content-based retry key and submits the real API request; API/DB/
projection responses are NOT mocked. Only native message-file selection, modal
confirmation and toast capture are controlled; native phone/file consent is not
claimed. Existing marked teacher account only; no account/role/DDL changes.

- Cancel: no import row. Confirm: 24 actual records / two categories; verified
  owner, exact numeric 2.55 / 18.35 amounts and cloud projection readback.
- Repeat same file: same import and unchanged whole-table snapshot, replay toast.
- Changed same-key payload with an extra row: current HTTP contract returns 400
  CLOUD_BUSINESS_INPUT_INVALID, and all three asset tables remain unchanged.
- Student/family/visitor imports return 403; body-supplied owner returns 400.
  Admin/student/family projections contain none of the teacher test records;
  visitor projection is denied (403), rather than leaking financial data.
- Actual month/year/all taps match income/expense totals 25.50/183.50,
  28.05/201.85 and 30.60/220.20. Native pull performs no new import.
- Exact cleanup removes 24 created records, their import and two newly created
  categories. Original three asset-table snapshots match byte-for-byte:
  `1adc642d99d8bcdcaeb75087a2f248c4572c2de6dbd813b02943f373c5fccb90`.
  Original signed-out auth and business cache are restored and compared equal.

Five PNGs in that receipt directory individually inspected: month, year, all,
records-bottom and native-pull. Populated baseline exposed cramped category names
and joined date/amount text. Fix reuses existing detail styles, shows category,
cloud note and secondary date, right-aligns signed amounts, lets category names
use available width, and uses native page scrolling instead of a fixed nested
viewport plus phantom tab-bar padding. Recent-20 policy, statistics, roles and
confirmation/write flow remain unchanged. Baseline screenshot:
`gewu-assets-real-20260923-u7dh0x3e/teacher-month-populated.png` (inspected).

Actual TSX test first failed on absent record category, then passed category/note,
date/amount separation, native scrolling and existing race/permission/import
coverage. Full miniapp UI suite, typecheck, final-version weapp build and
version/independent-component tests pass. Only miniapp patch 8.8.15 -> 8.8.16;
cloud/desktop/NAS unchanged. Source `147997a3813f31e19b850aca9ec7121cca02edfc`
is pushed to gewu/master. Guarded fixed-egress development upload succeeded
2026-09-23T12:26:40.115Z; receipt
`gewu-miniapp-8816-upload-20260923-tud34x8l/receipt.json` and `active.json`.
Pre/post runtime compatibility health checks and finalized platform receipt
passed, process exit 0. This is a development upload, not formal release or
completion of the multi-end/page-audit goal.
Successful real receipt SHA256:
`ea51a00de96ebf4c74d6fb27c79414c29429e73e42543b49fb62067fcd53e2e1`.

Keep failed harness runs visible: `6062prw8` failed before any import because it
expected visitor projection 200; its cleanup verifier deadlocked on a held
single-connection pool (fixed to snapshot via that connection). `u7dh0x3e`
performed and cleaned 24 rows, but expected conflict 409 instead of the existing
400 contract; it remains failed, not relabeled. Both restored auth/cache.
The succeeding run starts from the same empty three-table baseline.
Physical-device consent/offline and full 18-route acceptance remain open.

## Personal assets import integrity (8.8.15 development / cloud 8.11.21, UTF-8)

Cloud and development upload verified below; later real acceptance is recorded above.
Existing teacher import was exposed by the UI but rejected by
the cloud repository. A changed idempotent retry was validated after COMMIT and
could leave extra categories/records despite a conflict response. Isolated PG17
reproduced the partial write; validation now happens inside the real transaction
callback, matching server.js BEGIN/work/COMMIT/ROLLBACK wiring. Teacher imports
remain owned by the verified account; student/family/visitor/retired admin imports
are denied. HTTP route tests use the actual repository and reject body-supplied
account IDs. Decimal tests reproduced valid 2.55/18.35 rejection from binary
floating-point multiplication; both parsers now enforce exact two-decimal values
and the existing 100,000,000 maximum without that false rejection.

Actual TSX tests first reproduced two simultaneous file pickers. The page now
captures its session before file selection, locks concurrent submissions, asks
for explicit confirmation, and hashes normalized records for the existing
account-scoped idempotency header. It never submits on show/reconnect. Cancel is
quiet; raw CSV/transport codes are replaced with actionable messages. Deferred
picker/read/modal/POST responses cannot submit or notify a replaced account,
hidden/unmounted page, or denied role. Picker hide/show retains its original lock.
Read-only projection refresh follows successful import and page return/native
pull; loading, fresh empty data, failed reads and scoped cached data are distinct.
Displayed amounts retain cents. Existing periods/category calculations remain.

Current checks: assetsRuntime, CSV/hash, repository, actual HTTP route and isolated
PG17 rollback/replay/owner tests pass; full miniapp UI/read suites and typecheck/
weapp build pass. Final 8.8.15 typecheck/build and repeated HTTP/PG checks also
pass. The frozen cloud lifecycle release gate passed below. Tests are included in npm UI
pretest and cloud-read posttest hooks. No desktop or NAS runtime change.

DevTools baseline `gewu-assets-baseline-20260923-hp5pcs2l` confirmed a raw
PERSONAL_ASSET_CSV_HEADER_INVALID toast argument (zero requests, original auth/
cache restored); its initial screenshot was inspected. New runtime run
`gewu-assets-runtime-20260923-kj3iszut` passed teacher/admin real cloud reads,
invalid CSV, cancelled confirmation, two same-key failed retries with amount
2.55, replay notice, failed post-import read and native-pull recovery, plus
student denial. Five screenshots inspected. Import/file/modal responses were
controlled; no production financial writes or native phone/file consent claimed.
The combined run remains FAILED because the harness addressed family_member
instead of its existing family fixture key. Original auth/cache were restored.
Follow-up `gewu-assets-runtime-20260923-l6s13bjb` passed family and visitor denial;
both screenshots inspected, original auth/cache restored. Seven inspected images
show no clipping in these empty/failure/denied states. Populated long-list layout,
physical offline and real production import/replay/readback remain unverified.

Source `9b5d87bf77592467c4b088eef903d1e154be8f2d` is pushed to gewu/master.
Frozen committed-source test receipt `gewu-assets-frozen-tests-20260923-0gzhkb1_`
records 183/183 commands, exit 0, including nested npm pre/post hooks and the
new PostgreSQL import test. No unrelated dirty source was included. Direct
deployment-script verification ran 56 tests, exit 0 (the earlier unittest
discovery command found zero tests and is not counted as a passing run).

Cloud release evidence: `gewu-cloud-81121-release-20260923-xb39l0jf/active.json`,
verified 2026-09-23T12:02:30Z, cloud 8.11.21, source above. Database recovery point
`/root/scheduling-backups/postgres/20260923-120115` was restored and ownership/
privileges checked before promotion; dump SHA256
`003ee5dc96859a2711618740910cc9a21d23f9d16b1ab558f3c9a86388489e8d`.
Gateway backup: `/root/scheduling-backups/gateway/20260923-120126`.
Public/private health, authority permissions, retired endpoints and WebSocket
rejection passed; a separate public health read returned ok=true, 8.11.21, cloud.

Guarded fixed-egress development upload used the SAME compatibility manifest.
Receipt `gewu-miniapp-8815-upload-20260923-g613xt28/receipt.json` records success,
miniapp 8.8.15, same source commit, verified 2026-09-23T12:03:51.078Z, with
pre/post health checks and finalized platform upload receipt. Desktop 8.9.8 and
NAS 8.8.3 are unchanged; their pending slots in this new ledger are not failure
claims about the earlier deployed versions. This remains a partial development
release, not a full project or formal miniapp release.

Runtime report hashes: failed combined receipt
`48451045fca878510d97a0e2d7491f9b0e32ff57fbc5cc20b36843abf3bf3069`;
successful family/visitor follow-up
`775e1bf2977ed0b58e71d62290a9a6f1b5e74e333b44a2c887debe194662ea58`.

## Teaching page read-state correction (8.8.14, UTF-8)

Scope: course list, timetable and lesson detail, preserving original course
labels, fee values/calculations, filters, date navigation and core-edit boundary.
Current-run baseline `gewu-teaching-before-20260923-rnkksiwf` captured five images,
all individually inspected: actual teacher course/detail, then three controlled
503 failures after removing only the test identity's selected cache tables.
The course list falsely said no courses; lesson detail falsely said no record;
the timetable presented an empty week instead of request failure. These are
confirmed UI defects, not evidence of empty production data.

That baseline run failed during restoration: a setStorageSync tool observation
timed out and the runner exited with its original snapshot only in memory.
Exact original-login/cache restoration is NOT proven. Follow-up removed only
the marked teacher test session, restored the request API and verified the
simulator is signed out. This does not erase the failed receipt or imply the
original state was restored. No production business records were changed.
The subsequent harness batches its scoped restore into one idempotent call,
keeps snapshots in memory for retries, and explicitly starts from signed out.

Actual-TSX regression first failed because loading lesson detail rendered a
missing-record state. All three pages now distinguish loading, fresh empty,
authorized stale cache and uncached failure/retry. Native pull works in empty
states, page return refreshes, and sequence/session checks reject hidden, unmounted,
replaced-account or denied-role responses before reading/rendering cache.
Historical detail uses the existing cloud lesson-name/type snapshot when the
course no longer appears in selectors; school/grade use existing desktop-parity
display helpers. Timetable date switches filter the already-loaded projection;
page return/native pull remain the refresh entry points. No business write added.

New teachingPagesRuntime tests are included in test:miniapp-ui. UI tests, retained
course-history test, typecheck/build and independent-version tests pass. The first
combined cloud-read run stopped with exit 1 after paper repository output and no
diagnostic; the explicit cloud read-suite rerun completed successfully. This is
not relabeled as a first-run pass. Scoped version classifier selected miniapp-only
patch 8.8.13 -> 8.8.14. Focused role checks and the verified development upload
are documented below; full-route acceptance remains incomplete.

First runtime run `gewu-teaching-live-20260923-u5aewp_x` passed six teacher
cases, including cached/uncached failure and real-cloud retry on all three pages.
It then correctly denied student course-list access, contrary to the harness's
incorrect expectation. Existing policy is preserved: student/family enter their
scoped lesson through the timetable; they cannot open the staff course list.
The actual-TSX harness now consumes the real route policy for this boundary.
The second run `gewu-teaching-live-20260923-2p6em2mb` passed seven student/family/
admin interaction cases but stopped when an unscoped fixture selector chose an
old administrator-visible lesson. Both failed runs restored their original signed-out
session/cache and removed mocks. Neither is labeled a successful full matrix.

Their bottom-scroll screenshots exposed a real layout defect: the last Sunday
lesson was still below the fixed tab bar. A failing-first layout regression now
bounds the page to the viewport and makes only the remaining timetable space
scrollable, retaining existing tab/safe-area padding. No card content/date/business
logic changes. The final harness selects only the marked test student's lesson,
filters staff views to that student, and measures the card/scroll/window bounds
before accepting screenshots. Build/UI/history/typecheck/version tests reran
successfully after this correction. Run `ks6dhlex` passed 16 cases and restored
its signed-out session/cache/mocks, but its last visitor-detail assertion failed:
the visitor timetable module allowed a detail request that the cloud rejected,
so the UI misleadingly offered a network retry. This remains a failed receipt,
SHA256 `9c473a4ab4f26cea4ad9f092ef59499304919cc360c3f65fdc1651599dcb0789`.
All 31 captured images were individually inspected, including the failure image.
Four formal roles had full visible last-card bounds: bottom 622.2–622.6 CSS px,
within scroll bottom 643.6. The visitor still correctly entered role application
from the empty timetable and was denied the staff course list.

A further failing-first actual-TSX regression reproduced the visitor-detail
request. That page now rejects visitor identity before any projection/cache read
and renders the existing role-application guidance. No cloud grant or business
rule changed. UI/history/typecheck/build checks pass again. Targeted final-build
visitor denial/return-home run `i5_h89tw` still observed the old retry UI and
failed, restoring state. The compiled disk chunk contained the new guard.
After official `cleanCompileCache` only (no storage/auth cleanup), the same build's
targeted run `y0q3is2o` passed both visitor cases, with three screenshots individually
inspected: application entry, course-list denial and detail denial; both denial
buttons returned home. Identity shape was a valid, non-invalidated visitor.
Original signed-out session/cache were restored, no mocks or business writes.
Report SHA256 `11c36f70f2a8ca9bc0a4fc9610a702d4a97e08d34e0720cf6820fdff4d9ccaa0`.
The actual-TSX harness now uses the real identity classifier and session runtime,
not simplified role/session stubs; it and the underlying session tests pass.
This supports stale DevTools compile cache as the cause of the post-fix mismatch.
The four formal-role
screens above predate only this visitor-only guard; they are not relabeled as
a second complete five-role run. Day-view interactions, physical offline,
cold consent, long-list bottom reachability and broader touch/accessibility
checks remain, as does the rest of the 18-route audit.

Source commit `4ce776df8c5ee6f0dcc4bb12017a7d1a210144e3` is pushed to gewu/master.
Guarded fixed-egress upload rebuilt and verified miniapp development version
8.8.14 at `2026-09-23T11:13:47.769Z`, including pre/post public health gates,
exit 0. Receipt: `gewu-miniapp-8814-upload-20260923-6ul5g7qy/active.json`.
Desktop 8.9.8, cloud 8.11.20 and NAS 8.8.3 remain unchanged; the pending slots
for those components are not new-deployment claims. Partial development release,
not formal WeChat release or full multi-end acceptance. Six unrelated tracked
changes and protected untracked output were excluded from both commits.

## Application resubmission correction (8.8.13, UTF-8)

The persisted role/mode-only key reproduced two failures: a rejected application
could only replay its old result, and changing roles after an uncertain response
could bypass duplicate protection. The current page reconciles authoritative
state before each explicit Submit. A pending/approved result prevents a POST;
a rejected application ID scopes a new persistent attempt, while network retries,
role changes and page re-entry preserve the same key. Legacy unresolved keys are
retained. A conflict triggers one read, never automatic key rotation or repost.
Only opaque attempt keys are stored; form names and phone numbers are not.

Page/session guards suppress stale preflight writes and late response/toast
updates. Return during an in-flight operation queues a read and recovers the form.
The first live screenshot additionally exposed misleading invalid-input copy on
service failure. A failing-first test now distinguishes an uncertain submission
from bad input; the form remains editable with its current values. No business
rules, layout, roles, API or SQL production contract changes.

Actual TSX tests cover rejection, retry, reopening, edited inputs, role changes,
lost response reconciliation, double taps, conflicts, failed reads, invalid states,
legacy keys, four formal-role entry denials and stale preflight/POST responses.
The isolated PostgreSQL test demonstrates old rejected-key replay, changed-body
conflict, new-key submission and identical retry returning exactly one application.
UI/cloud-read/role-application suites, typecheck, build and version tests pass.
The cloud change is test-only; desktop/cloud/NAS versions remain unchanged.

Final-build run `gewu-application-retry-20260923-my9ehm4d/report.json` passed all
six controlled cases: retry/role change, reopen, pending duplicate prevention,
new rejected attempt, conflict reconciliation, and read-failure recovery/approved
write prevention. Fourteen controlled GETs and six intercepted POST attempts;
zero unexpected requests and no production application writes. All six images
were individually inspected, including corrected service-failure copy, editable
rejected form, pending/no-form, offline recovery and approved/no-form. Original
login, scoped cache and this account's attempt keys were restored; mocks removed.
This exercises real TSX handlers and DevTools UI, not physical offline, native
phone consent/pickers, production submission/review, or all-role visual acceptance.
Source `5677ec1b` is pushed to gewu/master. Guarded fixed-egress development
upload rebuilt and verified miniapp 8.8.13 at 2026-09-23T10:28:19.896Z,
including pre/post public health checks; exit 0. Receipt:
`gewu-miniapp-8813-upload-20260923-4pv9pbza/active.json`.
Desktop 8.9.8, cloud 8.11.20 and storage 8.8.3 stay unchanged; their pending
slots in this new receipt are not claimed as new deployments. Partial development
release only. Runtime report SHA256:
`99ba9d1b9801e7a14c081962353252f863ab9c096c753f33683b2b2ff5d09455`.
Earlier controlled run
`gewu-application-retry-20260923-el2r07yh` passed six handler cases,
restoring the original login, cache and account attempt keys, but predates the
service-error copy correction. Its first screenshot is the evidence for that fix.
The two preceding runs `rkl6rgcn` / `bzpx7rf9` remain failed: the temporary mock
used native callbacks instead of returning the DevTools response value. The
minimal API mock check then passed. Neither run made production writes; both
restored original state. No claim of physical offline or production review flow.

## Privacy hit target and application error correction (8.8.12, UTF-8)

Two regression tests first failed: actual application TSX emitted English for
empty name, and the privacy link stylesheet provided no usable minimum target.
The link now has a 44px minimum height with equal negative vertical margins,
preserving text baseline/adjacent layout. Local validation uses Chinese messages;
only known service error codes receive specific copy. Unrecognized service or
transport errors show a safe retry message, never raw internal error text.
Submission stays in its existing event handler. No role policy, request fields,
idempotency contract, routes, privacy policy wording or core business changes.

The new actual-TSX test covers empty name/invalid phone/no invalid request,
editable recovery, all five role/mode payloads, phone normalization, known-phone
mismatch, and unknown service/transport errors. Included in test:miniapp-ui.
UI/cloud-read, typecheck, weapp build and independent-version tests pass.
The classifier selects miniapp patch 8.8.11 -> 8.8.12; other components unchanged.

Real DevTools evidence:

1. `gewu-application-validation-20260923-gzxt19dg/report.json`, ok=true. Existing
   cloud-signed visitor session read its real application state. Actual Submit
   taps with empty name and empty phone produced the expected Chinese messages;
   request interception counted zero network attempts. Toast arguments were
   captured through a controlled showToast mock, not a native toast screenshot.
2. Picker change events selected teacher/family/student. The family form shows
   Student Name and no profile-mode selector; teacher/student retain both modes.
   All six screenshots individually inspected; form/error sections fit. Native
   picker gestures, keyboard coverage and complete submitted/review flow remain.
3. `gewu-privacy-live-20260923-bhgp7lcy/report.json`, ok=true. Actual link size is
   88x45 CSS pixels, versus 88x17 before; text position stays visually unchanged.
   Real tap opens guidance, five sections/end note render, scrolling works and
   API Back returns to Login. All five screenshots individually inspected.
   No full accessibility, legal compliance, physical-offline or phone-login claim.

Both successful runs restored original auth/cache state and removed all mocks;
no business writes. The earlier `gewu-application-validation-20260923-rjgi68bj`
captured both English messages but stopped at the harness's class-only count
selector guard. It remains ok=false, original state restored. The helper was
corrected to count the existing .picker-value class, not a fictitious app fix.

Source 37fe9367 is pushed to gewu/master. Guarded fixed-egress upload rebuilt and
verified miniapp 8.8.12, with pre/post public health and compatibility checks,
exit 0; development receipt verified at 2026-09-23T09:52:28.610Z:
`gewu-miniapp-8812-upload-20260923-vvab4fwn/active.json`.
Desktop 8.9.8, cloud 8.11.20 and storage 8.8.3 are unchanged. This is a partial
development release, not formal release or a full multi-end acceptance claim.
Report hashes: application 03323fd433fb62b26d1b2c2e8a63777d69114cb7ff07a8460508b0ccfb7cf3a3;
privacy 1aa769c495dd09d41c4274353b9d8618b289cfee8ce711f8916af063917cef74.
Separate finding from source/SQL review, addressed by 8.8.13 above:
the role/mode-only stored idempotency key survives changed name/phone and rejected
applications, while SQL rejects changed payloads under the same key and returns
an old rejected application for identical retries. The refresh-page suggestion
does not reset that persisted key. The correction must preserve
ambiguous-network retry deduplication.

## My-page interaction correction (8.8.11, UTF-8)

Before screenshot: `gewu-settings-before-20260923-mppa0nb0/01-settings-before.png`,
SHA256 76be7f1a70a5c8708c5d1d4f29c61a4e860abb6752f5f4598fe4bd4dbe51a799.
The teacher page layout fits; existing sections, wording and positions remain.
Actual TSX tests reproduced stale logout confirmation clearing a replacement
account, duplicate refresh clicks, late refresh toasts after an account change,
and missing status updates on return. The old storage network state never got
initialized because initSyncManager has no caller; settings now checks WeChat
getNetworkType on show and listens to its real network-change event. This does
not re-enable the retired automatic synchronization manager.

Session checks protect confirmation and refresh responses; refs suppress double
clicks and cancel hidden/unmounted responses. The original formal/visitor logout
branches and cleanup contract remain. Page return updates profile/timestamp
without starting a business refresh; interaction requests stay in click handlers.
Tests cover platform offline state, network event/query races, refresh failure,
logout cancel/confirm, account replacement, return, hide/unmount, visitor role
application and listener cleanup. Included in test:miniapp-ui; UI/read/API-session,
typecheck/weapp/version checks pass. A follow-up test also protects local sign-out
of an already-invalidated but unchanged session; it still cannot clear a newer
generation/account. The same boundaries pass against the actual persistent
session runtime as well as the isolated page harness. Source 29066753 is pushed
to gewu/master. Guarded fixed-egress upload rebuilt/release-checked 8.8.11,
passed compatibility/public-health checks, and finalized the development receipt
at 2026-09-23T09:33:00.203Z, exit 0:
`gewu-miniapp-8811-upload-20260923-9if1lkqh/active.json`.
Desktop 8.9.8, cloud 8.11.20 and storage 8.8.3 are unchanged; no new receipts
were fabricated for them. This is partial development release, not full acceptance.

Real matrix `gewu-settings-live-20260923-h1sc8qsk/report.json`, ok=true:

1. All five cloud-signed roles opened My; the four formal roles tapped Refresh
   and the actual cloud-read timestamp advanced. Visitor had no refresh control.
2. Teacher network-type injection returned none; offline notice appeared and
   the real refresh button disabled. Restoring the API and returning recovered.
   This is controlled platform-output testing, not physical offline acceptance.
3. All five roles tapped Logout. With controlled showModal cancel/confirm
   results, cancellation retained the account; confirmation reached Login and
   cleared auth/token/permission/cache-identity state while invalidating the
   generation. Native dialog appearance/manual buttons were not validated.
4. Visitor tapped Apply Role, reached the existing form and returned; no form
   was submitted. That form's full role/profile/validation matrix remains open.

All twelve screenshots were individually inspected. No section/button overlap;
offline state adds a readable notice without hiding Logout. Actual refresh and
logout button sizes were 335x45 and 366x45 CSS pixels on the simulator; this does
not establish all-device or assistive-technology compliance. Original auth and
scoped cache/timestamp keys were restored and mocks removed. No business writes.
Earlier `gewu-settings-live-20260923-aqhs54kc` stopped at a harness rejection of
a compound selector; its screenshot shows recovery, but the run remains failed.
Both original auth/cache were restored there too. Full page acceptance still
needs native dialog/physical offline, cold consent and assistive-input coverage.

Final-build invalidated-session follow-up:
`gewu-settings-live-20260923-q9dwf_0l/report.json`, ok=true, teacher role. Cancel
retained the account; confirming local logout of the unchanged invalidated
session reached Login and cleared auth/cache identity. Both screenshots were
individually inspected (8.8.11 visible on My); original login, cache and mocked
APIs restored. No business writes. The earlier `l80mwpny` run timed out waiting
for Login and remains failed. The follow-up passed after clearing only DevTools
disposable compile cache, with no source change; this correlation alone does
not prove the failure's root cause. No auth/storage cache was cleared to recover.

## Login privacy interaction audit (8.8.11, unchanged source)

Receipt `gewu-privacy-live-20260923-o_u6wa6q/report.json`, ok=true, SHA256
14c0d11dc9b3da590b6ccbd2bcc4d2252dafa0b90cba083b3bbf3f9af225b165.
From the signed-out Login UI, the real privacy link opened pages/login/privacy.
All five sections and the effective-date note rendered. Top/middle/end scroll
captures were inspected individually; no horizontal clipping or text overlap
was seen at this simulator size. Official navigateBack returned to Login and
the phone-login button remained present. This tests navigation API back, not a
manual native navigation-bar tap. All five screenshots were inspected. Original
login and scoped caches were restored; no phone authorization or business writes.

Open finding: the measured privacy link is only 88x17 CSS pixels. It is tappable
in automation, but that does not establish comfortable touch use. Enlarge its
hit target while preserving the existing visible layout, then verify dimensions
and return navigation. This is UI inspection only, not legal/privacy compliance.
Separately, account-application/applicationRuntime.js throws English validation
messages and index.tsx displays error.message directly in a toast. This is a
source-confirmed user-copy issue; capture/reproduce the actual empty-name and
invalid-phone actions before correcting it. Preserve role policy and REST payloads.

## People-list correction (8.8.10, UTF-8)

Direct student navigation previously rendered its own scoped student row on a
list route that the existing role policy denies; it did not expose all students.
Both student and teacher lists now enforce the existing route policy before
projection/cache reads and at render. Their normal card contents, search rules,
student-detail destination and fee semantics remain unchanged. Boolean coercion
removes an orphan numeric zero beside a teacher with no hourly rate.

Both pages use native pull-down refresh, including empty states, and refresh on
return. Request sequence and account-session checks discard late responses;
failed reads show authorized saved rows with a notice or a retry action when no
cache exists. No core business mutation, projection widening or API change.
Actual TSX runtime tests cover search, detail click, empty/no-match states,
native/return refresh, failure/retry, hide/unmount and identity/access changes.
They are included in test:miniapp-ui. UI/read regressions, typecheck and automatic
independent-version checks and 8.8.10 weapp build pass. Source 36b80a7f is
pushed to gewu/master. Guarded fixed-egress CI rebuilt/release-checked 8.8.10,
passed compatibility/public-health checks before and after upload, and finalized
the verified development receipt at 2026-09-23T09:03:34.407Z, exit 0:
`gewu-miniapp-8810-upload-20260923-vfaaa0fy/active.json`.
Desktop 8.9.8, cloud 8.11.20 and storage 8.8.3 are unchanged; their targets are
pending in this new manifest. No formal or full-matrix release claim.

Test diagnostics are not app findings: a mixed DevTools compile cache produced
React #130 and a skeleton without running the new page handler. Clearing only
the disposable compilation cache restored the unchanged page source. No storage
or auth cache was cleared; speculative lifecycle workarounds were removed.
The live harness also corrected a Windows empty-argument issue using the real
Input event and now observes navigation completion before querying the new page
(a selector wait on the old page cannot detect the new page). Failed receipts
remain failures, with original login restored; they are not accepted UI runs.

Real cloud/DevTools matrix: `gewu-people-pages-20260923-cqhkbod4/report.json`,
ok=true, ten role/page cases. Teacher counts: one student / one teacher;
super-admin counts: 65 students / three teachers. Both student lists passed
known-name search, no-match, clear, last-card tap and exact detail-ID match;
teacher also exercised school search. Real phone-search data was absent from
these selected rows; phone filtering is covered by the TSX test, not claimed as
a live phone test. Both roles passed native pull-down refresh. Teacher's two
pages passed controlled wx.request 503/cache recovery. Student/family/visitor
each denied both lists and tapped Return Home successfully. No business writes;
request mock and original login restored, exit 0.

All 16 screenshots were viewed individually. Long names are ellipsized on list
cards and readable after opening student details; no card/header overlap seen.
The student failure screenshot retained bottom scroll after a prior last-card
test, so it is NOT evidence that the notice is visible; a top-of-page follow-up
was required. The teacher failure notice fits above the existing list header.
The rebuilt 8.8.10 student follow-up
`gewu-people-pages-20260923-fweiyuwe/report.json` passed actual cloud loading,
native refresh, controlled failure and recovery, with original login/mock
restored. Both new screenshots were individually inspected at scroll top:
notice, search and card fit without overlap. Student failure screenshot SHA256:
`b4564ece5d199e3960eea2467f8551529d96e4388f5887347cbd9c5c484c19df`.
Remaining: physical offline, rendered no-cache retry and cold authorization,
touch dimensions and other detail-page tabs/states. This is not full UI acceptance.

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
| login/privacy | G | Readable text, full scroll, return | 8.8.12 real entry/5 sections/end note/scroll/API back passed, five screenshots inspected; target enlarged and measured 88x45; native back tap/large-font/assistive input remain |
| index/index | A/T/S/F/V | Only real authorized entries; navigation and empty state | 8.8.21 navigation follow-up: five roles, 25 actual card/shortcut targets and return passed. 8.8.22 development uploaded: session/hide/unmount/retry regression tests passed; final five-role runtime metrics/privacy/return and 45x45px logout targets passed, ten screenshots inspected, exact auth/cache restoration verified; see miniapp-home-session-verification-2026-09-24.md. Full failure/cold-auth, native confirmation and physical-device checks remain |
| forbidden/index | A/T/S/F/V | Reason/application guidance appropriate to role; recovery | Dedicated route/Return Home passed for five roles; five screenshots inspected, visitor-only application guidance verified |
| schedule/index | A/T/S/F/V | Original course label/time/address; week/day, empty/offline | A/T/S/F real week/day/card/detail/return/native pull/Today and visible bottom-card geometry passed; T controlled cached/uncached failure/retry passed; V application entry passed; 8.8.20 date controls measured 45px and 17 final screenshots inspected (miniapp-schedule-day-verification-2026-09-23.md); physical offline/cold auth/touch remain |
| schedule/detail/index | A/T/S/F; deny V | Original details, attendance/fees, missing ID | Four formal roles real details/student/back/missing record and fee boundary passed; T cached/uncached failure/retry passed; final V pre-read denial and return-home passed after compile-cache refresh; physical offline/cold auth remain |
| schedule/edit/index | A/T/S/F | Core-edit boundary, recovery; no unauthorized save | Four formal roles passed normal and direct-root Return; four screenshots inspected; read-only/no-service dependency regression passes |
| students/index | A/T; deny S/F/V | Complete list/search, details, long labels | A/T counts/search/clear/last detail/native pull and S/F/V denial/recovery passed; T controlled failure/recovery/top notice capture passed; physical offline/no-cache/cold-auth/touch checks remain |
| student-detail/index | A/T/S/F; deny V | Scoped balances/history, tabs, missing ID | A/T/S/F detail/tabs/empty ledgers/native pull/missing recovery; T/S/F unrelated ID hidden; V denial/recovery; T controlled cache/no-cache failure and real retry passed; final T/S action 98x45px and tabs 117x45px verified with four inspected screenshots; physical offline/cold auth remain |
| courses/index | A/T; deny S/F/V | Original course semantics, details and empty state | Sep 24 A/T actual 58/1 course reads, all type filters/reset/native pull/return and last-card visibility passed; S/F/V denial has no data and recovery passed. Final staff filters all 45px high, all five fit; four final layout screenshots inspected, original auth/cache restored. See miniapp-courses-layout-verification-2026-09-24.md. T cached/uncached failure/retry earlier passed; physical offline/cold auth/native gestures remain |
| teachers/index | A/T; deny S/F/V | Scope, contact display and long text | A/T counts/native pull and S/F/V denial/recovery passed; T cached-failure/recovery and zero-fee correction observed; physical offline/no-cache/cold-auth/touch checks remain |
| payments/index | A/T; deny S/F/V | All authorized filters, counts/totals, empty/loading/offline | Sep 24 A/T real three-row currency/hour fixture, totals/cents/filter/native pull/return passed; S/F/V denied with no financial data and returned home. T controlled cached/uncached failure and real Retry passed. Final two staff screenshots inspected: long names wrap, filters 46x45px, all cards visible. Exact temporary ledger/device cleanup and auth/cache restoration passed. See miniapp-payments-verification-2026-09-24.md; physical offline/cold-auth/font-scale/native gestures remain |
| stats/index | A/T; deny S/F/V | Real totals, groups, expansion/collapse, empty state | A/T totals/collapse, A empty, S/F/V denial passed; 8.8.9 T request-failure/cache/retry/native pull/return passed; loading and stale-session unit tests passed; physical offline/loading capture/touch measurements pending |
| question-bank/index | A/T/S/F/V | Desktop-derived filters/options/media, answers toggle, floating basket | Five-role real reads/answer toggle/native pull/no-match recovery pass; A/T local basket add/remove/drawer pass; S/F/V write restriction verified. Sep 24 strict download gate passed after DevTools domain refresh and callback probe correction; all five roles' first-question diagram decoded at 2680x2060 with no placeholder, answer toggle passed, ten additional screenshots inspected and exact auth/cache restored (miniapp-download-domain-2026-09-20.md). Full filter combinations, remaining images, late-page option geometry and complete visual acceptance remain open |
| question-paper/index | A/T; deny S/F/V | Edit/reorder, Word/PDF buttons, permission/error recovery | 8.8.19 A/T real title/score/order/native pull/validation/removal/root-empty return passed; S/F/V denial inspected; controls measured 45px high. Sep 24 teacher actual Word/PDF export and download buttons passed with strict URL checks, cloud delivery size/hash match, exact auth/cache restoration; PDF five pages inspected. See miniapp-download-domain-2026-09-20.md. Native document viewer, Word pagination, physical offline/cold auth and native picker/keyboard remain unproven |
| assets/index | A/T; deny S/F/V | Personal import only, CSV/error/empty state, scope | Real A/T reads, S/F/V denial; teacher real 24-row CSV import/replay/conflict/owner isolation/readback/native pull and exact cleanup pass; populated month/year/all/bottom inspected (five PNGs), original auth/cache restored; physical-device consent/offline still open |
| settings/index | A/T/S/F/V | Actual account/status/actions, role application and logout | Five-role page/refresh-or-application/logout handlers passed; T controlled offline/recovery passed; button dimensions measured; native modal/physical offline/cold consent/accessibility remain |
| account-application/index | V, then approved formal entry | Names/phone instead of internal IDs; role choices and errors | UTF-8 Sep 24: real teacher/new form submission, desktop review HTTP, same-session approval read and Enter Home into teacher scope passed on 8.8.25; four final screenshots inspected, exact cloud/device fixture cleanup and auth/cache restoration verified. See role-application-approval-continuity-2026-09-24.md. Three-role entry and stale/failure/retry component tests pass; actual S/F application approval, desktop reviewer UI, cold auth, formal-role visual denial and native picker/keyboard remain |

Earlier 18-image ledger journey: docs/miniapp-student-ledger-2026-09-20.md.
Completed production paper correction: docs/verification-2026-09-20-paper-indent.md.
Do not repeat completed imports/exports to substitute for remaining page tests.
