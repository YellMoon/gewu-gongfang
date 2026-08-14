# vNext PostgreSQL 17 control-plane semantic mapping design

## Purpose and status

This design defines the next target-engine checkpoint after the owner-approved production-database decision. It maps the tested SQLite V5 control-plane semantics into PostgreSQL 17 and defines the disposable integration-test runtime that will prove the mapping. It does not create PostgreSQL DDL, install dependencies, start Docker, connect to RDS/ECS, access `D:\新建文件夹`, access NAS/removable storage, or import any real row.

The existing `shared/vNextControlPlaneReferenceKernel.js` and its reference writers remain the semantic oracle. They are not a migration source and are not replaced by this design.

## Target database boundary

The target is one dedicated PostgreSQL database named by the deployment manifest for vNext control-plane use only. All identifiers are unquoted lowercase snake case. It contains exactly these control-plane relations:

- schema metadata and migration ledger;
- authorities, accounts, verified contacts, role grants, capability catalog/overrides, data scope grants, and opaque profile bindings;
- trusted devices, device installations, account-device links, sessions, and reauthentication events;
- authorization command receipts, audit events, outbox events, and policy publications;
- bootstrap consumptions and trust-root evidence.

The target must not contain desktop business tables, question-bank content or assets, personal assets, file-object lifecycle records, NAS locators, removable-drive paths, old credential/token/session/challenge values, or any legacy cloud projection. Existing SQLite database files remain untouched.

## Common representation rules

| Semantic | PostgreSQL 17 representation | Contract |
| --- | --- | --- |
| Stable IDs | `text COLLATE "C"` with `NOT NULL` and `btrim(value) <> ''` unless the V5 source explicitly permits nullable evidence | Every opaque ID, actor key, idempotency key, capability ID, reason code, and hash comparison uses deterministic `C` equality/order. Do not convert IDs into UUIDs or normalize case. |
| Versions | `bigint` with `>= 1` (or nullable/`>= 0` only where V5 permits create-CAS) | Node binds/reads every version as `bigint`/decimal string, never a JavaScript `Number`; values outside the signed 64-bit range fail before SQL. |
| Instants | `timestamptz` normalized to UTC | Writers accept only canonical RFC3339 UTC instants, reject `infinity`/`-infinity`, and set the transaction `TimeZone` to UTC. Database comparisons never use text lexical ordering. |
| SHA-256 | `text` with `^[0-9a-f]{64}$` check under `COLLATE "C"` | Hashes are lower-case ASCII only. BLOB/bytea and upper-case strings are rejected. |
| Canonical JSON | canonical JSON `text` plus its SHA-256 | PostgreSQL `jsonb` is not used in the first target schema because it is not the canonical byte source: it reorders keys and can collapse duplicate-key input. Trusted writers validate exact shape, canonical text, and hash equality before insert. |
| Lifecycle status | closed text enum/check domains plus state/time checks | Use `CHECK` for row-local facts and trigger functions for facts that require reading another row. |

No database default may manufacture an authority, a super-admin, a policy publication, a credential, a session, a receipt, or an implicit current time for a security-relevant command. The trusted writer supplies validated values and records them in the same transaction.

## Constraint and schema manifest

The implementation will produce a checked-in manifest with an ordered migration ledger, relation definitions, constraints, partial unique indexes, trigger-function source hashes, and public catalog assertions. The manifest is exact at the semantic level; it is not a byte-for-byte translation of SQLite `sqlite_master` text. No target relation, column, nullable field, constraint, index, trigger family, or trigger function may be added or omitted without a new ADR and a migration checksum.

### Exact V5 relation map

Target relation names are the lower-case version of the V5 source name. Every listed column is required unless its nullable set says otherwise. Primary keys, composite keys, and the following checks are carried unchanged in meaning; `text` time columns become the `timestamptz` representation defined above.

