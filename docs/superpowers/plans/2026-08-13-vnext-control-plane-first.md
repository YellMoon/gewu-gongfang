# vNext Control-Plane-First Execution Plan

Date: 2026-08-13

Status: active execution baseline

## Decision

The final architecture makes the cloud the sole formal writer for business data. That does not justify an immediate rewrite of every SQLite table into a new PostgreSQL model. The next phase migrates only the authority control plane and the smallest necessary profile-binding projection. Existing business logic and SQLite business tables remain intact while each business domain earns migration through equivalence evidence.

## Authority matrix

| Concern | Current phase authority | Final authority | Notes |
| --- | --- | --- | --- |
| Account, verified identity, role, capability, scope, device and session | Cloud | Cloud | Service-side decisions; client claims never grant access. |
| Super-admin review | Cloud role/capability/device/re-auth gate | Cloud | Any trusted desktop installation may open it; no host-only test. |
| Legacy business records and domain transactions | Existing SQLite through a repository adapter | Cloud, one domain at a time | No business-table rewrite in this phase. |
| Offline reads and drafts | Signed cloud context plus per-account local partition | Same | Users explicitly confirm submission; drafts never silently push. |
| Question/export files, NAS and removable media | Storage task worker | Storage task worker | They store/verify/backup objects only and never authorize users. |

## Phase 1: Control plane and compatibility seam

1. Record a redacted authority matrix and a source-to-target mapping for only account, device, permission, session, audit, and profile-binding evidence.
2. Selectively port the account/permission/device worktree design: stable account subjects, role/capability/scope, trusted device, installation, account-device link, risk/revocation, per-account local partition, and offline license.
3. Build cloud control-plane schema and APIs. Replace primary-host-only review gating with cloud role + capability + valid link + recent re-authentication.
4. Introduce repository contracts for business services. The initial SQLite adapter must pass existing domain tests unchanged; no domain table is copied or remodelled yet.
5. Produce a copy-only control-plane migration rehearsal on a disposable database copy. It must have source fingerprinting, mapping ledger, replay protection, conflict reporting, and a rollback artifact.

## Explicitly deferred work

- PostgreSQL schemas or importers for courses, schedules, payments, consumption, balances, assets, question content/taxonomy, or other business domains.
- Migrating question files themselves. Only storage-object metadata needed by control-plane jobs may be introduced after the storage task contract is approved.
- Cutting existing SQLite business writes over to cloud writes.

## Business-domain entry gate

Before a domain can move from SQLite to the cloud, all conditions must be true:

1. Its repository interface is used by the existing business service and both SQLite and target adapters pass the same contract tests.
2. The proposed target schema accounts for every source field, constraint, lifecycle state, foreign-key effect, and derived aggregate.
3. A full shadow import, an incremental catch-up, an empty-environment restore, and a rollback rehearsal have zero unexplained differences.
4. Stable IDs, row counts, primary-key sets, normalized row hashes, and domain aggregates (including money and lesson-hour totals when applicable) match.
5. The old writer can be frozen during a defined cutover window without creating a second authority.

## Audit gates

Every task has two GPT-5.6-sol high-reasoning audits.

### Necessity audit, before implementation

- Is this an unavoidable step toward the active phase?
- Are its dependencies present, and is there a smaller safer predecessor?
- Which production data, devices, or release targets could it affect?
- Does it accidentally implement a future business domain?
- Decision: `continue`, `narrow`, `reorder`, or `pause`.

Only `continue` permits implementation.

### Quality audit, after self-verification

- Does the change stay inside the approved task boundary?
- Does it preserve existing business semantics and data?
- Is authorization server-enforced and consistent for desktop, miniapp, and cloud paths?
- Is migration copy-only at its source, idempotent, ledgered, hash-verifiable, and rollbackable?
- Do tests cover success, rejection, conflicts, interruption/replay, and rollback?
- Is there any path that creates a second authority?
- Decision: `pass`, `revise`, or `block`.

Only `pass` permits the next task or any completion claim.

## First bounded task

Build and verify a control-plane-only source catalog and migration contract. It must reject all business-domain tables by default, while admitting the exact identity, role, device, session, audit, and profile-binding evidence required for a disposable rehearsal. It must not touch real databases, NAS, removable drives, cloud production data, or desktop user data.

### First bounded task evidence (2026-08-14)

- Implemented `shared/controlPlaneMigrationCatalog.js` as a pure metadata classifier with no I/O, exporter, importer, target DDL, CLI, or credential-activation path.
- The contract records a disposition and a complete admitted/denied column partition for every source table. Unknown, host-authority, challenge, token, session, cache, business, and storage tables fail closed into explicit exclusion.
- Legacy role evidence remains restricted; legacy device authorization and session evidence remain inert archives requiring future reauthentication, never active cloud grants.
- Synthetic contract and full migration foundation tests are required before advancing to the control-plane schema/API task.

### Reference control-plane kernel evidence (2026-08-14)

