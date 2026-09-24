# Desktop silent-registration device names — candidate source

UTF-8. This change is not a new device approval workflow. Native Electron already
derives the computer name; the missing links were the registration request, cloud
storage and account-scoped device listing. No teaching/business UI is redesigned.

## Implementation

- Existing verified-access response advertises `deviceNameSupported: true`.
  Clients send optional metadata only for this exact boolean capability. Older
  servers receive the unchanged registration request; older clients can still
  register without a name. Teacher self-registration retains the capability.
- Optional name is validated before identity assertion issuance and bound into
  the canonical request digest. M29 adds nullable presentation metadata and two
  writer-only functions, leaving immutable M1–M28 untouched. The named function
  calls the existing validated registration transaction; replay cannot overwrite
  a newer name. Names do not grant roles or modify account versions.
- Account device listing uses existing account/authority scoping. Application
  writer has no direct device-table UPDATE privilege. No client device consent
  prompt, manual authorization, or extra login step is introduced.
- M29 deployment uses the exact M28 ledger prefix, a transaction-scoped owner
  grant, post-migration function hashes/privilege checks, and removal of that
  owner grant. It follows the existing database backup gate and precedes business
  migrations. NAS and miniapp need no device-name changes.

## Current verification

Executed on 2026-09-24 in the current checkout:

- `desktopDeviceNames.postgres.test.js`: actual disposable PostgreSQL through
  production adapter; Chinese name persists, exact replay has no side effects,
  tampered names rejected, wrong account/authority see no devices, invalid names
  and downstream collision leave no partial registration, stale replay cannot
  revert a new name, old no-name client works, revoked account denied. Nonwriter
  EXECUTE and writer direct UPDATE denied. Account versions unchanged.
- `cloudControlPlaneM29Upgrade.postgres.test.js`: actual M28 -> M29 SQL execution;
  wrong prefix rejected before changes, final state verified, temporary owner
  membership absent, unauthorized PUBLIC execute grant detected.
- Strict catalog assertion suite, original unified registration mutation suite,
  cloud session control PostgreSQL suite and migration manifest tests passed.
- Registration service/adapter, verified-access, device listing service/repository
  and desktop identity client tests passed. Client test covers capability values
  true/false/string/number and teacher-registration propagation.
- Five M29 Python deployment tests and 56 cloud deployment tests passed; TypeScript
  typecheck exited zero. New tests are included in the cloud posttest lifecycle.

## Remaining release gate

Frozen source `8216bdee` initially passed 145/186 lifecycle commands, then the
new test's host-clock assertion timestamp was rejected. Repeating the isolated
test exposed `VNEXT_ONLINE_IDENTITY_ASSERTION_INVALID`, not an unavailable
database: the helper had hidden that SQL error. The test now uses the database
clock minus one second and exposes raw SQL failures. Production time validation
is unchanged. A complete frozen rerun is required; the failed run is retained at
`gewu-frozen-cloud-bundled-tests-20260920-_7u2exm4`.

Release classification on the owned diff from `b8325f4a` to `8216bdee` is cloud
minor (`8.11.22 -> 8.12.0`) and desktop patch (`8.9.9 -> 8.9.10`). The classifier
now recognizes ADD COLUMN inside JavaScript SQL literals (red/green regression).
The protocol matrix records cloud-first rollout and capability gating. Versions
have not yet been changed; NAS and miniapp are unchanged.

Full frozen-source cloud lifecycle, production backup/migration/deployment, new
packaged desktop real-session smoke and OSS publication have NOT been performed
for this candidate. No production success is claimed. Existing unrelated dirty
files and protected output directories are excluded from this change.
