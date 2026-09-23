# Miniapp paper editor recovery 8.8.19

<!-- UTF-8: Evidence for a bounded page correction, not full multi-end acceptance. -->

## Reproduced defects and corrections

- The real teacher flow selected two single-choice questions from the cloud.
  Previously both appeared under `综合题`, six points each, unlike desktop.
  New defaults use the actual desktop canonical type/section/score rules.
  Saved custom sections and scores are not silently migrated or overwritten.
- After changing the title, setting 4.5 points and moving the first question
  down, native pull-to-refresh discarded the order and per-question edits.
  Restore now joins by selected, cloud-available ID, preserves saved order and
  valid layout values, ignores duplicate/foreign rows, and appends new selections.
  Question content remains the fresh cloud response, never the local draft.
- Empty direct-root paper pages used navigateBack with no prior page. The named
  Return to Question Bank button now uses switchTab to the question bank.
- Denied paper pages no longer read paper content/tasks or send formal student
  and family accounts to a visitor-only application route. They render the
  existing shared role-aware explanation. No role capability was expanded.
- The rendered ordering buttons were too small. Ordering buttons, editor fields,
  grouping controls and export/task actions now have a minimum 44px height;
  ordering targets also have a minimum 44px width. Desktop UI is unchanged.

## Current verification

- New helper/component tests reproduced failures before corrections. The helper
  parity test executes the actual desktop default builder and type normalizer.
- `npm run test:miniapp-ui`, `npm run test:miniapp-cloud-read`, miniapp typecheck
  and production weapp build pass. The cloud-read command includes real
  PostgreSQL ownership/replay/rollback checks and Word/PDF renderer regressions.
- Version classifier/independent-version tests pass; fixed-egress upload tests
  pass (56 cases), as does the miniapp upload contract test.
- Baseline failure receipt remains failed:
  `gewu-paper-editor-runtime-20260923-2r6rld8c` (refresh lost saved order).
- Corrected teacher receipt: `gewu-paper-editor-runtime-20260923-5sjj61cv`.
  Actual select/basket/editor/title/score/reorder/native pull/invalid score/
  correction/removal/root-empty/return operations passed. Five PNGs inspected.
- Admin plus student/family/visitor receipt:
  `gewu-paper-editor-runtime-20260923-wvh6p48n`. Admin performed the same flow;
  three restricted roles showed no paper and the appropriate shared explanation.
  All eight PNGs inspected. Rendered ordering button was 45x45; title, score,
  section picker and custom section inputs were each 45px high.
- Both successful runs restored original authentication and all `sch_` storage
  exactly. No question or business record was written; no export task submitted.
- Final teacher touch/layout receipt: `gewu-paper-editor-runtime-20260923-i80qha_5`.
  Seven controls measured 45px high, including both export actions' shared
  selector and the grouping button. The ordering button was 45x45. Three PNGs
  individually inspected, including the bottom export controls after scrolling.
  This supplementary run only checks touch/layout, not another full editing
  flow or export submission. Original authentication/storage were restored.

## Scope and remaining checks

Only miniapp changes from 8.8.18 to 8.8.19. Desktop 8.9.8, cloud 8.11.21 and
NAS 8.8.3 are unchanged. The root package change only wires regression tests.
Six unrelated tracked changes and protected untracked output are excluded.

The screenshots still show image-unavailable placeholders: strict WeChat
download-domain acceptance remains unresolved. This is not full visual acceptance
of question media, phone consent, physical offline/cold authentication, native
picker/keyboard accessibility or the complete 18-route audit. Do not disable
domain checks, repeat question imports or replace the NAS image for this patch.

## Development upload receipt

Source `f88edc2e0feabc15fe8c0e15281910bb270b5c7a` was pushed to `gewu/master`.
The guarded existing fixed-egress upload exited zero and recorded miniapp
8.8.19 as `verified`, releaseLevel `development`, at
`2026-09-23T14:41:12.656Z`. Evidence directory:
`gewu-miniapp-8819-upload-20260923-99j9vdrs` (`active.json`, `receipt.json`,
`upload.log`). The receipt was finalized only after post-upload health checks.
The platform result reported the full package as 1,076,584 bytes.

Compatibility remains `gewu.protocol-data-compatibility.v1`; no protocol or
schema change. Other component slots in this new per-upload manifest remain
pending, not new deployment receipts. This is a verified miniapp development
upload, not official WeChat review/release or full multi-end completion.
