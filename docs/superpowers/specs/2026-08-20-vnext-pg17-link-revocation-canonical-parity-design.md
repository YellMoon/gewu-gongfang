# PostgreSQL 17 Link-Revocation Canonical-Parity Design

## Decision

Build a local, disposable, read-only compatibility harness for the existing
`account_device_link.revoke` reference command before designing any production
write capability. The harness proves that PostgreSQL 17 can represent and
recompute the command's approved canonical request/result/audit/outbox values
from durable control-plane state without accepting caller-supplied identity,
role, capability, scope, reauthentication, or hash claims.

This decision uses the owner's standing approval to execute frozen vNext
specifications without a separate confirmation. It is not approval to connect
to RDS/ECS or to give a role direct write access.

## Why this is the next slice

The current `vnext_pg17_writer` identity is intentionally read-only. Existing
synthetic mutation modules use the fixture provisioner for arbitrary SQL, so
granting their table privileges to a deployment role would bypass receipt,
CAS, audit, outbox, reauthentication, and recovery contracts.

`account_device_link.revoke` is the smallest existing command that changes an
authority-scoped control-plane row. Unlike bootstrap or emergency recovery it
does not establish a trust root; unlike role and policy mutation it does not
change authorization policy or administrator membership. It is therefore the
lowest-risk command with which to prove canonical compatibility.

## Approaches considered

1. Give the writer direct DML permissions and adapt the existing JavaScript
   mutation. Rejected: arbitrary table access can bypass every durable
   companion and CAS invariant.
2. Add an owner-owned PostgreSQL procedure now. Rejected: it would be forced
   to trust JavaScript-provided actor claims or precomputed canonical hashes
   before parity has been demonstrated.
3. Recommended: create a read-only canonical-parity harness. It consumes only
   synthetic fixtures and the existing read-only verifier/catalog surface,
   compares field-level normalized values and SHA-256 inputs, and adds no
   DDL, grants, or mutation adapter.

## Boundary and API

Add one local-only module under `shared/vnext-pg17/` that exposes a
closure-branded, same-disposable-handle verifier function. Its input is a
plain, exact command envelope containing only:

- `type`, `targetLinkId`, `expectedTargetRowVersion`, `idempotencyKey`, and
  `reasonCode`;
- an opaque trusted-session assertion already accepted by the existing
  AccessContext resolver.

The harness resolves the context through the existing resolver and returns a
frozen, non-sensitive parity report. The report contains the canonical request
JSON and hash, expected result envelope, audit-context hash, and—for accepted
revocation only—the canonical outbox payload and hash. It does not return a
database client, credentials, raw query text, access context, assertion,
session ID, or any write capability.

No actor, authority, role, capability, scope, reauthentication, target status,
or policy revision is accepted from the caller. Those values are read from the
same disposable PostgreSQL handle and resolver output. The harness must verify
the current active authority, desktop surface, `super_admin`, `device.revoke`,
unexpired reauthentication, and the target link status/version before it may
produce an accepted vector.

## Canonical vectors

The sole canonicalization rule remains the existing sorted-key JSON formatter
and UTF-8 SHA-256 used by the reference mutation. The parity harness must not
introduce JSONB serialization, PostgreSQL hash functions, extensions, or a
second formatter.

It must produce and compare these exact cases:

| Case | Result status/code | Durable companion expectation |
| --- | --- | --- |
| current non-self active target at expected version | accepted / `ACCOUNT_DEVICE_LINK_REVOKED` | receipt, audit, and one outbox vector |
| same idempotency key and exact command | replay vector identical to stored durable values | no new vector |
| same key with changed canonical request | `IDEMPOTENCY_KEY_CONFLICT` | no new vector |
| stale target version | rejected / `LINK_VERSION_CONFLICT` | receipt/audit vector, no outbox |
| actor targets own active link | rejected / `SELF_LINK_REVOKE_FORBIDDEN` | receipt/audit vector, no outbox |
| absent or non-active target | rejected / `TARGET_LINK_NOT_ACTIVE` | receipt/audit vector, no outbox |
| absent, expired, or future reauthentication; wrong surface/role/capability | unavailable or unauthorized boundary failure | no vector |

For an accepted vector, the exact context is `{accountId, linkId,
policyRevision}`; the request binds the command fields and context-derived
authority/actor values; the outbox payload binds authority ID, target link ID,
and the post-revoke auth/access/row versions. All JSON bytes and hashes are
compared exactly with the existing JavaScript reference output.

## PostgreSQL read-only contract

Every parity *recomputation* uses a verifier lease and one `REPEATABLE READ
READ ONLY` transaction. Before that recomputation, `inspect` reuses the
existing AccessContext resolver's separate verifier-only read boundary. Across
both read paths it may issue only transaction control and `SELECT` statements;
it must not issue DML, DDL, `SET ROLE`, create temporary objects, call guard
functions, install extensions, or alter grants.

The existing writer remains `USAGE + SELECT` only. This slice adds no migration
16, no function, no function `EXECUTE`, no role privilege, no seed, and no
schema change. It does not import or adapt the existing mutation as a write
path.

## Testing and evidence

Tests use only fresh disposable PostgreSQL 17 fixtures. They compare the
harness and existing reference mutation's normalized request/result/context/
payload strings and SHA-256 values for each golden case. They also show that
wrong or copied assertions, cross-handle use, extra/accessor/Proxy command
objects, SQL drift, and all authorization/reauth failures fail closed without
writing any M1-M15 relation.

Trace evidence must prove the read-only transaction and prohibit DML, DDL,
role switching, temporary objects, and function execution. The existing
catalog, writer-zero-DML ACL, target aggregate, disposable cleanup, and diff
checks remain required.

## Non-goals and admission gate

This is not a production command adapter, a PostgreSQL stored procedure, a
generic writer pool, a direct-DML grant, a migration executor, an HTTP/API
route, a credential verifier, an RDS/ECS connection, or an operation on desktop
or business data.

Only after every golden vector's normalized values, JSON bytes, and hashes
match exactly may a new, separately audited design consider one
command-specific owner-owned write procedure. That later procedure—not this
parity harness—must independently rebuild authority, actor, permissions,
reauthentication, target, and version facts inside its own transaction.
