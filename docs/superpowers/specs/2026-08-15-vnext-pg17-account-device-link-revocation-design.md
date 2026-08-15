# PostgreSQL 17 vNext Account-Device-Link Revocation Design

## Decision

Add one synthetic-only PostgreSQL 17 writer for the already mapped
`vnext_account_device_links` relation. It exposes exactly one
existing-authority command: `account_device_link.revoke`. It derives all actor
and authority data from an opaque assertion resolved by a same-handle branded
PG17 AccessContext resolver. It is not an HTTP route, runtime adapter, seed
mechanism, production migration, or real cloud operation.

This is the PG17 counterpart of the approved SQLite reference contract. It
revokes one *other* active account-device link and invalidates that link's
captured sessions through the existing resolver's link status/vector checks.
It deliberately does not change any account-wide version.

## Inputs and authorization

The factory accepts exact own-data
`{ runtime, handle, resolver, now, idFactory, testHooks? }`. It rejects
proxies, accessors, symbols, unknown keys, foreign handles, foreign resolvers,
and invalid clocks. The exact command is:

```js
{
  type: 'account_device_link.revoke',
  targetLinkId: '...',
  expectedTargetRowVersion: 1,
  idempotencyKey: '...',
  reasonCode: '...'
}
```

Only a current desktop AccessContext with formal `super_admin`,
`device.revoke`, and strictly future recent reauthentication can proceed. The
target is loaded only within the actor's authority and may not equal the
current context link.

## Transaction semantics

The writer first verifies the exact M1-M15 catalog. Fresh commands use one
transaction and an authority-scoped advisory lock. They lock the authority,
actor account, target link, and target link's active sessions in stable
identifier order.

For an active target whose `row_version` equals the expected value, the writer
sets the link to `revoked`, fills `revoked_at` and `updated_at`, and increments
only link `auth_version`, `access_version`, and `row_version` once. It does not
modify the target account, device, installation, role, scope, profile, contact,
policy, or business record. Existing sessions are not rewritten: the resolver
must reject them because the parent link is revoked and its captured vectors
are stale.

A missing/non-active target is rejected. An already-revoked target is a
version-independent noop for a new idempotency key. A stale active target is a
stable version conflict. A failed row predicate rolls back the whole
transaction.

## Durable effects and replay

Every fresh outcome writes an immutable receipt and receipt-bound audit event.
An accepted revoke writes exactly one immutable
`authorization.account_device_link_revoked` outbox event after the target,
receipt, and audit. Noop and rejected outcomes write no outbox event.

The receipt's canonical result permanently contains the execution
account/link/policy-revision context. Exact replay validates the canonical
request/result hashes and shape, frozen audit context, target link state and
versions, and the full outbox envelope/payload/hash. It returns the durable
public result without allocating IDs or writing rows. A changed request under
the same authority/actor/idempotency key is an idempotency conflict.

## Tests and boundaries

The disposable PG17 suite must prove accepted revocation, stale target-session
failure, self-target rejection, stale version rejection, revoked noop and
replay, idempotency conflict, fake/cross-handle assertion rejection,
desktop/capability/reauth denial, exact command validation, target/receipt/
audit/outbox rollback, and malformed durable companion replay rejection.

The work remains local synthetic PostgreSQL 17 only. It must not connect to
RDS or ECS, access desktop SQLite/business data/NAS/removable media, generate
or validate credentials, add an API/UI/runtime adapter, seed control-plane
data, import data, or deploy anything.
