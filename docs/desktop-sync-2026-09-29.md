# Desktop synchronization and historical course addresses

Release target: desktop 8.9.22 / cloud business 8.12.4. NAS 8.8.3 and miniapp
8.8.26 retain their existing protocol contracts. Publication is pending until
the evidence below is completed. The miniapp has a development upload receipt,
not formal platform publication; the overall version matrix remains partial.

## Correction

The teacher projection previously recognized address IDs and recorded history,
but historical imported courses sometimes store an address name in legacy_room_id.
Production read-only inspection found nine affected addresses: 中杭府、云上学府、
华发天荟、华策中心、琥珀中心、白鹭郡东、蓝月半岛、蓝海国际、马塍路。
The fix uses same-tenant historical courses and lesson snapshots, including
deleted courses/lessons, with unique-name matching and exact-ID precedence.
Teacher delegation follows existing managed-teacher scope. Unused/unrelated
addresses are still excluded, and historical use does not grant ownership.
No production business rows or schema are rewritten by this correction.

Course save resolves the authoritative address ID before creating a genuinely
new typed address. Missing known references and ambiguous names preserve the
open form and show a readable error. Selecting/cancelling a new tag does not
prematurely create an address. Business refresh is independent of question
pagination and rejects results after an identity change.

One scheduler now owns the native outbox and one review modal. Online drafts
submit silently; offline batches prompt once after reconnect and are submitted
only after one aggregate decision. The approved payload and IDs cannot expand
while submission is running. Conflicts stop subsequent submission; resolving
them resumes the scheduler. Offline edits to an existing online draft preserve
the need for explicit review. Completed receipts remain stored but are hidden;
unverified question attachments remain actionable. Question commits still
refresh their authoritative content version and relay assets after commitment.

The Cloud Sync button and navigation requests open this same modal without
leaving the editor. Identity switches unmount the scheduler and stale callbacks.

## Verification

- Native outbox offline merge and real dependency-batch tests passed.
- Actual CourseList save-handler tests cover missing cached cloud addresses,
  canonical IDs, absent known references, new offline names and ambiguous names.
- PostgreSQL tests cover historical/deleted course and lesson links, unique
  names, managed teachers, tenant separation and unchanged maintenance rights.
- Production read-only evaluation of the new scope checks three teacher profiles;
  visible address counts are 0, 1 and 15. It recovers all nine affected names.
- Actual React/Ant Design browser tests verify silent online submission, one
  offline batch decision, no completed history, 1280px/390px layouts and keyboard
  Enter/Escape. Transport in this visual test is controlled, not production writes.
  Evidence: output/desktop-sync-20260929/{wide-pending,narrow-pending,
  empty-after-submit}.png and receipt.json. Screenshots were inspected.
- Typecheck passed; log: gewu-sync-typecheck-8922-20260928-_ctqp_0p in local Temp.
- All 427 npm lifecycle commands passed (430 attempts) through the existing sequential command runner.
  Evidence directory: gewu-sync-segmented-20260928-ehlrjnj2 in local Temp.
  One extracted SQL fixture needed the newly referenced managed_teachers CTE.
  A separate Windows native exit 0xC0000409 at desktopTeacherCourseAccess.test.js
  passed on its exact standalone rerun and the resumed lifecycle. The old sync facade static test was updated to trace the same authorization boundary through the unified scheduler.
- The optional, non-lifecycle src/uiRegression.test.js still fails on an unrelated
  old miniapp role-application string assertion at line 149. The same failure was
  reproduced using its unmodified HEAD source. Relevant sync checks were updated;
  this is not represented as a passing test.

## Recovery points and environment

Before cloud deployment, the running 8.12.3 source archive was saved and its
contents checked at /root/scheduling-backups/cloud-code/20260928-171432.
SHA-256: f3029ead915a14ecbd9344870ce1a29dff2bae93075710f67ad4b7e3bf8dfca7.
Previous image: gewu-cloud-business-api:8.12.3-a32b6e58cf01.
The deployment script additionally creates and restore-verifies a PostgreSQL
backup, checks ownership/privileges, performs migrations and validates health
and permission contracts before promotion. Its final receipt is still pending.

C: ran out of space during implementation. All existing dist files were preserved
under D:/Codex-task-artifacts/gewu-sync-20260929/dist, with a junction retaining
the original project path. The previous 8.9.21 unpacked application is preserved
beside that directory. Docker was recovered after stopping its hung processes,
terminating only docker-desktop WSL and archiving stale socket-only directories;
no Docker databases, volumes, images, business records or user files were deleted.
The unrelated docs/desktop-device-name-2026-09-24.md remains untouched (SHA-256
13C7144C09D1260FFBB12F11A6C8A191A4C57A680629FA1A5AEBEE3F49C88E72).
