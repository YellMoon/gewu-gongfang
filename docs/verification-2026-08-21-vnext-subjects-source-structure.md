# vNext `subjects` source-structure verification

**Status:** completed read-only structural evidence. This is not a field mapping, target-DDL admission, row admission, shadow import, cloud write, or release.

## Read-only boundary

The already approved legacy desktop source was opened with SQLite `readonly`, `fileMustExist`, and `query_only` settings inside one read transaction. The operation read only inventory metadata and the `sqlite_master` DDL record for `subjects`; it emitted no business rows, identifiers, names, grade values, credentials, paths, configuration, or media references. It created, renamed, moved, uploaded, and deleted nothing.

## Baseline agreement

| Check | Result |
| --- | --- |
| Whole-source inventory hash | `08460a7fe152f0f9d30c0abac732ee4b57355e3bbf7494024ffe68c6f9e581a2` |
| Expected baseline inventory hash | `08460a7fe152f0f9d30c0abac732ee4b57355e3bbf7494024ffe68c6f9e581a2` |
| Relations | `99` |
| SQLite `quick_check` | `ok` |
| Foreign-key violations | `0` |
| `subjects` row count | `0` |

The matching whole-source hash proves this inspection observed the same logical source inventory as the previously recorded read-only baseline. It does not approve importing any row from any relation.

## Exact `subjects` structural contract

The reviewed SQLite DDL string has SHA-256:

```text
81afce36c6d8e6c2dac23e6df8d7bc4494abf8277b7b978c3498931d561616d8
```

```sql
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  name TEXT NOT NULL,
  grade_level TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

SQLite metadata reports `id` as the only primary-key column and reports no foreign keys for this relation. The source has no `subjects` rows, so the inspection intentionally makes **no** claim about real values, default usage, tenant assignment, deletion encoding, timestamps, grade hierarchy, locale, or subject semantics.

## Consequences

This evidence closes only the source-shape prerequisite from the `subjects` admission design. It does not close any of the following requirements:

- a reviewed source-to-target field mapping, stable-ID preservation rule, transformer, or dependency order;
- proof that `tenant_id` can resolve to an admitted cloud tenant without invented defaults;
- canonical boolean and UTC timestamp parsing from real values;
- a decision that `grade_level` needs no parent grade, school, curriculum, locale, or version relation;
- target DDL, ownership/ACL, zero-seed catalog proof, synthetic batch admission, reconciliation, restore, cutover, or release.

`subjects` therefore remains `canonical` and `unmapped` in `migration/vnext/sourceTableCatalog.js`. No source or cloud row may be written from this evidence.
