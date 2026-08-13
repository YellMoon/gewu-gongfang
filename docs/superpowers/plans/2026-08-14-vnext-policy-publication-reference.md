# vNext Authorization Policy Publication Reference Plan

**Goal:** Upgrade the injected SQLite reference contract to V4 with an append-only, authority-scoped policy publication ledger for future AccessContext staleness detection.

**Boundary:** The ledger stores an activated canonical manifest JSON, its SHA-256 integrity identity, contract version and ordered revision. It never seeds a default, issues credentials, implements policy publishing, resolves access, or opens a real database. Current policy is derived solely as the authority's maximum revision; the default manifest is only an explicit first-publication candidate, never a fallback.

## Tasks

- [ ] Write red tests for fresh V4, zero seeds, V3 fail-closed, authority-local consecutive revisions, receipt binding, hash/type/time constraints and append-only records.
- [ ] Add `vNext_authorization_policy_publications`, exact V4 schema/trigger contracts, V4 marker, and no-mutation V3 rejection.
- [ ] Add an INSERT trigger requiring active authority, consecutive revision and an accepted `authorization_policy.publish` receipt targeting the same authority with exact expected/committed target versions.
- [ ] Test malformed same-column DDL, foreign-named trigger and public assertion read-only behavior.
- [ ] Record V4 reference-only evidence, run focused/full/diff checks, obtain GPT-5.6-sol quality PASS, then commit only task files and push `gewu/master`.

## Frozen semantics

- `policy_revision` is per-authority and starts at 1; it is distinct from schema, contract, account, session and row versions.
- `policy_contract_version=1` means the immutable content uses the pure policy contract; `canonical_manifest_json` is the published authority content and `policy_manifest_sha256` pins its exact canonical bytes. SQLite validates JSON shape and receipt-field linkage; a later trusted writer/resolver must re-canonicalize and recompute SHA-256 before accepting the publication.
- A successful future publish writes receipt, ledger row, receipt-bound audit and `authorization_policy.published` outbox atomically. This plan defines only the ledger-side insertion invariant, not that handler.
- No ledger row means unpublished; a registry/hash mismatch means unknown. Both must fail closed in a future resolver—never fall back to `DEFAULT_POLICY_MANIFEST`.
