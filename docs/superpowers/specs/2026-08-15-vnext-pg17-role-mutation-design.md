# PostgreSQL 17 vNext Role Mutation Design

## Decision

Add one synthetic-only PostgreSQL 17 writer for the already mapped
`vnext_role_grants` relation. It exposes exactly two existing-authority
commands: `role.grant` and `role.revoke`. It is not an HTTP route, a runtime
adapter, a seed mechanism, or a production database migration.

The writer accepts only an opaque assertion resolved through a same-handle,
branded PG17 AccessContext resolver. It does not accept caller-supplied actor
or authority claims. The injected resolver must produce a current desktop
context containing formal `super_admin`, `access.manage`, and unexpired recent
reauthentication.

## Inputs and authorization

The factory accepts exact own-data `{ runtime, handle, resolver, now,
idFactory, testHooks? }`. It rejects proxies, accessors, symbols, unknown
keys, a resolver for another handle, and a noncanonical clock value. Commands
are exact own-data snapshots:

- `role.grant`: `{ type, targetAccountId, role, expectedTargetRowVersion,
  idempotencyKey, reasonCode }`.
- `role.revoke`: `{ type, targetGrantId, expectedTargetRowVersion,
  idempotencyKey, reasonCode }`.

Only `super_admin`, `teacher`, and `student` are valid grant roles. Grant
creation requires expected target row version `0`; revoke requires a positive
integer expected row version. The writer validates all input before starting a
write transaction and never reads raw verifier presentation data.

## Transaction semantics

After asserting the exact M1-M15 catalog, each command runs in one transaction
under an authority-scoped advisory lock. It locks the active authority, actor,
and target in stable identifier order. Revoke additionally locks the active
super-admin grant set before deciding whether the requested grant is the final
active super-admin. Every affected row uses an exact version predicate; a
missed predicate rolls back the whole transaction as a stable conflict.

`role.grant` verifies an active target account and absence of an active grant
for `(authority, account, role)`, creates one active grant at versions one,
then increments the target account's auth, access, and row versions once.

`role.revoke` rejects a missing/non-active grant, returns noop for an already
revoked grant, and rejects a stale grant version. It must not revoke the final
active `super_admin`. A valid revoke sets the grant to revoked, advances grant
and row versions once, and advances the target account auth, access,
revocation, and row versions once. Existing sessions are not rewritten: their
captured account vectors no longer match, so the existing AccessContext resolver
fails them closed.

## Durable effects and replay

Every fresh command writes an immutable command receipt and receipt-bound audit
event. Accepted grant/revoke commands also write exactly one immutable outbox
event. The result, receipt vectors, audit context, target grant/account state,
and outbox payload are revalidated on exact replay. A changed request under the
same `(authority, actor, idempotency key)` is an idempotency conflict; no replay
allocates IDs or writes rows.

Rejected and noop outcomes retain a receipt and audit but no outbox. Accepted
payloads contain only control-plane identifiers and resulting versions. They do
not contain credentials, raw verifier presentation, signatures, nonces, or
business records.

## Tests and boundaries

The disposable PG17 suite must prove grant/revoke success, exact replay,
idempotency conflict, target/account/grant CAS failure, last-super-admin
protection, current desktop/capability/reauth authorization, cross-handle and
fake assertion rejection, rollback after every durable write, and replay
failure for malformed companions. It must also show the target's former
session fails the existing resolver after an accepted account-vector change.

This work is limited to local synthetic PostgreSQL 17 handles. It must not
connect to RDS or ECS, read or modify desktop SQLite data, touch business
tables, access NAS/removable media, implement tokens or verifier cryptography,
add HTTP/API/UI/runtime wiring, perform data import, or deploy anything.
