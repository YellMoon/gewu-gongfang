# `subjects` curriculum-reference target-DDL admission design

**Status:** design-only, fail-closed. `subjects` remains a canonical but **unmapped** legacy-source candidate. This document does not authorize target DDL, a source-field mapping, a migration-admission batch, a shadow write, source-path access, or a real-data read.

## Purpose and limited choice

`subjects` is the smallest remaining candidate that could become a cloud business-reference root after `business.tenants`: it is not an account, profile, credential, device, session, role, capability, scope, monetary record, question body, or media object. It could later support course references and structured question-bank taxonomy without moving NAS media bytes into the business database.

This is deliberately a **single-relation** admission decision. The checked-in bootstrap schema describes `chapters` as having a `subject_id` dependency, so it remains out of scope until its own source contract is independently approved; all other canonical relations remain out of scope for their own dependency, privacy, financial, or authority reasons.

## Current evidence and no-go boundary

The checked-in legacy bootstrap schema at `backend/src/schema.sql` describes a table named `subjects` with candidate columns `id`, `tenant_id`, `name`, `grade_level`, `deleted`, `created_at`, and `updated_at`. That file is a development artifact, not proof that the user-specified historical source has the same table, columns, types, values, key set, tenant semantics, or timestamp semantics.

Accordingly, the following are not allowed yet:

- changing `migration/vnext/sourceTableCatalog.js` to mark `subjects` as mapped;
- adding a `business.subjects` relation, a business-ledger entry, seed rows, a catalog assertion, or a migration writer;
- making a synthetic shadow-admission fixture for `subjects`;
- reading, fingerprinting, opening, exporting, hashing, or scanning `D:\新建文件夹\gewu-gongfang`;
- treating a subject name, grade label, or the legacy `deleted` value as an authorization, identity, account, role, scope, session, or reauthentication fact.

The existing four-table foundation and its synthetic shadow proof stay unchanged. This decision creates no compatibility promise for an additional relation.

## Required evidence before target-DDL admission

All of the following must be independently recorded and verified before a later design may authorize even empty disposable DDL:

1. An approved static source-table contract for `subjects`, anchored to an exact reviewed source schema/DDL fingerprint rather than only the bootstrap schema above. It must name the exact source columns, source primary-key form, requiredness, and SQLite type/affinity behavior.
2. A reviewed field mapping with exact source-to-target values, a stable-ID rule, a transformer identifier, dependency order, invariants, file-reference declaration, and rollback/reconciliation proof. A name-derived ID, generated replacement ID, or implicit default tenant is prohibited.
3. A tenancy decision proving how each nonblank source `tenant_id` maps to an already admitted `business.tenants(id)` value. Missing, ambiguous, blank, or cross-tenant references must be quarantined; they must never be silently repaired.
4. A canonical parsing contract for `deleted`, `created_at`, and `updated_at`: boolean representation, finite UTC timestamps, and `updated_at >= created_at`. Unknown or ambiguous encodings must be quarantined, not normalized by guesswork.
5. A data-classification decision for `name` and `grade_level`, including log, audit, export, API, and tenant-scoped read rules. Neither field is currently approved as a credential, identifier for matching a person, or cross-tenant lookup key.
6. A proof that subject semantics do not need a parent curriculum, school, grade-system, locale, or version relation before they can be represented safely. If any such parent is required, this single-table admission is no-go and the dependency must be designed first.

Only after these six items can a separate target-DDL admission propose types, constraints, indexes, ownership, and column-level read permissions. Only after that later DDL has its own disposable catalog/ACL/zero-seed proof may a separate batch/row-ledger/reconciliation design consider synthetic rows.

## Future cloud and NAS boundary

If later admitted, the target belongs to the cloud `business` authority and is limited to structured curriculum-reference metadata. It does not hold question text, explanations, answer keys, source documents, media bytes, media paths, import originals, generated papers, or backups.

Question-bank rich media, import originals, generated artifacts, and backups remain NAS/storage-proxy responsibilities. The future subject relation may refer only to independently admitted immutable object metadata; it never grants a desktop, mini-program, storage proxy, or database role direct NAS write access.

## Explicit exclusions for this slice

- `chapters`, knowledge points, questions, question contents, question assets, taxonomy, embeddings, and every other question-bank relation;
- `users`, `teachers`, `students`, profile bindings, verified contacts, roles, capabilities, scopes, sessions, devices, recovery, and reauthentication;
- courses, schedules, enrollments, grades, payments, consumptions, personal assets, and all business writers;
- real source reads, RDS, Alibaba Cloud resources, APIs, desktop runtime integration, NAS access, deployment, cutover, restore, or release.

## Stop condition

After saving this design, the correct state is **WAIT** for an independently approved, exact static source-field contract. The next operation must not be a speculative DDL implementation or a broader mapping pass merely to create momentum.
