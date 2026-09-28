# Architecture continuation, 2026-09-28

UTF-8. Status: desktop 8.9.21 published / overall partial release. This supersedes the old handoff
checkpoints for current execution; it does not erase historical evidence.

## Recovered baseline

The requested earlier chat stopped after cloud 8.12.0 deployment and desktop
8.9.10 build startup, then hit usage limits. Later repository work superseded
that checkpoint: e95bf5da, release source a32b6e58, desktop 8.9.20, cloud 8.12.3,
NAS 8.8.3 and miniapp development upload 8.8.26. Both local master and gewu/master
matched at the start. Preserve the pre-existing edit to
desktop-device-name-2026-09-24.md and all historical untracked outputs.

Do not revive the obsolete two-installer/manual-host-approval plan in task.md
or the July handoff checkpoint. Current authority is cloud-only, one desktop
installer, silent verified device registration and explicitly confirmed offline
drafts. Do not repeat completed imports, restart AList or upgrade NAS without a
relevant change. No subagents were started in this continuation.

## New verified evidence

- Actual packaged 8.9.20, isolated profile, existing marked teacher fixture:
  real online-registration API, encrypted native vault, ordinary teacher menu,
  real device name, device-list refresh and cold-process session recovery pass.
  Device page and cold home screenshots were inspected. No page errors. Newly
  generated sessions, links, installation and device were revoked; active counts
  all zero. Evidence: gewu-architecture-resume-20260928-xacm0zsv.
- This was controlled verified-account setup, not password/WeChat phone consent,
  physical offline testing, or installing on another person's computer. No
  production business records were changed. The first harness attempt failed
  on a read denied to writer (42501), before registration; the correction uses
  the existing maintenance read connection without granting runtime privileges.
- Fresh public cloud 8.12.3 health, PostgreSQL authority/privilege contract,
  fixed super-admin invariants and M29 function/column/ledger hashes pass.
  Four old endpoints return 410 and two old WebSocket paths return 404.
- Fresh NAS cloud-observed receipt: 8.8.3, parser SHA-256
  8d3a16cd92f5d01a9bbf8a746dc9115acb6dfb087ec854bc32b9d82e482cf689;
  receipt age about 299 seconds at verification. Transport/export/parser
  contracts match. Evidence: gewu-live-closeout-20260928-orkd3khf.
- Draft mapper, cloud-only client, encrypted outbox, authority runtime and full
  miniapp page-inventory check passed. Page-inventory success is not a claim
  that all remaining physical-device or visual scenarios passed.

## Desktop synchronization defects reproduced and repaired

Actual React component regression reproduced three stacked dialogs after two
timer ticks instead of one. It also reproduced a late outbox read opening a
dialog after unmount and a rejected retry still sending the following draft.
The component now owns/destroys its confirmation dialog, blocks re-entry,
invalidates stopped callbacks and stops retries at the first rejection/error.

Real authority-client/outbox integration reproduced a course failing after its
address had completed earlier in the same aggregate batch. Submission now reads
current dependency status while retaining the reviewed payload/allowed IDs, and
skips already completed commands. Both dependency orders send exactly one room
and one course command. Edited or newly unapproved payloads are rejected.

Online courses referencing unconfirmed offline addresses are included in the
offline decision, preventing an implicit offline write. Historical drafts with
no explicit connectivity classification also require confirmation. Existing
REST, permissions, core business windows and database schemas are unchanged.

Fresh focused tests cover one decision for two drafts, cancellation, in-flight
re-entry, new batches, stale component cleanup, conflict-stop, historical draft
classification, changed snapshots and exact dependency submission. New tests
are part of test:business-parity. TypeScript checking passed.

## Desktop release verified

Automatic classification: desktop patch 8.9.20 -> 8.9.21. Cloud 8.12.3, NAS
8.8.3 and miniapp 8.8.26 remain compatible and unchanged. The existing miniapp
development-upload receipt is reused with its original timestamp and explicit
source equality; no new upload or formal publication is claimed.

Initial npm test failed with Windows native exit 0xC0000409 and no assertion
diagnostic. The same app.test.js passed standalone. Original lifecycle commands
were checked individually in order: all 425 commands passed, 426 attempts,
retaining the one native failure and successful rerun. Logs:
gewu-sync-full-20260928-puldlva5 and gewu-sync-segmented-20260928-_t9t3jbf.
Do not describe this as a single successful npm test run.

Self-review checked confirmation snapshots, dependency ordering, lifecycle
cleanup, retry rejection and default test registration. No independent reviewer
or subagent was used. Typecheck and root/backend Node ABI 137 passed.

Source commit 6e2866749450778e77f21aa8c0086b563ae6cd51 was pushed to
gewu/master. The prepared matrix was archived and recreated against this exact
source before packaging; the earlier draft matrix remains in its history.

- dist:win passed; packaged root/backend Electron ABI 119 passed, followed by
  restored root/backend Node ABI 137. Build log: gewu-sync-dist-20260928-98gb36fz.
- Packaged smoke passed: gewu-sync-packaged-20260928-_5er5jxx.
- Final 8.9.21 real online registration, teacher-only devices, device refresh
  and cold-process session recovery passed with no page errors. Device and cold
  home screenshots inspected. Evidence: gewu-architecture-resume-20260928-1qhmt77k.
  New test sessions/links/installations/devices were revoked; active counts zero.
  This remains controlled verified-account setup, not phone/password consent.
- publish:desktop-update passed: gewu-sync-publish-20260928-1j9o7wh1. Current
  and archived public feeds match local latest.yml. The complete public installer
  download matches local/feed SHA-512 and size 150364281 bytes; archive HEAD size
  and ETag match. Verification time: 2026-09-28T12:16:08.426Z.
- After packaging, all three synchronization regression files passed again;
  after publication, root/backend Node ABI 137 passed again.

Feed SHA-512:
H2ExSZIiw5ZUkZNhlexfjPLKG8lYiKm/QM4dh8R9doC9hND1EXqzMazUcnMMyI/ptmyz0NpPULDnUlB379JZlg==

Release matrix and OSS verification evidence are in
output/release-matrix-desktop-8.9.21__cloud-business-8.12.3__storage-proxy-8.8.3__miniapp-8.8.26/.
Named runtime/test log directories above are under the local user's AppData/Local/Temp.
Original unrelated document edit was preserved byte-for-byte (SHA-256
13c7144c09d1260ffbb12f11a6c8a191a4c57a680629fa1a5aebee3f49c88e72).
No independent installer delivery or Quark upload was performed.

## Remaining long-term acceptance

- Physical offline and password/WeChat phone-consent cold login; controlled
  session fixtures do not substitute for those flows.
- Continue the complete miniapp registered-page and role ledger in
  miniapp-page-audit-2026-09-23.md, including unresolved media/filter/late-page
  layout, native document viewer, Word pagination and device interaction states.
- Preserve original business-flow acceptance requirements and final audit.
- WeChat formal publication is not verified: prior status API returned 86000
  (third-party-only access). Development upload is not production release.

Overall completion remains open until all applicable runtime, UI and platform
publication evidence exists.
