# vNext Control-Plane Reference V2 Verification

Date: 2026-08-14

## Scope

The V2 artifact is an isolated SQLite schema contract. It uses only explicit injected handles in `:memory:` tests. It does not select a cloud engine, open a file path, read environment configuration, import a gateway or runtime module, create an HTTP/WebSocket route, dispatch an event, or access desktop/NAS/removable-drive/business data.

## Contract evidence

- `vNext_authorization_command_receipts` is append-only and is the unique idempotency authority for `(authority_id, actor_key, idempotency_key)`. It carries a writer-supplied canonical request SHA-256, canonical result JSON plus SHA-256, target identity, expected version, and committed-version receipt fields. SQLite validates result JSON and lower-case 64-hex hash shape; a future writer must canonicalize JSON and verify the content-to-hash match.
- `vNext_authorization_audit_events` is receipt-bound and append-only. It is not a second idempotency store.
- `vNext_authorization_outbox_events` is an append-only, receipt-bound, authority-bound event-intent envelope. It carries valid JSON plus a 64-hex SHA-256-shaped field, but has no delivery status or retry behavior. Delivery attempts and checkpoints require a separate future worker contract.
- Fresh bootstrap has no seed authority, account, capability, receipt, audit, outbox, credential, session, license, or business record. Old reference V1 is rejected explicitly rather than silently changed.
- Tests reject duplicate receipt keys for one actor, malformed JSON, malformed hashes, fractional aggregate versions, cross-authority receipt linkage with an existing second authority, foreign-named objects attached to vNext tables, tampered schema, missing foreign-key enforcement, and append-only violations.

## Frozen next-step rules

The exact version/CAS matrix is in [the V2 implementation plan](superpowers/plans/2026-08-14-vnext-control-plane-reference-v2.md). A future role-grant/revoke mutation service must write target state, version changes, receipt, audit, and outbox in one transaction, with an injected fail-closed authorization guard. That future service is not implemented by this change.

## Checks

```text
node shared/vNextControlPlaneReferenceKernel.test.js
npm run test:vnext-migration
git diff --check
```
