# Core Scheduling Local Shadow Rehearsal Evidence

## Boundary

This is a one-time, user-authorized, read-only rehearsal against the legacy scheduling SQLite database. It is not a source importer, a cloud write, a cutover, or a release. The source path, row values, names, contacts, fees, and schedule details are intentionally not recorded here.

The reader opened only `tenants`, `institutions`, `schools`, `rooms`, `teachers`, `students`, `courses`, and `schedules` inside a SQLite `query_only` transaction. No question-bank or asset table was queried. The PostgreSQL target was a disposable local database and was destroyed after reconciliation.

## 2026-08-21 result

- Source file SHA-256 before and after: `9d382041654d039a25f2c21921e75f74add4ee0629b1c07e37e787a7a9b533c5`; the values matched.
- Scoped eight-table inventory SHA-256: `f5b010ef1843e26444ebc19854531e07f8ade2124600e2d234084d891b3d48ae`.
- Read counts: tenants 1, institutions 4, schools 15, rooms 15, teachers 1, students 60, courses 57, schedules 589.
- Reconciled target counts: the same foundation counts; teachers 1, students 60, courses 57, course default pricing rows 69, schedules 571, explicit schedule override rows 246.
- The admission ledger reconciled the eight real source relations, with 571 admitted schedules and 18 quarantined schedules.
- The quarantined set matched the approved immutable obsolete-schedule manifest; no fake student or schedule was created.

## Interpretation

This proves that the current core scheduling contract, local business schema, and disposable shadow executor can represent this approved snapshot without mutating the source. It does not prove a reusable source-reader deployment, RDS readiness, cloud command writing, user authentication, device registration, offline submission, NAS media handling, or a production release.
