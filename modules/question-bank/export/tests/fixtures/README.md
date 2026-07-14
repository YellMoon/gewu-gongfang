# Formula export render-matrix fixture

The reproducible render fixture is defined by `scripts/generate-formula-render-matrix.js`.
It intentionally exercises the complete paper shape instead of isolated formula snippets:

- rich stem text with a fraction and a square root;
- single-choice options containing Greek letters and a definite integral;
- a block `cases` expression, a sub-question, and a formula sub-answer;
- a structured correct option used by the choice-answer summary;
- a second multiple-choice question and a non-choice solution question;
- an embedded PNG question image;
- answer, knowledge-point, and analysis blocks in both supported positions.

Run `node scripts/generate-formula-render-matrix.js` from the repository root. The command
creates 16 artifacts under `output/task13-formula-matrix`: four requested formula modes,
two answer positions, and DOCX/PDF output for every combination.

Expected policy results:

- DOCX `word-native` stays native OMML with no fallback.
- DOCX `eq-field` contains an EQ field plus indexed OMML visible results with no fallback.
- `mathtype-compatible` falls back explicitly to LaTeX vector output until an audited
  MathType/MTEF writer and fixture are available; it must never masquerade as OLE.
- PDF requests for Word-native, EQ, or MathType output fall back explicitly to LaTeX
  vectors because PDF cannot retain editable Word formula objects.
- Requested `latex-vector` stays vector in both DOCX and PDF.

The final gate must reject visible LaTeX source, unresolved placeholders, missing formula
indices, invalid media relationships, zero-size/cropped drawings, or missing SVG/PNG
fallbacks. Microsoft Word rendering is the authoritative DOCX page-layout check; Poppler
rendering is used for every generated PDF page and for PDFs exported from Word.