- Implemented `shared/vNextControlPlaneReferenceKernel.js` only as an executable SQLite reference contract. It accepts an explicitly injected SQLite handle, has no path or environment fallback, and is never imported by gateway initialization, HTTP, WebSocket, desktop, cloud, NAS, or migration runtime paths.
- Every object is `vNext_`-prefixed and isolated from legacy schema. Bootstrap creates no authority, account, grant, device, installation, link, credential, session, offline-license, or business record. It rejects legacy `admin`; visitor remains the derived absence of a formal role.
- The reference contract models authority-scoped opaque accounts, verified-contact evidence, time-bounded role/capability/scope records, opaque profile-binding evidence, device-installation-account links, and append-only authorization audit metadata. It contains no bearer token, refresh token, secret, password, session, offline license, primary-host, or host-receipt field.
- Bootstrap is transactional, idempotent only for the exact same schema, requires enforced SQLite foreign keys, and fail-closes on table, column, named-index, trigger, or schema-version drift. This is not a selected cloud target schema or production initializer; target-engine selection and target DDL remain required before any cloud integration or shadow import.

### Reference control-plane v2 evidence (2026-08-14)

- The reference contract now defines an append-only command receipt as the sole idempotency authority, a receipt-bound append-only audit record, and an immutable receipt-bound authorization outbox intent. V2 stores only writer-supplied JSON and SHA-256-shaped request/result/payload metadata needed for a later mutation contract; it does not send events or issue credentials.
- The accompanying v2 plan freezes the version/CAS effects of role, capability, scope, and device-link changes before a mutation handler exists. Reference v1 is explicitly rejected rather than silently upgraded; no real database migration is implemented.
- This remains an injected in-memory SQLite contract only. It is not production cloud DDL, a selected target database, an authorization API, session/reauth resolver, delivery worker, real-data importer, or business writer.

### Reference role-mutation vertical slice evidence (2026-08-14)

- Implemented `shared/vNextRoleGrantMutationReference.js` as the first executable control-plane transaction reference. It supports only immediate `role.grant` and `role.revoke` against an explicitly injected, prevalidated current exact V3 SQLite handle; it never bootstraps or repairs schema.
- An injected synchronous guard must explicitly return `allowed: true`; authority and actor identity are then reloaded from active authority/account rows. Caller-supplied authority, actor, or unknown fields are rejected. This artifact does not resolve sessions, tokens, reauthentication, primary-host authority, or production policy.
- Target state, account-version invalidation, command receipt, receipt-bound audit, and immutable outbox intent are one transaction. Replays validate receipt semantics and every companion record; rejected/noop commands retain receipt/audit evidence but have no outbox intent. The last currently effective super-admin on an active account cannot be revoked.

### Reference session and reauthentication V3 evidence (2026-08-14)

- The injected SQLite-only reference contract now records opaque online/initialization session state and append-only recent-reauthentication evidence. It contains no bearer, refresh token, password hash, one-time code, challenge, secret, private key, credential issuer/verifier, session API, runtime import, cloud database connection, source-data access, or business writer.
- A session is authority-scoped and compositionally bound to its active-account/device/installation/link identity with captured authorization versions. Reauthentication is allowed only against an active online parent session, its evidence lifetime must lie within the parent session window, and its complete captured version vector must match; device-only proof is not a supported factor.
- V3 is still not an AccessContext resolver. Before that can be built, the project must freeze role-default capability mapping, normalized surface semantics, authority policy versioning, deny precedence, canonical scope/hash rules, and a trusted verifier boundary that never treats client-supplied session IDs as authentication.

### Reference authorization-policy definition evidence (2026-08-14)

- `shared/vNextAuthorizationPolicyReference.js` is a pure, versioned and deeply frozen policy-definition contract. Its V1 baseline grants only `user.review`, `access.manage`, and `device.revoke` to `super_admin`, all desktop-only; teacher, student and derived visitor receive no default control-plane capability.
- It resolves only already trusted, loaded evidence with surface filtering and final deny precedence, and emits deterministic code-unit-sorted capability/scope hashes. It performs no database I/O, token/session validation, route integration, business owner evaluation or production policy activation.
- Authority-specific policy publication/version/CAS evidence remains a separately audited next task. Only after that and a trusted verifier boundary may a read-only AccessContext resolver be introduced.

### Reference authorization-policy publication V4 evidence (2026-08-14)

- V4 adds an authority-scoped, append-only policy-publication ledger. Its current policy is the highest contiguous authority-local revision; there is no mutable current pointer and no automatic default-policy row.
- Each publication persists canonical policy JSON plus a SHA-256 identity and is bound to an accepted, typed `authorization_policy.publish` receipt with exact authority, publication, contract/hash, revision and time semantics. Adjacent identical policy content is rejected as a noop; A→B→A is a new valid revision.
- This remains reference-only. A later trusted writer and resolver must re-canonicalize stored JSON, recompute its hash and fail closed; policy publication does not mass-update account/session versions, issue credentials, or expose an API.

