# vNext Local Business Repository Synthetic Mutation Admission / No-Go

## Decision

Do not implement a mutation adapter now. Before any synthetic mutation harness
is admitted, create a candidate-specific static interface inventory and prove
that the retained local operation already supplies stable ownership,
validation, and commit/failure behavior; the inventory must characterize any
existing rollback or replay contract before a harness may model it. This decision keeps
the local business repository authoritative and prevents a fictional test seam
from becoming an implicit writer, PG17 projection, sync channel, or migration
path.

The current implementation status is **no admitted mutation operation**. The
earlier personal-asset-account synthetic adapter is read-only and does not
authorize a related write operation.

## Considered Approaches

1. **Recommended: candidate-specific admission, then a fictional-state-only
   harness.** Inspect one existing public mutation statically, freeze its
   retained semantics, and only then decide whether a closure-owned test seam
   is feasible. This has negligible infrastructure cost and keeps all actual
   data sources and services untouched.
2. **Rejected: generic synthetic mutation adapter now.** A generic input/state
   engine would invent transaction, authorization, and replay semantics before
   a retained operation proves them. It would be a second business write model.
3. **Rejected: direct local/PG writer integration.** This would need real
   database authority, operator identity, ownership verification, deployment
   roles, and a cross-endpoint release matrix. The existing identity-bridge and
   writer admission decisions explicitly prohibit it.

## Candidate Admission Inventory

One future candidate may be inspected only at source-code level. Its inventory
must name all of the following before a plan or code is written:

- module owner and exact public mutation operation;
- current caller surface and focused retained-service test;
- exact own-data input shape, actor/ownership checks, stable errors, and
  forbidden input fields;
- retained transaction boundary, commit result, rejection/failure result, and
  conflict behavior;
- whether retained replay/idempotency semantics already exist; and
- the smallest observable state/result fields needed by a purely fictional
  compatibility fixture.

The inventory must reject a candidate when it requires a raw SQL helper,
filesystem path, attachment, question-bank content, export, snapshot, task
dispatch, broad/unbounded query, cloud call, hidden mutable global, or a
business-row output that cannot remain process-local.

No candidate may be inferred from a database scan, a desktop data directory,
an environment variable, a backup, a source export, or a user-provided record.

## Future Fictional-State Harness Contract

If and only if one candidate passes inventory review, its future harness must
have all of these properties:

- The fixture factory accepts only exact own-data, closure-owned fictional
  values; it rejects proxies, accessors, symbols, non-enumerable properties,
  sparse arrays, unknown/missing fields, paths, URLs, secrets, real-looking
  identifiers, and persistent data handles.
- The harness receives an opaque fixture brand rather than a database handle,
  query callback, path, environment object, network client, clock, ID factory,
  or runtime service.
- A successful mutation updates only private fictional state and returns a
  process-local, frozen, non-serializable fictional result. It cannot add a
  projection, receipt, relay event, snapshot, task, file object, or PG row.
- Validation, authorization, and conflict outcomes preserve the fictional
  fixture exactly. An injected internal fault may be modeled only for a stage
  that the inventory proves the retained operation handles atomically, with no
  partial commit; that modeled fault must restore the pre-operation canonical
  fingerprint. A candidate without that retained atomic-rollback contract is
  no-go. An indeterminate commit/rollback acknowledgement and a resulting
  poisoned fixture may be modeled only when the inventory proves the retained
  operation already has that explicit boundary; otherwise this case is
  forbidden.
- The harness may not create replay semantics. A replay case is admissible only
  when the retained operation has an existing stable idempotency key and stored
  result contract. Otherwise the future inventory must mark replay as
  unsupported and the candidate remains no-go.
- Compatibility means retained semantics for the explicitly admitted fictional
  cases only; it never asserts equivalence against real business data or turns
  a test result into a runtime response.

## Required Future Test Gate

A future implementation plan must require red-green tests for:

1. exact inventory input/fixture acceptance and proxy/accessor zero-read
   rejection at every nested boundary;
2. successful fictional commit changing only the intended private state;
3. retained validation, ownership, authorization, and conflict errors leaving
   state and canonical fingerprint unchanged;
4. every injected fault for a retained, explicitly atomic stage restoring the
   entire fictional fixture; candidates lacking that proof are rejected;
5. replay only when retained replay semantics are documented, with the stored
   fictional result returned and no second state transition;
6. immutable/non-serializable result behavior and source-fixture mutation
   isolation; and
7. evidence of zero SQLite/PG/filesystem/environment/network/shell/Docker use,
   zero runtime import/caller registration, and zero control-plane projection
   or sync output.

## Explicit No-Go Boundaries

This specification does not select or implement a candidate, create a fixture,
or authorize any local business write. It forbids all real SQLite/desktop/NAS/
D-drive data, RDS/ECS/API access, PG17 source/projection writes, writer DML or
procedure execution, identity bridges, relay/heartbeat work, bootstrap/trust,
session/reauth, policy publication, task dispatch, snapshots, imports, exports,
and multi-endpoint deployment or release.

Real offline edits remain under the retained local repository and the existing
user-confirmed sync architecture. Any future real source read, migration,
rollback rehearsal, or cross-device release remains subject to separately
approved source inventory, authorization, backup, recovery, and version-matrix
gates.
