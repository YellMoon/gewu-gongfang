# vNext Local Business Repository Synthetic-Compatibility Admission

## Decision

Before any repository adapter is implemented, freeze a synthetic-only
compatibility contract for local business repositories. The contract preserves
existing public domain behavior while preventing a future adapter from reading
real local data or turning any business record into a PG17 control-plane source.

## Static Interface Inventory

The future pilot must begin with a static code-level inventory, not a database
scan. For every selected repository interface it must record: module owner,
public operation, input/output shape, transaction boundary, stable error codes,
caller surface, and existing focused test. It must exclude raw SQL helpers,
filesystem path helpers, bulk exports, snapshot readers, attachment readers,
and any function that returns a physical path or an unbounded row set.

The first pilot must name exactly one low-risk, read-only business interface
after this inventory exists. It cannot combine multiple repositories, write
operations, sync queues, question-bank content, exports, attachments, or task
dispatch.

## Synthetic Adapter Contract

- The adapter accepts only closure-owned synthetic fixtures; no path, database
  handle, connection string, environment fallback, or generic query callback
  is part of its public configuration.
- For admitted synthetic inputs, it returns the same domain result and stable
  error semantics as the retained local repository interface. A result may
  contain a closure-owned synthetic domain object only inside the test process;
  it must never be serialized, cached, projected, transmitted, persisted, or
  derived from a real business row.
- Empty state, not-found, validation failure, and conflict behavior must be
  deterministic and demonstrated by existing-domain plus adapter tests. A
  read-only operation never begins or executes a write transaction; on success
  or failure its synthetic fixture fingerprint remains unchanged. Any future
  write interface requires a separate transaction and rollback admission spec.
- The adapter cannot make HTTP, websocket, cloud, filesystem, shell, Docker,
  or database calls, enumerate files, or expose a raw backend handle.
- It cannot produce a PG17 insert, a control-plane projection, an offline sync
  operation, a snapshot, or a reverse write to a local repository.

## Preservation Rule

The local repository remains the sole business implementation and source of
truth. A synthetic adapter is a test seam only; it neither replaces the local
repository at runtime nor creates a second authoritative store. Existing
transactions, ownership constraints, business validation, and user-facing
error semantics remain governed by the local implementation.

## Verification Gate

A future pilot may proceed only when tests prove all of the following:

1. the static inventory is exact and every selected public operation has an
   identified owner and existing domain test;
2. synthetic success, empty, not-found, validation, and conflict fixtures are
   behaviorally equivalent to the local interface contract, and both success
   and failure preserve the synthetic fixture fingerprint;
3. adapter configuration rejects extra fields, accessors, proxies, paths,
   database handles, raw query callbacks, and network/filesystem hooks;
4. trace or dependency evidence proves zero network, zero real SQLite, zero
   file enumeration, zero cloud call, and zero PG17 write; and
5. no adapter output contains a real or persistent business row, attachment,
   path, raw contact, snapshot, or control-plane projection; any synthetic
   domain result remains process-local and non-serializable.

## Non-Goals

This is not permission to read a real business repository, alter existing
business logic, build a business PG schema, export data, create a cloud relay,
enable writer DML/EXECUTE, modify miniapp routes, access RDS/ECS/NAS/D-drive,
or perform a multi-endpoint release. A real repository rehearsal remains behind
the separately frozen source inventory, minimized snapshot, rollback, and
multi-endpoint authorization gates.
