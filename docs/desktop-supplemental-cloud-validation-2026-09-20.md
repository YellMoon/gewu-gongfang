# Confirmed desktop drafts against production - 2026-09-20

## Passed real seven-entity loop

Evidence: `gewu-real-draft-chain-20260920-fr93o3da/receipt.json`.
Test marker: `codex-e2e-8.11.14-c99b977950362b0e`.

The actual desktop identity REST client, business-draft mapper, authority client,
and command outbox were composed, using an ephemeral AES-GCM store. The public
cloud was 8.11.14. Each draft remained awaiting confirmation with zero network
requests until explicitly confirmed. This is not an installed-desktop UI test
or a test of physical network disconnection.

Institutions, schools, rooms, teachers, students, courses and schedules were
created through those modules: all seven returned HTTP 201 and appeared in the
cloud desktop projection. A confirmed schedule move returned 200 and read back
the intended local time. Reusing the earlier baseline returned 409, retained a
conflict in the outbox, and did not overwrite the moved schedule. No request
used the retired authority-command relay.

All seven generated records were removed through the same confirmed REST
path, with HTTP 200 and a final absence check. Deletion retains ordinary cloud
audit/tombstone history; it does not erase that history.

Authentication used a controlled server-issued verification fixture followed
by the real online-registration API. It did not test password/WeChat login UI.
Only the newly generated test installation/device/session/link were revoked
afterward. Their active counts are all zero. Runtime writer membership in both
control-plane and business owner roles was false before and after the run; no
GRANT/REVOKE of runtime owner membership was used. No personal login was needed.

## Expansion found a real production failure

Evidence: `gewu-real-draft-chain-20260920-v7rlp6t8/receipt.json`.
Test marker: `codex-e2e-8.11.14-490b0599a3ea7574`.

The subsequent 12-type expansion stopped at payment creation: HTTP 503,
`CLOUD_ONLINE_IDENTITY_UNAVAILABLE`. The seven preceding records were removed
and their absence verified; the isolated device/session/link/installation were
revoked. No production write success is claimed for the five supplemental
types in this failed run.

Read-only production privilege checks showed that the writer can already
write supplemental tables, but cannot read the student/schedule columns used
by the existing reference-validation SELECTs. A disposable PostgreSQL 17 test
reproduced SQLSTATE 42501 under the actual writer role.

## Local fixes and regression evidence

1. An additive migration grants only reference columns: student/schedule ID,
   tenant and deletion status, plus imported asset-category ID, tenant, account
   and type. It does not grant full table reads, student names/contact details,
   core-table writes, or owner-role membership.
2. The existing REST API returns millisecond versions, but supplemental tables
   stored microseconds. After the permission fix, the real database test failed
   again: updating a payment with the version just returned by creation matched
   no row. The migration aligns existing stored versions to the already exposed
   milliseconds and installs a monotonic millisecond trigger on the five manual
   tables. Business values are unchanged; two writes in one transaction still
   produce different versions. Historical public baselines remain usable.
3. The same test exposed SQLSTATE 42P08 for an asset with no associated student.
   Added explicit text casts to the create/update null checks; no API fields or
   business rules changed.

Fresh successful checks:

- `node cloud-business-api/sql/supplemental-business-authority.test.js` now
  includes the disposable PostgreSQL runtime test in the existing CI path.
- All five services: create, update, stale update rejection and soft deletion.
- Missing, deleted and other-tenant student references are rejected.
- Another account cannot update/delete a personal asset; referenced categories
  cannot be removed.
- Migration replay preserves business values and the prior external baseline.
- Same-transaction versions advance; student name reads/core writes remain
  denied.
- Supplemental service/routes and desktop draft mapping tests pass.
- Four cloud release verification tests, authority architecture and release
  boundary checks pass. The release verifier now requires the reference grants
  and all five enabled version triggers, so the old healthy-looking state will
  not pass this gate again.

The PostgreSQL least-privilege skill informed the narrow column grants and
explicit denial regressions instead of owner-role escalation.

## Deployed and verified against production