| Source to target relation | Exact columns; nullable columns | Keys, checks, indexes, and trigger family |
| --- | --- | --- |
| `vNext_schema_meta` → `vnext_schema_meta` | `schema_key,schema_version,applied_at`; none | singleton `schema_key='control-plane-reference'`; V5 source version is `5`; target adds no implicit upgrade. |
| **new approved target-only** `vnext_schema_migrations` | `migration_id,semantic_version,manifest_sha256,applied_at,applied_by`; none | PK `migration_id`; unique strictly increasing `semantic_version`; lower-case SHA-256 check; append-only no-update/no-delete triggers; catalog assertion includes this ledger. |
| `vNext_authorities` → `vnext_authorities` | `authority_id,status,created_at,updated_at`; none | PK authority; closed status; updated not before created. |
| `vNext_accounts` → `vnext_accounts` | `account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at`; none | PK account; unique `(account_id,authority_id)`; FK authority; all versions positive. |
| `vNext_verified_contacts` → `vnext_verified_contacts` | `contact_id,authority_id,account_id,contact_type,normalized_value_hash,verification_state,verification_evidence_hash,verified_at,revoked_at,row_version,created_at,updated_at`; `verified_at,revoked_at` | PK contact; unique authority/type/hash; composite account FK; verified/revoked time-state check. |
| `vNext_role_grants` → `vnext_role_grants` | `grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,ends_at,revoked_at,granted_by_account_id,created_at,updated_at`; `ends_at,revoked_at,granted_by_account_id` | PK grant; account/grantor composite FKs; role/status/time checks; partial unique active `(authority_id,account_id,role)`. |
| `vNext_capability_catalog` → `vnext_capability_catalog` | `capability_id,status,surface_mask,created_at`; none | PK capability; active/retired check. |
| `vNext_capability_overrides` → `vnext_capability_overrides` | `override_id,authority_id,account_id,capability_id,effect,status,starts_at,ends_at,row_version,created_at,updated_at,revoked_at`; `ends_at,revoked_at` | PK override; composite account FK and capability FK; lifecycle/time checks; partial unique active `(authority_id,account_id,capability_id)`. |
| `vNext_data_scope_grants` → `vnext_data_scope_grants` | `scope_grant_id,authority_id,account_id,scope_type,scope_value_hash,effect,status,starts_at,ends_at,row_version,created_at,updated_at,revoked_at`; `ends_at,revoked_at` | PK scope grant; composite account FK; five closed scope types; lifecycle/time checks; partial unique active `(authority_id,account_id,scope_type,scope_value_hash)`. |
| `vNext_profile_bindings` → `vnext_profile_bindings` | `binding_id,authority_id,account_id,profile_type,profile_id,status,evidence_hash,row_version,created_at,updated_at,revoked_at`; `revoked_at` | PK binding; composite account FK; lifecycle checks; partial unique active account/type and active profile identity. |
| `vNext_trusted_devices` → `vnext_trusted_devices` | `device_id,authority_id,status,hardware_evidence_hash,risk_code,credential_version,risk_version,row_version,created_at,updated_at,revoked_at`; `hardware_evidence_hash,risk_code,revoked_at` | PK device; unique `(device_id,authority_id)`; authority FK; lifecycle/version checks. |
| `vNext_device_installations` → `vnext_device_installations` | `installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at,revoked_at`; `revoked_at` | PK installation; composite device FK; unique installation/device/authority and authority/fingerprint; lifecycle/version checks. |
| `vNext_account_device_links` → `vnext_account_device_links` | `link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at,revoked_at`; `revoked_at` | PK link; composite account/device/installation FKs; unique authority/account/installation and full tuple; lifecycle/version checks. |
| `vNext_sessions` → `vnext_sessions` | `session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,revoked_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at`; `revoked_at` | PK session; unique `(session_id,authority_id)` for reauth FK; composite parent FKs; expiry/version/status checks; parent-state insert guard, identity-immutable, lifecycle-monotonic, and no-delete trigger families. |
| `vNext_recent_reauthentication_events` → `vnext_recent_reauthentication_events` | `reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at`; none | PK event; composite session FK; online/current parent and time/vector insert guard; no-update/no-delete triggers. |
| `vNext_authorization_command_receipts` → `vnext_authorization_command_receipts` | `receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version,created_at`; `actor_account_id,expected_row_version,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version` | PK receipt; unique receipt/authority and authority/actor/idempotency; authority/actor composite FKs; exact JSON guard where consumed; no-update/no-delete triggers. |
| `vNext_authorization_outbox_events` → `vnext_authorization_outbox_events` | `event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at`; none | PK event; unique authority/receipt/event/aggregate; authority/receipt composite FKs; exact JSON guard where consumed; no-update/no-delete triggers. |
| `vNext_authorization_policy_publications` → `vnext_authorization_policy_publications` | `publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at`; none | PK publication; unique authority/revision and authority/receipt; `policy_contract_version=1`; authority/receipt composite FKs; contiguous revision/receipt linkage/unchanged-adjacent insert guard; no-update/no-delete triggers. |
| `vNext_authorization_audit_events` → `vnext_authorization_audit_events` | `event_id,authority_id,receipt_id,reason_code,context_sha256,created_at`; none | PK event; unique authority/receipt; authority/receipt composite FKs; no-update/no-delete triggers. |
| `vNext_bootstrap_consumptions` → `vnext_bootstrap_consumptions` | `marker_key,bootstrap_intent_id,authority_id,installation_key_fingerprint,policy_manifest_sha256,receipt_id,consumed_at`; none | PK fixed marker; unique authority, intent, and receipt; **zero foreign keys**; exact accepted bootstrap-receipt insert guard; no-update/no-delete triggers. |
| `vNext_trust_root_evidence` → `vnext_trust_root_evidence` | `evidence_id,authority_id,receipt_id,actor_kind,event_id,assertion_evidence_sha256,backup_id,backup_manifest_sha256,created_at`; `backup_id,backup_manifest_sha256` only for deployment bootstrap | PK evidence; unique authority/receipt and actor-kind/event; authority/receipt composite FKs; bootstrap/recovery receipt/evidence and paired-backup guard; no-update/no-delete triggers. |

