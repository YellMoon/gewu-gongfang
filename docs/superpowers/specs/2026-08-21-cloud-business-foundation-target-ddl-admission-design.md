# Cloud business foundation target-DDL admission design

**Status:** the four-table target-DDL foundation is implemented and verified only in a local disposable PostgreSQL 17 target with an independent `business` DDL ledger. It is not a deployed schema, source-row admission, shadow import, restore, rollback, or release evidence.

## Purpose and boundary

This design is the next admission gate for the first four already reviewed legacy-source mapping contracts:

1. `tenants`
2. `institutions`
3. `schools`
4. `rooms`

It defines only the future cloud `business` schema shape needed by those contracts. The cloud is the sole writable authority for applicable business data. NAS or the storage agent may hold rich-media bytes, import originals, generated artifacts, and backups, but never a second writable business database.

This document authorized only the bounded local implementation of its empty four-table DDL foundation: a disposable PostgreSQL 17 container, a separate `business` schema and DDL ledger, exact catalog/ACL/zero-seed tests, and no source rows. It does not authorize RDS creation, source-row reads, canonical export, importer code, seed data, an application business writer, or a cutover. It also does not admit users, teachers, students, schedules, financial records, assets, question-bank data, sessions, credentials, or any legacy device state.

## Identity, ordering, and deletion rules

The four future relations use lower-case, unquoted names under a dedicated `business` schema. The legacy text primary key is preserved exactly as the target `id`; no name-based matching or newly generated replacement identity is allowed during migration.

`tenants` is the only root. `institutions`, `schools`, and `rooms` each retain only their reviewed source `tenant_id` relationship and must have a foreign key to `business.tenants(id)`. No relationship from a school or room to an institution is proposed because the reviewed source contract has no such source field. Every tenant foreign key receives a supporting index.

The old `deleted` flag is retained as a non-authorizing `legacy_deleted` business-history field. This is not a hard delete, does not activate or deactivate an account, and cannot substitute for authorization, device, session, or reauthentication state. Source timestamps must pass canonical UTC parsing before any future admission; invalid or ambiguous values are quarantined, never silently repaired.

## Proposed relation contracts

All `id` and `tenant_id` values are nonblank `text`; names, addresses, notes, and contact fields are `text`; exact money/ratio values use `numeric`; legacy counts use `integer`; timestamps use `timestamptz`; and deletion state is a strict boolean converted only from a future reviewed canonical boolean input. Requiredness below is a future source-admission rule, not a claim that every current source row already satisfies it.

### `business.tenants`

| Target column | Proposed type | Source field | Rule |
| --- | --- | --- | --- |
| `id` | `text` primary key | `id` | Preserve exact stable text identity. |
| `name` | nonblank `text` | `name` | Required business label. |
| `legacy_status` | `text` | `status` | Preserve only; no access decision may read it. |
| `legacy_plan` | nullable `text` | `plan` | Preserve only; no billing or entitlement inference. |
| `legacy_archive_before` | nullable `timestamptz` | `archive_before` | Canonical UTC parse or quarantine. |
| `legacy_deleted` | `boolean` | `deleted` | Strict canonical boolean or quarantine. |
| `created_at` | `timestamptz` | `created_at` | Canonical UTC parse. |
| `updated_at` | `timestamptz` | `updated_at` | Canonical UTC parse; must not precede `created_at`. |

### `business.institutions`

| Target column | Proposed type | Source field | Rule |
| --- | --- | --- | --- |
| `id` | `text` primary key | `id` | Preserve exact stable text identity. |
| `tenant_id` | nonblank `text` FK | `tenant_id` | Must resolve to an admitted tenant. |
| `name` | nonblank `text` | `name` | Required business label. |
| `contact_person_legacy` | nullable `text` | `contact_person` | Business contact metadata only. |
| `contact_phone_legacy` | nullable `text` | `contact_phone` | Business contact metadata only; never login, recovery, or reauthentication evidence. |
| `revenue_share` | nullable `numeric` | `revenue_share` | Exact decimal parse or quarantine. |
| `notes` | nullable `text` | `notes` | Preserve without interpretation. |
| `legacy_deleted` | `boolean` | `deleted` | Strict canonical boolean or quarantine. |
| `created_at` | `timestamptz` | `created_at` | Canonical UTC parse. |
| `updated_at` | `timestamptz` | `updated_at` | Canonical UTC parse; must not precede `created_at`. |

