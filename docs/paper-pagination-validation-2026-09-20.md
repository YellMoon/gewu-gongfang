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

## 07:35 production deployment follow-up

The preceding local-only evidence is now supplemented by a real deployment of
frozen commit `61399eb7f60c9de26e87ef1bd61fff4740288485`. All 181 commands in the
committed-source cloud test lifecycle exited zero, including real PostgreSQL
checks. Receipt directory: `gewu-frozen-cloud-bundled-tests-20260920-_2w0k1fz`.
The six protected dirty files were not included in the deployed archive.

The pre-deployment PostgreSQL backup was restore-verified, including security
ownership/ACL evidence. Backup identifier `20260919-233238`, SHA-256
`02eba0f904bf764c08c8dd83a699e72432a238cc139cda15c86ed52d7e191259`.
The retirement gateway code backup identifier is `20260919-233248`.
Deployment receipt `gewu-cloud-81117-release-20260920-itok5gut/execution.json`
records exit zero. Its compatibility manifest verifies cloud and retirement
gateway 8.11.17, public health, four old-authority tombstones and rejection of
the retired WebSocket path. Desktop and miniapp remain pending in this matrix.

NAS was not deployed or restarted. Its fresh acknowledged 8.8.3 receipt
`storage_runtime_receipt_532e4c48-6d35-4139-b1ff-8e667a5eae1c` verifies export
contract 3, transport contract 3 and parser-proof contract 1 against cloud
8.11.17. The currently active parser hash remains
`8d3a16cd92f5d01a9bbf8a746dc9115acb6dfb087ec854bc32b9d82e482cf689`.
Source-table parser activation/content backfill remains gated by reader rollout.
This is a partial release, not a completed multi-end release or paper-quality
acceptance.

## Actual 108-question production artifacts and visual rejection

Cloud 8.11.17 completed both existing tasks, with real authenticated downloads:
Word `paper_task_de35f73e-b4d9-4007-8305-af6095dbf970` and PDF
`paper_task_4a32f45b-af5b-43dd-ab18-11e1b003a929`. Local evidence directory:
`gewu-cloud-corrected-108-8_11_17-20260920-placement`; report `ok=true`.
Word: 11,296,392 bytes, SHA-256
`cfdf58456efd97e58deb8abac28594352d10ba35be5f5d223735d00c49c65d3d`.
PDF: 17,954,455 bytes, SHA-256
`93daa2671d51416e001b12791ef2dd967c7fe7e507e8d9676c765faecddd8110`.

Microsoft Word 16 opened the exact downloaded DOCX read-only, reporting 38 pages
and 452 native equations, then exported a visual-check PDF without changing the
DOCX hash. ZIP inspection found 116 drawings and 115 embedded images; the
detached duplicate formula hash recorded above is absent. Word pages 1, 18, 28,
29 and 38 were visually checked. Page 29 confirms question 76 contains the
placed diagram and editable formula, without the detached duplicate image.
The other 33 actual Word pages still require visual review; previous local
candidate screenshots do not substitute for this production file.

The actual cloud PDF strictly parses as 40 nonempty, unencrypted pages. All 40
pages were rasterized at 120 dpi and individually viewed. **Visual acceptance
failed**, despite successful parsing/download:

- Page 9 question 14 loses upright pi; page 10 loses micro-unit symbols.
  Full-width operators/brackets disappear from several later formulas, including
  questions 22, 37, 58, 81, 93, 95 and 105. Page 28 question 68 shows missing-glyph
  boxes for Unicode numeric subscripts. Question 108's ordinary math pi remains
  visible, so this is not a universal failure to draw Greek letters.
- Stem/option splitting persists, e.g. questions 8, 25, 40, 60, 63, 69, 81, 85
  and 106; question 89's answer appears alone at the top of page 35. Question 14
  has a short orphan heading. These were not fixed by successful file parsing.
- Question 42's production table remains flattened pending reader/parser rollout.
  Answer/source mixing is visible in questions 30, 47, 48, 50, 51, 53, 64 and 98.
  Question 44's embedded basketball image appears degraded; cause not established.

The cold 115-asset download path took about 20 minutes before Word completion;
two ten-minute test-ticket expirations were resumed against the same task rather
than submitting duplicates. There were no worker retries/errors in the checked
progress records. The following PDF task reused fetched media. This is not an
acceptable-performance claim and needs separate latency investigation.

## 8.11.18 local PDF symbol repair (not yet deployed)

An isolated probe reproduced MathJax generating SVG `text` for upright `π`, `μ`
and full-width `＋－（）`. The SVG-to-PDF default serif selection used a standard
PDF font without those glyphs, although the bundled CJK font contains them.
That CJK font itself has glyph ID zero for `₁₂₃` and `⁰`, explaining the separate
body-text boxes. The actual Word equation for question 105 still contains the
full-width plus sign, distinguishing PDF loss from source loss.

The repair explicitly selects the bundled Unicode font for formula text
fallbacks, preserves emphasis and restores the body font afterward. Numeric
Unicode super/subscripts and their arithmetic punctuation are displayed using
supported base glyphs at the correct size and vertical position. Neither stored
question content nor the editable Word equation path is rewritten or rasterized.

`paperExportPdfSymbols.test.js` first failed on pi encoding (exit 1), then passed
after the repair. It checks actual PDF font encodings for seven fallback symbols
and numeric script positions/emphasis, and is included in the renderer suite.
The complete `test:paper-export-regressions` lifecycle then exited zero, including
600-formula lifetime checks, native Word equations, tables, attachment placement,
media, worker/lease and real PostgreSQL artifact-archive checks.

Thirteen selected recorded-source questions were rerendered locally using media
from the actual cloud DOCX; all 11 resulting PDF pages were viewed. Pi, micro
units, full-width operators/brackets and numeric scripts are visible again.
Evidence directory `gewu-pdf-symbol-render-20260920-nPnV1b`; PDF SHA-256
`f0bea743903a1e5e345553226156ccd6a2d920ce7d4dfcb25178cfe8d1e53885`.
The recorded source snapshot predates later geometry/content repairs, so its
duplicated subquestions and large source-image layout are **not** a fresh
production-layout result. Some old imported EQ formulas also lack powers in the
stored expression itself (e.g. questions 24/95); font selection cannot restore
absent source content. Those parser/content findings remain separate open work.

Automatic scoped version classification is patch: cloud/gateway 8.11.18 only.
Desktop, miniapp and NAS versions are unchanged. Fresh frozen-source full cloud
tests, backup/deployment and a new real export remain required before claiming
this repair is live. Overall release and paper-quality acceptance remain partial.
