# Question Formula Pipeline and WYSIWYG Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a verified Word-import-to-host-export pipeline where all question formulas become editable canonical LaTeX, rich question content is edited visually, and host-generated DOCX/PDF files contain only visible, stable formula results in the selected output mode.

**Architecture:** A shared Python WordprocessingML token walker parses document and comment parts into typed content tokens. Formula adapters normalize OMML, EQ fields, and MathType OLE through MathML into canonical LaTeX while preserving original payloads. Structured rich-content JSON is edited by one React editor core, and a host-only Python export worker renders four requested targets with a visible-result fallback gate.

**Tech Stack:** Python 3, lxml/ElementTree, python-docx, Ruby MathType converter runtime, React 18, TypeScript, KaTeX, TipTap/ProseMirror-compatible editor packages, docx/OpenXML, SVG/EMF/PNG rendering, Node/Electron, SQLite.

---

## File structure

- `modules/question-bank/parsers/word_content.py`: shared document/comment token walker and relationship resolution.
- `modules/question-bank/parsers/formula_model.py`: canonical formula types, normalization result and serialization.
- `modules/question-bank/parsers/formula_omml.py`: OMML to LaTeX/MathML conversion.
- `modules/question-bank/parsers/formula_eq.py`: Word field state machine and EQ to LaTeX conversion.
- `modules/question-bank/parsers/formula_mathtype.py`: OLE extraction, batched Ruby conversion and cache.
- `modules/question-bank/parsers/parse_word.py`: question-boundary orchestration using shared tokens.
- `modules/question-bank/parsers/tests/`: synthetic DOCX fixtures and parser/converter tests.
- `src/types/questionRichContent.ts`: versioned rich-content and formula contracts.
- `src/services/questionRichContent.ts`: legacy migration, validation and plain-text projection.
- `src/components/question-editor/`: focused toolbar, canvas, formula dialog, image node and question-structure components.
- `src/components/RichQuestionEditor.tsx`: compatibility wrapper around the new editor.
- `backend/src/services/questionBankService.js`: persistent structured content/formula asset mapping.
- `modules/question-bank/export/`: host-only conversion adapters, render gate and DOCX builder.
- `backend/src/services/paperArtifactService.js`: immutable export snapshot and worker invocation.
- `src/pages/QuestionBankPaper.tsx`: output preference and quality summary UI.

### Task 1: Parser test harness and canonical formula model

**Files:**
- Create: `modules/question-bank/parsers/tests/test_formula_model.py`
- Create: `modules/question-bank/parsers/tests/docx_fixture.py`
- Create: `modules/question-bank/parsers/formula_model.py`
- Modify: `package.json`

- [x] Write tests asserting a formula record serializes `canonical_latex`, source coordinates, original payload reference, display mode and warnings without exposing binary data in visible text.
- [x] Run `python -m unittest discover modules/question-bank/parsers/tests -v` and verify failure because `formula_model` does not exist.
- [x] Implement frozen/dataclass-style `FormulaDocument` and `FormulaConversionResult` with explicit JSON projection.
- [x] Re-run the focused suite and verify pass.
- [x] Add the Python parser suite to the repository test command and commit.

### Task 2: Shared document/comment content walker

**Files:**
- Create: `modules/question-bank/parsers/tests/test_word_content.py`
- Create: `modules/question-bank/parsers/word_content.py`
- Modify: `modules/question-bank/parsers/parse_word.py`

- [x] Build a synthetic DOCX containing styled text, drawing, table, comment, OMML, split EQ field and OLE relationships in both `document.xml` and `comments.xml`.
- [x] Assert both parts yield the same ordered token kinds and retain part/paragraph/comment/relationship coordinates; run and observe failure.
- [x] Implement relationship normalization and a streaming child walker that yields text/style/break/image/OMML/field/OLE tokens.
- [ ] Replace divergent paragraph/comment low-level traversal in `parse_word.py` while keeping existing question-boundary behavior.
- [ ] Run parser tests plus a real existing Word import smoke test and commit.

### Task 3: Complete EQ field state machine and converter

**Files:**
- Create: `modules/question-bank/parsers/tests/test_formula_eq.py`
- Create: `modules/question-bank/parsers/formula_eq.py`

- [ ] Add failing cases for `fldSimple@instr`, split `instrText`, nested fields, `begin/separate/end`, fractions, roots, superscript/subscript, integral/sum and unsupported instructions.
- [ ] Verify tests fail for missing parser.
- [ ] Implement a stack-based field collector and recursive EQ expression parser that returns canonical LaTeX or a visible-source fallback status.
- [ ] Verify supported fields produce rendered LaTeX and unsupported fields never become visible source text.
- [ ] Commit the focused change.

