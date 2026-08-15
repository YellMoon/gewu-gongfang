# PostgreSQL 17 vNext AccessContext reference design

## Purpose and boundary

This design adds the next target-engine authorization boundary after the completed PostgreSQL 17 M1-M15 schema, first-authority bootstrap reference, and emergency-recovery reference. It is a synthetic, disposable-only reference for rebuilding an immutable AccessContext from a trusted session assertion. It is not an HTTP route, token/JWT verifier, credential issuer, API middleware, production database adapter, policy writer, or data migration.

The design must not connect to RDS/ECS, inspect source SQLite or desktop data, read `D:` or NAS/removable storage, create a real session, or access a business relation. The existing SQLite reference modules remain semantic oracles:

- `shared/vNextTrustedSessionVerifierBoundaryReference.js`
- `shared/vNextAccessContextResolverReference.js`

## Components

### 1. Same-handle trusted-session verifier boundary

`shared/vnext-pg17/trustedSessionVerifierBoundary.js` will expose:

```js
createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding, verifyPresentation })
boundary.verify(presentation)
boundary.unwrap(assertion)
isVNextPg17TrustedSessionVerifierBoundaryForHandle(boundary, handle)
```

`databaseBinding` is an opaque object-identity binding only. The boundary never queries or mutates it. The resolver later requires the exact disposable handle object, preventing assertions issued for another synthetic database from being replayed against it.

The injected deployment verifier is the only component allowed to validate a real presentation in future. This reference accepts only a verifier result with exact own enumerable data shape `{ sessionId }`, a plain-object prototype, and a nonblank opaque session ID matching the existing vNext session-ID grammar. It rejects proxy/accessor/symbol/non-enumerable/extra-key/class-instance/thenable results without reading untrusted getters. It snapshots the string once after a native Promise resolves and stores it only in a closure-private WeakMap.

An assertion is a frozen empty object. It cannot be copied, serialized, manually recreated, moved to another boundary, or unwrapped for a different handle. Verifier exceptions, rejected Promises, invalid results, and unwrap failures map to stable public boundary errors without leaking source details. The boundary does not validate a token, generate or consume nonce material, query PostgreSQL, cache replay state, or expose presentation/result data.

### 2. Read-only AccessContext resolver

`shared/vnext-pg17/accessContextResolver.js` will expose:

```js
createVNextPg17AccessContextResolver({ runtime, handle, verifierBoundary, surface, now })
resolver.resolve(assertion)
isVNextPg17AccessContextResolverForHandle(resolver, handle)
```

All factory inputs are exact plain own-data values. Proxy/accessor/symbol/non-enumerable/unknown/missing configuration, unbranded runtime/handle, another-handle boundary, an unsupported surface, or an invalid clock fail closed as `VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE`. `surface` is fixed at factory creation to exactly `desktop` or `miniapp`; callers cannot claim it per resolve request.

`resolve` unwraps exactly once, takes one canonical UTC instant from `now`, and first calls the exact M1-M15 catalog assertion. It then runs every context-building SQL read inside one explicit `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` / `COMMIT` snapshot through the disposable verifier facade. It must not issue DDL, DML, `SET ROLE`, a transaction-control statement outside that read-only block, or an implicit write. Any query, clock, schema, parse, or validation problem rolls back the read-only transaction and maps to the same unavailable error.

The resolver reads only the control-plane relations below:

1. The session plus authority/account/device/installation/link tuple. Require an online active session, active parents, `issued_at <= now < expires_at`, and equality of all nine captured/current vectors.
2. The current authority-local policy publication, defined only as the highest policy revision. Require contract version 1; parse canonical text, re-canonicalize it through the pure policy reference, and require exact canonical text plus SHA-256 equality.
3. Active-at-time role grants, capability overrides, and data-scope grants for the resolved account. Pass only normalized values to `vNextAuthorizationPolicyReference`; do not read `vnext_capability_catalog` as a second policy truth.
4. The latest currently valid reauthentication event for the resolved online session, filtered by the same authority, time window, and nine session vectors. Return only its expiry timestamp or `null`; never expose factor class or evidence hash.