Cloud 8.11.15 was deployed from committed revision
`d261b4081896eb22bd306bd2bea8a517a6b8d25e`, not the dirty working directory.
Image tag: `gewu-cloud-business-api:8.11.15-d261b4081896`.
Evidence: `gewu-cloud-81115-release-20260920-bmxi4owh/active.json`,
`execution.json` (exit 0), and `deployment.log` under the current Windows Temp.
Public health returned cloud authority, PostgreSQL and version 8.11.15.
The deployment also verified the gateway's four retired-authority endpoints,
WebSocket rejection, and the database permission contract, including the new
reference-column grants and five version triggers.

Recovery points, created before migration/promotion:

- Code: `/root/scheduling-backups/cloud-code/20260919-194310-bc6ec22f/code.tar.gz`,
  SHA-256 `7ea5b395a960740c34ed889027d32ba8c587e4509ac3e24dbd20a2ded78cf5b2`.
- Previous cloud 8.11.14 image:
  `sha256:a7d8fdf6753f49aac21f1061e953a3dd5b98f1842ae242505f70ad8bf9ea40b8`.
- Database: `/root/scheduling-backups/postgres/20260919-195238/gewu_cloud.dump`,
  SHA-256 `450a71425c6b64757dc0217b66e28b4bb5c1997aafaa369cb7982c382d68439d`.
  An isolated restore and the ownership/privilege fingerprint comparison passed.
  The migration ledger applied only `20260920-supplemental-runtime-contract.sql`;
  previously applied migrations were skipped. Untracked SQL was not deployed.

Fresh real-API evidence:
`gewu-real-draft-chain-20260920-u8p6ghks/receipt.json`.
Marker: `codex-e2e-8.11.15-2d59cf13c71a1bf0`.

All twelve types passed creation (201), update (200), rejection of an earlier
version (409), and deletion (200), with projection read-back checks:
institution, school, room, teacher, student, course, schedule, payment,
consumption, grade, personal-asset-category and personal-asset-record.
The schedule's moved local time was preserved after the rejected stale update.
Before every explicit confirmation, submitting an awaiting-confirmation draft
made zero network requests. All confirmed commands used the direct cloud REST
client; none used the retired authority-command relay.

All twelve generated records were removed by their exact IDs through confirmed
REST commands and their absence checked. Audit/tombstone history remains.
The generated installation `acceptance-registration-f6b7b14e-eaa4-481e-bea3-848b47bae63d`
and its device/link/session were revoked; all four active counts were zero.
The writer was not a member of either owner role before or after the test.
This was an actual desktop-module/API integration test, not installed-Electron
UI automation, physical offline testing, or password/WeChat login acceptance.

NAS 8.8.3 was retained without a container update. A fresh cloud-recorded heartbeat
was checked at `2026-09-19T19:56:12.573243Z` (age about 95 seconds):
`storage_runtime_receipt_cba5cfd4-4348-4072-97ef-af3f834dc3e3`.
Export/transport/parser-proof contracts remained 3/3/1, with parser SHA-256
`8d3a16cd92f5d01a9bbf8a746dc9115acb6dfb087ec854bc32b9d82e482cf689`.
Evidence: `gewu-storage-live-proof-20260920-hkk_12s1/receipt.json`.

Frozen-source test stages were verified in resumed chunks: the initial complete
run had an abnormal process exit; the interrupted test passed separately, the
remaining main tests passed, and post-tests passed after supplying the historical
Git reference needed by their fixtures. Final post-test receipt:
`gewu-frozen-cloud-tests-20260920-tpiunq84/receipt.json` (exit 0).
This is not a claim that one uninterrupted `npm test` invocation passed.
Fresh supplemental PostgreSQL, release-verifier (4 cases), version classifier,
independent-version and release-matrix tests also passed.

The matrix has verified cloud and retained-NAS receipts only. Desktop remains
8.9.8 and miniapp 8.8.5; neither was published again in this cloud repair.
This is a partial release, not completed multi-end acceptance.

The Word visual gate, desktop window interactions and full multi-role miniapp
page audit remain separate unfinished acceptance work.