### Trusted-session verifier boundary evidence (2026-08-14)

- `shared/vNextTrustedSessionVerifierBoundaryReference.js` turns only an exact `{ sessionId }` result from an explicitly injected deployment verifier into a closure-branded opaque assertion. Object shape, JSON, a copied assertion and another boundary's assertion never establish trust.
- This is deliberately not a token, credential, cryptographic verifier, session issuer, API or database reader. It does not accept a client-provided session ID as authentication and it never return the original presentation or a verifier-internal failure.
- A later read-only AccessContext resolver must unwrap only this boundary's assertion and then independently reload current V3 session/parent state and the current V4 publication. It must fail closed for every stale or inconsistent record.

### Read-only AccessContext reference evidence (2026-08-14)

- `shared/vNextAccessContextResolverReference.js` accepts only a verifier module's closure-branded assertion, a fixed deployment surface and an explicitly injected exact V4 reference SQLite handle. It rebuilds one frozen context from a single read transaction and never accepts caller identity, role, capability, scope, reauth or surface claims.
- The resolver requires active online session and parent state, all nine current version-vector matches, session time validity, highest authority-local V4 publication whose policy JSON re-canonicalizes to exactly its stored bytes and hash, and the existing policy contract's deny/surface/time rules. No publication and any inconsistency fail closed; it never falls back to the default policy.
- The V4 publication manifest is the resolver's sole policy truth. The capability catalog remains an override FK/writer-validation vocabulary, so a catalog mutation cannot silently rewrite a published policy while it is read. This remains in-memory reference-only: no token/API/runtime/database path, cache, profile binding, audit/outbox write, business data or deployment integration.

### File object lifecycle reference evidence (2026-08-14)

- `shared/vNextFileObjectLifecycleReference.js` now freezes the pure current-state contract for question-file object identity, queued storage, matched write and independent-read verification receipts, terminal inspection state and separate NAS/removable-backup receipt chains. It uses opaque location references only and performs no file, NAS, Docker, cloud, database or task-worker I/O.
- `verified` is therefore not a real-copy claim: production storage workers must later supply these receipts only after actual I/O and preserve audit history independently of this current-state snapshot. A retryable/missing retry clears stale current evidence rather than presenting old backups as proof of the new upload cycle.

### Existing-authority policy publication mutation reference evidence (2026-08-14)

- `shared/vNextPolicyPublicationMutationReference.js` completes the existing-authority V4 publish vertical slice only. It consumes a real opaque assertion through a resolver branded and bound to the same injected database; only a current desktop `super_admin` with `access.manage` and a valid recent reauthentication can publish a later policy revision.
- Revision zero remains `FIRST_POLICY_BOOTSTRAP_REQUIRED`, so this writer does not create an authority, first policy, first administrator or bootstrap bypass. Every candidate is recursively snapshotted and canonicalized before hashing; it must retain active desktop `access.manage` for `super_admin`, preventing policy self-lock before a separately approved recovery design exists.
- Success atomically records receipt, publication, audit and outbox. Replay rechecks all associated canonical request/result, publication, audit and outbox evidence. This is still `:memory:` reference code: no API/runtime/cloud database/source data/real storage/business migration/deployment integration.

### Existing-authority account-device-link revocation reference evidence (2026-08-14)

- `shared/vNextAccountDeviceLinkRevocationMutationReference.js` defines only `account_device_link.revoke` for an existing authority. It consumes an opaque assertion through the same injected V4 database's branded resolver and requires a current desktop `super_admin`, `device.revoke`, and unexpired recent reauthentication.
- It rejects the current link and every cross-authority/non-active target. A successful compare-and-swap changes only the target link to `revoked`, increments its auth/access/row vectors, and atomically writes a command receipt, receipt-bound audit, and one immutable invalidation outbox intent. Target account auth/access/revocation versions deliberately remain unchanged; resolver current-link checks invalidate the target's captured sessions.
- An already revoked target is a version-independent noop. Replays revalidate the frozen command result, original policy audit context, target state/vectors/timestamps, audit, and outbox payload/hash; every branch remains `:memory:` reference-only and has no API/runtime/cloud database/source data/real storage/business migration/deployment integration.

### Existing-authority role mutation AccessContext evidence (2026-08-14)

- `shared/vNextRoleGrantMutationReference.js` no longer accepts an injectable authorization callback. Its only authorization path is an opaque assertion resolved through a resolver branded and bound to the same exact V4 reference database.
- A role grant or revoke requires the current desktop context to carry `super_admin`, `access.manage`, and an unexpired recent reauthentication. Actor and authority are derived exclusively from that context; commands cannot claim or override them.
- Existing role CAS, account-version changes, last-effective-super-admin protection, receipt/audit/outbox atomicity and replay semantics remain reference-only. Accepted replay cross-checks frozen context evidence, actual role-grant/account versions and immutable outbox payloads so internally self-consistent but durable-state-inconsistent companion tampering fails closed.

