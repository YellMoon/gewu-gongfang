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
