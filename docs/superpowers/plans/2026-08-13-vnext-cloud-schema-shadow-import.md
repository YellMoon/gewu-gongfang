# Cloud Authority vNext Phase 2: Schema and Shadow Import Plan

> **Execution policy:** The primary agent implements serially. Each task starts with a failing test, ends with focused verification and an atomic commit, then Phase 2 receives primary self-audit and independent GPT-5.6-sol/high review before Phase 3.

**Goal:** Convert the verified legacy SQLite/file inventory into recoverable, signed, canonical migration inputs; create an isolated PostgreSQL 17 cloud-authority schema; import twice into a clean shadow environment without duplicates; and prove data, aggregate, file-reference, restore, and rollback invariants without touching production writers.

**Target:** PostgreSQL 17.x is the target cloud authority. It is supported upstream through November 2029 and is more established than PostgreSQL 18 for this migration. Alibaba Cloud provisioning remains deferred until the current RDS console offering, region, backup/PITR settings, and cost are explicitly verified. Development, shadow/staging, and production must use separate databases, credentials, signing keys, object prefixes, and migration batch namespaces. A schema name alone is not sufficient production isolation.

**Architecture:** Keep legacy SQLite immutable. Use SQLite online backup to a new external snapshot, verify source/snapshot consistency, export deterministic typed NDJSON, sign the closed bundle with an explicit Ed25519 migration key, classify every old table, and import through canonical adapters into PostgreSQL schemas. The importer writes an append-only migration ledger and quarantine records in the same transaction as target rows. No long-lived dual write and no production client traffic are allowed in Phase 2.

**PostgreSQL design rules:** lowercase identifiers; `text` unless a real length constraint exists; `timestamptz`; exact `numeric` for money/hours; explicit booleans and check constraints; stable legacy IDs retained as text; new distributed IDs use sortable text/UUIDv7 only when the platform supports it; every foreign key has a supporting index; application roles are least-privilege and never superuser; atomic `insert ... on conflict`; short transactions with timeouts; bulk import uses bounded batches/COPY while preserving per-record ledger outcomes.

---

## Task 1: Freeze the source-to-target data contract

**Files:**

- Create `migration/vnext/source-table-catalog.json`
- Create `migration/vnext/sourceTableCatalog.js`
- Create `migration/vnext/sourceTableCatalog.test.js`
- Create `docs/vnext-source-data-dictionary.md`

**Steps:**

1. Write a failing test that loads the redacted 99-table Phase 1 inventory fixture and requires every table to have exactly one disposition: `canonical`, `archive`, `local_partition`, `rebuildable_cache`, or `quarantine_only`.
2. Require canonical entries to declare target schema/entity, stable-ID strategy, dependency order, transformer ID, aggregate invariants, and file-reference fields where applicable.
3. Require archive/cache entries to provide a reason and forbid an active target entity.
4. Classify identity/access, school/teacher/student, course/scheduling/payment/consumption/assets, question/taxonomy, storage/file jobs, audit/outbox, old host/control-plane, sync/cache, and vector/search tables.
5. Generate a human-readable data dictionary from the catalog and Phase 1 structural metadata; include no row values, absolute paths, credentials, or private hashes.
6. Gate Phase 2 if a newly discovered source table is unclassified or a critical source is unavailable.

## Task 2: Create recoverable SQLite snapshots

**Files:**

- Create `scripts/vnext-migration/sqliteSnapshot.js`
- Create `scripts/vnext-migration/sqliteSnapshot.test.js`
- Extend `scripts/vnext-migration/cli.js` and exact test script

**Steps:**

1. Write tests for `better-sqlite3` online backup into a brand-new external `.partial` snapshot, including a concurrent WAL writer.
2. Verify `quick_check`, foreign keys, table counts, primary-key sets, and canonical row hashes between the established source read snapshot and completed backup.
3. Atomically rename only after read-back verification; never checkpoint, copy, rename, or delete the source DB/WAL/SHM.
4. Reject source/output overlap, reparse ancestors, existing outputs, interrupted partials, insufficient space, and source schema changes during the operation.
5. Add `snapshot` CLI output containing only redacted IDs and hashes.

## Task 3: Export deterministic canonical records

**Files:**

- Create `migration/vnext/canonicalTypes.js`
- Create `migration/vnext/transformers/*.js`
- Create `scripts/vnext-migration/canonicalExport.js`
- Create corresponding tests and fixtures

**Steps:**

1. Define typed canonical values that preserve null, boolean, 64-bit integer, exact decimal, timestamp/timezone, text, JSON, and BLOB references without JavaScript precision loss.
2. Export from the verified snapshot, never the live source. Use stable primary-key order and bounded NDJSON chunks.
3. Preserve stable business IDs. Normalize phone/contact values only as evidence fields; never auto-merge on names, nicknames, schools, or handwritten WeChat IDs.
4. Convert active business records through explicit transformers. Export old sessions/tokens/challenges/host epochs/host keys only to encrypted archive metadata and never as active credentials.
5. Put ambiguous identities, duplicate stable IDs, invalid numerics/timestamps, dangling references, and unsupported rows in quarantine with deterministic reason codes.
6. Emit source-row count/hash, canonical-row count/hash, excluded/quarantined count, and record-level ledger entries.