### First-authority trust-root reference evidence (2026-08-14)

- `shared/vNextFirstAuthorityBootstrapReference.js` is an isolated `:memory:` V5 reference writer, not a server deployment, credential issuer, cloud migration, or real initialization operation. It accepts only a branded, same-database deployment bootstrap assertion and writes the first authority atomically.
- Its dedicated policy-publication trigger branch accepts only the matching accepted `AUTHORITY_BOOTSTRAPPED` receipt at revision `1`; it does not introduce a first-call exemption, legacy-administrator mapping, default seed, host-only bypass, device claim, or client-session claim.
- `docs/superpowers/specs/2026-08-14-vnext-first-authority-trust-root-decision.md` remains the owner-approved trust-root contract. Recovery packages remain preservation evidence rather than credentials. `shared/vNextEmergencyRecoveryReference.js` has completed its separate dual-gate review and this Task 7 cross-module review: it operates only on an existing active authority, creates a new replacement chain, CAS-revokes prior super-admin grants and active sessions, binds verified-backup evidence, and preserves ordinary roles, profiles, scopes, and business rows. It remains a reference-only artifact: real recovery still requires per-event owner authorization and a recoverable backup, neither of which is implemented here.

### PostgreSQL 17 disposable target-ledger evidence (2026-08-15)

- `shared/vnext-pg17/` adds only the first target-engine harness slice: exact `pg` `8.23.0`, a digest-pinned official PostgreSQL 17 image, closure-private handles, and a fixed `vnext_control_plane` schema inside one local Docker container bound to `127.0.0.1`. It accepts no caller connection configuration and does not contact RDS, ECS, a cloud database, NAS, removable media, or source/business data.
- The sole approved target relation is the append-only `vnext_control_plane.vnext_schema_migrations` ledger. It is owned by a synthetic non-login owner, has ordered-version and no-update/no-delete guards, and is checked through a read-only verifier identity. No V5 authority, account, session, policy, business, or file-object relation has been copied to PostgreSQL.
- The immutable catalog assertion fail-closes on relation, column, constraint, trigger, function, owner, role, membership, ACL, checksum, public-shadow, and unexpected-object drift. Every drift case uses a new synthetic database and releases it immediately; setup failure invalidates and cleans the disposable runtime rather than leaving it reusable.
- Fresh focused checks, `npm run test:vnext-control-plane-target`, a repeated disposable-runtime run with no labelled container left behind, `npm test`, and `git diff --check` passed locally. This is disposable synthetic validation only; non-production RDS validation, target control-plane DDL beyond the ledger, real migrations, APIs, and deployment remain deferred.

### PostgreSQL 17 foundation identity/device evidence (2026-08-15)

- Migration 2 adds only the V5 foundation: schema metadata plus authorities, accounts, trusted devices, device installations, and account-device links. It creates no authority, account, device, session, role, policy, capability, or business-data seed.
- The disposable PostgreSQL 17 catalog now verifies the foundation’s composite foreign keys, authority-local uniqueness, lifecycle checks, strict lower-case SHA-256 fingerprints and hardware evidence, ownership, verifier-only read access, and exact trigger definitions. Missing, altered, or extra catalog objects fail closed.
- Fresh focused checks, the control-plane target aggregate, the existing repository suite, and a clean diff check were rerun locally. This remains synthetic disposable validation only: it does not apply DDL to RDS/ECS, access desktop or business data, introduce writers/APIs, or perform a migration or deployment.

### PostgreSQL 17 role-grants evidence (2026-08-15)

- `shared/vnext-pg17/roleMutation.js` is a synthetic-only existing-authority writer for `role.grant` and `role.revoke`. It accepts only a same-handle branded AccessContext resolver and opaque assertion, then requires desktop surface, formal super-admin, `access.manage`, and current reauthentication.
- Under an authority advisory lock it creates active grants or CAS-revokes grants, preserves the final active super-admin, advances the affected account version vector, and writes receipt/audit/outbox companions atomically. Existing sessions are not rewritten: the resolver rejects their stale captured account vectors.
- Focused tests cover grant/revoke, rejection/noop/replay, target-session invalidation, replay after a later policy revision, outbox-companion corruption rejection, and rollback after target, account, receipt, audit, and outbox writes. This remains a local disposable PostgreSQL 17 contract with no RDS/ECS, API/runtime wiring, business data, desktop SQLite, NAS/removable-media, or deployment access.

- Migration 3 adds only `vnext_role_grants` and its active-role partial unique index. It creates no role, super-admin, capability, policy, session, receipt, or business-data seed.
- The disposable catalog verifies both authority-scoped account/grantor foreign keys, nullable-but-nonblank grantor semantics, strict lifecycle/version/finite-time constraints, revoked-history behavior, the exact partial-index predicate, verifier-only access, and the absence of role-table triggers. Constraint, index, ACL, trigger, public-shadow, default, and migration-prefix drift fail closed.
- Focused PG17 checks and the control-plane target aggregate were rerun after review. This remains a synthetic local PostgreSQL validation only: no real RDS/ECS DDL, data import, runtime writer, API, business row, or deployment was performed.

