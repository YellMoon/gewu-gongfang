# PostgreSQL 17 vNext Policy Publication Mutation Reference Design

## Purpose and boundary

This design adds the first existing-authority PostgreSQL 17 write reference after the completed M1-M15 catalog and read-only AccessContext resolver. It publishes a later policy revision for an already initialized authority. It is synthetic and disposable only. It is not an HTTP route, production writer, policy API, deployment action, data migration, token issuer, or real RDS/ECS operation.

The design must not inspect source SQLite, desktop or business data, `D:` content, NAS/removable storage, or a real server. It must not create an authority, first policy, account, session, credential, contact, capability seed, or default role mapping.

## Authority boundary

The public factory is:

```js
createVNextPg17PolicyPublicationMutation({ runtime, handle, resolver, now, idFactory, testHooks })
writer.execute(assertion, command)
```

The factory accepts exact own-data input only. `runtime` and `handle` must be the same branded disposable pair, and `resolver` must be the closure-branded resolver for that exact handle. The writer derives authority and actor only by resolving the opaque session assertion. It accepts no caller-supplied actor, authority, role, capability, policy revision, or reauthentication claim.

Before a mutation, the resolver context must be desktop, formally `super_admin`, contain `access.manage`, and have a reauthentication expiry strictly after one canonical writer clock instant. The writer reloads the active authority and actor account in the transaction; stale/missing parents fail closed.

## Command and policy input

The exact command is:

```js
{
  type: 'authorization_policy.publish',
  expectedPolicyRevision: positive integer,
  idempotencyKey: nonblank opaque text,
  reasonCode: nonblank opaque text,
  manifest: plain policy manifest
}
```

The command and nested manifest are recursively snapshotted from own enumerable data before policy parsing. Proxy, accessor, symbol, sparse array, prototype, unknown/missing field, invalid time, or malformed manifest input fails closed. The writer uses the existing pure policy contract to obtain canonical manifest text and its SHA-256 identity. It rejects a candidate that removes active desktop `access.manage` from formal `super_admin`; this prevents a policy publication from removing the only configured management path before a separately authorized recovery procedure.

`expectedPolicyRevision = 0` is never an initialization fallback: it records only a rejected receipt (`FIRST_POLICY_BOOTSTRAP_REQUIRED`). The completed bootstrap writer remains the sole first-policy path.

## Transaction and durable effects

The writer first runs the exact M1-M15 catalog assertion, then uses one transaction-scoped authority advisory lock. It checks a prior receipt for `(authority, actor key, idempotency key)` before allocating IDs. Exact replay validates the receipt, policy-publication companion, receipt-bound audit, and optional outbox payload against durable rows; a changed command under the same key is an idempotency conflict.

Fresh execution reloads the highest authority-local policy revision under the same lock:

- missing/current revision mismatch: write a rejected receipt and audit, no publication/outbox;
- canonical manifest equal to the current publication: write a noop receipt and audit, no publication/outbox;
- valid later revision: append exactly one policy publication, accepted receipt, audit event, and `authorization_policy.published` outbox event in the same transaction.

The publication is revision `expectedPolicyRevision + 1`, contract version `1`, and stores the writer-supplied canonical manifest text and hash. The receipt keeps actor/authority, expected and committed policy revision, canonical request/result hashes, and null account version effects. Audit context binds the actor account and the policy revision visible before the write. The outbox payload includes only authority ID, new revision, and manifest hash. No account/device/session/link vector changes occur.

Every test hook failure, SQL error, CAS conflict, receipt guard rejection, or companion failure rolls back every fresh write. The writer exposes stable domain errors only; SQL, verifier, policy, and clock detail are not returned.

## Test contract

Tests use only the disposable PG17 runtime and synthetic bootstrap-derived rows. They must prove:

1. Exact same-handle resolver/assertion authorization; reject fake, foreign, expired, miniapp, non-super-admin, missing-capability, and missing-reauth contexts without writes.
2. Accepted revision increment, canonical manifest/hash storage, receipt/audit/outbox exact fields, and no account/device/session/link mutation.
3. Bootstrap revision zero rejection, CAS conflict, adjacent unchanged noop, A-to-B-to-A later revision, self-lock rejection, idempotency replay/conflict, and same command with a different key.
4. Full rollback after each durable write boundary and catalog/companion tamper fail-closed replay.
5. No business relation, source-data, file, API, runtime, credential, RDS/ECS, or deployment access.

Focused tests join the existing one-runtime PG17 integration runner. The target aggregate and the repository suite remain required; a pre-existing unrelated suite failure must be reported rather than attributed to this writer.

## Non-goals

This reference does not implement first authority bootstrap, recovery, capability/catalog mutation, session issuance, policy resolution cache, API integration, outbox dispatch, real deployment, or business-data migration. A future production writer requires a separate target-adapter, operational, and real non-production RDS validation gate.
