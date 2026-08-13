# vNext Authorization Policy Publication Reference Verification

Date: 2026-08-14

The V4 control-plane reference ledger is an explicitly injected SQLite contract. It is tested only with in-memory synthetic rows and has no cloud, runtime, token, session issuance, HTTP, WebSocket, desktop, source-data or migration integration.

Each authority policy publication is append-only and derives current policy from its maximum contiguous revision. The stored canonical manifest JSON is the published authority policy content; its SHA-256 is an integrity identity. The default policy is not seeded or used as a fallback. SQLite checks record shape and receipt linkage, while a later trusted writer/resolver must re-canonicalize the JSON and recompute the hash before use.

Verification:

    node shared/vNextControlPlaneReferenceKernel.test.js
    node shared/vNextAuthorizationPolicyReference.test.js
    npm run test:vnext-migration
    git diff --check

Passing these commands proves the isolated contract only. Trusted verifier input and AccessContext resolution are still separate work.
