# vNext Authorization Policy Reference Verification

Date: 2026-08-14

`shared/vNextAuthorizationPolicyReference.js` is a pure CommonJS contract. It has no database, filesystem, environment, network, route, Electron, token, session or runtime dependency.

V1 defines only `desktop` and `miniapp` surfaces. Its fixed control-plane baseline is desktop-only `user.review`, `access.manage` and `device.revoke` for `super_admin`; no role bypasses a surface restriction or explicit deny. The contract canonicalizes and hashes policy manifests, effective capabilities and V3-shaped scope evidence, but does not evaluate business ownership or activate per-authority policies.

Verification:

    node shared/vNextAuthorizationPolicyReference.test.js
    npm run test:vnext-migration
    git diff --check

Passing this reference test does not prove a deployed authorization service. Authority policy activation/version evidence, trusted verifier input and read-only AccessContext resolution remain later tasks.