### `business.schools`

| Target column | Proposed type | Source field | Rule |
| --- | --- | --- | --- |
| `id` | `text` primary key | `id` | Preserve exact stable text identity. |
| `tenant_id` | nonblank `text` FK | `tenant_id` | Must resolve to an admitted tenant. |
| `name` | nonblank `text` | `name` | Required business label. |
| `legacy_count` | nullable `integer` | `count` | Exact integral parse or quarantine; do not infer its meaning. |
| `legacy_deleted` | `boolean` | `deleted` | Strict canonical boolean or quarantine. |
| `created_at` | `timestamptz` | `created_at` | Canonical UTC parse. |
| `updated_at` | `timestamptz` | `updated_at` | Canonical UTC parse; must not precede `created_at`. |

### `business.rooms`

| Target column | Proposed type | Source field | Rule |
| --- | --- | --- | --- |
| `id` | `text` primary key | `id` | Preserve exact stable text identity. |
| `tenant_id` | nonblank `text` FK | `tenant_id` | Must resolve to an admitted tenant. |
| `name` | nonblank `text` | `name` | Required business label. |
| `address_legacy` | nullable `text` | `address` | Preserve only; no geocoding or normalization. |
| `legacy_count` | nullable `integer` | `count` | Exact integral parse or quarantine; do not infer its meaning. |
| `legacy_deleted` | `boolean` | `deleted` | Strict canonical boolean or quarantine. |
| `created_at` | `timestamptz` | `created_at` | Canonical UTC parse. |
| `updated_at` | `timestamptz` | `updated_at` | Canonical UTC parse; must not precede `created_at`. |

## PII, isolation, and migration prerequisites

The two legacy contact columns are restricted business metadata. `contact_person_legacy`, `contact_phone_legacy`, and `notes` (which can contain personal data) are excluded by default from ordinary runtime access, generic `SELECT` grants, API projections, logs, errors, audit/outbox payloads, and exports. They may be read only through a future separately approved, minimum-privilege field projection. They are not identity factors and cannot be copied into future account, verified-contact, session, device, recovery, or reauthentication relations. Future role and application access is tenant-scoped, but tenant scope alone is not permission to read these fields; the exact runtime role, RLS, and API authorization contract is deferred to its own DDL and deployment admission. This design grants no database privilege.

The eventual migration mechanism must introduce a separate batch/ledger/quarantine model before importing any row. It must record the immutable bundle identity, source stable identity, canonical row hash, target row identity, reconciliation result, and restore/rollback receipt in the same bounded transaction. A source row is admitted only after exact field parsing, tenant dependency validation, duplicate/identity conflict detection, and batch isolation have all passed.

## Required evidence before source admission

The first condition below is now satisfied only for the local disposable DDL foundation. The remaining conditions are still required before any source row, shadow import, RDS target, or release work:

1. **Completed locally only:** a disposable PostgreSQL 17 target-DDL test proves fresh apply/reapply, exact columns, primary keys, tenant FKs, supporting indexes, nullability, check constraints, PII column restrictions, independent ledger append-only guards, control-plane isolation, and zero seed rows. It does not prove a production target or authorize a row write.
2. A separately approved migration-batch/ledger/quarantine design proves no target row can be written without a traceable batch and canonical-row hash.
3. Synthetic source-admission tests prove malformed timestamps, booleans, decimals, integers, blank IDs, duplicate identities, missing tenants, and invalid timestamp ordering fail closed into quarantine.
4. A shadow-import test proves source-to-target count, stable-key set, and canonical logical hash reconciliation, then proves restore and rollback on disposable targets only.
5. Production RDS creation, credentials, roles, backup/PITR configuration, actual source export, user data, question-bank data, NAS reads, and cutover remain separately authorized gates.
