# vNext Control-Plane Reference Kernel Verification

Date: 2026-08-14

## Boundary

The artifact is a synthetic, in-memory SQLite reference kernel. It has no database path selection, environment fallback, cloud connection, gateway integration, file access, NAS access, removable-drive access, API route, WebSocket, credential issuance, session schema, offline-license schema, or business-data migration behavior.

It is deliberately not production cloud DDL. No target cloud database has been selected or changed by this task.

## Verified invariants

- All reference objects use the `vNext_` namespace and leave a pre-existing legacy table and its row unchanged.
- Bootstrap creates no identity, authority, grant, device, installation, link, capability, audit, session, license, credential, or business seed data.
- Opaque IDs are non-null and non-blank. Legacy `admin` is rejected; formal roles are only `super_admin`, `teacher`, and `student`.
- Authority-scoped composite foreign keys prevent orphan accounts, device installations, and mismatched account-device-installation links.
- A device installation requires non-blank public-key and fingerprint evidence. Active role, capability, scope, and profile constraints reject conflicting active records while allowing revoked history.
- Verified-contact lifecycle checks, version lower bounds, time validation, audit idempotency, and audit append-only triggers are enforced by SQLite.
- Reapplication accepts only the matching schema. A malformed pre-existing table, removed required index, or replaced audit trigger fails closed. Injected statement and clock failures leave no partial `vNext_` objects.

## Required checks

```text
node shared/vNextControlPlaneReferenceKernel.test.js
npm run test:vnext-migration
git diff --check
```

The next task is not deployment or migration. It requires a separate necessity review before adding a mutation service, session/reauth resolver, selected cloud database DDL, or any real-data rehearsal.