The five partial unique indexes named above and every listed trigger family are mandatory target objects. `vnext_schema_migrations` is the only target-only object approved by this specification. Any other target-only object, source object omitted from this map, or intentional semantic difference requires a new ADR, a source-to-target migration entry, and a dedicated regression test.

The following V5 rules are mandatory:

- composite authority/account/device/installation/link foreign keys prevent cross-authority tuple mixing;
- active role, capability override, data-scope, and profile-binding uniqueness uses PostgreSQL partial unique indexes, preserving revoked history;
- all lifecycle/version/time checks preserve the V5 active/revoked/expired/pending states and monotonic version requirements;
- device-installation fingerprint uniqueness is authority-scoped;
- sessions have immutable identity, monotonic terminal lifecycle, no delete, full nine-version snapshots, and parent-currentness checks;
- reauthentication evidence is append-only, online-session-only, time-window bounded, and validates the session plus current parent vectors;
- receipts, audit events, outbox events, policy publications, bootstrap consumptions, and trust-root evidence are append-only;
- policy publication revisions are authority-local and contiguous, reject an unchanged adjacent publication, and bind to an accepted receipt;
- bootstrap consumption retains no foreign key to the authority, is a deployment-global single-use marker, and remains even if authority rows are later damaged;
- trust-root bootstrap and owner-recovery evidence use distinct actor kinds, exact accepted receipt/result shapes, and backup evidence rules;
- no legacy `admin` role, legacy session, token, challenge, host epoch, host receipt, or old device authorization becomes an active vNext record.

The schema is fresh-apply only during this phase. A pre-existing unknown schema, unknown migration checksum, incompatible object, extra privileged trigger, or semantic catalog drift fails closed. `CREATE IF NOT EXISTS`, automatic ALTER/repair, and production data upgrade paths are prohibited from masking drift.

## PostgreSQL transaction and concurrency design

SQLite's single-writer behavior must not be assumed in PostgreSQL. The default command isolation level is `READ COMMITTED`; correctness comes from deterministic advisory/row locks, CAS predicates, and unique constraints rather than an implicit serializable retry loop. A transaction may retry at most twice on SQLSTATE `40001` or `40P01`, only while the same canonical command/idempotency key remains within its server deadline. It never retries a guard, validation, permission, or uniqueness error.

