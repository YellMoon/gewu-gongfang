# vNext PostgreSQL 17 Production Control-Plane Adapter Design

**Status:** read-only deployment-boundary checkpoint. The later 2026-08-20
identity-bridge feasibility decision supersedes every prospective writer-path
statement below: no production command adapter is admitted yet.

## Purpose

This design prepares the already verified PostgreSQL 17 control-plane contract
for a later RDS deployment without connecting to an RDS instance, reading any
desktop database, importing business data, or exposing an HTTP route. It keeps
the local data host and removable-drive question bank as the authority for all
business data. The cloud database may contain only the vNext control-plane
relations already defined by the M1-M15 PostgreSQL manifest.

The design is a bridge between the disposable reference implementation and a
future production deployment. It is not a decision to create an RDS instance
or to cut over any client.

## Alternatives considered

1. **Replace the Backend SQLite database with PostgreSQL.** Rejected. The
   Backend SQLite database contains business-domain data and would violate the
   approved boundary that cloud PostgreSQL is control-plane only.
2. **Create an isolated control-plane adapter beside existing Backend and
   Gateway databases.** Chosen. It can expose only reviewed authorization
   commands and projections while preserving the current local-business paths.
3. **Import all legacy business tables into PostgreSQL first.** Rejected for
   now. The frozen source dictionary explicitly requires a per-domain
   repository contract, shadow import, catch-up, restore rehearsal, and
   rollback evidence before any business-domain data becomes eligible.

## Boundary and ownership

The adapter owns a dedicated PostgreSQL database and the M1-M15
`vnext_control_plane` schema only. It never reads from or writes to a local
SQLite business database, question-bank content, personal assets, file-object
locations, NAS paths, removable drives, or legacy session/token records.

The existing modules in `shared/vnext-pg17/` remain the semantic oracle. A
production adapter must not fork their policy canonicalization, receipt
idempotency, access-context, bootstrap, recovery, role-mutation,
policy-publication, or device-link-revocation behavior. It may replace only the
disposable handle with a production-safe connection boundary.

## Connection and role model

The deployment supplies four separate database identities through a secret
manager, never through a committed connection string or browser-visible
configuration:

| Identity | Production use | Forbidden capability |
| --- | --- | --- |
| schema owner | non-login owner of schema, tables, and guard functions | login and application use |
| migrator | explicit operator-run migration command | normal HTTP serving and bootstrap data seed |
| writer | reserved deployment identity; currently `USAGE + SELECT` only | every table DML, function `EXECUTE`, DDL, trigger/role changes, and arbitrary SQL |
| verifier | read-only AccessContext reads | all DML and function execution except explicitly reviewed read helpers |

The runtime obtains a bounded `pg` connection pool through dependency injection.
It sets UTC timezone, statement timeout, lock timeout, application name, and
TLS verification before any command transaction. It does not read `PG*`
environment fallbacks, return connection details, or log secrets, SQL text,
raw assertion presentations, tokens, signatures, backup contents, or request
bodies.

## Migration boundary

Migration is an explicit operator action, not an application-start side effect.
The migrator first verifies the intended dedicated database identity, the
approved M1-M15 manifest sequence and checksums, the exact catalog assertion,
and an empty or known ledger state. Any unknown object, checksum, prior partial
apply, privilege drift, or catalog mismatch fails closed without repair.

The migrator applies only forward checked-in migrations in one ordered ledger.
It never uses `CREATE IF NOT EXISTS`, automatic `ALTER`, schema repair, or a
legacy-data import. A production rollback means stopping the adapter, restoring
a separately verified pre-change backup into a new isolated target, and routing
no traffic to the failed instance; it does not mutate or downgrade an active
ledger in place.

## Command and read boundary

The only admitted production-shaped boundary in the current phase is the
read-only verifier path. It can rebuild an AccessContext from a separately
authenticated presentation, but that opaque assertion is a process-local
boundary rather than a PostgreSQL-verifiable command identity. It must never
be treated as authority to grant a writer `EXECUTE` or any table DML.

The existing receipt, audit, outbox, lock and CAS contracts remain semantic
oracles for later command-specific work. They do not by themselves identify
the database caller. Consequently this design neither admits bootstrap,
recovery, policy publication, role grant/revoke nor account-device-link
revocation to a production adapter. Bootstrap and recovery remain reference
operator ceremonies only; no localhost, first-call, existing SQLite-admin,
desktop-device, or legacy-token bypass is permitted.

Before a single command can be admitted, a separately approved identity bridge
must prove a non-shared, database-verifiable, command-bound and single-use
execution fact that the writer cannot create, read-and-reuse, swap, or forge
through session settings. Only then may a separate command-specific procedure
design consider the existing canonical receipt/audit/outbox and CAS contracts.

## Environment and data isolation

Development, disposable test, shadow/staging, and production use independent
instances, credentials, TLS materials, network allowlists, backup namespaces,
and migration identifiers. No environment shares an RDS instance merely by
using a different schema. Only Backend/Gateway services deployed in the same
private VPC may reach production RDS; desktop and miniapp clients never connect
to it directly.

Existing business runtimes remain on their current authority path until a
separate domain-specific migration is approved. This design creates no
dual-write, no shadow import, no source snapshot, no data seed, no automatic
administrator, and no active client session.

## Required proof before real provisioning

Before any real RDS creation or connection, an independent authorization must
provide the target region/VPC, exact fixed-HA TLS-capable SKU, budget, RPO,
RTO, backup retention, restore target, secret-management mechanism, and
network allowlists. The implementation then must prove on a disposable
non-production RDS instance:

1. exact M1-M15 migration and catalog assertion under production-equivalent
   roles and TLS;
2. negative privilege tests for writer, verifier, and ordinary runtime
   identities;
3. after the identity bridge and the relevant command-specific procedure have
   passed their own approval, command/replay/CAS behavior with synthetic values
   only;
4. backup and isolated restore of an empty schema and a synthetic populated
   control-plane database;
5. bounded connection, timeout, failover, and restore behavior compatible with
   the selected RPO/RTO; and
6. an all-client compatibility matrix proving that no desktop, miniapp, or
   existing business route has silently switched authority.

Until every proof succeeds and deployment authority is granted, the current
local disposable tests remain the only execution path.

## Non-goals

This design does not create RDS/ECS resources, add a connection string, create
an API, migrate or read real data, provision a first authority, issue a token,
verify a signature, perform a backup, import a business table, run an outbox
worker, package a desktop app, or publish a client release. It also does not
grant a writer DML or `EXECUTE`, define an identity bridge, or claim that the
current verifier boundary can authorize a mutation.
