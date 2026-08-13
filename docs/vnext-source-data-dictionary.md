# vNext legacy source data dictionary

This document is the human-readable view of `migration/vnext/source-table-catalog.json`. The JSON catalog is authoritative and test-enforced against the redacted 99-table Phase 1 structural fixture.

## Disposition rules

| Disposition | Meaning | Cutover treatment |
| --- | --- | --- |
| `canonical` | Deterministically transformed into a PostgreSQL vNext authority entity | Import, reconcile, and preserve stable IDs |
| `archive` | Preserved as inactive historical evidence | Never reactivate sessions, host authority, leases, challenges, or credentials |
| `local_partition` | Offline work requiring account ownership and user review | Inject into an encrypted pending-review partition, never auto-commit |
| `rebuildable_cache` | Derived state reproducible from canonical authority data | Record source counts/hashes, then rebuild after import |
| `quarantine_only` | A table whose rows cannot be safely interpreted automatically | Preserve for human disposition; currently no whole table uses this class |

Invalid individual rows from any canonical table still go to record-level quarantine.

## Canonical domains

- Identity and access: `tenants`, `authority_accounts`, legacy `users` evidence, memberships, role applications/bindings/grants, and WeChat binding requests. Legacy evidence does not create active authorization by itself.
- Institution and teaching: institutions, schools, rooms, subjects, teachers, students, courses, enrollments, schedules, and grades.
- Financial and assets: payments, consumptions, asset accounts, personal asset categories, and personal asset records. PostgreSQL uses exact numeric types; migration checks amount/hour/balance aggregates.
- Question metadata: taxonomy systems/nodes, chapters, knowledge/model points, questions, versioned contents, relation tables, and import batches/items.
- Storage tasks: question assets, paper artifacts/jobs, and archive jobs. A legacy file reference is not `verified` until the destination storage agent returns a matching hash receipt.
- Audit and outbox: authorization/operation/sync/storage/delete events, outbox events, and identity provisioning receipts.
- Migration evidence: legacy ledgers, source provenance, snapshots, source metadata, and historical schema events.

## Inactive archive

The archive contains legacy host commands/receipts/epochs/heartbeats/recovery state, desktop sessions/pairing/challenges/authorizations, device grants/leases, miniapp login attempts/events/tasks, old role/device/projection mirrors, relay nonces, legacy sync authorization/delivery/device/log state, storage bindings, schema migrations, and taxonomy deletion backups.

Archive means data retention, not permission retention. Phase 3 requires cloud reauthentication and installation-key proof before creating an active account-device link.

## Local pending-review partition

`desktop_sync_batch_backups` and `sync_conflicts` are preserved for account-scoped inspection. They must not silently mutate cloud authority data.

## Rebuildable cache

Scoped projections, knowledge-point rollups, search jobs, taxonomy state, and vector embeddings are recorded by count/hash but rebuilt from canonical rows. They are never used to fill missing authority rows.

## Current readiness

The authority database is available. The configured removable `question-files` and `question-assets` logical sources are currently unavailable. The readiness policy therefore blocks a complete production import/cutover claim while allowing development of snapshot, schema, transformer, signing, and shadow-import machinery against available sources and synthetic fixtures.

## Change control

Any new source table, duplicate table entry, invalid target, missing transformer, absent aggregate invariant, or unknown catalog table fails `npm run test:vnext-shadow-import`. There is no wildcard or default disposition.