### PostgreSQL 17 capability-catalog evidence (2026-08-15)

- Migration 4 adds only `vnext_capability_catalog`. It has no capability seed, authority ownership field, policy/default mapping, override, extra index, foreign key, or trigger.
- Disposable PostgreSQL 17 checks verify C-collated nonblank IDs and surface masks, active/retired status, finite creation times, owner/verifier-only access, no runtime rights, no table trigger, and fail-closed relation, constraint, index, ACL, public-shadow, and migration-prefix drift.
- Focused PG17 checks and the control-plane target aggregate were rerun after independent necessity and quality review. This is synthetic local validation only: no real RDS/ECS DDL, data import, writer/API, business row, deployment, or desktop data access occurred.

### PostgreSQL 17 capability-overrides evidence (2026-08-15)

- Migration 5 adds only `vnext_capability_overrides` and its `active` partial-unique index. It has no override seed, default role mapping, authority policy field, trigger, function, writer, API, business relation, or real-resource access.
- Disposable PostgreSQL 17 checks verify C-collated IDs, allow/deny and active/revoked/expired lifecycle rules, finite timestamps, positive row versions, both RESTRICT foreign keys, retired-capability structural references, active-record uniqueness with revoked history, verifier-only SELECT, and no runtime access.
- The exact catalog fails closed on migration-4 prefix apply, altered ACL/default/constraint/FK/index/partial-predicate/trigger/public-shadow drift, and unexpected table objects. Independent necessity and quality review passed, followed by focused checks, the complete control-plane target aggregate, and a clean diff check.
- This remains synthetic local validation only: no RDS/ECS DDL, source or business-data import, runtime writer, API, deployment, desktop-data, NAS, or removable-media access occurred.

### PostgreSQL 17 data-scope-grants evidence (2026-08-15)

- Migration 6 adds only `vnext_data_scope_grants` and its `active` partial-unique index. Scope values remain opaque text: no business foreign key, SHA-256 shape assumption, scope resolver, default grant, seed, trigger, function, writer, or API was introduced.
- Disposable PostgreSQL 17 checks verify the five V5 scope types, allow/deny effects, active/revoked/expired lifecycle, finite timestamps, positive row versions, the composite RESTRICT account foreign key, active-tuple uniqueness independent of effect, and revoked-history replacement behavior. Verifier access remains SELECT-only and runtime has no table access.
- The immutable catalog rejects migration-5 prefix application without writes, altered partial predicates, extra indexes, altered scope-type/status checks, missing account foreign keys, ACL/default/trigger/public-shadow drift, and unexpected relation objects. Focused manifest/catalog checks, the complete control-plane target aggregate, and a clean diff check were rerun after independent necessity and quality review.
- This remains synthetic local validation only: no real RDS/ECS DDL, source/business-data import, runtime writer, API, deployment, desktop-data, NAS, or removable-media access occurred.

### PostgreSQL 17 profile-bindings evidence (2026-08-15)

- Migration 7 adds only `vnext_profile_bindings` with two active partial-unique indexes: one account/profile-type binding and one authority/profile identity binding. Profile IDs and evidence remain opaque control-plane text, with no business-profile relation, business data, seed, trigger, function, writer, or API.
- Disposable PostgreSQL 17 checks verify teacher/student types, active/revoked/pending lifecycle, finite timestamps, positive row versions, composite RESTRICT account references, both independent active uniqueness rules, pending/revoked history behavior, verifier-only SELECT, and absent runtime access.
- The exact catalog rejects a migration-6 prefix without writes, altered keys or predicates for either partial index, extra indexes, altered profile-type/status checks, removed account foreign keys, ACL/default/trigger/public-shadow drift, and unexpected relation objects. Focused manifest/catalog checks, the complete control-plane target aggregate, and a clean diff check passed after independent necessity and quality review.
- This remains synthetic local validation only: no RDS/ECS DDL, source/business-data import, runtime writer, API, deployment, desktop-data, NAS, or removable-media access occurred.

### PostgreSQL 17 verified-contacts evidence (2026-08-15)

- Migration 8 adds only `vnext_verified_contacts`. Contact identity and verification evidence remain opaque C-collated text: this target contract stores no plaintext phone or WeChat identifier, normalization rule, verification channel, seed, trigger, function, writer, or API.
- Disposable PostgreSQL 17 checks verify all three contact types, verified/revoked lifecycle, finite nullable timestamps, positive row versions, the composite RESTRICT account reference, and the non-partial authority/type/hash uniqueness rule that continues to reserve a revoked contact identity. Verifier access is SELECT-only and runtime has no table access.

