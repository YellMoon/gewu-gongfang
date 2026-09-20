# Student-detail read model correction — 2026-09-20

## Defect and scope

The miniapp projection supplied nullable legacy balances, and its cache adapter
unconditionally replaced payments/grades with empty arrays. The student page
therefore showed blank balances and false empty-record states. Hour purchases
were also displayed as currency.

The correction uses the existing authorized student set, tenant/deleted filters,
and original desktop payment-minus-consumption calculation in one SQL statement.
It returns only fields used by payment/grade tabs, not raw consumption rows or
internal ledger notes. No miniapp business-write permission, teaching workflow,
desktop window, database migration or NAS update is introduced.

Cloud support must precede the miniapp reader. Independent candidates:
cloud/gateway **8.11.19**, miniapp **8.8.7**; NAS remains **8.8.3**.

## Current verification

- Reproduced failing cache and HTTP tests before implementation.
- Cloud HTTP tests: manager/teacher/student/family scopes; visitor and unbound
  student denied before a query; missing balances/record arrays return 503.
- Disposable PostgreSQL: creator/course/override student scopes; unrelated and
  cross-tenant isolation; deleted students/rows excluded; empty ledger = zero;
  funded ledger = 10.5 hours and 1020 currency units, overriding stale legacy
  values; reader cannot delete payments, consumptions or grades.
- Miniapp cache/session tests: real payment/grade arrays retained; incomplete
  results and stale-account responses write nothing.
- Original desktop balance parity, student display and independent version
  tests passed. Hours display as hours rather than currency; failed loading no
  longer appears as empty records.

## Deployed correction and current acceptance boundary

Commit `abc4bc0554273c6ebe64f87e26cfb2bb9dc08ab1` is pushed to gewu/master.
All 182 frozen-source cloud commands passed (exit 0):
`gewu-frozen-cloud-bundled-tests-20260920-6lckgvw9/receipt.json` in Windows Temp.
Miniapp typecheck, weapp build (37.21s), release smoke, all 14 miniapp cloud-read
entrypoint tests and the complete test:miniapp-ui entrypoint also passed.

Cloud 8.11.19 is deployed and publicly verified. Evidence:
`gewu-cloud-81119-release-20260920-ve32ltxv/active.json` and execution.json (0).

- Before deployment: cloud code/templates archive
  `/root/scheduling-backups/cloud-code/20260920-020201-34b76a61/code.tar.gz`,
  SHA256 `b083e7e38483cdec1590c024c707c81face2cf2fcc33301c54712f7c872a99c8`;
  prior 8.11.18 image retained as rollback source.
- DB backup `/root/scheduling-backups/postgres/20260920-020743`,
  SHA256 `e2a57c18802aba660863fdf5afcd18e9f0184a4b451741b34fcef50b8cfcb68f`;
  isolated restore and ownership/privilege comparison passed.
- Public health contract SHA256
  `53b07ad3029947784457488a6bc399ae53fed0aa6925ca3c0260936d2118ca26`;
  authority contract SHA256
  `5f9099826555c692cb09aad3e1df5bf2fb3ce465f4e65148c898cbeb422e5372`.

Real public REST checks created two payments, one consumption and one grade for
the existing isolated E2E student. Teacher/student/family projections each
returned 10.5 hours, 1020 currency units and score 86; the visitor projection
returned 403. Only temporary ledger rows were written, using the existing
administrative REST boundary for fixture setup; no core teaching row changed.
These are real cloud results, not mocks and not proof of the phone-login flow.

UI runs exposed developer-tool failures (automatic reLaunch timeout, followed
in another run by automation screenshot timeout). No valid new screenshots
were obtained in those runs. They must not be marked as visual acceptance.
The second run did automatically reach home before its screenshot failure.
Its fixture rows were all removed, original balances/record lists restored,
original simulator login restored and temporary device/session/link revoked:
`gewu-miniapp-ledger-live-20260920-b9z228ug/receipt.json`.
The first run's cleanup script passed a noncanonical timestamp and got 400;
reconciliation used the exact observed version normalized to UTC (no version
bypass), removed its four rows and revoked its temporary registration:
`gewu-miniapp-ledger-live-20260920-63vf8mh9/receipt.json`.

Miniapp 8.8.7 development upload succeeded at 2026-09-20T02:26:17.013Z after
fixed-egress CI upload and post-upload public health checks. The active release
manifest records releaseLevel=development; the upload receipt is
`gewu-miniapp-887-upload-20260920-x1n5e9o8/receipt.json` (ok=true).
This proves development upload, not formal WeChat release or visual acceptance.

A subsequent bounded UI attempt and project-window reopen still encountered
navigation/screenshot timeouts. No new valid page screenshots were obtained.
Its four fixture rows were removed and temporary registration revoked:
`gewu-miniapp-ledger-live-20260920-7v3795yr/receipt.json`.
Desktop parser OSS update subsequently completed as 8.9.8 with full public
installer byte verification; see desktop-template-release-2026-09-20.md.
Full multi-page acceptance remains open.
This is a partial release; NAS remains 8.8.3 and needs no ledger update.

Existing unrelated edits (including the room-history SQL hunk in app.js) are
preserved in the worktree and excluded from this change's release source.
