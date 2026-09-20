# Paper indentation and pure-image option layout

## Scope

User-requested export-only correction: indent complete option and subquestion
paragraphs by two CJK character widths. Recognize ASCII/full-width parentheses
with digits, circled digits, and lowercase a-d followed by ASCII/full-width dot.
At the retained template's 10.5pt body size this is 21pt / 420 twips, not a
first-line-only indent. Option grids use the same left offset and reduced width.

Pure-image options choose 4, then 2, then 1 column from actual display dimensions
and available width. They are not shrunk to force more columns. Bitmap pixel
counts do not replace declared source display dimensions. The same rule handles
four consecutive labelled pictures inside a subquestion, including label/image
paragraph separation and inline picture runs. Incomplete groups remain intact.

No source question, user template, business UI, account permission, schema,
NAS image or storage protocol changes. Only cloud-business/gateway package
patch versions change: 8.11.19 -> 8.11.20. Desktop 8.9.8, miniapp 8.8.7 and
storage-proxy 8.8.3 remain independently versioned.

## Verification

- New `paperExportIndent.test.js` first failed on absent 420-twip indentation.
- Passed whole-paragraph markers, negative plain paragraphs, structured child
  questions, PDF exact x-offset, column-width boundaries, 100/220/550px pictures,
  rich and embedded groups, no forced shrinking, source-order preservation,
  incomplete groups and PDF margin restoration across page breaks.
- Renderer regression suite passes template preservation, native equations,
  styles, table cells, pagination, media placement, formulas and answer order.
- Desktop/miniapp actual export-handler regression passed for both Word and PDF.
- Full paper-export regression command exited zero (a previous run exited 1
  without final artifact-test output; the isolated artifact test and full rerun
  both passed). Independent version/classification tests passed.
- Rendered real 20-question snapshot matching the previously verified cloud
  paper: 10 single, 3 multiple, 3 experiment, 4 solution. Original asset hashes
  checked before use; source reference remains byte-identical.
- Word read-only render: 23 pages, 294 native equations. All 23 pages individually
  inspected. Question 17(3) heat-engine pictures occupy a two-by-two grid;
  retained answer space and next-question page breaks remain intact.
- Evidence basenames: `gewu-template-20260920-indent-28UY3F` (Word render) and
  `gewu-template-20260920-indent-46lhKv` (final outputs). All uncompressed DOCX
  parts match between the two iterations, so the inspected Word rendering applies
  exactly to the final DOCX. Bundled renderer failed due to missing bundled
  LibreOffice; existing read-only Word renderer used, with source hash unchanged.
- PDF inspection found a pre-existing footer collision risk; reserve 16pt above
  the nominal bottom content boundary without changing the template page/margins.
  Paragraph-associated images keep the existing tail-line pagination behavior.

## Release gate

Local implementation is not a production deployment receipt. Before claiming
the new export rule is live: complete final PDF page inspection, run the full
committed-source cloud lifecycle tests, back up database/code, deploy the exact
commit, verify public/private contracts, then download real Word/PDF tasks.
Miniapp download-domain validation remains a separate unresolved runtime check.
The user confirmed the intended miniapp is Gewu Zhilin; do not ask that again.