### PostgreSQL 17 authorization-command-receipts evidence (2026-08-15)

- Migration 9 adds only `vnext_authorization_command_receipts` and its two table-local append-only trigger functions. It stores generic idempotency receipt structure; it does not add an audit, outbox, policy, trust-root consumer, command vocabulary, writer, API, seed, or runtime DML.
- Disposable PostgreSQL 17 checks verify all 19 columns, both RESTRICT foreign keys, nullable actor/version fields, all three outcomes, generic canonical JSON text with duplicate-key rejection, finite time and SHA/version bounds, verifier-only SELECT, runtime-zero access, and failed update/delete preservation.
- The catalog assertion fails closed for missing M9 after an exact M1-M8 prefix, changed or extra index/constraint/FK/default/ACL/function/trigger/public shadow, and function owner, SECURITY DEFINER, search-path, and execution-privilege drift. The evidence is synthetic local PostgreSQL 17 only; it is not a real RDS/ECS receipt deployment.
- The immutable catalog rejects a migration-7 prefix without writes, altered contact uniqueness, extra indexes, altered contact-type/state/lifecycle checks, missing account foreign keys, ACL/default/trigger/public-shadow drift, and unexpected relation objects. Focused manifest/catalog checks, the complete control-plane target aggregate, and a clean diff check passed after independent necessity and quality review.
- This remains synthetic local validation only: no RDS/ECS DDL, source/business-data import, runtime writer, API, deployment, desktop-data, NAS, removable-media, or real contact access occurred.

### PostgreSQL 17 authorization-audit-events evidence (2026-08-15)

- Migration 10 adds only `vnext_authorization_audit_events` and its two table-local append-only trigger functions. It records generic receipt-bound audit evidence, but does not introduce an audit writer, reason taxonomy, context payload contract, outbox, policy, trust-root consumer, seed, API, or runtime DML.
- Disposable PostgreSQL 17 checks verify C-collated nonblank event/authority/receipt/reason fields, lower-case context hashes, finite timestamps, primary and authority/receipt uniqueness, both RESTRICT foreign keys, verifier-only SELECT, runtime-zero access, and failed update/delete preservation.
- The exact catalog fails closed on an M9 prefix without writes, changed unique/FK/check/default/nullability/owner/ACL/function/trigger/public-shadow/index drift. The independent necessity and quality review passed after focused and aggregate target verification.
- This is synthetic local validation only: no real RDS/ECS DDL, audit data, audit writer, API, production deployment, business data, desktop data, NAS, or removable-media access occurred.

### PostgreSQL 17 authorization-outbox-events evidence (2026-08-15)

- Migration 11 adds only `vnext_authorization_outbox_events` and its two table-local append-only trigger functions. It records generic receipt-bound outbox intent and deliberately adds no dispatcher, queue worker, event vocabulary, payload schema, writer, API, policy, trust-root consumer, seed, or runtime DML.
- Disposable PostgreSQL 17 checks verify generic object/array/scalar JSON text with duplicate-key rejection, positive aggregate versions, primary and five-field uniqueness, both RESTRICT foreign keys, C-collated nonblank fields, finite timestamps, verifier-only SELECT, runtime-zero access, and failed update/delete preservation.
- The exact catalog rejects an M10 prefix without writes, changed unique/FK/check/default/nullability/collation/index/owner/ACL/function/trigger/public-shadow drift. Independent necessity and quality review passed after focused and aggregate target verification.
- This is synthetic local validation only: no real RDS/ECS DDL, outbox payload data, dispatcher, writer, API, production deployment, business data, desktop data, NAS, or removable-media access occurred.

### PostgreSQL 17 bootstrap-consumptions evidence (2026-08-15)

- Migration 12 adds only the permanently append-only `vnext_bootstrap_consumptions` marker and its insert/no-update/no-delete guards. The marker intentionally has zero foreign keys so a damaged authority or receipt cannot reopen bootstrap.
- The insert guard accepts only an exact accepted `authority.bootstrap` receipt with the fixed bootstrap actor, authority, result vector, typed seven-key result, matching policy hash, and nondecreasing time. No bootstrap data, writer, API, policy publication, or trust evidence row is seeded.
- Catalog and disposable PG17 checks reject M11 prefixes, injected foreign keys, altered constraints/indexes/ACL/functions/triggers/public shadows, malformed JSON values, and attempted updates/deletes. This remains synthetic local validation only.

### PostgreSQL 17 authorization-policy-publications evidence (2026-08-15)

