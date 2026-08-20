# PG17 vNext Link-Revocation Historical Evidence Boundary

## Decision

Add one synthetic copy-only evidence closure for the already-defined
`account_device_link.revoke` command. It maps only validated receipt, audit,
and accepted-only outbox rows after the completed identity lifecycle closure.

## Source Contract

The synthetic source supplies a source-only canonical request envelope with
the fixed revoke command fields: authority, actor key, idempotency key, link
target, expected target row version, and reason code. The rehearsal recreates
canonical request bytes and SHA-256, then accepts a receipt only if it matches
the exact envelope and known link state.

Accepted evidence must reference an already mapped revoked link and match its
committed versions, canonical result, audit context, outbox canonical payload,
and payload hash. Noop and rejected evidence have all committed versions null
and no outbox. Every receipt gets exactly one audit record; accepted gets
exactly one non-dispatched outbox record.

## Safety Boundary

This is historical structural consistency only. It never presents the
historical actor, context, receipt, or result as present authorization and it
never replays the command. Unknown command types, malformed canonical request
envelopes, mismatched hashes, incompatible link state, missing companions, or
generic receipt records fail closed.

It adds no dispatcher, policy, bootstrap, trust evidence, contact, session,
reauthentication, writer permission, procedure, API, CLI, real source, real
database, or business data path. The target remains same-runtime disposable
PG17 and all writes use a runtime-issued static SQL manifest in one transaction.

## Verification

Tests cover accepted/noop/rejected fixtures, request/result/audit/outbox hashes,
companion absence or mismatch, state/version contradictions, target reread
hashes, all write-stage rollback, commit/rollback poison, catalog/empty target
rejection, and zero dispatch. Success is only `link-revocation evidence
boundary-verified`, never an operational command or release claim.
