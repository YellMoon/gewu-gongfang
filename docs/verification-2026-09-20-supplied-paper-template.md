# Supplied paper template: local implementation and visual verification

Date: 2026-09-20. Scope: the supplied output DOCX, cloud paper renderer, and
preservation of explicit source section types during Word import. No teaching
workflow, desktop layout, account permissions or NAS deployment changes.

## Reference and implementation

- The user's `output-template.docx` reference was located in the authorized
  D-drive question test directory. Original SHA256:
  `fb8ac8d5b95f18ac72110a9161583fbf92736a991545980dd6b6b7b9a19060f2`.
  The bundled `cloud-business-api/resources/paper/output-template.docx` has the
  same hash. The original was opened read-only and was not changed.
- All three reference pages were rendered and inspected. The fidelity contract
  inventories 26 ZIP parts, two A4 sections, title/identity fields, choice-answer
  table, footer fields/contact and replacement slots.
- Word generation starts with that actual package. Only question/answer slots,
  title and dynamic grid are filled. Original styles and opaque parts remain.
  Native formulas remain OMML. Generated media relationships are isolated from
  the template's original image and drawing IDs.
- One deliberate footer adaptation moves the original PAGE/NUMPAGES field runs
  unchanged from their invisible floating textbox to the existing centered
  paragraph. The source textbox clipped or wrapped the last character with
  double-digit page counts. All bytes outside that wrapper remain unchanged;
  the retained reference is untouched.
- Solution questions reserve 240 pt of writing space after their content; the
  following question starts a new page. Long questions may span pages. The first
  question does not create an empty title-only cover. Explicit custom order,
  section titles and inline/end answers are still supported.
- PDF uses the same title, identity, page geometry, question categories, answer
  grid and footer, with licensed Noto Serif CJK instead of Windows SimSun.
  It is not a pixel-identical Word conversion. The font and OFL license ship in
  the cloud image; no desktop-installed proprietary font is redistributed.
- The real exam's explicit fourth section was being overwritten as `fill` by
  the import finalizer. Section-heading classification now survives finalization;
  the actual 20-question exam yields 10 single, 3 multi, 3 experiment, 4 problem.
  Existing production questions have not been silently reclassified.

## Current-source checks

- `npm --prefix cloud-business-api run test:paper-export-regressions`: exit 0,
  including template Word/PDF tests, geometry, option columns, attachments,
  tables, native formulas, 600-formula lifetime, worker/task/media checks, real
  disposable PostgreSQL leases and atomic artifact archive.
- `node cloud-business-api/Dockerfile.test.js`: exit 0; resources copied.
- Bundled Python unittest discovery in `modules/question-bank/parsers/tests`:
  74 tests, exit 0. Added section-finalization cases first reproduced the fault.
- `git diff --check`: exit 0.
- Frozen commit `6a065598cd263f0942a9a1661fb0b7955d2c9afb`: all 181
  cloud pretest/test/posttest commands passed, exit 0, committed sources only.
  Receipt directory basename: `gewu-frozen-cloud-bundled-tests-20260920-78vogh8r`.
  The six protected tracked user modifications were not included in this commit
  or the frozen test archive.

## Actual exam render

Local evidence directory basename: `gewu-template-20260920-sample-09MHnM`.
The authorized Ningbo physics exam was reparsed using the current parser and
rendered using the actual cloud renderer, with all source asset hashes checked.
This is local renderer QA, not a production export-task receipt.

- `exam.docx` SHA256:
  `4b1bbbfe49214e1a5ab37b71783bcaaa7e1489021e042263b2c6b7b47a550ef6`.
- `exam.pdf` SHA256:
  `96d3556ad6bf42200998521d21705b0ce57ab2818184dd16e2a0902973d14579`.
- Read-only Word 16 COM opened the DOCX and exported its render successfully:
  23 pages, 294 editable equations. The input hash stayed unchanged.
  The bundled LibreOffice executable was unavailable; this is a Word render,
  not a claimed LibreOffice validation. The user's open Word session was not used.
- Every Word page 01-23 was inspected at 1450-pixel page scale. Title, school /
  name / class fields, categories, diagrams, formulas, answers and footers are
  visible without the old footer clipping. Single-column top-level choice
  options remain together. Solution starts: Q17 page 8, Q18 page 10, Q19 page 11,
  Q20 page 12. Page 13 is deliberately reserved writing space after long Q20;
  reference answers start on physical page 14 with page counter restarted.
- Every PDF page 01-19 was inspected. The final PDF's 19 page-image hashes match
  the already inspected `gewu-template-20260920-sample-MtoeD9` PDF images exactly
  (the later edits were Word-only). Four solutions start on separate pages with
  writing room. Answer pages have complete page counts and teacher footer.
