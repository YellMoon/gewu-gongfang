# Desktop synchronization and historical course addresses

Desktop 8.9.22 is published to OSS and cloud business 8.12.4 is deployed.
NAS 8.8.3 and unchanged miniapp 8.8.26 retain verified compatible contracts. The miniapp has a development upload receipt,
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
Cloud 8.12.4 was deployed from source commit 2d0e0c15b533. The PostgreSQL backup
/root/scheduling-backups/postgres/20260928-172421 was restore-verified, including
ownership and privileges. SHA-256:
d71765ae2ee76c36cf17c12d8ccd3d2ad38974555c1eaa152ad1c983af752058.
Existing migrations were verified without changing the M29 ledger; candidate
and public health/permission checks passed before/after promotion. A fresh
follow-up verified cloud 8.12.4, retirement gateway tombstones, M29 metadata and
the NAS 8.8.3 runtime receipt. Evidence: gewu-sync-cloud-deploy-8124-20260928-riz8h3p0
and gewu-live-closeout-20260929-eugit5pq in local Temp.

C: ran out of space during implementation. All existing dist files were preserved
under D:/Codex-task-artifacts/gewu-sync-20260929/dist, with a junction retaining
the original project path. The previous 8.9.21 unpacked application is preserved
beside that directory. Docker was recovered after stopping its hung processes,
terminating only docker-desktop WSL and archiving stale socket-only directories;
no Docker databases, volumes, images, business records or user files were deleted.
The unrelated docs/desktop-device-name-2026-09-24.md remains untouched (SHA-256
13C7144C09D1260FFBB12F11A6C8A191A4C57A680629FA1A5AEBEE3F49C88E72).

## Final desktop and delivery evidence

Source commit: 2d0e0c15b53375bdacf6c22a05912458be635ab6, pushed to gewu/master.
Build: npm run dist:win passed. Packaged native ABI 119 passed for root/backend;
the script restored and verified Node ABI 137 for both. Native outbox, dependency
batch and actual-component checks passed again after restoration.
Build log: gewu-sync-dist-8922-20260928-okqfea3j in local Temp.
Packaged smoke: gewu-sync-packaged-smoke-8922-20260928-cve1tb9w.

Packaged runtime evidence: gewu-sync-runtime-8922-20260929-hpjfk9r4 in local Temp.
The real renderer/main/preload/native vault used a controlled verified test
teacher account with the deployed cloud. Registration, the shared empty sync
window without a popover, actual menu/device listing and cold restart passed.
Screenshot 02a-unified-sync-empty.png was inspected. This verification did not
write production teaching data. Exact test device/session/installation/link
cleanup counts are all zero. It does not claim password/WeChat consent testing.

OSS publication: gewu-sync-publish-8922-20260928-w9jlae_9 in local Temp.
Public and archived latest.yml match the local feed. The complete public
installer was downloaded and matched the feed SHA-512; archive size/ETag match.
Installer: GewuGongfang-Desktop-8.9.22-x64.exe; 150368262 bytes.
SHA-512: U42HB6mPtW+cKNswyhjo4xSYBtszoLCpGCGDgsozSyENO1P51ZPx85V9SQM1dY9udksVEjZOIHYpMkPiZpCM6g==
Verified at 2026-09-28T17:50:28.642Z.

The version matrix is stored in
output/release-matrix-desktop-8.9.22__cloud-business-8.12.4__storage-proxy-8.8.3__miniapp-8.8.26/active.json.
All component compatibility receipts are verified, but overall publication is
still PARTIAL because the miniapp receipt is development-only. No new miniapp
upload or formal platform publication is claimed for unchanged miniapp source.

The installed user application was read-only checked at 8.9.16. This task does
not install over the running user instance; OSS automatic update to 8.9.22 and
a restart are needed to activate the new desktop interaction on that machine.
