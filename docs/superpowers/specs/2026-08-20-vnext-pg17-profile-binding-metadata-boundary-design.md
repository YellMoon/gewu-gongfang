# PG17 vNext Profile-Binding Metadata Boundary

## Decision

Add exactly one synthetic copy-only relation: `profileBindings` to
`vnext_profile_bindings`. This is opaque account metadata, not a business
profile migration and not an authorization writer.

## Scope and Safety

Every run replays the approved nine-relation identity and historical-
authorization closure, then maps exact own-data rows with:
`binding_id`, `authority_id`, `account_id`, `profile_type`, `profile_id`,
`status`, `evidence_hash`, `row_version`, `created_at`, `updated_at`, and
`revoked_at`.

Rows must reference the one source authority and an existing account; use only
`teacher|student`, `active|pending|revoked`, positive safe-integer versions,
finite canonical instants, and the V5 lifecycle. `profile_id` and
`evidence_hash` are opaque nonblank text. They are never interpreted as
business-table keys or forced into a hash format.

The runtime facade retains no generic SQL ability. It gains only static,
fully-qualified profile INSERT and sorted post-write SELECT entries. Source and
target hashes must match before commit. A report exposes only counts and
hashes, including active profile-binding count. Active profile bindings are
explicitly non-authorizing; active role, override, and scope counts stay zero.

The target remains same-runtime disposable PG17; source stays in-memory SQLite.
Every target data relation must be empty and exact M1-M15 catalog checks pass
before writing. All ten write-stage faults roll back 19 target relations.

Contacts, receipts, audit, outbox, sessions, reauthentication, policy, trust
evidence, and legacy collections remain non-writing boundaries. There is no
writer DML/EXECUTE, procedure, API, CLI, real source, real database, business
profile table, default binding, or contact-verification logic.

## Verification

Tests prove exact validation, lifecycle and both active unique keys, target
reread hashes, ten-stage rollback, profile-only mismatch rollback, empty-
target/catalog rejection, trace closure, ordering invariance, and exclusion of
all remaining collections. Success is only `profile-binding metadata boundary-
verified`, never a complete migration or release claim.
