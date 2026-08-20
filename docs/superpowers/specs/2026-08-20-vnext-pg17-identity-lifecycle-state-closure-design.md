# PG17 vNext Identity Lifecycle-State Closure

## Decision

Extend only the existing five identity relations in the synthetic copy-only
rehearsal so their source states match the approved M2 lifecycle contract.
No target relation, credential, evidence, or API is added.

## State Contract

There is exactly one `active` authority. Accounts may be `active`, `disabled`,
or `revoked`. Devices may be `active`, `risk_limited`, `revoked`, or `retired`.
Installations may be `active`, `revoked`, or `retired`; links may be `active`,
`revoked`, or `expired`.

For devices, installations, and links, only `revoked` requires a non-null
finite `revoked_at`; every other permitted state requires null. Link `expired`
therefore has null `revoked_at`. Existing exact IDs, authority/account/device
FKs, C-collation uniqueness, key fingerprints, positive versions, timestamps,
and relation ordering remain unchanged. The copy never repairs a state,
changes a version, or silently lowers a state.

Historical role/override/scope remains revoked or expired only. Profile
bindings stay opaque and non-authorizing, but an active binding targeting a
non-active account is invalid and fails before target writing.

## Safety Boundary

The target remains same-runtime disposable PG17 and the source remains
in-memory SQLite. Every run validates the exact catalog and an empty set of all
19 target data relations. Source/target rereads use canonical hashes before
commit. Faults after all ten fixed write stages roll back to empty; uncertain
commit or rollback poisons the target.

No receipts, audit, outbox, contacts, sessions, reauthentication, policy,
trust evidence, credentials, device grants, offline licenses, business rows,
writer DML/EXECUTE, procedure, API, CLI, real source, or real cloud resource is
introduced.

## Verification

Test every newly accepted state, each illegal state/revocation-time pairing,
active profile binding against disabled/revoked accounts, logical reread and
ordering equality, full rollback, terminal poison, target nonempty/catalog
drift, and the fixed SQL trace. Success is only `identity lifecycle-state
boundary-verified`, not a real migration or release claim.
