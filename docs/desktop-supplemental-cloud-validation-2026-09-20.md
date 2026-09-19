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

## Not deployed

The new migration and the two SQL casts are pending cloud release. Production
remains 8.11.14; do not report the production payment issue as repaired yet.
Before deployment: create and restore-verify a fresh database backup, preserve
the code/image rollback point, apply the committed migration through the ledger,
deploy the matching cloud code, then rerun all 12 production draft types and
their cleanup checks. Do not silently edit old migration checksums or run the
untracked migration files. No NAS release is required for this repair.

The Word visual gate, desktop window interactions and full multi-role miniapp
page audit remain separate unfinished acceptance work.
