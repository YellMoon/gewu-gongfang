# vNext Session and Reauthentication Reference Verification

Date: 2026-08-14

## Scope

`shared/vNextControlPlaneReferenceKernel.js` is an executable V3 SQLite reference contract used only with an explicitly injected database handle. The tests use `new Database(':memory:')` and synthetic identities. No project desktop database, D: source folder, NAS, removable drive, cloud database, HTTP route, WebSocket, Electron runtime, credential, token, login/logout/refresh API, offline license, data importer, or business writer is accessed.

## Contract evidence

- `vNext_sessions` has opaque IDs and authority/account/device/installation/link composite foreign-key evidence, state snapshots and lifecycle checks. `session_id` is never defined as a bearer credential.
- `vNext_recent_reauthentication_events` stores only allowed factor class, an SHA-256-shaped evidence hash, version vector and time window. It is immutable and rejects initialization, inactive/revoked/expired session state, out-of-window evidence and version-vector mismatch. It is historical evidence only, not a continuing authorization grant; each future AccessContext resolution must independently reload current authority, account, device, installation, link and all relevant versions.
- Exact V3 table/index/trigger assertions fail closed on V1/V2 metadata and same-column semantic drift. The read-only assertion requires, but never enables, SQLite foreign keys.
- This does not resolve an AccessContext. That future task requires frozen role-default capability mappings, surfaces, policy version, deny precedence, canonical scope/hash rules and a server-side trusted verifier result.

## Verification commands

    node shared/vNextControlPlaneReferenceKernel.test.js
    npm run test:vnext-migration
    git diff --check

Expected result: each exits 0. These checks prove only the isolated reference contract; they do not prove production cloud authentication, session issuance, deployment, or migration of real data.
