# vNext business-foundation source-structure verification

**Status:** completed read-only physical-shape evidence. It verifies only the legacy SQLite metadata for the four already proposed foundation mappings. It is not source-row admission, target-row admission, cloud write, reconciliation, restore, cutover, or release evidence.

## Read-only method and scope

The approved legacy SQLite source was opened once with `readonly`, `fileMustExist`, and `query_only` settings in one read transaction. The fixed allow-list was exactly `tenants`, `institutions`, `schools`, and `rooms`.

For each allow-listed relation, the operation read only its `sqlite_master` table DDL plus `PRAGMA table_info`, `PRAGMA foreign_key_list`, and `PRAGMA index_list` metadata. It issued no row query, count, sample, export, update, pragma that persists to the source, filesystem write, or cloud/NAS/API request. This record omits the source path, all business rows, all identifiers, contacts, names, addresses, and notes.

The source still matches the previously recorded 99-table inventory hash:

```text
08460a7fe152f0f9d30c0abac732ee4b57355e3bbf7494024ffe68c6f9e581a2
```

## Canonical physical contracts

| Relation | DDL SHA-256 | Ordered source columns | PK | Source FKs |
| --- | --- | --- | --- | --- |
| `tenants` | `75a20bba966adf652e060fcf653870ab2fcbf9b0cb4c70323e9dc496fde55346` | `id`, `name`, `status`, `plan`, `archive_before`, `deleted`, `created_at`, `updated_at` | `id` | none |
| `institutions` | `d3e3afab7f75a6defbf3e0aafa702ca0b2cf9cf8c55f82a60cb0a0f8d6e0cf82` | `id`, `tenant_id`, `name`, `contact_person`, `contact_phone`, `revenue_share`, `notes`, `deleted`, `created_at`, `updated_at` | `id` | none |
| `schools` | `fff38fcfa9f1602c7a425c35124a38e5bc76a2ad713a50a48c9c8081da2538a3` | `id`, `tenant_id`, `name`, `count`, `deleted`, `created_at`, `updated_at` | `id` | none |
| `rooms` | `1b59707925ecb720b8b1306b1623323ac1a93bfb9af69a12386bc0d64207700a` | `id`, `tenant_id`, `name`, `address`, `count`, `deleted`, `created_at`, `updated_at` | `id` | none |

All four relations have a SQLite `TEXT` primary key. `name`, `created_at`, and `updated_at` are the only columns marked `NOT NULL` in every relation; the source's `tenant_id` columns are nullable/defaulted text and the source declares no foreign key for them. The cloud target's nonblank tenant foreign keys are therefore a future migration-admission rule, not a claim about legacy database enforcement.

The source has ordinary lookup indexes in addition to the primary-key index. Those indexes are source implementation detail: they are neither copied as target DDL nor treated as a source identity or authorization rule.

## Mapping-field comparison

The exact source-field keys in the four reviewed proposed contracts in `migration/vnext/sourceTableCatalog.js` match the four ordered column sets above, without an omitted or invented field:

| Relation | Existing transformer | Dependency order | Physical field-set result |
| --- | --- | --- | --- |
| `tenants` | `legacy_tenant_v1` | 1 | exact match |
| `institutions` | `legacy_institution_v1` | 2 | exact match |
| `schools` | `legacy_school_v1` | 3 | exact match |
| `rooms` | `legacy_room_v1` | 4 | exact match |

The target names `legacy_*` in those contracts deliberately express a proposed preservation mapping. They do not prove a legacy value is valid, safe to expose, or semantically equivalent to a current cloud business field.

## What remains blocked

Physical shape agreement does **not** prove stable-ID value quality, tenant resolution, boolean encoding, timestamp parsing/order, `revenue_share` decimal semantics, `count` semantics/range, duplicate behavior, PII classification, or row-level reconciliation. It also does not authorize the existing synthetic shadow executor to receive real rows.

Before any real foundation shadow batch, a separate reviewed value-semantics and privacy contract must use the immutable source snapshot, emit only redacted aggregate outcomes, fail closed to the admission quarantine model, and prove no source change before/after. Production RDS, NAS, desktop API wiring, cutover, and release remain prohibited.