The result is deeply frozen and has only:

```js
{
  authorityId, accountId, deviceId, installationId, linkId, sessionId,
  surface, policyRevision, policyManifestSha256,
  roles, capabilityIds, capabilitySha256,
  scopes, scopeSha256, reauthenticatedUntil
}
```

Roles are formal active roles, or derived `visitor` when none exist. Capability and scope semantics come only from the frozen policy reference: deny wins, retired/unknown capability fails closed, and scope hashes remain opaque. The resolver does not decide a business-owner/scope intersection, mint a token, update a version, or elevate a session.

## Authorization and concurrency semantics

The resolver is a read model. PostgreSQL `REPEATABLE READ READ ONLY` provides one stable snapshot from the first read through the final reauthentication query; no result may splice policy, vector, or grant data from different transactions. A writer using this context must still run its own lock/CAS transaction and revalidate all relevant state. The context carries policy revision/hash and current identity/version observations for freshness comparison; it is not a durable credential.

The resolver is branded with a closure-private WeakSet and handle identity WeakMap. Future policy, role, and device-link target writers must accept only a resolver branded for their exact handle and only opaque assertions routed through it. A fake object with `resolve`, a copied resolver, a different-handle resolver, or a raw session ID must never establish authority.

## Error contract

The resolver has one public error: `VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE`. It covers malformed config, foreign brands, unavailable catalog, invalid assertion, session/parent/vector/time failure, missing or malformed current policy, malformed grants/scopes, and query/transaction failure. It must not expose SQLSTATE, relation names, credentials, factor/evidence information, raw verifier errors, or presentation content.

## Test contract

All tests use the existing local disposable PG17 runtime and synthetic rows only.

1. Boundary tests: exact config/result, native Promise snapshot, opaque assertion, copied/JSON/manual/cross-boundary/cross-handle rejection, getter/proxy zero-read behavior, verifier failure redaction, and no runtime/database query from the boundary.
2. Resolver factory tests: runtime/handle/boundary binding, exact config, both surfaces, clock rejection, fake resolver/boundary rejection, and no SQL before factory validation.
3. Resolver success: a bootstrap-derived active online session plus a current policy returns the exact frozen context for desktop and miniapp; super-admin receives only the approved desktop policy capabilities and miniapp remains surface-limited.
4. Fail-closed state matrix: each parent status, each of nine vector mismatches, initialization/revoked/expired/future session, policy absence/hash/text/contract/revision failure, role/override time boundaries, deny precedence, invalid scope, no/expired/future reauth, and malformed policy JSON all reject without writes.
5. Read-only proof: before/after logical snapshots of every vNext table, schema catalog, foreign-key/transaction state, and row counts are identical. A separate peer client attempts a write between reads; the resolver result is one coherent snapshot and never contains mixed vector/policy data.
6. Schema drift: a catalog drift reaches the public unavailable error and changes no control-plane row.
7. No business/table expansion: a synthetic non-vNext business-like row remains untouched; no source SQLite, desktop, file, API, or network path is used.

Focused boundary/resolver tests join `runPg17IntegrationTests.js`. The aggregate `npm.cmd run test:vnext-control-plane-target` and the repository suite remain required. Local PG17 passing is necessary but not evidence of production authorization or deployment.

## Explicit non-goals

- No real signature, session-token, password, passkey, contact, nonce, or credential verification.
- No account/device/role/policy/scope mutation, session issuance, reauthentication issuance, outbox dispatch, API, middleware, or server adapter.
- No RDS/ECS connection, production DDL application, source or business-data import, backup/restore, desktop/NAS/removable-media access, package release, or OSS publishing.

## Review and next step

This document deliberately fixes the target boundary before implementation. After written-spec review, the next artifact is a focused implementation plan: trusted-session boundary first, then resolver read snapshot and test integration. Only after the resolver passes its own necessity/quality review may a single existing-authority PG17 writer be selected.
