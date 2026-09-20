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

Full frozen-source regression, build, deployment and new real-page screenshots
are still pending. This document is not a release-completion claim.

Existing unrelated edits (including the room-history SQL hunk in app.js) are
preserved in the worktree and excluded from this change's release source.