- Older rejected iterations remain separate: floating-footer clipping/wrapping
  and the earlier `fill`-classified solution run are not delivery artifacts.

## Bounded lecture sample

Three actual questions from the authorized kinematics lecture were exported
with the same production renderer. Evidence directory basename:
`gewu-template-20260920-sample-WDCp2t`. Word and PDF each have two pages; all four
page renders were inspected. Word reports 11 native equations. This covers a
mixed single/multi-choice sequence, diagram, formula and dynamic answer grid,
not all 88 questions in the lecture. Caller order is retained, so the repeated
single-choice category appears after the intervening multiple-choice question.

- Word SHA256: `4c8511cf92f66479093b650372ffa7d3c828aec09f35b584842bce5a1e8fd0a1`.
- PDF SHA256: `e0014cd64b61e2eebe3053f608729ee0cf0b2d3df0f14039a3d2d71d819efe9f`.

## Remaining gates / honest limits

- Cloud 8.11.18 from commit `6a065598cd26` was deployed successfully. Deployment
  wrapper exit 0; public cloud and retired-gateway health match 8.11.18. Four
  retired authority endpoints return 410; websocket rejection and the public
  permission contract passed. The live export test is recorded separately below.
- Fresh database backup: `/root/scheduling-backups/postgres/20260920-012647`,
  SHA256 `86a1024242aa9c28e2aa0f177358a2fa1e297521a920934c6882fe347e523ba6`.
  It was restored into an isolated verification database; ownership/privilege
  fingerprint matched before cutover. Gateway code backup:
  `/root/scheduling-backups/gateway/20260920-012656/gateway-code.tar.gz`.
  The prior cloud image/container is retained by the deployment rollback flow.
- Deployment receipt directory: `gewu-cloud-81118-release-20260920-ou6pucrj`.
  Health contract SHA256:
  `45a33b8ced1a4e8f1bc30667a14e29c07712db4e302caa34b820eeee551eb87f`.
  Authority contract SHA256:
  `5f9099826555c692cb09aad3e1df5bf2fb3ce465f4e65148c898cbeb422e5372`.
- Real teacher-scoped public export task submitted for the existing 20 exam
  records, with native Word equations and end-of-paper answers. No layout score
  placeholders and no DB question-type edits are used. Both tasks completed,
  archived to storage, passed cloud delivery and were downloaded successfully.

### Real cloud export and downloaded-file verification

- Public teacher-scoped Word task:
  `paper_task_6f26b138-3bf2-4682-b669-0451bf8ec1cf`, completed.
  Download: `exam-20.docx`, 6,211,895 bytes,
  SHA256 `8e36225d525db4f873a2fe1fe0798d6806985affa6a41ec8d4f081124efa590f`.
- Public teacher-scoped PDF task:
  `paper_task_5309069a-3c40-44ce-a75c-dfffd70d030f`, completed.
  Download: `exam-20.pdf`, 11,023,319 bytes,
  SHA256 `40bc0c3690d997bca99d2314ff7241601d806c5a0203752de035e786ca7cda3f`.
- Receipt directory basename:
  `gewu-cloud-template-exam-20-8_11_18-20260920`; `report.json` has `ok: true`.
  No session tokens are persisted in that report.
- Every uncompressed DOCX ZIP part matches the verified local sample exactly.
  The actual downloaded DOCX was independently opened read-only in Word 16:
  23 pages, 294 editable equations, input hash unchanged.
- All 23 downloaded Word render pages and all 19 downloaded PDF pages were
  rasterized. Each page-image hash matches its individually inspected local
  counterpart exactly: 42 compared pages, zero different pages. This verifies
  the actual cloud/download result, not merely a mocked renderer or HTTP status.
- Render receipt directory basename:
  `gewu-template-20260920-cloud-9d71fa61261446d09a118100f10fb8e2`.
- The stored artifacts are intentionally retained as this requested export.
  Temporary session helper files were removed by the existing cleanup path;
  no teaching/question records or NAS deployment settings were changed.

### Still outside this completed export check

- This receipt does not cover all 108 imported questions or all miniapp pages.
  Full-lecture content QA and source subquestion option arrangement still require
  separate checks. Non-solution PDF questions can split across pages;
  no claim is made that PDF and Word have identical line/page breaks.
- NAS remains unchanged. No user business record or source document was changed.
- The parser correction is also packaged in the desktop application. It is not
  distributed by this cloud deployment; the next applicable desktop OSS update
  must include it. Already-imported exam records were previously classified
  correctly in the captured cloud snapshot, so no data rewrite is needed for
  the real exam export test.
