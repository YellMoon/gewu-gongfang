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

Final local PDF: all 21 pages individually inspected. The heat-engine grid is
on page 8. Blank pages 9 and 13 are retained solution writing space. No content
overlap or clipping observed. PDF SHA256:
`9f9ede035837a49179fc7040613717a69272cf9fe108213fb6e59d4391126426`.
The corresponding inspected DOCX SHA256 is
`6a35ec772617035c7dd951057589aace176e89d8e36f6527b637e999c5b02a51`.

Committed source `080f1bb8ee30e510c109202a2bc71a348b0c5a16` passed all 182
cloud lifecycle commands. Receipt: `gewu-frozen-cloud-bundled-tests-20260920-qodpn3w_`.
Six unrelated tracked modifications and all protected untracked work were
excluded from both the committed test archive and deployment source.

Cloud 8.11.20 deployed from that exact commit, exit 0. Evidence directory:
`gewu-cloud-81120-release-20260920-avfaow6o`. The release matrix records the
cloud target as verified, with public/private health, authority permissions,
retired routes and WebSocket rejection checked. Database backup at
`/root/scheduling-backups/postgres/20260920-043005` was independently restored
and its ownership/privileges verified before promotion; dump SHA256:
`0c491c11db4a9d306da3800f992c2949ecd7044dd532a9004eecff8f27c5e989`.
Gateway code backup: `/root/scheduling-backups/gateway/20260920-043014`.
The previous business container/image remains the rollback target.

Fresh production exports used the existing 20-question selection from the
previous successful 8.11.18 task receipt (no reimport or question changes).
Both new tasks completed, were stored through the existing NAS agent, and
were downloaded through the real cloud teacher-scoped delivery API:

- Word task `paper_task_337c48ba-401a-4995-9edb-541ef4b77ef8`, 6,212,298 bytes;
  SHA256 `df8747576e4c67761c5112dacb259bdb6742d895ffa5ec8656b0c289e719d05f`.
- PDF task `paper_task_795409e3-fe56-4a56-a23d-daf9d1304e8c`, 11,023,929 bytes;
  SHA256 `6c116982bd1379f041933ac2ff63f4a3b87917d7dd68c005061ae03bf9e0c63e`.
- Evidence: `gewu-cloud-template-exam-20-8_11_20-20260920/report.json`, ok=true.
  Every uncompressed production DOCX part matches the inspected Word document.
  Production PDF opens/parses as 21 A4 pages; all 21 rendered page-image hashes
  exactly match the individually inspected final local pages. The production
  heat-engine grid on page 8 was also directly viewed.
- This proves real cloud/NAS export and delivery, plus desktop/miniapp handler
  regression coverage; it is not a new WeChat phone-login or download-domain
  acceptance claim. No NAS image replacement or desktop update was needed.

Miniapp download-domain validation remains a separate unresolved runtime check.
The user confirmed the intended miniapp is Gewu Zhilin; do not ask that again.
