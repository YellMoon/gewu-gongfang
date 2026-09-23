# Miniapp page-detail audit — Sep 23, 2026

Scope: existing UI, wording, fit, interactions and role boundaries. No redesign
of original desktop business behavior. Source coverage is not visual acceptance.
Official DevTools agent CLI, confirmed AppID wx3d570539bbe6ba1b, dist project,
URL checks enabled. All listed Sep 23 role runs restored the original session.
Cloud-signed existing test sessions verify UI/cloud authorization; they do not
prove WeChat phone consent/login. No business rows were created or changed.

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
  No protocol or schema change. Upload receipt is pending; not fully released.

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
| stats/index | A/T; deny S/F/V | Real totals, groups, expansion/collapse, empty state | Pending |
| question-bank/index | A/T/S/F/V | Desktop-derived filters/options/media, answers toggle, floating basket | Strict media-download gate unresolved; full audit pending |
| question-paper/index | A/T | Edit/reorder, Word/PDF buttons, permission/error recovery | Handler/export regressions pass, strict WeChat download acceptance pending |
| assets/index | A/T | Personal import only, CSV/error/empty state, scope | Pending |
| settings/index | A/T/S/F/V | Actual account/status/actions, role application and logout | T screenshot inspected; remaining roles/actions pending |
| account-application/index | V | Names/phone instead of internal IDs; role choices and errors | Pending |

Earlier 18-image ledger journey: docs/miniapp-student-ledger-2026-09-20.md.
Completed production paper correction: docs/verification-2026-09-20-paper-indent.md.
Do not repeat completed imports/exports to substitute for remaining page tests.