## Task 4: Close and sign migration bundles

**Files:**

- Create `scripts/vnext-migration/bundleSignature.js`
- Extend bundle protocol/writer/verifier and tests
- Update runbook

**Steps:**

1. Require an explicit Ed25519 signing key supplied outside the repository. Store only algorithm, public key, key fingerprint, payload hash, and signature in the bundle.
2. Pin allowed migration public-key fingerprints in each isolated environment; a checksum rewrite without a valid signature must fail.
3. Close the file set over snapshot metadata, canonical chunks, inventory, ledger, unresolved/quarantine, and checksums before signing.
4. Encrypt any bundle containing business rows at rest with a separate explicit key; do not log or commit keys.
5. Add signature tamper, wrong-key, missing-key, replayed-bundle-ID, and modified-checksum tests.

## Task 5: Define PostgreSQL 17 authority schema

**Files:**

- Create `cloud-vnext/migrations/0001_extensions_roles.sql`
- Create `cloud-vnext/migrations/0002_identity_access.sql`
- Create `cloud-vnext/migrations/0003_business.sql`
- Create `cloud-vnext/migrations/0004_question_storage.sql`
- Create `cloud-vnext/migrations/0005_audit_outbox_migration.sql`
- Create `cloud-vnext/schemaContract.js` and tests

**Steps:**

1. Create separate schemas: `identity`, `access`, `business`, `question`, `storage`, `audit`, and `migration`.
2. Model tenant/institution boundaries, accounts/profiles/verified contacts/external identities, roles/capabilities/scopes, devices/installations/account links, and recent-auth evidence.
3. Model school/room/teacher/student/course/enrollment/schedule/payment/consumption/personal assets while preserving stable legacy IDs and exact financial/hour types.
4. Model question metadata/content versions/taxonomy/knowledge links/import batches, file objects/versions/storage locations/jobs/receipts, and paper artifacts.
5. Model append-only audit, transactional outbox, import batch/record ledger, quarantine, source snapshots, and restore receipts.
6. Add uniqueness, checks, foreign keys, foreign-key indexes, row versions, immutable audit triggers, least-privilege roles, statement/lock timeouts, and environment/batch guards.
7. Test the SQL against a real PostgreSQL 17 disposable database. Static string tests alone do not satisfy this task.

## Task 6: Implement idempotent shadow importer

**Files:**

- Create `cloud-vnext/src/db.js`
- Create `cloud-vnext/src/migration/shadowImporter.js`
- Create `cloud-vnext/src/migration/reconcilers/*.js`
- Create integration tests

**Steps:**

1. Accept only a valid signed bundle, an allowed environment, an empty/new shadow batch, and a pinned schema version.
2. Acquire a migration advisory lock and reject concurrent imports for the same authority/batch.
3. Import in dependency order using bounded transactions and atomic upserts keyed by source identity and canonical hash.
4. Write target row and migration ledger atomically. A same-ID/same-hash replay is a no-op; same-ID/different-hash is quarantine/fail-closed, never last-write-wins.
5. Do not activate users/devices/roles solely from legacy control-plane evidence. Preserve evidence for Phase 3 review.
6. Do not register file objects as verified until the storage copy and destination hash receipt exist.

## Task 7: Prove shadow import, restore, and rollback

**Files:**

- Create `cloud-vnext/src/migration/shadowVerification.js`
- Create `scripts/vnext-shadow-rehearsal.js`
- Create `docs/verification-<date>-vnext-shadow-import.md`

**Steps:**

1. Import the same signed canonical bundle twice into a clean disposable PostgreSQL 17 shadow database; prove the second pass creates zero target rows and zero duplicate ledgers.
2. Compare source/canonical/target counts, stable primary-key sets, canonical hashes, foreign keys, uniqueness, monetary/hour/asset aggregates, question relations, and file references.
3. Demonstrate fail-closed behavior for every quarantine and unavailable critical source. The currently disconnected removable question source blocks a claim of complete production migration.
4. Back up the empty/schema and imported shadow databases, restore into new disposable databases, rerun verification, and record restore receipts.
5. Generate a rollback plan: production remains untouched; delete only explicitly marked disposable shadow databases after their verified backups and exact names are recorded.

## Task 8: Phase 2 review gate

1. Run exact unit, PostgreSQL integration, snapshot, signature, importer, restore, and legacy safety tests.
2. Primary agent audits requirements against evidence and fixes findings.
3. Commit and push to `gewu/master`; do not publish desktop OSS because no runtime client has switched yet.
4. Ask GPT-5.6-sol/high for an independent read-only audit of data loss, schema constraints, transaction/idempotency, signature trust, quarantine, backup/restore, and documentation claims.
5. Reproduce and resolve valid findings, rerun the whole Phase 2 gate, and update the roadmap.

## Phase 2 completion gate

Phase 2 is complete only when every discovered source table is classified; all critical sources are available or explicitly block cutover; a recoverable verified source snapshot exists; canonical row exports are deterministic and signed; PostgreSQL 17 migrations run on a real disposable server; two imports are idempotent; all invariants and quarantines reconcile; empty and imported backups restore successfully; no production writer/data was changed; and both primary and independent audits have resolved findings.
