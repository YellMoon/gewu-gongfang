# vNext Read-Only AccessContext Reference Verification

Date: 2026-08-14

The resolver is an injected SQLite `:memory:` reference only. It consumes an opaque assertion from the trusted verifier boundary, reads one V4 snapshot transaction, and returns a frozen AccessContext only when current session, parent entities, all nine captured/current versions and the authority's highest published policy agree.

Focused evidence covers the valid desktop path, fake/raw/cross-boundary assertion rejection, visitor derivation, deny precedence, surface filtering, non-empty scope freeze, no reauthentication evidence, every current-vector mismatch, session time boundaries, five parent-status failures, policy absence/noncanonical/hash failure, strict factory/clock/DB rejection, and an all-vNext-table content/FK/transaction-state fingerprint before and after resolve.

The publication's canonical manifest is the read-time policy authority. The capability catalog is not a second policy overlay; it only provides override foreign-key vocabulary and later writer validation.

Verified commands:

    node shared/vNextAccessContextResolverReference.test.js
    npm run test:vnext-migration
    git diff --check

These results do not establish a production login, token verifier, cloud database, endpoint, route authorization, cache, business migration or deployment. Those need separate bounded work and environment-specific integration evidence.
