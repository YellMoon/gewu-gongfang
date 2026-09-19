# Source table fidelity — 2026-09-20

## Scope and release boundary

The previously reviewed 108-question export flattened the road/friction table
in lecture question 22 (combined export question 42). This change preserves
the existing source table through import, structured display/editing and
Word/PDF export. No course, schedule, student, navigation or modal workflow is
changed. No production question has been rewritten by this repair yet.

`questionRichTables` in the independent protocol/data declaration requires
reader/exporter rollout before activating the new parser or repairing cloud
content. The old desktop reader does not understand these additive nodes.
The NAS remains at its separately verified 8.8.3 runtime. The latest published
cloud/miniapp versions remain 8.11.16/8.8.6; this table work is not yet released.
The new declaration is a release coordination requirement, not a claim that
an automatic old-client minimum-version gate has been implemented.

## Reproduction and implementation

- New parser tests first reproduced lost cell/row structure. The fix retains
  inline formulas/media, nested tables, empty cells and horizontal/vertical
  merges without changing the original paragraph coordinates used by formula
  recovery. The default token API remains paragraph-oriented for its existing
  coordinate consumers; the import entry points explicitly request tables.
- Desktop validation and paste tests first rejected/dropped table spans;
  miniapp display tests first produced consecutive paragraphs. Both are fixed
  with bounded numeric spans and existing unsafe-attribute rejection retained.
- An actual TipTap HTML/JSON round trip first flattened the table. Schema-only
  table nodes now preserve it, including nested tables and empty continuation
  rows. No table toolbar or new teaching workflow was introduced.
- Word export first contained no data table. It now uses real Word tables and
  native editable equations within cells. Media hydration recurses into cells
  and does not append a duplicate image after the question.
- PDF uses measured cells and borders. Independent rows paginate; merged cells
  stay together. A cell/group taller than a page or a table too wide to render
  safely returns an explicit error rather than silently clipping/flattening.
  This size limitation is not claimed as unrestricted table layout support.

## Verified source artifact

Evidence folder: `gewu-table-source-render-20260920-ILLEV4` in the local temporary
evidence area. Inputs came from the D-drive original exam/lecture, parsed into
`gewu-image-geometry-source-20260920-jj9if_g4`, not from invented sample text.
All 108 structured questions passed desktop normalization. One question
contains a data table: lecture-22, two rows and four cells in each row.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| tables.docx | 9349 | 349126cff4a98dc021183bb5e98ddace96abd65c6d122207d44fa6473fcb3f8f |
| tables.pdf | 131858 | af9ea064802ec39f49a11428f2c1582758d199cdfeec3859d931169f4a465b2e |

Microsoft Word opened the DOCX read-only, repaginated it to one page and
exported `word-native.pdf`. Its two Word tables are the source data table and
the existing option-column grid. This particular source question has no
equations; its zero equation count is expected, not a native-formula proof.
Native equations inside tables are covered separately by the renderer test.

Both `word-page.png` (real Word rendering) and `pdf-page.png` (cloud renderer,
Poppler rasterization) were visually inspected: the 2×4 grid, road labels,
0.7 / 0.6–0.7 / 0.32–0.4 values, four options and answer B are visible, with
no flattened cell sequence or clipped table. This is a local source-artifact
check; it is not a fresh production export or complete 108-page visual audit.

## Checks and remaining acceptance

Passed individually: 71 parser tests; rich-content suite including actual
TipTap and React server rendering; local question persistence tests;
miniapp question display tests; full paper export renderer suite; desktop and
miniapp TypeScript checks; optimized desktop renderer build; miniapp build.

Root regression attempts are retained, including failures. The first used
bundled Python without Paramiko; the second reached a real miniapp page-boundary
failure after the cloud suite passed. Payments/stats/assets imported the
registered forbidden page; they now share its unchanged content component,
while the registered page is a wrapper. Page access, copy, inventory and
desktop-authorization checks pass after this extraction.

The next run stopped at `ELECTRON_CROSS_INSTALL_OWNER_UNVERIFIED` and left the
test listener open. Only that identified test process was terminated. The
unchanged lock test passed when run independently. Its wrapper had launched
system npm through Node 24.15 despite a prepended PATH; the fresh full run now
invokes npm's CLI explicitly with bundled Node 24.19.0 and system Python with
Paramiko. Evidence: `gewu-root-regression-20260920-0pj1f9bo`. Its final outcome
must be appended; this is not yet a full-suite pass or proof of the lock error's
root cause.

Miniapp actual simulator evidence: `gewu-miniapp-table-visual-20260920-htyk5z2c`,
`teacher-pages-question-bank-index.png`. The D-source 2x4 table, all values,
four options, collapsed answer action, basket action and floating basket were
visually checked. The earlier successful screenshot exposed raw `single`;
the display labels now reuse one tested mapping matching desktop aliases.
Stored question types, scoring and paper grouping are unchanged.

After the component extraction, one run showed a blank page and a module-loader
TypeError. Clearing **only compilation cache** and refreshing resolved it:
the subsequent actual UI run passed and the error was absent from the new
console capture. No login/storage cache was cleared, and no runtime workaround
was added. Earlier failed evidence (including `nz_jfhrc`) remains available.
The table response is a display-only fixture, not production question data or
authorization evidence. The helper restores the wx API and prior login state
and does not submit cloud question writes.

Still required: successful actual desktop screen evidence, rollout
compatibility checks, scoped content repair with version conflict protection,
then a fresh real-cloud export. The separately recorded answer/source mix-up,
question-108 pagination finding, full role/page UI audit and desktop OSS
release remain open.
