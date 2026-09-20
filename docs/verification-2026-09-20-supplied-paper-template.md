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

## Remaining gates / honest limits

- Cloud production remains 8.11.17 at this checkpoint. Candidate 8.11.18 is not
  yet deployed. Full frozen-commit tests, fresh restore-verified DB/code backups,
  deployment health/contracts and a real cloud template export remain required.
- This receipt does not cover all 108 imported questions or all miniapp pages.
  Lecture-specific template QA and source subquestion option arrangement still
  require separate checks. Non-solution PDF questions can split across pages;
  no claim is made that PDF and Word have identical line/page breaks.
- NAS remains unchanged. No user business record or source document was changed.