Locks are acquired in this exact order: deployment bootstrap advisory lock (bootstrap only); authority row; accounts by `account_id COLLATE "C"`; trusted devices; installations; account-device links; role grants by `grant_id COLLATE "C"`; sessions by `session_id COLLATE "C"`; policy-publication advisory lock for `(authority_id,'policy')`; then immutable receipt/audit/outbox/evidence rows. A recovery mutation locks the authority, derives and locks the distinct accounts owning captured active super-admin grants by `account_id COLLATE "C"`, then locks those grants by `grant_id`, then locks all captured active sessions by `session_id`, before it updates any row. A policy mutation takes its per-authority policy advisory lock even when no publication exists.

Every authorization mutation follows this sequence inside one explicit transaction:

1. Set `READ COMMITTED`, bounded statement/lock timeouts, UTC transaction timezone, and trusted writer clock input.
2. Read and lock the authority/aggregate rows in the fixed order above. Use row locks for account, grant, link, session, publication, and replacement-chain rows.
3. Serialize deployment-global bootstrap with the transaction-scoped advisory lock derived from a fixed migration namespace. Also retain the durable marker and unique constraints as the final proof.
4. Apply each single-row CAS update with the captured versions in every `WHERE` predicate; that statement must affect exactly one row. For a captured recovery set, every member CAS must affect one row and the total must equal the pre-locked set cardinality; an empty set is valid only where the recovery contract permits it.
5. Write the changed state, immutable receipt, audit record, publication or outbox intent, and trust-root evidence in the same transaction.
6. Commit only after final invariants hold. A uniqueness conflict, trigger exception, timeout, or injected failure rolls back every relation touched by that command.

Bootstrap additionally requires authority count zero and marker count zero before creating the sole authority, account/device/installation/link chain, sole active super-admin, policy publication, receipt, audit, outbox, marker, and evidence. Recovery requires an existing active authority, never inserts an authority or changes its marker, creates a new replacement chain, revokes every captured active super-admin grant and every captured active session, preserves ordinary role/profile/scope/business records, requires backup evidence, and ends with exactly one active super-admin. Exact replay reads the original immutable receipt plus every required companion, revalidates canonical text/hash/shape and durable state, and returns the durable result only when all agree; changed command/key/event/fingerprint inputs conflict rather than create a second effect.

Partial unique indexes and unique receipt keys are concurrency backstops, not substitutes for command-level locks. The writer remains the only component allowed to calculate canonical JSON/hash pairs or translate database error classes into stable vNext codes.

## Trigger functions, roles, and error boundary

PostgreSQL trigger functions implement append-only rejection, session lifecycle, reauthentication parent checks, policy-publication/receipt linkage, bootstrap-marker/receipt linkage, and trust-root-evidence/receipt linkage. The target uses non-login schema-owner `SECURITY DEFINER` functions with `SET search_path = pg_catalog, pg_temp`, fully qualified vNext relation names, and no dynamic SQL. `PUBLIC` has no `EXECUTE` on these functions and no `CREATE` on the database or `public` schema; runtime roles have neither `TEMP` nor schema-creation permission. Function creation and the `PUBLIC` revocation happen in the same migration transaction. This allows guard functions to read companion relations without granting runtime callers broad `SELECT`, while preventing caller-controlled object shadowing.

The migration role may create the dedicated schema and its functions. The runtime role may access only vetted vNext DML paths and cannot create/drop/alter relations, `TRUNCATE`, change table ownership, disable triggers, set replica role, seed a first authority, or read migration credentials. The production bootstrap/recovery writer has a separately reviewed least-privilege role; it is not an ordinary runtime fallback.

Receipt result and outbox payload text have database checks equivalent to `IS JSON WITH UNIQUE KEYS`; policy manifest text has `IS JSON OBJECT WITH UNIQUE KEYS`. Thus malformed or duplicate-key content cannot reach a guard without turning every V5 receipt/payload into an unintended object-only field. Policy/publication and the receipt-consuming bootstrap/recovery guards temporarily parse the guarded canonical text as core `json` to validate exact object key count, key names, JSON types, and required values. Audit triggers do not parse JSON because audit rows have no JSON column. No guard derives canonical bytes from `jsonb::text`; the trusted writer independently validates canonical serialization and SHA-256 equality before insert and replay.

