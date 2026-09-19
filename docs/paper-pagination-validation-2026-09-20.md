# Word pagination and detached formula preview repair

## Scope

Cloud candidate 8.11.17 contains the previous source-table fidelity repair,
stem/option pagination and structured attachment placement fixes. The existing
version analyzer classified the scoped renderer changes since cloud 8.11.16
as patch. Cloud and retirement-gateway package versions advance together;
desktop, miniapp and NAS versions do not advance in this commit. This document
is local validation evidence, not a deployment receipt.

No teaching workflow, scheduling calculation, account rule or business record
is changed. The six pre-existing dirty files and user output directories are
excluded from the commit. Production question content is not rewritten.

## Tests and real Word checks

`paperExportPagination.test.js` exercises paragraph, image and native-formula
stem tails with one-, two- and four-column options. It first reproduced missing
keep-next settings. Real Word then exposed split compact option rows and a
two-line stem split one line per page; separate failing assertions preceded
both fixes. Only the final stem content is kept with following options. Compact
option rows stay together. Explicit widow control prevents isolated single
lines without forcing every long paragraph onto one page. Independent questions
are not chained and no hard page break is inserted.

The actual D-drive exam (20 questions) and lecture (88 questions) were rendered
with the product renderer and opened read-only in Microsoft Word 16.0. The
bundled LibreOffice renderer was unavailable (`soffice.exe` absent); this is
Microsoft Word evidence, not a claim of LibreOffice compatibility validation.
Source files were not changed. QA PDFs/PNGs are not production export artifacts.

Intermediate local evidence retained in the temporary evidence area:

- `gewu-pagination-source-20260920-PYLUCq`: compact option row C/D still orphaned.
- `gewu-pagination-source-20260920-aa8wFD`: option rows fixed, first stem line
  still separated from the rest.
- `gewu-pagination-source-20260920-Baa6mt`: 38 Word pages; question 108 complete
  on page 38. All 38 page images were individually inspected. Page 28 exposed
  a large duplicated raster `a-x` after question 76. Therefore this intermediate
  artifact was not accepted as a complete export-quality pass.

The duplicate was an old MathType preview labelled `image` in the asset
inventory; the structured stem already contained editable `a-x`. The desktop
viewer renders explicit structured occurrences, not every inventory attachment.
The export renderer now follows the same rule. No filename/OCR heuristic is
used and no asset is deleted. Explicit image occurrences, including repeated
answer images, remain. Legacy questions without structured sections retain
their implicit attachments. Unused inventory hydration is unchanged.

`paperExportAttachmentPlacement.test.js` first failed with three drawings
instead of two; it now verifies Word and PDF do not append detached inventory,
native formulas remain editable, explicit images are retained and both null
and old formula-only metadata preserve legacy attachments.

Latest local artifact: `gewu-pagination-source-20260920-ZbvZqW/all-108.docx`,
11,296,443 bytes, SHA-256
`ae8e5b68d44f18a45dd89f85a28cf5f46e7b2ac8a60a6c70ffb46d35b7ac0b9e`.
Real Word opened it and rendered 37 pages with 452 native equations. OOXML has
116 drawing occurrences and 115 distinct embedded media, compared with
117/116 before the attachment repair. The excluded duplicate hash is
`81caa2a0cf6d9c4a1cb2250823d987b29c003ca8f4ca03eda995addf2db40ff2`;
the 452 native equation count is unchanged.

Latest pages 1–27 are byte-identical PNGs to the individually reviewed preceding
render. Latest pages 28–37 were individually reviewed. Question 76 no longer
has the giant duplicated formula image; question 108 retains its whole stem,
diagram and four options on page 37. The table in question 42 remains visible.

Passed on the latest code: full `test:paper-export-regressions` lifecycle,
including native-formula stress tests, Word/PDF tables, geometry, attachment
placement, lease/worker/media/task and actual PostgreSQL archive checks;
`update-version.test.js`; `independent-release-version.test.js`; diff whitespace
check. Frozen committed-source full cloud tests are still a separate release
gate and must not be inferred from these working-tree checks.

## Open acceptance findings

This is a bounded repair, not full paper-layout acceptance. Latest pages 6–7
still split question 12's single-column options, page 7 leaves question 14's
short heading at the bottom, pages 8–9 split question 15's non-choice stem, and
pages 14–15, 20–21 and 36–37 separate short answers from preceding questions.
Long stems and multi-image questions may still span pages. No general
table-at-stem-tail keep-with-options guarantee has been added.

The current Word findings do not substitute for a fresh real-cloud Word/PDF
export or full cloud-PDF visual audit. Source-table parser activation/content
repair still requires the desktop/miniapp reader rollout. NAS remains 8.8.3.
Question 51's previously recorded production answer/source mix-up, full
multi-role/page interaction audit and desktop OSS release remain open.
