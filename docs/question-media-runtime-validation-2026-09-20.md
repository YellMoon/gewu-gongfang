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

## Bulk-export contention found after the first UI repair

Student runtime verification failed while the 108-question export was active:
its first two images were queued behind 80 earlier export deliveries. Both were
still queued after the miniapp's new 120-second deadline. Evidence:
`gewu-miniapp-media-886-student-yomgi48x`; a read-only queue check returned
`earlierpending: 80/81`. This failure is not hidden by the successful visitor
and teacher checks, and miniapp 8.8.6 has not been uploaded yet.

Cloud candidate 8.11.16 changes only the storage-image lease ordering to earliest
expiry first, then creation time and ID. Active exports already renew their
temporary-media lifetimes (capped at one hour); interactive deliveries do not.
This prioritizes expiring browsing images without adding roles, changing access
checks, stealing active leases, copying another account's delivery, or changing
the NAS protocol. Equal deadlines retain deterministic FIFO order.

A new disposable PostgreSQL test reproduced the failure with 80 export images
ahead of two browsing images. The old ordering failed; the new ordering passed
both browsing selections, subsequent export progress, live-lease preservation,
expired-lease reclamation and expired-row cleanup. Full-schema PostgreSQL media
authorization, repository, route and permission tests also passed, along with
56 deployment-script tests. This is not yet production evidence: frozen-source
verification, backup/deployment and a repeated contention test remain required.

## Further verification on the same committed candidate

The frozen `bc0662a09a4216ce0033f7620a701349a6a2dc0c` candidate passed all
181 commands expanded from the cloud package's pretest/test/posttest lifecycle.
Evidence: `gewu-frozen-cloud-bundled-tests-20260920-rks5ynrd`, with a zero-exit
receipt and per-command results. The successful run used bundled Node 24.19.0.
Two earlier runs using local Node 24.15.0 terminated with Windows process code
3221226505 at different tests; their logs remain failed evidence, not passes.
An additional run was deliberately stopped after detecting that Windows had
selected the old executable despite the child PATH override. The successful
run specifies the bundled executable by absolute path. No product code was
changed to conceal these process failures.

Additional real miniapp checks (8.8.6 build against cloud 8.11.15):

- Family: `gewu-miniapp-media-886-family-ldqtcdep`; first-question image visible,
  40 cards/actions, and answer expand/collapse roundtrip passed.
- Super administrator: `gewu-miniapp-media-886-super_admin-5vivpfrp`; same checks
  passed using the existing authorized administrator selected by the harness;
  unlike the other role fixtures, it is not a synthetic e2e account. These
  server-issued sessions are not WeChat login proof. The later load-export
  helper rejects non-e2e accounts and uses only the controlled teacher fixture.
- Teacher basket: `gewu-miniapp-basket-flow-20260920-480253dc`; actual add button,
  floating basket, and begin-paper button reached the editor with three
  questions and matching score/section fields. Both export buttons were present.
  The newly added question was removed through the UI afterwards. This check did
  not submit or download an export, nor change score/section values.

The basket and editor screenshots were inspected. Remaining editor findings:
technical formula-layout wording, export history pushing the editable questions
below the first screen, and the floating basket overlapping download controls.
These are not marked fixed by successful navigation.

## Completed 108-question exports, with visual defects still open

The existing Word task completed without being recreated. The subsequent PDF
task is `paper_task_11f0af16-4175-4738-91b5-54f9681bc347`. Both artifacts were
downloaded through the authenticated cloud/NAS delivery flow and checked:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Word | 11296213 | `de4263759df9500d8c0d40f831f1bd3392e7134d79a9e81517fd36ad958b41db` |
| PDF | 17954455 | `4e700f4bb69c5639d14e3cc8c94a36430d312f23edd3777f591107a48b295791` |

Microsoft Word 16.0 opened the DOCX read-only, repaginated it to 36 pages and
recognized 452 native equations. It rendered a PDF without changing the DOCX
hash. ZIP/XML checks found 116 positive-size drawing occurrences and 115 unique
embedded images, every image byte-matched to an original parsed source image;
there were no newly rasterized formula images. The cloud PDF parsed as 40 pages,
with nonempty text on every page, and all pages rendered with Poppler.

Visual review is partial, not full acceptance: Word pages 1, 2, 10, 20, 36 and
cloud PDF pages 1, 20, 40 were inspected. Recorded defects:

- Question 42's road/friction table is flattened into lines. Fresh lecture
  parsing already has this defect, so it is not only PDF layout. The formula
  import path emits table-cell paragraphs separately instead of reconstructing
  the table; this needs a source-preserving parser regression and repair.
- Question 51's source label appears within its answer in the existing cloud
  content. Fresh source parsing returns answer A without that label; compare and
  repair the scoped imported content rather than removing text indiscriminately.
- The Word final page contains only question 108's options/answer, requiring a
  pagination review.

Detailed checks remain in the export evidence directory's
`artifact-inspection.json` and `visual-review.json`. Successful file opening and
native-equation checks do not imply complete export fidelity or multi-end release.

## Cloud 8.11.16 deployed; real contention regression passed

The frozen candidate was deployed successfully. The deployment receipt records
public cloud health, retirement-gateway health, four old-authority tombstones,
WebSocket rejection and permission contracts at 8.11.16. Before migration and
promotion, a PostgreSQL custom backup was restored into an isolated verification
database with ownership/privilege checks:
`/root/scheduling-backups/postgres/20260919-213008`, SHA-256
`164f98ff77c31965ac9f3e954afd4cf985722d261bc7e900db855eed3898c4f7`.
The previous container remains the deployment rollback target. Fresh NAS receipt
`storage_runtime_receipt_3b1a7251-c4f8-4eef-9334-62a9cab0bd28` confirms unchanged
8.8.3 and the existing contracts/parser hash. No NAS deployment was performed.

A new controlled-teacher 20-question export created real media contention:
`paper_task_2f4c6bc7-ee3e-4db4-8a26-44d4ba22df75`. Read-only queue snapshots
recorded 13 queued export images before the student opened the bank. At
21:34:32 UTC, ten earlier export deliveries remained queued while student
deliveries created at 21:34:07 had already become ready at 21:34:20 and
21:34:29; the first was downloaded. Thus browsing media actually progressed
ahead of the older bulk-export work, not merely after the queue drained.

The student runtime test exited zero, showing the image, 40 cards/actions and
answer expand/collapse. Its screenshot was inspected:
`gewu-miniapp-media-886-student-sc57y08i`. Queue evidence is in
`gewu-media-contention-81116-20260920/progress.jsonl`. The earlier student failure
remains in the record. These checks do not complete the full role/page matrix.

Miniapp 8.8.6 was subsequently rebuilt, release-checked and uploaded through the
project's fixed-egress miniprogram-ci workflow. WeChat returned success and a
1029591-byte full package; the deferred receipt was finalized only after the
post-upload cloud health check. The custom release manifest records the miniapp
as verified at development release level. Cloud 8.11.16 and unchanged NAS 8.8.3
are verified in the same manifest, while desktop remains pending. This is a
partial release, not formal WeChat publication or completion of all page audits.