SQLSTATE values and trigger messages are implementation details. The writer maps expected constraint, lock, serialization, and guard failures to existing stable vNext error codes without returning raw SQL, paths, credentials, or database internals to clients.

## Disposable PostgreSQL 17 test runtime

The implementation plan will add a local-only test harness, not a production database client:

- Node's built-in `node:test` remains the runner; `pg` is the minimal PostgreSQL client.
- `testcontainers` is the preferred dev dependency for an official PostgreSQL 17 Linux image pinned to an exact 17.x digest. The harness must verify a `127.0.0.1` host binding after start, use random credentials and an empty disposable database, and label every resource. A `finally` cleanup plus label-scoped best-effort sweeper handles interruption; no framework is assumed to provide absolute cleanup by itself.
- No host bind mount, persistent named volume, fixed password, fixed port, source-data path, or business-facing container network is allowed. Each suite gets a unique database/schema namespace. Dependency installation from the configured package registry and pulling the pinned public PostgreSQL image are the only controlled setup-time network exceptions; a test run has no business/data-plane external network.
- `pg-mem`, SQLite, and SQL-string snapshots cannot replace a real PostgreSQL 17 test for triggers, transaction isolation, advisory locks, row locks, canonical JSON text/duplicate-key behavior, or role privileges.
- If the Docker daemon is unavailable or the pinned image cannot be obtained, `npm run test:vnext-pg17` exits nonzero with an explicit `VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE` report. The aggregate release gate must run that command and cannot count an unavailable PG suite as passing. It never falls back silently to SQLite.

At implementation time the exact image digest, Node dependency versions, timeout values, and cleanup labeling are added only after being checked against the then-current package ecosystem. This design does not install or pull them.

## Required synthetic integration tests

Each test creates synthetic facts only and checks all affected table counts/content hashes before and after failure paths.

1. Fresh ledger apply, exact catalog assertion, deliberate table/column/index/constraint/trigger-function drift, unknown object, and unknown checksum all fail closed.
2. Composite foreign-key and partial-unique tests cover cross-authority rejection, revoked-history allowance, duplicate active role/capability/scope/profile rejection, and installation-fingerprint collision.
3. Validation tests cover blank IDs, `bigint` version boundaries and Node decimal-string ABI, upper-case/BLOB-like hashes, canonical timestamp boundaries including infinity rejection, JSON extra/missing keys, duplicate-key canonical input rejection, and text/hash mismatch.
4. Append-only/lifecycle tests cover receipt/audit/outbox/publication/marker/evidence update/delete rejection, session identity immutability, terminal-state monotonicity, reauthentication time/vector checks, and marker retention after simulated authority damage.
5. Two real PostgreSQL connections race on bootstrap, policy revision, one version-CAS mutation, and recovery collection locking. Exactly one transaction may commit where the command is singleton; the loser produces a stable conflict and no partial evidence.
6. Failure injection after every mutation stage proves receipt/audit/outbox/publication/marker/evidence atomic rollback. Bootstrap/recovery success, exact replay, changed-key/event/fingerprint conflict, and tampered/missing companion evidence each have dedicated tests. Existing ordinary roles, profile bindings, scope grants, and a synthetic non-vNext business-like table remain equivalent as sorted logical row sets and canonical row hashes.
7. The same truth-table fixtures run against the SQLite V5 reference and PostgreSQL target tests. Expected allow/deny, replay, version, state, and error-category outcomes must match; engine-specific SQLSTATE details are not compared.
8. Runtime-role tests prove it cannot perform DDL, `TRUNCATE`, trigger disablement, or bootstrap seed writes; the migration role is never used by ordinary request paths.

## Explicit non-goals and next step

This work does not create RDS, choose a final RDS SKU/price/VPC/vSwitch, configure TLS certificates or secrets, deploy ECS, create an API, issue a token, migrate a desktop row, import business data, or publish an application. Those require later design, separate authorization, and real-environment gates.

After this specification passes its independent necessary/quality audit, the next artifact is an implementation plan. The first implementation slice is only the disposable PG17 harness plus schema ledger/catalog-drift test; it still has no production connection and no data migration. Local PG17 success is necessary but not sufficient: before any production DDL, separately authorized disposable non-production RDS must pass the same catalog, semantic, concurrency, and rollback suite.
