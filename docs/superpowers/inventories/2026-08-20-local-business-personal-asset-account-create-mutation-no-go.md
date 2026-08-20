# Local Business Mutation Candidate Inventory: Personal Asset Account Create

## Decision

**No-go.** `personalAssetAccountService.create` is recorded as the second
source-only mutation candidate required by the synthetic-mutation admission
decision. It is not admitted for a fictional mutation harness, and this
inventory authorizes no code, test, service invocation, SQLite access, or
runtime integration.

The retained operation has bounded input validation and a local authority
command surface, but it allocates a new ID and timestamp for every successful
call without accepting an idempotency key or preserving an outcome for replay.
It also has no retained public transaction, fault-stage, rollback, or
indeterminate-acknowledgement contract. A synthetic adapter must not pretend
that an ID factory, a single SQL `INSERT`, or a database uniqueness rule makes
the operation idempotent, replayable, or safely recoverable.

## Static Sources Consulted

- Retained module:
  `backend/src/services/personalAssetAccountService.js`
- Focused retained service test:
  `backend/src/services/personalAssetAccountService.test.js`
- Static local command caller:
  `backend/src/services/authorityCommandRegistry.js`
- Registry wiring test:
  `backend/src/services/authorityCommandRegistry.test.js`
- Governing admission decision:
  `docs/superpowers/specs/2026-08-20-vnext-local-business-repository-synthetic-mutation-admission-no-go-design.md`

These files were inspected as static source text only. The test's in-memory
SQLite setup, retained service, command handler, and all business values were
not executed, constructed, copied, or read as data.

## Retained Public Operation

The exact retained operation is:

```js
create({ actor, authorityId, accountType, provider, label, maskedIdentifier,
  balance, currency, ... })
```

The service instance receives a SQLite-style database, a clock, and an ID
factory. On a successful call, `create` obtains a new value from the injected
ID factory, obtains a timestamp from the injected clock, inserts a fresh
`asset_accounts` row, and returns a projected account record. It accepts no
idempotency key, receipt, request fingerprint, replay token, caller-provided
transaction, recovery handle, or stored-result lookup.

The retained command registry exposes `personal-asset-account.create.v1`. It
forwards the existing envelope payload while setting the authority ID and actor
from the current local authorization scope. That static caller surface is not
permission to expose this operation to a synthetic adapter, PG17, a relay, or
a remote protocol.

## Observed Retained Semantics

### Ownership and input boundary

- Actor identity comes from `actor.userId` or `actor.id`; missing identity is
  rejected with `ASSET_ACCOUNT_ACTOR_REQUIRED`.
- The caller must supply a nonblank authority ID; otherwise the operation
  returns `ASSET_ACCOUNT_AUTHORITY_REQUIRED`.
- Account type is normalized through retained aliases and restricted to the
  retained account-type set; invalid input returns
  `ASSET_ACCOUNT_TYPE_INVALID`.
- The operation rejects secret-bearing input keys and unmasked long numeric
  identifiers as `ASSET_ACCOUNT_SECRET_FORBIDDEN`.
- Provider, label, masked identifier, balance, and currency follow retained
  validation errors. Balance must be finite; an invalid clock produces
  `ASSET_ACCOUNT_CLOCK_INVALID`; a bad generated ID produces
  `ASSET_ACCOUNT_ID_INVALID`.

### Successful state/result behavior

The retained source constructs one fresh account row with status `active`,
uses the generated ID and timestamp, and then re-reads it to return the
projected account object. The focused retained test statically demonstrates a
successful create and a secret-input rejection. It does not establish a
complete create validation matrix, duplicate/competition behavior, retained
replay, a fault contract, or rollback guarantees.

## Missing Admission Evidence

| Required admission evidence | Static finding | Consequence |
| --- | --- | --- |
| Caller idempotency key | No recognized or persisted create input/command field | No retry/replay case may be modeled. |
| Stored result/receipt | No receipt, command outcome record, or result lookup | A repeated call cannot return a retained original outcome. |
| Replay conflict behavior | No canonical request fingerprint or conflict branch | Do not create a synthetic duplicate/conflict protocol. |
| Stable generated identity | Every success obtains a new ID from an injected factory | Do not infer that repeated input addresses the same object. |
| Stable commit timestamp | Every success obtains a clock value | Do not infer byte-identical repeated results. |
| Explicit transaction boundary | No retained `db.transaction` or public transaction contract | Do not claim operation-level atomicity. |
| Stage fault/rollback contract | No documented stages or retained injected-fault tests | Do not add synthetic write-stage faults. |
| Indeterminate acknowledgement/poison | No acknowledgement, lease, or poison boundary | Do not model uncertain commit/rollback. |

The implementation's single `INSERT` is not, by itself, an admission-quality
contract for retries, conflict handling, atomic rollback, or recovery.

## Explicit Prohibitions

This inventory does not authorize:

- invoking or constructing the retained service or command handler;
- opening SQLite, including an in-memory database, or reading any account row;
- creating a fictional fixture, mutation adapter, test, runtime registration,
  ID factory, clock, receipt, replay record, or synthetic result;
- copying a business account, balance, account/user/authority ID, masked
  identifier, timestamp, or any other business value into a fixture;
- changing the retained service, registry, callers, schema, or existing tests;
- PG17/control-plane writes, writer DML/EXECUTE, projection, synchronization,
  import/export, snapshot, relay, task, identity bridge, receipt, or outbox;
- real desktop/SQLite/D-drive/NAS data, RDS/ECS/API/network access, Docker, or
  deployment/release work.

## Reconsideration Gate

This candidate remains no-go unless a later, separately approved inventory
documents and references an actual retained idempotency/stored-result contract
and explicit, testable atomic rollback evidence for every proposed fault
stage. Any change to the retained operation would require its own design,
necessity, safety, compatibility, and verification review before a fictional
mutation harness could even be planned.