- `shared/vnext-pg17/policyPublicationMutation.js` is a synthetic-only, same-handle writer for an existing active authority. It accepts only a branded PG17 AccessContext resolver and opaque assertion, requires desktop surface, formal `super_admin`, active `access.manage`, and unexpired current reauthentication, then serializes one authority-local publication under an advisory transaction lock.
- It canonicalizes a plain-data policy manifest before hashing, rejects bootstrap revision zero and self-locking manifests, and records either a rejected/noop receipt plus audit or an accepted receipt, publication, audit, and outbox row atomically. Exact replay rechecks the receipt and each durable companion without allocating IDs; changed input under the same idempotency key fails closed.
- Focused synthetic tests cover publication revision CAS, adjacent noop and later reactivation, opaque/fake assertion and miniapp rejection, management-path preservation, and rollback after every writer-side durable stage. This remains outside RDS/ECS, API/runtime adapters, business/source/desktop data, NAS/removable media, and deployment.

- Migration 13 adds only the authority-local append-only `vnext_authorization_policy_publications` ledger. It stores canonical manifest text plus its writer-supplied SHA-256; it adds no policy seed, current pointer, resolver, writer, API, or capability mapping.
- Its insert guard requires a contiguous authority-local revision and exact accepted receipt result. The normal path binds `authorization_policy.publish` and its revision vector; the bootstrap path additionally requires the durable M12 marker, matching receipt/actor/authority/hash, and time ordering. Adjacent identical contract/hash revisions reject as unchanged.
- Exact catalog checks and synthetic PG17 behavior cover M12-prefix fail-closed behavior, JSON/receipt/vector/time/type mismatches, inactive authorities, marker absence, append-only preservation, ACL/function/trigger drift, and no runtime access. No real RDS/ECS, business data, deployment, desktop data, NAS, or removable media was accessed.

### PostgreSQL 17 trust-root-evidence evidence (2026-08-15)

- Migration 14 adds only the append-only `vnext_trust_root_evidence` ledger. Bootstrap evidence binds the durable M12 marker; recovery evidence binds an accepted owner-recovery receipt plus the caller-supplied backup ID and manifest hash. It does not perform backup, signature, nonce, credential, or recovery I/O.
- The SECURITY DEFINER guard rejects time regressions, ordinary recovery receipts, malformed backup pairing/hashes, and noncanonical recovery receipt state. Catalog and disposable PG17 checks fail closed on M13 prefixes and changed unique/FK/actor/backup/index/ACL/function/trigger/public-shadow facts.
- This remains synthetic local PostgreSQL 17 verification only. No RDS/ECS, production trust-root procedure, business data, desktop data, NAS, removable media, or deployment was accessed.

### PostgreSQL 17 sessions and recent-reauthentication evidence (2026-08-15)

- Migration 15 adds only `vnext_sessions` and `vnext_recent_reauthentication_events`, together with their seven owner-owned SECURITY DEFINER guards. It creates no issuer, credential verifier, token, API, runtime writer, or production connection.
- Disposable PostgreSQL 17 checks verify the full captured nine-version vector, online/init session distinction, finite session and reauthentication windows, parent-currentness, session identity immutability, one-way revoke lifecycle, and append-only reauthentication rows. Verifier access remains SELECT-only and runtime has no relation access.
- The catalog rejects a missing M15 after an exact M1-M14 prefix and rejects M15 index, FK, ACL, and trigger drift. Evidence is synthetic local PostgreSQL 17 only; no RDS/ECS, desktop data, NAS, removable media, or deployment was accessed.

### PostgreSQL 17 first-authority bootstrap mutation reference evidence (2026-08-15)

- `shared/vnext-pg17/firstAuthorityBootstrapMutation.js` is a disposable-PG17, synthetic-only reference mutation. It consumes only an opaque `deployment_bootstrap` assertion from a verifier boundary bound to the same disposable handle; it has no HTTP, server, credential, signature, nonce, RDS/ECS, desktop-data, or deployment integration.
- Against the exact M1-M15 catalog and one transaction-scoped advisory lock, it requires both an empty authority relation and an empty durable bootstrap marker. It writes one first authority, account, trusted device, installation, account-device link, null-grantor active super-admin grant, accepted bootstrap receipt, marker, revision-one policy publication, trust-root evidence, audit event, and outbox intent in dependency order.
- Synthetic checks cover success, opaque-assertion rejection, expiration, exact durable replay without ID allocation, idempotency-key conflict, consumed-marker rejection, and rollback injected after every write stage. The PG17 aggregate runs this focused mutation alongside the manifest and catalog suites. This is not a real first-authority ceremony or a production initialization path.

### PostgreSQL 17 emergency-recovery mutation reference evidence (2026-08-15)

- `shared/vnext-pg17/emergencyRecoveryMutation.js` is a disposable-PG17, synthetic-only reference mutation for a specifically authorized existing active authority. It accepts only an opaque same-handle `owner_recovery_event` assertion; it never creates another authority or changes the durable bootstrap marker, and it has no HTTP, server, backup, signature, nonce, credential, RDS/ECS, desktop-data, or deployment integration.
- One lock-ordered transaction creates a new replacement account/device/installation/link and null-grantor super-admin grant, CAS-revokes every captured active super-admin grant and active session, increments each former-super-admin account vector exactly once, and verifies exactly one replacement super-admin plus zero active authority sessions before writing receipt, backup-bound evidence, audit, and outbox companions.
- Synthetic checks cover two former administrators, ordinary account/session preservation, zero-old-super-admin recovery, exact replay, same-key conflict, consumed-event rejection, expiry and opaque-assertion rejection, twelve write-stage rollback injections, and evidence/audit/outbox companion corruption after catalog restoration. The PG17 aggregate runs the focused recovery suite alongside the manifest, catalog, and bootstrap suites. This is not a real recovery procedure: any actual recovery still requires explicit per-event owner authorization and a verified recoverable backup.

