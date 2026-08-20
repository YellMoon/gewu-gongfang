# vNext Legacy Source Inventory and Snapshot Evidence

**Status:** completed read-only baseline; not an import or cutover.

## Scope and safety boundary

The owner approved one legacy desktop root as a read-only source. Its path, configuration values, business rows, and credentials are intentionally omitted from this record. No source file, WAL, SHM, configuration file, NAS path, or desktop profile was written, moved, renamed, or deleted.

The inventory opened the designated `scheduling.db` source in SQLite read-only/query-only mode and used one read transaction. The snapshot used SQLite online backup into a separate local migration workspace outside the repository. The snapshot is not checked into Git, uploaded, or treated as a cloud import.

## Verified baseline

| Check | Result |
| --- | --- |
| SQLite `quick_check` | `ok` |
| Foreign-key violations | `0` |
| Relations | `99` |
| Total source rows | `2,551` |
| Source inventory hash before/after snapshot | `08460a7fe152f0f9d30c0abac732ee4b57355e3bbf7494024ffe68c6f9e581a2` |
| Snapshot file hash | `e5653c797c1dec544b83fe1c137d23ae398a0e8c9f548cd27f51bd1c8fc0ddae` |

The online-backup verification compared every table's row count, primary-key set hash, and canonical row-set hash against the snapshot. The subsequent source inventory hash remained identical.

## Structural observations requiring disposition

These counts are structural evidence only. They neither expose content nor approve a target mapping.

| Source family | Observed non-empty relations | Required disposition now |
| --- | --- | --- |
| Core teaching/scheduling | institutions `4`, schools `15`, rooms `15`, teachers `1`, students `60`, courses `57`, schedules `589` | classify and map before any shadow import |
| Question-labelled | questions `80`, question_contents `80`, question_assets `911` | quarantine pending provenance, structured-text/media split, and canonical mapping |
| Personal assets | asset_accounts `0`, personal_asset_categories `0`, personal_asset_records `0` | record as currently absent; do not synthesize or discover another private source |
| Legacy authority/session/sync | present as schema, mostly empty | archive or rebuild by current cloud sign-in/device-registration contract; never revive as active credentials |

The owner reported that the selected root should contain no question-bank or asset source data. The observed question-labelled rows are therefore an evidence mismatch, not an authorization to migrate them. They remain quarantined until an explicit source-table catalog establishes whether they are real structured question content, media references, cache/import residue, or another noncanonical artifact.

## Next gate

Before any cloud write or shadow import, create a complete source-table catalog for all 99 relations. Each relation must have one explicit disposition and, where canonical, a field-level mapping, stable-ID rule, dependency order, invariant set, target entity, and rollback proof. A clean disposable PostgreSQL shadow target is required; production RDS remains untouched.
