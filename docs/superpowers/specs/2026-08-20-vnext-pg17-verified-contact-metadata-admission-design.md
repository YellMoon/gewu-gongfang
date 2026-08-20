# PG17 vNext Verified-Contact Metadata Admission

## Decision

Approve one future synthetic copy-only boundary for the already-provisioned
`vnext_verified_contacts` target relation. The source collection is currently
rejected; only a later single-table implementation may admit structurally
validated historical metadata for the three V5 contact types: `phone`,
`wechat_openid`, and `wechat_unionid`. It does not implement a contact writer, lookup,
normalization service, login factor, recovery factor, reauthentication factor,
or session admission rule.

## Why This Is the Next Small Slice

The target relation depends only on the completed authority/account identity
topology and is the sole remaining direct metadata relation in the rehearsal
allow-list that is currently source-rejected.
It can be tested entirely with synthetic opaque values in memory and the
existing disposable PG17 target. Session/reauthentication would make contact
status operational and require the separately rejected identity bridge;
receipt/policy/bootstrap/trust groups each require their own semantic closure.

Two narrower or broader alternatives are rejected:

- importing only revoked contacts would lose valid historical metadata without
  reducing the privacy boundary;
- importing contacts together with session, reauthentication, or a credential
  writer would turn archived metadata into current authorization state.

## Source and Target Contract

The synthetic source accepts only exact own-data rows with these target fields:

`contact_id, authority_id, account_id, contact_type, normalized_value_hash,
verification_state, verification_evidence_hash, verified_at, revoked_at,
row_version, created_at, updated_at`.

`contact_id`, `authority_id`, `account_id`, `normalized_value_hash`, and
`verification_evidence_hash` are opaque, nonblank text. The two hash-named
fields deliberately do not gain a SHA-256 shape requirement: V5 only freezes
opaque nonblank text. The exact row shape must reject fields such as
`phoneNumber`, `openId`, `unionId`, `rawValue`, a normalization rule, a
verification channel, or raw evidence. The two opaque fields themselves are
never parsed, normalized, looked up, or interpreted as contact values.

`contact_type` is exactly one of `phone`, `wechat_openid`, or
`wechat_unionid`; `verification_state` is exactly `verified` or `revoked`;
`row_version` is a positive safe integer; all non-null timestamps are canonical
finite UTC instants; and `updated_at >= created_at`.

Lifecycle is exact:

- `verified` requires non-null `verified_at` and null `revoked_at`;
- `revoked` requires both `verified_at` and `revoked_at` to be non-null.

Every row must point to a mapped account in the single mapped authority. The
source must preflight the target's non-partial unique identity
`(authority_id, contact_type, normalized_value_hash)`, including revoked rows.
This means a revoked historical contact continues to reserve that identity and
cannot be copied to another account in the same authority.

An admitted `verified` contact may be attached only to an active mapped account.
A revoked contact may remain attached to a disabled or revoked account as
historical metadata. This admission check is explicit source validation, not a
claim that PostgreSQL's foreign key supplies current authorization semantics.

## Safety Boundary

The target copy is historical metadata only. A `verified` state must not create
or revive a login, current reauthentication, recovery authorization, password,
passkey, session, token, installation credential, device grant, offline license,
or contact lookup. No code in this slice may read a contact to resolve an
AccessContext or authorize a current command.

Only the existing runtime-issued copy-only facade may add fixed, fully-qualified
`INSERT` and reread `SELECT` statements for `vnext_verified_contacts`. The
facade remains bound to one disposable runtime/target transaction, has no raw
database client escape hatch, and rejects all DDL, DCL, role changes, trigger
changes, temporary objects, procedures, COPY, dispatch, or unlisted SQL.

All failures—including source validation, target non-emptiness, catalog drift,
each verified-contact write-stage fault, reread mismatch, uncertain COMMIT, or
uncertain ROLLBACK—must either restore all 19 data relations to empty or poison
the disposable target. Source logical fingerprints must remain unchanged.

## Verification Contract

The later implementation must prove with synthetic fixtures:

1. valid `verified` and `revoked` rows reread from PG17 with equal logical
   hashes and redacted row counts;
2. each lifecycle, enum, timestamp, version, cross-authority, duplicate
   authority/type/hash, unexpected raw-contact fields, other extra fields, and
   missing-field input
   fails at the source with zero target writes;
3. `verified` contact on a disabled or revoked account fails at source, while a
   revoked contact on either remains historical metadata;
4. the verified-contact write stage and its post-read mismatch roll back all 19
   target data relations; terminal transaction uncertainty poisons the target;
5. static trace evidence contains only the existing transaction/catalog/empty
   checks plus the fixed verified-contact INSERT and reread SELECT; and
6. sessions, reauthentication, receipts, audit events, outbox events, policy,
   trust evidence, and dispatch counts remain zero.

## Explicit Non-Goals

This design does not authorize real contact migration, contact discovery,
normalization, SMS/WeChat verification, credential recovery, current identity
proof, session or reauthentication import, writer DML/EXECUTE, procedures,
HTTP/API/CLI work, RDS/ECS access, desktop/D-drive/NAS access, or business-data
copying. Any future operational use of contact metadata requires a separate
identity/reauth admission design and independent safety review.