### Task 4: OMML normalization coverage

**Files:**
- Create: `modules/question-bank/parsers/tests/test_formula_omml.py`
- Create: `modules/question-bank/parsers/formula_omml.py`
- Modify: `modules/question-bank/parsers/parse_word.py`

- [ ] Add failing fixtures for fractions, nth roots, sub/superscripts, n-ary operators, limits, matrices, equation arrays, delimiters, accents, bars and piecewise expressions.
- [ ] Implement an OMML AST visitor that produces normalized LaTeX and warnings for approximations.
- [ ] Compare rendered KaTeX-compatible output against expected structures and ensure no OMML XML appears in visible question text.
- [ ] Route old `_math_latex` callers through the new adapter and run regression tests.
- [ ] Commit.

### Task 5: MathType import reuse and packaging

**Files:**
- Create: `modules/question-bank/parsers/tests/test_formula_mathtype.py`
- Create: `modules/question-bank/parsers/formula_mathtype.py`
- Modify: `scripts/prepare-python-runtime.js`
- Modify: `package.json`

- [ ] Port reference-project tests for hash deduplication, batch sentinel parsing, converter failure and cached reuse; verify failure.
- [ ] Reuse the reference Ruby `mathtype_to_mathml_plus` invocation with explicit UTF-8, hidden subprocesses, timeouts and per-object isolation.
- [ ] Convert returned MathML to canonical LaTeX, retain OLE/preview references, and emit `preview_only` instead of invented LaTeX on failure.
- [ ] Package the reviewed Ruby runtime/gems or a pinned legal dependency bundle and verify packaged path discovery.
- [ ] Run parser and packaging smoke tests; commit.

### Task 6: End-to-end Word import quality gate

**Files:**
- Create: `modules/question-bank/parsers/tests/test_parse_word_formulas.py`
- Modify: `modules/question-bank/parsers/parse_word.py`
- Modify: `modules/question-bank/src/routes/parse_word.js`

- [ ] Add lecture and exam fixtures proving formulas in stems, options, subquestions, answers, analyses, comments and tables attach to the correct question in source order.
- [ ] Make the current implementation fail on field and comment/OLE cases.
- [ ] Replace `read_docx_rich_blocks() or read_docx_rich_paragraphs()` with one token-derived rich block stream and attach canonical formula nodes.
- [ ] Return a parse quality report with counts by source/status and actionable locations.
- [ ] Run forced XML fallback, python-docx path and route integration tests; commit.

### Task 7: Structured rich-content persistence and compatibility

