# Source image geometry validation 2026-09-20

Status: local implementation and integration evidence, NOT a production release.
No business windows, scheduling rules, production records, or NAS containers
were changed in this work. The protected output directory was not touched.

## Reproduced causes and repair

- The active ordered Word-token importer discarded each image occurrence's
  drawing/VML container geometry. A separate older reader had a size helper,
  but the active token path did not call it. The new integration test exercised
  that real path and failed with three `(None, None)` sizes before the repair.
- HTML-to-rich-content conversion discarded height and rejected fractional
  widths. Both dimensions now survive in the existing pixel-based width/height
  attributes; there is no new wire schema or database migration.
- Cloud export ignored rich image nodes, then appended all assets after options.
  It now resolves images by the snapshot's verified asset key and preserves field
  ownership, order, repeated occurrences and per-occurrence sizes. Missing assets
  and invalid geometry fail explicitly. Images owned by answers are not exposed
  early in the question section.
- Word uses the source display size in CSS pixels; PDF converts it to points.
  Only printable-page limits scale a declared size. Unsized legacy attachments
  retain the existing fallback, so old data still needs source-bound correction.
- Diagrams use the current desktop viewer's block/centered presentation
  (`src/index.css`, structured-question-viewer image rules), not giant inline
  text lines. Supported left/right alignment remains available.
- Image labels and the preceding final text line stay with their diagram where
  they fit on one page. Long paragraphs remain splittable, avoiding the blank
  space caused by moving the entire paragraph wholesale.

## Tests executed

- `node cloud-business-api/src/paperExportImageGeometry.test.js`: new tests
  failed first for missing occurrences, inline blocks, orphan labels and
  wholesale paragraph movement; all pass after the corresponding repairs.
- `npm run test:paper-export-regressions --prefix cloud-business-api`: exit 0,
  including hydration, formula lifetime, native equations, renderer, media,
  leases, worker, task repository and PostgreSQL archive checks. After the final
  pagination adjustment, `node cloud-business-api/src/paperExportRenderer.test.js`
  was rerun and exited 0.
- `python -m unittest discover -s modules/question-bank/parsers/tests`: 67 tests,
  exit 0, including four new geometry tests, ordered token reading and formulas.
- `node modules/question-bank/src/routes/parse_word.test.js`: exit 0.
- `npm run test:rich-content`: exit 0, including normalization, sanitization,
  editor roundtrip, structure operations and question revalidation.

## Real source integration

Original exam SHA-256:
`cc32c9804373a906f6799522da77f24882c85fdec447701b0f09002894a132ad`.
Original lecture SHA-256:
`3be433a44d4a05506626915574b3cfa7b38498ee9b7f84436e3dd3579f0c8008`.
Both retained originals were read, never overwritten. Fresh parsing still yields
20 exam questions and 88 lecture questions. All 23 exam image occurrences and
all 93 lecture image occurrences now have positive width and height.

The local renderer used the whole exam plus lecture question 67 (21 questions),
with each resolved image's SHA-256 verified. This is a direct local parser-to-
renderer integration, not a new cloud import or production export task.

Final evidence is in the task's temporary directory
`gewu-image-geometry-source-20260920-84nu_fr_/render-bm4LRx`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| geometry.docx | 6190159 | bb37783de7239eb16b1979e4f1f2d7db16a86975aba9875d39a077e21b6d6687 |
| geometry.pdf | 10936454 | 553a8411dd94984f3e7308e739a587b9b26e7b413c6f7e79755a04d6022a0a75 |

`structure-review.json`: Word ZIP integrity passed; all 23 image occurrences
retain their exact bytes and match source display width/height within 0.001 px;
299 native Word equations remain. PDF strict parsing passed, unencrypted, 13
pages; all 13 pages rasterized and were individually viewed. Page 7 keeps all
four heat-engine diagrams with their labels. Page 9 retains the four formerly
image-only lecture options as proper formulas. Answer illustrations remain in
the answer section (for example page 11), not among question options.

## Remaining gates and immediate next work

- **Not fully accepted:** the sample still shows text-style loss (for example
  subscript-style `F1`/`v1` in the lecture stem), non-adaptive option columns,
  and question/paragraph pagination that requires comparison with the original
  desktop export template. This change only closes the image geometry and
  ownership defects, not the entire document layout gate.
- The canonical Word renderer was attempted and failed because bundled
  LibreOffice `soffice.exe` is unavailable. Word structural checks are NOT visual
  verification. No Word appearance claim is made.
- Existing production rich image nodes still lack dimensions. Prepare a
  source-hash/asset-hash-bound, version-checked correction plan; back up and
  restore-verify before applying through the established cloud API. Do not
  blindly overwrite rich content, replace question IDs or duplicate imports.
- Do not compare the 13-page 21-question local sample with the previous 83-page
  108-question production export as if they were the same paper.
- No component version was bumped and no service/container was deployed in this
  step. When the remaining export gates pass, release only the changed cloud
  renderer and NAS parser components with new independent versions and parser
  proof; desktop and miniapp versions do not need artificial lockstep bumps.
- Re-export the real 108-question selection through cloud/NAS after correction,
  verify Word appearance and every PDF page, then continue the multi-role UI and
  original business-window parity audit. Overall project completion remains open.
