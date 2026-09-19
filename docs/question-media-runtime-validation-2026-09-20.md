# Question media runtime validation 2026-09-20

Status: partial acceptance. Cloud 8.11.15 and NAS 8.8.3 remain in service.
Miniapp 8.8.6 has been built locally; this note does not claim upload or complete
multi-role UI acceptance. Desktop UI and business workflows were not changed.

## Source-bound production geometry repair

The previously reviewed selection contains 108 questions from the D-drive exam
and lecture. Exactly 85 questions contain 116 source image occurrences whose
cloud rich-content nodes lacked width and height. Fresh parsing matched every
image position and asset hash. No historical duplicate task or other question
was included, and no question was imported again.

The closed correction plan only fills missing width/height, preserving text,
formulas, source images, question IDs and all other content. Source file hashes:

- Exam: `cc32c9804373a906f6799522da77f24882c85fdec447701b0f09002894a132ad`.
- Lecture: `3be433a44d4a05506626915574b3cfa7b38498ee9b7f84436e3dd3579f0c8008`.
- Plan: `606be5f7a333e238e75529a4651d098fd1e3222f5bfe8eccf611bc7be3fd438b`.

Before the first write, PostgreSQL was backed up and restored in isolation with
ownership/privilege verification. Backup SHA-256:
`f7abe2a1e6102fc6bece42c37fad91a39ff7c016d6b5c6364d1a0261564cf073`.
The initial batch hit its 1200-second process limit after 81 writes. Resuming the
same durable journal read back those 81 changes and wrote only the remaining 4.
The resume also took a fresh verified backup, SHA-256
`2381c85a2ab2ec3908ebd6ad80e2812215388bc23e00c02a990ef469bbc43117`.
No database owner privilege was granted to the runtime writer.

Final result: 85/85 verified through cloud REST, with a read-only SQL cross-check
of 85 version increments, 0 pending and 0 unexpected versions. Temporary desktop
device, installation, link and session active counts are all zero.

Local evidence directories under Windows Temp:

- `gewu-image-geometry-plan-20260920-tp00kn`: plan, original execution journal and
  final result (81 `readback-resumed`, 4 `committed-and-readback`).
- `gewu-real-draft-chain-20260920-255hivqw/receipt.json`: successful resume and
  revoked test identities.

This repairs existing data only. Future-import parser geometry still requires
separate acceptance; this operation did not update the NAS container/parser.

## Miniapp media failure and repair

The first real visitor screenshot showed missing images despite valid text and
answers. Network evidence plus read-only PostgreSQL checks established that
deliveries became ready after 17.68 and 40.24 seconds, while both pages stopped
after five 1.5-second polls. Neither ready image had been downloaded.

Both question-bank and question-paper now use one tested delivery lifecycle:
one preparation request, original delivery-ID polling, a 120-second deadline,
terminal-state handling, session/unmount cancellation and immediate display of
each completed image. It never grants permissions or bypasses the cloud.

After the first build, the simulator still exhibited the old short-poll behavior.
Only this project's compile cache was cleared; login, storage and business data
were not cleared. Fresh real-cloud checks then verified:

- Visitor: 20 question cards, answers initially hidden, working expand/collapse,
  visible source images, and denied direct payments/assets routes.
- Teacher: 40 question cards, visible source images, working expand/collapse.
  Delivery `question_asset_delivery_a26b9cf9-f9f9-40b9-bf5b-efa2a3521b6d`
  progressed from queued to ready after nine status reads, exceeding the old
  five-read cutoff; it was not replaced by another delivery.

Screenshots and element receipts:

- `gewu-miniapp-media-886-visitor-e12jhshn` (including `ready/`).
- `gewu-miniapp-media-886-teacher-cmfi863g` (including `ready/`).
- Initial detailed visitor audit: `gewu-visitor-detail-audit-20260920-ky1xdwhy`.

Tests used server-issued scoped test sessions in the actual DevTools runtime,
not a successful user-facing WeChat phone-login flow. Prior non-test session
storage was restored afterward. The tested content was real cloud data, not UI
mock data. Screenshots were visually inspected, not only counted.

## Verification and remaining acceptance

Passed: shared delivery regression, both page delivery suites, paper download
and actual-handler tests, miniapp TypeScript, full WeChat build, display tests,
31 role-UI harness tests, version classifier/independent-version tests, static
18-page UI coverage, and the complete `test:miniapp-cloud-read` command including
its PostgreSQL/cloud renderer/permission tests.

Still open: full 18-route multi-role and state-by-state visual acceptance,
student/family media checks, paper-editor interactions, and fresh 108-question
Word/PDF export/visual review. Initial home/application screenshots also retain
verbose role copy and a redundant available-function count; these observations
are not marked fixed. Question cards beyond initial prefetch still need their
scroll/tap media behavior reviewed. A passing static page inventory is not proof
that all these flows work.

The fresh export run uses one task per format and durable resume receipts in
`gewu-cloud-corrected-108-8_11_15-20260920-geometry`. At the time of this note,
Word task `paper_task_7e631002-ced2-43c7-b881-b6692281a945` is processing; no
successful artifact or completed multi-end release is claimed.
