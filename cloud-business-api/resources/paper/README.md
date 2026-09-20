# Export template

`output-template.docx` is the user's supplied output template, retained without
changes. SHA256:
`fb8ac8d5b95f18ac72110a9161583fbf92736a991545980dd6b6b7b9a19060f2`.

The cloud renderer starts from this ZIP package, replacing the paper title,
question slots, choice-answer grid and sample answer content. It retains the
original A4 sections, styles, numbering, header/footer fields and opaque parts.
The only footer edit moves the original page-field runs unchanged out of the
invisible floating textbox into its existing centered paragraph. Word otherwise
fits that box to stale single-digit cached values, clipping/wrapping the final
character after repagination. Border, contact, styling and all bytes outside the
textbox wrapper remain unchanged. The retained reference itself is never edited.

Solutions (including the importer's `problem` and `calculation` types) start a
new page, except when they are the first question below the title. Each reserves
240 pt of writing space after its content and the following question starts a
new page. Long content may continue onto a second page without clipping.
Caller-selected question order, custom section names and inline/end answer
placement remain supported. A separate answer section restarts its page counter,
matching the source template. Native Word equations remain editable OMML.

PDF uses the same title/identity fields, A4 geometry, category/answer layout and
footer content, with Noto Serif CJK as the redistributable serif counterpart to
Windows SimSun. PDF and Word can have different line/page breaks; do not claim
pixel-identical conversion. Test source files are not production database writes.

Tests: `src/paperExportTemplate.test.js`, `src/paperExportPdfTemplate.test.js`,
the full paper-export regressions, parser source-section tests and visual QA.
