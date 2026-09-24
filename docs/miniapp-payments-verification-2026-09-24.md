# Payments page verification

Date: 2026-09-24. UTF-8. Scope: miniapp read-only display, not accounting mutations.

## Defects and correction

- Type 2 amounts are hours, not currency. The old summary added both types and
  rounded money to integers. Separate money/hours/count; retain two money decimals.
- Cloud miniapp ledger rows intentionally omit created_at. The old sort throws
  on these rows. Fall back to payment_date, retaining equal-date source order
  and never mutating cached arrays. No added cloud fields or changed ledger rules.
- Hide fabricated zero totals during loading; distinguish failed uncached reads
  from successful empty results. Authorized saved data carries a cache notice.
- Bind both rendered data and pending reads to the account generation, request
  sequence and page lifecycle. Hidden/unmounted/older requests cannot read cache.
- Support native pull, preserve a still-authorized student filter and reset a
  removed filter. Use remaining viewport height instead of phantom tab padding.
- Screenshot review found a long unbroken test name colliding with the hours
  amount; add wrapping. Filters have at least 44px height and border-box sizing.

## Tests

Actual-component regression first failed on misleading loading totals. A second
regression reproduced missing-created_at TypeError; the long-name CSS regression
also failed before correction. All now pass, including 35 students, all filters,
money/hours, true empty, cached/uncached failures, retry and five stale-read cases.
Student/family/visitor are denied before service or cache reads.

Full test:miniapp-ui (including pretest), miniapp typecheck and build:weapp passed.
Cloud miniapp-student-ledger PostgreSQL checks also passed: exact balances,
role/tenant/deletion scoping, private-field exclusion and read-only permissions.
Version classifier selected patch; update-version, independent-release-version,
release-matrix and upload-miniapp tests passed. Only miniapp changes to 8.8.24;
desktop 8.9.8, cloud 8.11.21 and storage-proxy 8.8.3 stay unchanged.

## Real operation evidence

Baseline `gewu-payments-runtime-20260924-27s_bpfs` failed waiting for cards;
the screenshot remained loading and showed misleading zero totals. No retained
console evidence establishes that failure's exact cause; do not relabel it as
a proven sorting stack trace. All three marked fixtures and their temporary
device were cleaned; original balances, ledger and auth/cache were restored.

Run `gewu-payments-runtime-20260924-z6zqgkh7` completed with ok=true against
production cloud 8.11.21, real cloud-issued test sessions and live projection.
Only the existing marked test student received three temporary payments: 2.55
and 18.35 currency plus 12.5 hours. Teacher/admin actual page reads, student/all
filters, native pull and return passed. Summary was 20.90 / 12.5 / 3, rows retained
their units. Student/family/visitor denial had no cards/totals and returned home.
Controlled wx.request 503 tested cached and uncached failure; restoring real
requests and clicking Retry recovered the three records. This is not a physical
offline-network test. Eight screenshots were individually inspected; long-name
overlap found here means this run is not final visual acceptance.

All three exact marked payments were deleted via authorized REST with version
preconditions. Complete original student ledger and balances compared equal;
temporary device/session/link/installation active counts are zero. Original auth
and all sch_ storage compared equal after restoration. No user teaching records,
question records or unmarked payments were edited.

Development upload is pending below.
Full multi-end release and all-page acceptance remain incomplete.

The first final-layout attempt started before the refreshed simulator exposed
wx; it stopped before any fixture or authentication write. The next attempt
`gewu-payments-runtime-20260924-7ea0tufr` failed the runtime word-break assertion;
its screenshot still contained the old overlap despite updated built WXSS.
Exact three-record, device and auth/cache cleanup succeeded. Only compile cache
was then cleared, followed by refresh; no storage/authorization cache was cleared.

Final `gewu-payments-runtime-20260924-wfp9p7_h` exited 0 with ok=true. Teacher
and super-admin both read the real three-row fixture, retained correct totals,
used native pull/all filters/back, and read runtime word-break=break-all and
box-sizing=border-box. Filter size was 46x45px. Both final screenshots were
individually inspected: long names wrap without touching currency/hours; all
three cards fit the viewport. The report pins all payment source/test file hashes.
All three fixtures and the exact temporary device were cleaned; original ledger,
balances, auth and all sch_ storage again compared equal.

This verifies the current default simulator viewport, not every physical device,
font scale, native gesture, offline radio or cold-login state.
