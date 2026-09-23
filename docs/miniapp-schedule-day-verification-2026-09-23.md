# Miniapp schedule day view 8.8.20

<!-- UTF-8: A scoped page audit, not full multi-end completion. -->

## Scope

The original schedule component and its filtering, navigation, record fields,
detail route, date calculations and refresh logic remain byte-for-byte unchanged.
Only its local stylesheet changes: day/week mode, student filters, previous/next
date and Today controls have minimum 44px touch heights; date arrows and Today
also have minimum 44px widths. No desktop UI, schema, API, account capability,
question data, NAS image, or production teaching record was changed.

The pre-change real teacher flow passed date navigation, detail/back, native
pull, Today and switching back to week mode. Actual rendered targets were:
mode 177x36px, date arrow 33x30px, Today 37x23px. Evidence:
`gewu-schedule-day-runtime-20260923-qx9uflue`, ok=true, original auth/storage
restored. Four screenshots individually inspected before making the CSS change.

## Tests

- Extended the existing actual-component test for teacher, super admin, student
  and family member: day/week toggling; today/next/empty day; exact lesson-detail
  route; preserving day selection after detail return and native pull; staff-only
  student filters; week-to-day date retention. Cross-year next/back also passes.
- Touch-target assertion first failed against the old stylesheet, then passed.
- `npm run test:miniapp-ui`, miniapp typecheck and weapp build pass.
- Shanghai date/projection tests and automatic/independent version tests pass.
- The release classifier selected patch: miniapp 8.8.19 -> 8.8.20. Desktop 8.9.8,
  cloud 8.11.21 and NAS 8.8.3 remain unchanged.

## Architecture guard recheck

During the UI run, these current-worktree checks also passed without edits:
cloud-business authority contract, browserDatabase capture, browser authority
projection cutover, desktop command outbox, desktop authority client, desktop
cloud-business draft adapter, and desktop authority runtime. Runtime code wires
the REST adapter and the tests reject retired authority transports; unsupported
types fail closed rather than using a local-host relay. This is local code/test
evidence, not a new production migration or full installed-desktop acceptance.

## Runtime and release status

Final DevTools runtime `gewu-schedule-day-runtime-20260923-uurfo9jb` completed
with ok=true, five roles, businessWrites=false, authRestored=true and
storageRestored=true. It used existing test accounts and existing production
schedule records, without creating teaching data or changing the device clock.

- Teacher, super admin, student and family member: real cloud day cards,
  detail/back preserving the selected date, previous/next day, native pull,
  Today empty state and return to week view passed.
- Student/family views have no staff student filter or teacher-fee field.
- Visitor sees the empty schedule and can open the role application route;
  no teaching data or day controls are exposed.
- Actual rendered mode/date/Today controls measure 45px high; date arrows and
  Today measure 45px wide. Staff filter targets also measure 45px high.
- Last-card bottom is 525.8px for staff and 464px for student/family, within
  the 643.6px scroll viewport bottom; no bottom card is hidden by navigation.
- All 17 final screenshots were individually inspected (four per formal role,
  plus the visitor boundary). No card clipping or date-control overlap seen.

Committed source `613908f82964bbbd38141174f78fec737831f90a` was pushed to
`gewu/master`. Re-ran the complete miniapp UI suite, typecheck, independent
version tests and weapp build (13.72s), all exit zero. The existing guarded
fixed-egress CI workflow uploaded 8.8.20 and finalized its development receipt
after post-upload checks at `2026-09-23T15:26:21.821Z`. Evidence directory:
`gewu-miniapp-8820-upload-20260923-awi5hqyc`; `active.json` marks miniapp verified.
No desktop feed, cloud deployment or NAS update was performed or needed here.

The strict wx.downloadFile gate was retried after upload and still returns
`REAL_MINIAPP_DOWNLOAD_DOMAIN_NOT_ALLOWED:downloadFile:https://physicsedu.xyz`.
The active dist project retains urlCheck=true and has no private config override.
This is not full multi-end release acceptance. Physical phone touch,
offline/cold-session behavior and the full 18-page audit remain separate gates.
Programmatic taps do not prove physical touch accessibility.