### PostgreSQL 17 trusted session and AccessContext reference evidence (2026-08-15)

- `shared/vnext-pg17/trustedSessionVerifierBoundary.js` converts only an exact verifier-returned session ID into a closure-private opaque assertion bound to one disposable handle. It neither verifies a credential nor reads a database, and copied, fabricated, or foreign-handle assertions cannot establish a session identity.
- `shared/vnext-pg17/accessContextResolver.js` first verifies the exact M1-M15 catalog, then reads the session, current parents and nine captured version values, latest authority-local policy publication, formal roles, overrides, scopes, and eligible reauthentication evidence through the verifier role in one `REPEATABLE READ READ ONLY` transaction. It re-canonicalizes the stored policy bytes and hash, applies the pure policy contract, and returns only a deeply frozen context or `VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE`.
- Synthetic PG17 checks cover desktop capability derivation, miniapp surface filtering, absent/expired/future reauthentication, initialization/revoked/expired/future and expiry-boundary sessions, all five inactive parent types, all nine captured-vector mismatches, forged assertions, a peer write between two reads of a stable snapshot, and before/after logical snapshots of every M1-M15 target relation. This remains an internal disposable reference only: no token or credential verifier, API, runtime integration, RDS/ECS access, desktop/business data, NAS, removable media, or deployment was used.

### PostgreSQL 17 verifier-readiness boundary evidence (2026-08-20)

- `shared/vnext-pg17/productionVerifierReadiness.js` now provides a local disposable, verifier-only readiness seam. It uses a closure-private `pg.Pool` lease, checks the exact M1-M15 catalog through the existing single-sourced catalog query core, and returns only a frozen non-sensitive readiness summary.
- Each check uses one `REPEATABLE READ READ ONLY` transaction with local UTC, bounded statement/lock timeouts, and a fixed application name. Runtime-issued traces lock the exact transaction prefix and prove that the boundary emits only transaction control and `SELECT` statements; no DML, DDL, role switch, temporary object, or function execution is permitted.
- Plaintext is accepted only for a closure-branded disposable pool/TLS pair. Uncertain `BEGIN`/`COMMIT`, failed rollback, and failed release destroy the lease rather than returning it to the pool. This is not an RDS/ECS connection, production TLS proof, writer role, mutation adapter, HTTP/API, credential creator, migration runner, or deployment. A separately audited writer-role/ACL manifest is still required before any production command can be adapted.

### PostgreSQL 17 writer zero-direct-DML ACL evidence (2026-08-20)

- The disposable runtime now creates a separate `vnext_pg17_writer` login identity with no role membership or elevated role attributes. Its checked-in deployment ACL manifest grants only target-schema `USAGE` and `SELECT` on the exact M1-M15 control-plane relations; it grants no direct table DML, schema/database creation, temporary-object, function-execution, or default privileges.
- The exact catalog treats any writer role, membership, schema/database/TEMP, table, function-execution, or owner default-ACL drift as fail-closed. It explicitly rejects schema-local and database-global default privilege grants, including `PUBLIC` grants that could otherwise leak into future control-plane relations.
- This is local disposable configuration evidence only. The identity remains deliberately read-only: no existing synthetic mutation may use it, and a later command-specific, owner-owned procedure or separately audited limited SQL capability is required before any production write path can exist. No RDS/ECS connection, real credential, API, migration deployment, business data, desktop data, NAS, or removable media was used.

### PostgreSQL 17 account-device-link revocation mutation reference evidence (2026-08-15)

- `shared/vnext-pg17/accountDeviceLinkRevocationMutation.js` is a synthetic-only, same-handle writer for `account_device_link.revoke`. It consumes only an opaque AccessContext assertion and requires desktop `super_admin`, `device.revoke`, and current reauthentication.
- One authority advisory lock atomically revokes a different active target link and advances only that link's auth/access/row vectors. It deliberately leaves account versions and session rows untouched; the existing resolver rejects the target session from the revoked parent link and changed captured vectors.
- Durable receipt, audit, and accepted-outbox companions are replay-checked with canonical hashes, an exact stored execution context, target status/vector verification, and exact payload semantics. Self, missing, stale, already-revoked, changed-idempotency, companion-tamper, and each write-stage rollback path are covered by disposable PG17 tests and the aggregate runner. No RDS/ECS, API/runtime, desktop/business data, NAS/removable media, or deployment integration is included.
