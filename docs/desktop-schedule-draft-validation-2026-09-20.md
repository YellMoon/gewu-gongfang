# Desktop schedule draft validation - 2026-09-20

## Scope and result

Fixed three references to an undefined `adapterError` in the existing schedule
time conversion. They now use the module's existing `businessDraftError` helper.
No date interpretation, scheduling rules, UI, REST schema, or authority boundary
was changed. This is a desktop-only compatible bug fix; no NAS upgrade is needed.

## Regression evidence

Before the fix, `node src/services/desktopCloudBusinessDraft.test.js` failed with
`ReferenceError: adapterError is not defined` instead of the expected
`CLOUD_BUSINESS_DRAFT_SCHEDULE_TIME_INVALID`.

After the fix, all 32 added cases pass: eight invalid values, both start/end
fields, and both create/update operations. No cloud client call is made for any
of these cases. Existing valid local-time and UTC schedule conversions pass.

The actual authority client, command outbox, and business adapter are composed
in an additional regression: an unconfirmed invalid draft remains
`awaiting_confirmation`; explicit submission reports the typed error; its
payload remains intact and it is not marked completed; retry also makes no
network call. The existing outbox status after attempted submission is
`submitted`, not a successful cloud receipt. This change does not add an edit or
repair UI for an already submitted invalid draft.

Fresh successful checks:

- `node src/services/desktopCloudBusinessDraft.test.js`
- `node src/services/desktopAuthorityClient.test.js`
- `node src/services/desktopCommandOutbox.test.js`
- `node public/desktopAuthorityRuntime.test.js`
- `node src/services/desktopIdentityClient.test.js`
- `node src/services/authorityDraftAdapter.test.js`
- `node src/services/browserDatabaseSyncCapture.test.js`
- `node src/services/browserAuthorityProjectionCutover.test.js`
- `node src/services/scheduleDraftComparison.test.js`
- `node src/services/courseRoomDraft.test.js`
- `node scripts/check_cloud_business_authority_contract.test.js`
- `git diff --check`

These are automated local regressions, not a new installed-desktop or production
write acceptance run.

## Release boundary

`node scripts/release-matrix.js assert --target desktop` failed because the
unified manifest for desktop 8.9.8 / cloud 8.11.14 / storage 8.8.3 / miniapp 8.8.5
does not exist. No installer or OSS update was published for this fix. Do not
bypass that gate or overwrite unrelated generated-version edits. The desktop
patch version must be prepared when the compatible release matrix is ready.
