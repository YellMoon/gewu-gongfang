# Local Business Mutation Candidate Inventory: Personal Asset Account Update

## Decision

**No-go.** `personalAssetAccountService.update` is recorded as the first
static mutation candidate required by the synthetic-mutation admission
decision, but it is not admitted for a fictional mutation harness. This
inventory is source-code evidence only. It neither invokes the retained
service nor reads a database, a local path, a business row, or any other
runtime input.

The operation has useful ownership and validation behavior, but its retained
public contract does not establish an idempotency key, stored result, replay
contract, explicit transaction boundary, stage-level atomic rollback contract,
or indeterminate commit/rollback acknowledgement boundary. A future synthetic
adapter must not invent any of those properties. Consequently, no fixture,
adapter, test, runtime registration, or implementation plan is authorized for
this candidate.

## Static Sources Consulted

- Retained module:
  `backend/src/services/personalAssetAccountService.js`
- Focused retained service test:
  `backend/src/services/personalAssetAccountService.test.js`
- Static command caller surface:
  `backend/src/services/authorityCommandRegistry.js`
- Registry wiring test:
  `backend/src/services/authorityCommandRegistry.test.js`
- Governing admission decision:
  `docs/superpowers/specs/2026-08-20-vnext-local-business-repository-synthetic-mutation-admission-no-go-design.md`

These references were inspected as source text only. In particular, the
in-memory SQLite setup in the focused retained test was not executed or used
as a source fixture.

## Retained Public Operation

The exact retained operation is:

```js
update({ actor, accountId, changes = {} })
```

The service is constructed around an injected SQLite-style `db`, a clock, and
an ID factory. The update operation looks up an account by `accountId`, checks
ownership, validates a bounded set of changes, performs one SQL `UPDATE`, and
returns a projected account record. It is synchronous and does not accept an
idempotency key, receipt, replay token, caller-supplied transaction, or
recovery handle.

The retained registry exposes a local authority command named
`personal-asset-account.update.v1`. It takes an envelope payload account ID
and changes object, constructs the actor only from the existing authorization
scope, and calls this retained operation. This is a current local caller
surface, not authorization to reuse it in a synthetic adapter, a PG17
projection, or any remote protocol.

## Observed Retained Semantics

### Ownership and actor boundary

- The actor identity is derived from `actor.userId` or `actor.id`; absence is
  rejected with `ASSET_ACCOUNT_ACTOR_REQUIRED`.
- The operation rejects a blank/missing account ID with
  `ASSET_ACCOUNT_ID_REQUIRED` and a missing account with
  `ASSET_ACCOUNT_NOT_FOUND`.
- The account owner may update it. A non-owner is rejected unless the actor has
  `admin` or `super_admin` in the retained `roles` or `role` representation;
  rejection is `ASSET_ACCOUNT_FORBIDDEN`.
- The focused service test directly proves the ordinary non-owner rejection.
  It does not establish a complete mutation compatibility matrix.

### Accepted change surface

Only these own change keys are allowed by the retained source:

- `provider`
- `label`
- `maskedIdentifier`
- `balance`
- `currency`
- `status`

Unknown keys are rejected as `ASSET_ACCOUNT_CHANGES_INVALID`. The retained
operation rejects secret-bearing fields and unmasked long numeric identifiers
as `ASSET_ACCOUNT_SECRET_FORBIDDEN`. It applies retained validation for
provider, label, masked identifier, finite balance, currency, and status;
status is restricted to `active` or `archived`. Its clock may reject an invalid
time as `ASSET_ACCOUNT_CLOCK_INVALID`.

### Result and state shape

After its SQL update, the operation re-reads the record and returns the
retained projected account object: account and authority/owner IDs, account
type, provider, label, masked identifier, balance, currency, status, and
created/updated timestamps. This is a business-row result and cannot be
treated as an exportable, serializable, cached, projected, or cloud-bound
synthetic result.

## Missing Admission Evidence

The following required semantics are absent from the retained public contract
or unproven by its focused test. They must not be supplied by a new synthetic
harness:

| Required admission evidence | Static finding | Consequence |
| --- | --- | --- |
| Idempotency key | No operation input or retained key | No replay case may be modeled. |
| Stored result/receipt | No receipt, outcome record, or durable result | A second call cannot be represented as retained replay. |
| Replay conflict behavior | No request fingerprint or prior-result comparison | Do not add a synthetic conflict/replay protocol. |
| Explicit transaction boundary | No retained `db.transaction` or public transaction contract | Do not claim operation-level atomicity. |
| Stage-level fault contract | No documented stages or injected-fault tests | Do not add synthetic write-stage faults. |
| Indeterminate acknowledgement/poison contract | No acknowledgement, lease, or poison behavior | Do not model uncertain commit/rollback. |
| Complete mutation parity test | Focused test proves an unauthorized update only | Do not infer successful update, validation, or failure/rollback parity. |

Although the source performs one `UPDATE` after preparatory reads and checks,
that implementation detail is not an admitted transaction, retry, or rollback
contract for a future fictional operation.

## Explicit Prohibitions

This inventory does not authorize any of the following:

- calling `update`, constructing its service, or opening SQLite (including an
  in-memory database);
- creating a fictional fixture, mutation adapter, red-green test, or runtime
  caller;
- copying a personal-asset row, value, masked identifier, timestamp, account
  ID, user ID, balance, or any other business value into a fixture;
- modifying the retained service, registry, callers, database schema, or tests;
- PG17 control-plane writes, writer DML/EXECUTE, receipts, outbox events,
  projections, synchronization, import/export, snapshots, relay work, or an
  identity bridge;
- real SQLite/desktop/D-drive/NAS data, RDS/ECS/API/network access, Docker,
  shell execution against a source database, or deployment/release work.

## Reconsideration Gate

This candidate remains no-go unless a new, separately approved static
inventory documents and references evidence that the retained operation itself
acquired the missing contractual semantics without relying on real business
data. Any such future review must first establish an actual retained
idempotency/stored-result contract and an explicit, testable atomic rollback
boundary for every proposed fault stage. It must then pass a fresh necessity
and safety review before any synthetic code is planned.