**Files:**
- Create: `src/types/questionRichContent.ts`
- Create: `src/services/questionRichContent.ts`
- Create: `src/services/questionRichContent.test.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `backend/src/services/questionBankService.js`
- Modify: `src/services/browserDatabase.ts`

- [ ] Add failing tests for legacy HTML/text migration, formula-node round trip, image references, persistence/reload, plain-text search projection and old-client compatibility.
- [ ] Add additive versioned JSON columns/content rows without deleting legacy fields.
- [ ] Implement strict sanitizer/validator and deterministic legacy projection.
- [ ] Verify mutation → database → reload → derived flags/search → UI payload.
- [ ] Run backend/browser database suites and commit.

### Task 8: WYSIWYG editor core

**Files:**
- Modify: `package.json`
- Create: `src/components/question-editor/QuestionContentEditor.tsx`
- Create: `src/components/question-editor/EditorToolbar.tsx`
- Create: `src/components/question-editor/FormulaDialog.tsx`
- Create: `src/components/question-editor/ImageNodeView.tsx`
- Create: `src/components/question-editor/QuestionContentEditor.css`
- Modify: `src/components/RichQuestionEditor.tsx`
- Modify: `src/uiRegression.test.js`

- [ ] Add failing behavior/static contracts for headings/paragraphs, font family/size, bold/italic/underline/strike, colors, alignment, spacing, indentation, lists, sub/superscript, clear format, undo/redo, formula and image commands.
- [ ] Install a compatible TipTap/ProseMirror editor stack and verify the lockfile change is scoped.
- [ ] Implement a controlled versioned-JSON editor with real toolbar state, keyboard shortcuts, focus restoration and sanitized paste.
- [ ] Implement formula preview/edit using canonical LaTeX and image insert/resize/alignment/alt text.
- [ ] Preserve the old component API through `RichQuestionEditor` and verify all current pages still compile.
- [ ] Run component contracts, TypeScript build and commit.

### Task 9: Question structure editing

**Files:**
- Create: `src/components/question-editor/QuestionStructureEditor.tsx`
- Modify: `src/pages/QuestionBankEdit.tsx`
- Modify: `src/pages/QuestionBankPreview.tsx`
- Modify: `src/pages/QuestionBankImport.tsx`

- [ ] Add failing tests/contracts for editable stem, ordered options, correctness, subquestions with answers, main answer and analysis.
- [ ] Implement stable-ID add/remove/reorder operations with undo-safe updates and deletion confirmation where content exists.
- [ ] Remove the duplicate free-form formula textarea once formula nodes are authoritative.
- [ ] Verify validation, loading, save failure, retry and dirty-state protection.
- [ ] Run build and focused UI tests; commit.

### Task 10: Formula rendering adapters and visible-result gate

**Files:**
- Create: `modules/question-bank/export/tests/test_formula_renderers.py`
- Create: `modules/question-bank/export/formula_renderers.py`
- Create: `modules/question-bank/export/visible_gate.py`
- Create: `modules/question-bank/export/vendor/NOTICE.md`

- [ ] Add failing adapter tests for OMML, EQ, MathType-compatible OLE and SVG output from one formula model.
- [ ] Audit and pin the chosen MIT MTEF/OLE implementation; record source, version, license and reviewed limitations.
- [ ] Implement adapters plus SVG/EMF/PNG fallback without visible source code.
- [ ] Implement a gate that rejects missing relationships, zero-size/cropped render bounds, empty formulas and visible code-pattern residue.
- [ ] Verify a single failed formula blocks artifact success with question/location diagnostics; commit.

### Task 11: Host-only DOCX/PDF export worker

**Files:**
- Create: `modules/question-bank/export/build_paper.py`
- Create: `modules/question-bank/export/tests/test_build_paper.py`
- Modify: `backend/src/services/paperArtifactService.js`
- Modify: `backend/src/routes/cloudRelayHost.js`
- Modify: `src/services/docxExporter.ts`

- [ ] Add failing tests proving non-host clients create jobs rather than locally generating authoritative files.
- [ ] Build immutable question snapshots and invoke the Python worker with selected format and layout settings.
- [ ] Generate DOCX, render/convert PDF, record artifact hash/page/question/formula counts and actual fallback distribution.
- [ ] Make task execution idempotent and enforce timeout/cancel/retry/cleanup rules.
- [ ] Run host task and artifact service tests; commit.

### Task 12: Export preference UI and runtime visual QA

**Files:**
- Modify: `src/pages/QuestionBankPaper.tsx`
- Modify: `src/components/QuestionBasket.tsx`
- Create: `docs/verification-2026-07-12-question-formula-editor.md`

- [ ] Add selection controls for four output modes with truthful compatibility descriptions and host readiness state.
- [ ] Show job progress, failure locations, fallback summary and download actions; never expose raw formula payloads.
- [ ] Run the real desktop app and exercise import → edit → save → export at desktop and narrow widths, keyboard-only paths, loading/error/recovery states and console health.
- [ ] Capture safe screenshots/check records and complete the visual evidence record against selected UI checks.
- [ ] Commit.

### Task 13: Document render matrix and regression closure

**Files:**
- Create: `modules/question-bank/export/tests/fixtures/README.md`
- Modify: `docs/verification-2026-07-12-question-formula-editor.md`

- [ ] Generate all four DOCX variants and PDFs from the same complex formula fixture.
- [ ] Render every page and inspect formula count, baseline, fraction/root sizing, clipping, line spacing, pagination and image relationships.
- [ ] Run parser suites, backend suites, UI tests, TypeScript build, miniapp typecheck/release check and full `npm test`.
- [ ] Record any external Word/MathType verification limitation without claiming success for unrun checks.
- [ ] Commit.

### Task 14: Unified release matrix

**Files:**
- Modify: `task.md`
- Modify: relevant deployment/version evidence files discovered during release

- [ ] Back up the local-host and Aliyun databases/code before deployment.
- [ ] Deploy/migrate/restart cloud and local-host services and verify private/public health plus permission contracts.
- [ ] Build and upload the WeChat miniapp; record platform blockers if upload/review cannot complete.
- [ ] Automatically bump the desktop version, run `npm run dist:win`, publish the OSS update feed, restore Node ABI and verify `latest.yml` plus installer hashes.
- [ ] Install/upgrade the designated local data host while preserving its data/device configuration and verify question disk plus export task flow.
- [ ] Commit and push `gewu/master`; mark complete only when every applicable endpoint has runtime evidence.
