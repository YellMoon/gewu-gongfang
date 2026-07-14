# Formula export dependency audit

Reviewed on 2026-07-13. No third-party source code is vendored in this directory.

The bundled Ruby runtime contains these MIT-licensed **read-side** packages:

- `mathtype_to_mathml_plus` 0.0.16 — RubyGems metadata identifies David Vu and
  `https://github.com/vuhonglinh`; converts binary MathType/MTEF input to MathML.
- `mathtype` 0.0.8 — RubyGems metadata identifies Jure Triglav; reads MathType
  binaries and converts them to an XML form.
- `ruby-ole` 1.2.13.1 — `https://github.com/aquasync/ruby-ole`; general OLE
  structured-storage library.

Their installed gemspecs declare MIT licenses. They are used by the import path.
They do **not** provide an audited LaTeX/MathML-to-MTEF writer, so they are not a
legal or technical basis for claiming that a generated image is a MathType OLE
object.

Until an actual writer is selected, version-pinned, license-reviewed and tested
against MathType, export requests for `mathtype-compatible` must either fail
closed or report an explicit `latex-vector` fallback. The implementation chooses
the explicit fallback and records `MATHTYPE_WRITER_UNAVAILABLE`; the final gate
only accepts `mathtype-compatible` when the DOCX contains a real OLE embedding,
an `oleObject` relationship/object, and a visible preview relationship.

MTEF is a MathType/Design Science binary format. This audit does not grant rights
to proprietary MathType SDK material, and no SDK code or undocumented binary
writer has been copied into the project.
