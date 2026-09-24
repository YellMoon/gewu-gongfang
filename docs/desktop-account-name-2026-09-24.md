# Desktop account-name correction (UTF-8)

## Finding and correction

The full packaged 8.9.9 runs recorded in desktop-role-review-2026-09-24.md
showed `Cloud account` after session recovery. This was a literal in the cloud
session issuer, not a missing React translation. First registration independently
discarded any cloud name and sealed the generic account label into the vault.

The candidate now reads the selected business account's active teacher grant and
teacher name, constrained by account, teacher ID and tenant. Selection still uses
the existing phone-merge/account resolver. Disabled/ineligible profiles, missing
or ambiguous rows, deleted teachers, overlong/control-character names and names
from a different tenant cannot become the displayed name. The reader returns no
phone number, internal account ID or unrelated student/family name.

Session context has an optional presentation-only `displayName`. Old contexts
without it remain accepted. The cloud issuer and first-login client retain a
valid name; unnamed accounts use `我的账号`. Account IDs, role grants, lease
signatures, authorization and business mutations retain their existing semantics.
No schema, core teaching UI or NAS changes are included.

## Verification

- Cloud regression first failed on `Cloud account` versus `我的账号`; client
  regression first failed on ignoring the returned teacher name. Both now pass.
- Passed desktopRegistrationService, cloudDesktopIdentityService,
  cloudDesktopIdentityServerWiring, desktopAccountDisplayName,
  desktopIdentityClient, desktopIdentityClient.http and root typecheck.
- The name-reader regression is included in the cloud npm-test lifecycle.
- Frozen committed source `9605c30f1428e7557ce8e985e224bf70df0851bc` passed all
  183 expanded cloud npm-test lifecycle commands, exit 0. Receipt directory:
  `gewu-frozen-cloud-bundled-tests-20260920-wkq85bcl` (Sep 24 execution; retained
  harness prefix). This includes real disposable PostgreSQL original-course,
  original-student, schedule confirmation/undo, financial ledger and role-scope
  checks. The archive excludes all six unrelated tracked dirty files and
  protected untracked output work. No production migration was run by these tests.
- Production read-only receipt `gewu-desktop-name-read-20260924-t_2vcnm2/report.json`
  used the actual application database role, not an owner/admin role. The new
  reader matched the existing marked E2E teacher's stored name. Mismatched teacher
  IDs and a different tenant returned null. A role-only administrator returned
  null, so no name is fabricated. The transaction was rolled back; no account,
  grant or teacher data changed. Reports contain booleans and the source digest,
  not names or credentials.

## Pending release and device-name finding

This is candidate source, not proof of a newly deployed cloud or published
desktop. Current public versions remain desktop 8.9.9 and cloud 8.11.22 until
separate release receipts exist. Device names remain unresolved: the registration
request omits the local name, the trusted-device table has no name field, and
the list service explicitly emits null. Completing that path requires proper
cloud-owned metadata storage and compatibility tests, not a cosmetic placeholder
or reconstructing names from audit payloads. Keep silent device registration and
the original user/business data intact. Release the compatible changes only
after frozen-source tests, backup/deployment and packaged validation.
