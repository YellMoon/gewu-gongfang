# Paper text and option export validation

Date: 2026-09-20. Scope: local cloud renderer changes, not production deployment.

## Implemented and verified

- Preserve literal rich text (including spaces and comparison signs), subscript and superscript marks, paragraph and hard-break boundaries.
- Keep generated option/answer labels and score suffixes separate from script styling. PDF measures script runs at their actual smaller font size and shifts their baseline.
- Match the existing desktop top-level option column rule: four short options use four columns, medium options two, long options one. Two options use two columns unless long; other counts use one. The parity test imports the actual desktop utility and tests text-length boundaries, Unicode, images and structured formulas. No desktop UI/business code was changed.
- Word uses borderless fixed-width option cells; PDF measures row height before drawing and moves a complete row when it does not fit. Very tall PDF rows fall back to ordinary flowing paragraphs. Option images fit their column width; native Word formulas remain native.
- A real-render review exposed a paragraph-break regression separating a stem from its following image. The regression was reproduced in a failing test and fixed: retain the preceding last line with the image, without moving a whole long paragraph.

## Tests

- `node cloud-business-api/src/paperExportTextStyle.test.js`: initially failed (zero Word script marks), now passes.
- `node cloud-business-api/src/paperOptionLayout.test.js`: passes desktop parity cases.
- `node cloud-business-api/src/paperExportOptionColumns.test.js`: initially failed (zero Word columns), now passes; includes four native Word equations and four column-constrained image occurrences in both formats.
- `node cloud-business-api/src/paperExportImageGeometry.test.js`: paragraph-break/image orphan check initially failed, now passes.
- `npm run test:paper-export-regressions --prefix cloud-business-api`: exit 0, including renderer, media resolution, execution leases, worker/task processing and real PostgreSQL atomic archive checks.
- `git diff --check`: passes.

## Real source integration evidence

Reused the retained fresh parse of the original exam and lecture sources, without re-importing production data. The local snapshot contains 20 exam questions and lecture question 67 (21 questions total).

Final retained local artifact directory basename: `render-t1R8Y0` under the prior `gewu-image-geometry-source-20260920-84nu_fr_` temporary test directory.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| geometry.docx | 6191006 | ffefb8f0956dfd64a2098cd0f2596a6e78f5a7b287ad38d8598932951255ea22 |
| geometry.pdf | 10934820 | f2e8752ce5ee69e53767ef80ab4152da16a6e0cec61986bbf9d2157b51988a31 |

Checks: all 23 image occurrences retain source bytes and source display dimensions within 0.001 px; 299 native Word equations; all 16 source text subscript marks appear as editable Word subscript runs. The sample contains no text superscript marks; superscript behavior is covered by the regression fixture, not claimed as real-sample coverage.

PDF strict parsing succeeds, is unencrypted, and all 16 pages rasterized and were individually viewed. The final page review confirms top-level two-column options (for example questions 3, 7, 9 and 21), equations, answer images and image/preceding-line pairing. Four-column cases are regression-fixture coverage. This is a local integration result, not a new 108-question production export.

## Remaining gates and known issues

- Word appearance is NOT verified. The canonical document renderer was attempted and failed because bundled LibreOffice `soffice.exe` is unavailable. XML/ZIP checks do not replace Word visual acceptance.
- Subquestion-internal packed text/image options are still represented inside the subquestion document rather than independent option groups; they do not yet receive the top-level option grid.
- Other rich text marks (such as italics/bold) and source-specific paper formatting still need parity work. Long question/answer flow, orphan answer headings and subquestion answer ordering still need review against the original desktop export.
- The 16-page count is not evidence of final pagination quality. Restoring paragraph boundaries changes pagination; do not compare it with the earlier 13-page flattened-text result as a size improvement.
- No production record, cloud/NAS deployment, desktop feed or miniapp upload was changed. Existing component versions remain in place. New parser geometry still requires a source/hash/version-bound correction plan and backup before applying to existing production questions.
- Continue export acceptance and then resume the multi-role, all-page miniapp/desktop/course audit. Do not mark the overall migration or multi-end release complete.
