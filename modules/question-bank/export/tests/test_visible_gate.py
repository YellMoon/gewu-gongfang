import hashlib
import base64
import binascii
import json
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

EXPORT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EXPORT_ROOT))

from visible_gate import (  # noqa: E402
    VisibleGateError,
    _pdf_has_visible_paint,
    _valid_png,
    _valid_svg,
    inspect_artifact,
)


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>
</Types>"""
EMPTY_RELS = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"""
VALID_SVG = '<svg viewBox="0 0 10 5"><path d="M0 0 L10 5 L0 5 Z"/></svg>'
VALID_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")


def valid_cfb():
    sector_size = 512
    header = bytearray(sector_size)
    header[:8] = bytes.fromhex("D0CF11E0A1B11AE1")
    header[24:26] = (0x3E).to_bytes(2, "little")
    header[26:28] = (3).to_bytes(2, "little")
    header[28:30] = bytes.fromhex("FEFF")
    header[30:32] = (9).to_bytes(2, "little")
    header[32:34] = (6).to_bytes(2, "little")
    header[44:48] = (1).to_bytes(4, "little")
    header[48:52] = (1).to_bytes(4, "little")
    header[56:60] = (4096).to_bytes(4, "little")
    header[60:64] = (0xFFFFFFFE).to_bytes(4, "little")
    header[68:72] = (0xFFFFFFFE).to_bytes(4, "little")
    header[76:80] = (0).to_bytes(4, "little")
    for offset in range(80, 512, 4):
        header[offset:offset + 4] = (0xFFFFFFFF).to_bytes(4, "little")
    fat = bytearray(b"\xff" * sector_size)
    entries = [0xFFFFFFFD, 0xFFFFFFFE, 3, 4, 5, 6, 7, 8, 9, 0xFFFFFFFE]
    for index, value in enumerate(entries):
        fat[index * 4:index * 4 + 4] = value.to_bytes(4, "little")
    directory = bytearray(sector_size)
    def entry(offset, name, object_type, start, size):
        encoded = (name + "\0").encode("utf-16le")
        directory[offset:offset + len(encoded)] = encoded
        directory[offset + 64:offset + 66] = len(encoded).to_bytes(2, "little")
        directory[offset + 66] = object_type
        directory[offset + 67] = 1
        directory[offset + 68:offset + 80] = b"\xff" * 12
        directory[offset + 116:offset + 120] = start.to_bytes(4, "little")
        directory[offset + 120:offset + 128] = size.to_bytes(8, "little")
    entry(0, "Root Entry", 5, 0xFFFFFFFE, 0)
    entry(128, "Equation Native", 2, 2, 4096)
    equation = bytearray(4096)
    equation[0:2] = (28).to_bytes(2, "little")
    equation[4:8] = (0x00020000).to_bytes(4, "little")
    equation[8:10] = (1).to_bytes(2, "little")
    equation[12:16] = (4096 - 28).to_bytes(4, "little")
    equation[28:35] = bytes([5, 1, 0, 6, 0, 1, 0])
    return bytes(header + fat + directory + equation)


def png_with_empty_idat():
    output = bytearray(VALID_PNG[:8]); offset = 8
    while offset < len(VALID_PNG):
        length = int.from_bytes(VALID_PNG[offset:offset + 4], "big")
        kind = VALID_PNG[offset + 4:offset + 8]
        payload = VALID_PNG[offset + 8:offset + 8 + length]
        if kind == b"IDAT":
            payload = zlib.compress(b"")
        output.extend(len(payload).to_bytes(4, "big") + kind + payload + (binascii.crc32(kind + payload) & 0xFFFFFFFF).to_bytes(4, "big"))
        offset += 12 + length
    return bytes(output)


def transparent_rgba_png():
    def chunk(kind, payload):
        return len(payload).to_bytes(4, "big") + kind + payload + (binascii.crc32(kind + payload) & 0xFFFFFFFF).to_bytes(4, "big")
    ihdr = (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([8, 6, 0, 0, 0])
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00")) + chunk(b"IEND", b"")


def png_with_trns(color_type, pixel, transparency, palette=b"", bit_depth=8):
    def chunk(kind, payload):
        return len(payload).to_bytes(4, "big") + kind + payload + (binascii.crc32(kind + payload) & 0xFFFFFFFF).to_bytes(4, "big")
    ihdr = (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([bit_depth, color_type, 0, 0, 0])
    chunks = [chunk(b"IHDR", ihdr)]
    if palette:
        chunks.append(chunk(b"PLTE", palette))
    chunks.extend((chunk(b"tRNS", transparency), chunk(b"IDAT", zlib.compress(b"\x00" + pixel)), chunk(b"IEND", b"")))
    return b"\x89PNG\r\n\x1a\n" + b"".join(chunks)


def manifest(mode, requested=None, latex="x", fallback=False):
    return [{
        "questionId": "q-1",
        "location": "stem",
        "index": 0,
        "canonicalLatex": latex,
        "requestedMode": requested or mode,
        "effectiveMode": mode,
        "fallbackUsed": fallback,
        "diagnostics": [],
    }]


def vector_body(index=0, svg_id="rSvg", png_id="rPng", extent=True):
    size = '<wp:extent cx="100" cy="50"/>' if extent else ""
    return f'<w:p><w:r><w:drawing><wp:inline>{size}<wp:docPr id="{index + 1}" name="formula-{index}" descr="GEWU_FORMULA_{index}"/><a:graphic><a:blip r:embed="{png_id}"><a:extLst><a:ext><asvg:svgBlip r:embed="{svg_id}"/></a:ext></a:extLst></a:blip></a:graphic></wp:inline></w:drawing></w:r></w:p>'


def native_body(index=0, eq=False):
    result = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>'
    if eq:
        result = f'<w:fldSimple w:instr=" EQ \\f(a,b) ">{result}</w:fldSimple>'
    return f'<w:sdt><w:sdtPr><w:tag w:val="GEWU_FORMULA_{index}"/></w:sdtPr><w:sdtContent>{result}</w:sdtContent></w:sdt>'


def write_docx(path, body, relationships=EMPTY_RELS, parts=None):
    document = f"""<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>{body}</w:body></w:document>"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", EMPTY_RELS)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/_rels/document.xml.rels", relationships)
        for name, value in (parts or {}).items():
            archive.writestr(name, value)


def write_pdf(path, content=None, include_contents=True, painted=True, extra_stream=None, compressed=False):
    drawing = b"0 0 m 20 20 l S" if painted else b"q Q"
    stream = content or (b"% GEWU_FORMULA_DRAW 0 10 762 20 20\n" + drawing + b"\n% GEWU_FORMULA_DRAW_END 0\n")
    contents = b" /Contents 4 0 R" if include_contents else b""
    stored_stream = zlib.compress(stream) if compressed else stream
    filter_name = b" /Filter /FlateDecode" if compressed else b""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]" + contents + b" /Annots [5 0 R] >>",
        b"<< /Length " + str(len(stored_stream)).encode() + filter_name + b" >>\nstream\n" + stored_stream + b"\nendstream",
        b"<< /Type /Annot /Subtype /Link /Rect [10 10 30 30] /A << /S /URI /URI (gewu-formula:0) >> >>",
    ]
    if extra_stream is not None:
        objects.append(b"<< /Length " + str(len(extra_stream)).encode() + b" >>\nstream\n" + extra_stream + b"\nendstream")
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for object_id, value in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f"{object_id} 0 obj\n".encode() + value + b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    output.extend(b"0000000000 65535 f \n")
    output.extend(b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:]))
    output.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    path.write_bytes(output)


def write_split_evidence_pdf(path):
    marker = b"% GEWU_FORMULA_DRAW 0 10 762 20 20\n0 0 m 20 20 l S\n% GEWU_FORMULA_DRAW_END 0\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Annots [6 0 R] >>",
        b"<< /Length " + str(len(marker)).encode() + b" >>\nstream\n" + marker + b"\nendstream",
        b"<< /Type /Annot /Subtype /Link /Rect [10 10 30 30] /A << /S /URI /URI (gewu-formula:0) >> >>",
        b"<< /Length 3 >>\nstream\nq Q\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for object_id, value in enumerate(objects, 1):
        offsets.append(len(output)); output.extend(f"{object_id} 0 obj\n".encode() + value + b"\nendobj\n")
    xref = len(output); output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    output.extend(b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:]))
    output.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    path.write_bytes(output)


class VisibleGatePackageContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temp.cleanup()

    def path(self, name="artifact.docx"):
        return Path(self.temp.name) / name

    def test_word_native_requires_omml_and_reports_final_hash(self):
        path = self.path()
        write_docx(path, f"<w:p>{native_body()}</w:p>")
        report = inspect_artifact(path, "docx", manifest("word-native"), question_count=1)
        self.assertEqual(report["formulaCount"], 1)
        self.assertEqual(report["fallbackCount"], 0)
        self.assertEqual(report["effectiveFormulaModes"], ["word-native"])
        self.assertEqual(report["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(report["questionCount"], 1)
        self.assertIsNone(report["pageCount"])

    def test_eq_field_requires_instruction_and_visible_omml_result(self):
        path = self.path()
        write_docx(path, f'<w:p>{native_body(eq=True)}</w:p>')
        report = inspect_artifact(path, "docx", manifest("eq-field"), question_count=1)
        self.assertEqual(report["effectiveFormulaModes"], ["eq-field"])

    def test_empty_native_and_eq_omml_are_not_visible_results(self):
        for mode, inner in (("word-native", "<m:oMath/>"), ("eq-field", '<w:fldSimple w:instr=" EQ \\f(a,b) "><m:oMath/></w:fldSimple>')):
            path = self.path(f"empty-{mode}.docx")
            body = f'<w:sdt><w:sdtPr><w:tag w:val="GEWU_FORMULA_0"/></w:sdtPr><w:sdtContent>{inner}</w:sdtContent></w:sdt>'
            write_docx(path, body)
            with self.assertRaises(VisibleGateError) as raised:
                inspect_artifact(path, "docx", manifest(mode), question_count=1)
            expected = "EQ_FIELD_VISIBLE_RESULT_MISSING" if mode == "eq-field" else "OMML_VISIBLE_RESULT_MISSING"
            self.assertTrue(any(item["code"] == expected for item in raised.exception.diagnostics))

    def test_omml_chr_attribute_without_run_text_semantics_is_not_renderable(self):
        path = self.path("chr-only.docx")
        body = '<w:sdt><w:sdtPr><w:tag w:val="GEWU_FORMULA_0"/></w:sdtPr><w:sdtContent><m:oMath><m:chr m:val="x"/></m:oMath></w:sdtContent></w:sdt>'
        write_docx(path, body)
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "docx", manifest("word-native"), question_count=1)
        self.assertTrue(any(item["code"] == "OMML_VISIBLE_RESULT_MISSING" for item in raised.exception.diagnostics))

    def test_latex_vector_requires_svg_png_relationships_and_positive_extent(self):
        path = self.path()
        rels = """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rSvg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.svg"/>
          <Relationship Id="rPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.png"/>
        </Relationships>"""
        body = vector_body()
        write_docx(path, body, rels, {"word/media/formula.svg": VALID_SVG, "word/media/formula.png": VALID_PNG})
        report = inspect_artifact(path, "docx", manifest("latex-vector"), question_count=1)
        self.assertEqual(report["formulaCount"], 1)

    def test_latex_vector_without_formula_extent_fails_for_that_formula(self):
        path = self.path("vector-no-extent.docx")
        rels = """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rSvg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.svg"/>
          <Relationship Id="rPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.png"/>
        </Relationships>"""
        write_docx(path, vector_body(extent=False), rels, {"word/media/formula.svg": VALID_SVG, "word/media/formula.png": VALID_PNG})
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "docx", manifest("latex-vector"), question_count=1)
        self.assertEqual(raised.exception.diagnostics[0]["code"], "FORMULA_RENDER_BOUNDS_MISSING")
        self.assertEqual(raised.exception.diagnostics[0]["questionId"], "q-1")

    def test_vector_media_must_be_structurally_renderable(self):
        rels = """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rSvg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.svg"/>
          <Relationship Id="rPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.png"/>
        </Relationships>"""
        for name, svg, png, code in (
            ("empty-svg", '<svg viewBox="0 0 10 5"></svg>', VALID_PNG, "LATEX_VECTOR_SVG_INVALID"),
            ("empty-path", '<svg viewBox="0 0 10 5"><path d=""/></svg>', VALID_PNG, "LATEX_VECTOR_SVG_INVALID"),
            ("zero-shape", '<svg viewBox="0 0 10 5"><rect width="0" height="5"/></svg>', VALID_PNG, "LATEX_VECTOR_SVG_INVALID"),
            ("hidden-path", '<svg viewBox="0 0 10 5"><g style="display:none"><path d="M0 0 L10 5"/></g></svg>', VALID_PNG, "LATEX_VECTOR_SVG_INVALID"),
            ("transparent-path", '<svg viewBox="0 0 10 5" opacity="0"><path d="M0 0 L10 5"/></svg>', VALID_PNG, "LATEX_VECTOR_SVG_INVALID"),
            ("none-paint", '<svg viewBox="0 0 10 5"><path fill="none" stroke="none" d="M0 0 L10 5"/></svg>', VALID_PNG, "LATEX_VECTOR_SVG_INVALID"),
            ("zero-path", '<svg viewBox="0 0 10 5"><path d="M0 0 L0 0"/></svg>', VALID_PNG, "LATEX_VECTOR_SVG_INVALID"),
            ("fake-png", VALID_SVG, b"PNG", "LATEX_VECTOR_PNG_INVALID"),
            ("empty-idat", VALID_SVG, png_with_empty_idat(), "LATEX_VECTOR_PNG_INVALID"),
            ("transparent-png", VALID_SVG, transparent_rgba_png(), "LATEX_VECTOR_PNG_INVALID"),
        ):
            path = self.path(f"{name}.docx")
            write_docx(path, vector_body(), rels, {"word/media/formula.svg": svg, "word/media/formula.png": png})
            with self.assertRaises(VisibleGateError) as raised:
                inspect_artifact(path, "docx", manifest("latex-vector"), question_count=1)
            self.assertTrue(any(item["code"] == code for item in raised.exception.diagnostics))

    def test_svg_fill_requires_nonzero_area_but_keeps_polygon_curve_and_stroke(self):
        self.assertFalse(_valid_svg(b'<svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>'))
        self.assertTrue(_valid_svg(b'<svg viewBox="0 0 10 10"><path d="M0 0 L10 10 L0 10 Z"/></svg>'))
        self.assertTrue(_valid_svg(b'<svg viewBox="0 0 10 10"><path d="M0 0 C0 10 10 10 10 0 Z"/></svg>'))
        self.assertTrue(_valid_svg(b'<svg viewBox="0 0 10 10"><path fill="none" stroke="black" d="M0 0 L10 10"/></svg>'))

    def test_png_trns_requires_at_least_one_visible_pixel(self):
        cases = (
            (0, b"\x7f", b"\x00\x7f", b""),
            (2, b"\xff\x00\x00", b"\x00\xff\x00\x00\x00\x00", b""),
            (3, b"\x00", b"\x00", b"\xff\x00\x00\x00\xff\x00"),
        )
        for color_type, pixel, transparency, palette in cases:
            with self.subTest(color_type=color_type):
                self.assertFalse(_valid_png(png_with_trns(color_type, pixel, transparency, palette)))
                visible = bytearray(pixel); visible[-1] ^= 1
                self.assertTrue(_valid_png(png_with_trns(color_type, bytes(visible), transparency, palette)))
        palette = b"\xff\x00\x00\x00\xff\x00"
        self.assertFalse(_valid_png(png_with_trns(3, b"\x80", b"\xff\x00", palette, bit_depth=1)))
        self.assertTrue(_valid_png(png_with_trns(3, b"\x00", b"\xff\x00", palette, bit_depth=1)))

    def test_mathtype_rejects_fake_ole_and_preview_bytes(self):
        path = self.path("fake-mathtype.docx")
        rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/equation.bin"/><Relationship Id="rPreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/equation.png"/></Relationships>'
        body = '<w:sdt><w:sdtPr><w:tag w:val="GEWU_FORMULA_0"/></w:sdtPr><w:sdtContent><w:object><o:OLEObject r:id="rOle"/></w:object><w:drawing><wp:inline><a:graphic><a:blip r:embed="rPreview"/></a:graphic></wp:inline></w:drawing></w:sdtContent></w:sdt>'
        write_docx(path, body, rels, {"word/embeddings/equation.bin": b"OLE", "word/media/equation.png": b"PNG"})
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "docx", manifest("mathtype-compatible"), question_count=1)
        self.assertTrue(any(item["code"] == "MATHTYPE_OLE_EVIDENCE_INVALID" for item in raised.exception.diagnostics))

        arbitrary_stream = bytearray(valid_cfb()); arbitrary_stream[-4096:] = b"E" * 4096
        write_docx(path, body, rels, {"word/embeddings/equation.bin": bytes(arbitrary_stream), "word/media/equation.png": VALID_PNG})
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "docx", manifest("mathtype-compatible"), question_count=1)
        self.assertTrue(any(item["code"] == "MATHTYPE_OLE_EVIDENCE_INVALID" for item in raised.exception.diagnostics))

        fake_header = bytearray(1024)
        fake_header[:8] = bytes.fromhex("D0CF11E0A1B11AE1")
        fake_header[28:30] = bytes.fromhex("FEFF"); fake_header[30:32] = (9).to_bytes(2, "little"); fake_header[32:34] = (6).to_bytes(2, "little"); fake_header[44:48] = (1).to_bytes(4, "little")
        write_docx(path, body, rels, {"word/embeddings/equation.bin": bytes(fake_header), "word/media/equation.png": VALID_PNG})
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "docx", manifest("mathtype-compatible"), question_count=1)
        self.assertTrue(any(item["code"] == "MATHTYPE_OLE_EVIDENCE_INVALID" for item in raised.exception.diagnostics))

    def test_mathtype_claim_fails_closed_without_audited_fixture(self):
        path = self.path()
        rels = """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/equation.bin"/>
          <Relationship Id="rPreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/equation.png"/>
        </Relationships>"""
        body = '<w:sdt><w:sdtPr><w:tag w:val="GEWU_FORMULA_0"/></w:sdtPr><w:sdtContent><w:p><w:r><w:object><o:OLEObject ProgID="Equation.DSMT4" r:id="rOle"/></w:object><w:drawing><wp:inline><wp:extent cx="100" cy="50"/><a:graphic><a:blip r:embed="rPreview"/></a:graphic></wp:inline></w:drawing></w:r></w:p></w:sdtContent></w:sdt>'
        write_docx(path, body, rels, {"word/embeddings/equation.bin": valid_cfb(), "word/media/equation.png": VALID_PNG})
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "docx", manifest("mathtype-compatible"), question_count=1)
        self.assertTrue(any(item["code"] == "MATHTYPE_OLE_EVIDENCE_INVALID" for item in raised.exception.diagnostics))

    def test_unreferenced_png_cannot_satisfy_vector_fallback_or_mathtype_preview(self):
        vector_path = self.path("vector-unreferenced.docx")
        vector_rels = """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rSvg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.svg"/>
          <Relationship Id="rUnused" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/unused.png"/>
        </Relationships>"""
        write_docx(vector_path, vector_body(png_id=""), vector_rels, {"word/media/formula.svg": VALID_SVG, "word/media/unused.png": VALID_PNG})
        with self.assertRaises(VisibleGateError) as vector_error:
            inspect_artifact(vector_path, "docx", manifest("latex-vector"), question_count=1)
        self.assertTrue(any(item["code"] == "LATEX_VECTOR_PNG_FALLBACK_MISSING" for item in vector_error.exception.diagnostics))

        mathtype_path = self.path("mathtype-unreferenced.docx")
        mathtype_rels = """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/equation.bin"/>
          <Relationship Id="rUnused" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/unused.png"/>
        </Relationships>"""
        mathtype_body = '<w:p><w:r><w:object><o:OLEObject ProgID="Equation.DSMT4" r:id="rOle"/></w:object></w:r></w:p>'
        write_docx(mathtype_path, mathtype_body, mathtype_rels, {"word/embeddings/equation.bin": valid_cfb(), "word/media/unused.png": VALID_PNG})
        with self.assertRaises(VisibleGateError) as mathtype_error:
            inspect_artifact(mathtype_path, "docx", manifest("mathtype-compatible"), question_count=1)
        self.assertTrue(any(item["code"] == "MATHTYPE_OLE_EVIDENCE_MISSING" for item in mathtype_error.exception.diagnostics))

    def test_mathtype_evidence_must_be_bound_inside_each_indexed_container(self):
        path = self.path("mathtype-cross-bound.docx")
        rels = """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/equation.bin"/>
          <Relationship Id="rPreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/equation.png"/>
        </Relationships>"""
        body = native_body(0).replace('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', '<w:object><o:OLEObject ProgID="Equation.DSMT4" r:id="rOle"/></w:object>') + native_body(1).replace('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', '<w:drawing><wp:inline><wp:extent cx="100" cy="50"/><a:graphic><a:blip r:embed="rPreview"/></a:graphic></wp:inline></w:drawing>')
        write_docx(path, body, rels, {"word/embeddings/equation.bin": valid_cfb(), "word/media/equation.png": VALID_PNG})
        rows = manifest("mathtype-compatible") + [{**manifest("mathtype-compatible")[0], "questionId": "q-2", "index": 1}]
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "docx", rows, question_count=2)
        self.assertEqual({item["questionId"] for item in raised.exception.diagnostics if item["code"] == "MATHTYPE_OLE_EVIDENCE_MISSING"}, {"q-1", "q-2"})

    def test_broken_relationship_blocks_with_location(self):
        path = self.path()
        rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rSvg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.svg"/><Relationship Id="rPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.png"/></Relationships>'
        write_docx(path, vector_body(), rels, {"word/media/formula.png": VALID_PNG})
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "docx", manifest("latex-vector"), question_count=1)
        broken = next(item for item in raised.exception.diagnostics if item["code"] == "DOCX_RELATIONSHIP_TARGET_MISSING")
        self.assertEqual(broken["questionId"], "q-1")

    def test_zero_extent_crop_source_residue_and_placeholder_each_block(self):
        cases = [
            ('<w:p><w:r><w:t>\\frac{a}{b}</w:t></w:r><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>', "FORMULA_SOURCE_RESIDUE_VISIBLE"),
            ('<w:p><w:r><w:t>[[GEWU_FORMULA_0]]</w:t></w:r></w:p>', "FORMULA_PLACEHOLDER_UNRESOLVED"),
        ]
        for index, (body, code) in enumerate(cases):
            with self.subTest(code=code):
                path = self.path(f"case-{index}.docx")
                write_docx(path, body)
                with self.assertRaises(VisibleGateError) as raised:
                    inspect_artifact(path, "docx", manifest("word-native"), question_count=1)
                self.assertTrue(any(item["code"] == code for item in raised.exception.diagnostics))

        rels = """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rSvg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.svg"/>
          <Relationship Id="rPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.png"/>
        </Relationships>"""
        parts = {"word/media/formula.svg": VALID_SVG, "word/media/formula.png": VALID_PNG}
        vector_cases = [
            (vector_body().replace('cx="100"', 'cx="0"'), "FORMULA_RENDER_BOUNDS_INVALID"),
            (vector_body().replace("<a:graphic>", '<a:srcRect l="1"/><a:graphic>'), "FORMULA_RENDER_CROPPED"),
        ]
        for index, (body, code) in enumerate(vector_cases):
            with self.subTest(code=code):
                path = self.path(f"vector-case-{index}.docx")
                write_docx(path, body, rels, parts)
                with self.assertRaises(VisibleGateError) as raised:
                    inspect_artifact(path, "docx", manifest("latex-vector"), question_count=1)
                self.assertTrue(any(item["code"] == code for item in raised.exception.diagnostics))

    def test_visible_source_gate_covers_inline_commands_and_serialized_markup_but_not_field_instruction(self):
        visible_cases = [
            "$x$",
            r"\alpha + 1",
            "<math><mi>x</mi></math>",
            "<m:oMath><m:r/></m:oMath>",
            "EQ \\f(a,b)",
        ]
        for index, visible in enumerate(visible_cases):
            with self.subTest(visible=visible):
                path = self.path(f"source-{index}.docx")
                escaped = visible.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                write_docx(path, f"<w:p><w:r><w:t>{escaped}</w:t></w:r>{native_body()}</w:p>")
                with self.assertRaises(VisibleGateError) as raised:
                    inspect_artifact(path, "docx", manifest("word-native"), question_count=1)
                self.assertTrue(any(item["code"] == "FORMULA_SOURCE_RESIDUE_VISIBLE" for item in raised.exception.diagnostics))

        eq_path = self.path("eq-instruction-hidden.docx")
        write_docx(eq_path, f'<w:p>{native_body(eq=True)}</w:p>')
        inspect_artifact(eq_path, "docx", manifest("eq-field"), question_count=1)

    def test_source_gate_allows_comparisons_and_currency(self):
        path = self.path("legal-visible-text.docx")
        write_docx(path, f'<w:p><w:r><w:t>a&lt;b and c&gt;d, price $5$</w:t></w:r>{native_body()}</w:p>')
        inspect_artifact(path, "docx", manifest("word-native"), question_count=1)

    def test_source_gate_allows_ordinary_windows_paths(self):
        path = self.path("windows-path.docx")
        write_docx(path, f'<w:p><w:r><w:t>C:\\alpha\\lesson and \\\\server\\alpha\\lesson</w:t></w:r>{native_body()}</w:p>')
        inspect_artifact(path, "docx", manifest("word-native"), question_count=1)

        command_path = self.path("standalone-command.docx")
        write_docx(command_path, f'<w:p><w:r><w:t>value \\alpha + 1</w:t></w:r>{native_body()}</w:p>')
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(command_path, "docx", manifest("word-native"), question_count=1)
        self.assertTrue(any(item["code"] == "FORMULA_SOURCE_RESIDUE_VISIBLE" for item in raised.exception.diagnostics))

    def test_native_and_eq_missing_first_formula_map_to_first_manifest_row(self):
        for mode in ("word-native", "eq-field"):
            with self.subTest(mode=mode):
                path = self.path(f"missing-first-{mode}.docx")
                write_docx(path, f'<w:p>{native_body(1, eq=mode == "eq-field")}</w:p>')
                rows = manifest(mode) + [{**manifest(mode)[0], "questionId": "q-2", "location": "analysis", "index": 1}]
                with self.assertRaises(VisibleGateError) as raised:
                    inspect_artifact(path, "docx", rows, question_count=2)
                code = "EQ_FIELD_VISIBLE_RESULT_MISSING" if mode == "eq-field" else "OMML_VISIBLE_RESULT_MISSING"
                missing = next(item for item in raised.exception.diagnostics if item["code"] == code)
                self.assertEqual(missing["questionId"], "q-1")
                self.assertEqual(missing["location"], "stem")

    def test_docx_formula_index_set_must_match_manifest_exactly(self):
        extra = self.path("extra-index.docx")
        write_docx(extra, native_body(0) + native_body(1))
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(extra, "docx", manifest("word-native"), question_count=1)
        self.assertTrue(any(item["code"] == "FORMULA_INDEX_SET_MISMATCH" for item in raised.exception.diagnostics))
        duplicate = self.path("duplicate-index.docx")
        write_docx(duplicate, native_body(0) + native_body(0))
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(duplicate, "docx", manifest("word-native"), question_count=1)
        self.assertTrue(any(item["code"] == "FORMULA_INDEX_DUPLICATE" for item in raised.exception.diagnostics))

    def test_second_formula_broken_relationship_maps_to_second_manifest_location(self):
        path = self.path("second-broken.docx")
        rels = """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rSvg0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula0.svg"/>
          <Relationship Id="rPng0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula0.png"/>
          <Relationship Id="rSvg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.svg"/>
          <Relationship Id="rPng1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula1.png"/>
        </Relationships>"""
        body = vector_body(0, "rSvg0", "rPng0") + vector_body(1, "rSvg1", "rPng1")
        parts = {"word/media/formula0.svg": VALID_SVG, "word/media/formula0.png": VALID_PNG, "word/media/formula1.png": VALID_PNG}
        write_docx(path, body, rels, parts)
        rows = manifest("latex-vector") + [{**manifest("latex-vector")[0], "questionId": "q-2", "location": "analysis", "index": 1}]
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "docx", rows, question_count=2)
        broken = next(item for item in raised.exception.diagnostics if item["code"] == "DOCX_RELATIONSHIP_TARGET_MISSING")
        self.assertEqual(broken["questionId"], "q-2")
        self.assertEqual(broken["location"], "analysis")

    def test_empty_canonical_formula_blocks(self):
        path = self.path()
        write_docx(path, "<w:p/>")
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "docx", manifest("latex-vector", latex=""), question_count=1)
        self.assertEqual(raised.exception.diagnostics[0]["code"], "FORMULA_CANONICAL_LATEX_EMPTY")

    def test_pdf_report_uses_final_file_and_truthful_fallback(self):
        path = self.path("artifact.pdf")
        write_pdf(path)
        report = inspect_artifact(path, "pdf", manifest("latex-vector", requested="word-native", fallback=True), question_count=1)
        self.assertEqual(report["pageCount"], 1)
        self.assertEqual(report["formulaCount"], 1)
        self.assertEqual(report["fallbackCount"], 1)
        self.assertEqual(report["effectiveFormulaModes"], ["latex-vector"])

    def test_pdf_flate_page_content_stream_is_decoded(self):
        path = self.path("compressed.pdf")
        write_pdf(path, compressed=True)
        report = inspect_artifact(path, "pdf", manifest("latex-vector"), question_count=1)
        self.assertEqual(report["formulaCount"], 1)

    def test_pdf_source_residue_is_checked_only_in_referenced_page_text(self):
        path = self.path("pdf-source.pdf")
        content = b"BT (\\alpha + 1) Tj ET\n% GEWU_FORMULA_DRAW 0 10 762 20 20\n0 0 m 20 20 l S\n% GEWU_FORMULA_DRAW_END 0\n"
        write_pdf(path, content=content)
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "pdf", manifest("latex-vector"), question_count=1)
        self.assertTrue(any(item["code"] == "FORMULA_SOURCE_RESIDUE_VISIBLE" for item in raised.exception.diagnostics))

        clean_path = self.path("pdf-windows-path.pdf")
        write_pdf(clean_path, content=content.replace(b"\\alpha + 1", b"C:\\Users\\teacher\\lesson"))
        inspect_artifact(clean_path, "pdf", manifest("latex-vector"), question_count=1)

    def test_blank_pdf_with_formula_manifest_fails_closed(self):
        path = self.path("blank.pdf")
        write_pdf(path, include_contents=False)
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "pdf", manifest("latex-vector"), question_count=1)
        self.assertTrue(any(item["code"] == "PDF_PAGE_CONTENTS_MISSING" for item in raised.exception.diagnostics))

    def test_pdf_marker_and_annotation_without_actual_draw_is_not_visible_evidence(self):
        path = self.path("annotation-only.pdf")
        write_pdf(path, painted=False)
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "pdf", manifest("latex-vector"), question_count=1)
        self.assertEqual(raised.exception.diagnostics[0]["code"], "PDF_FORMULA_DRAW_OPERATOR_MISSING")

    def test_pdf_comment_or_string_operator_tokens_are_not_paint(self):
        for name, fake in (("comment", b"% S"), ("string", b"(S)"), ("empty-stroke", b"S"), ("empty-text", b"BT /F1 12 Tf () Tj ET")):
            path = self.path(f"fake-operator-{name}.pdf")
            content = b"% GEWU_FORMULA_DRAW 0 10 762 20 20\n" + fake + b"\n% GEWU_FORMULA_DRAW_END 0\n"
            write_pdf(path, content=content)
            with self.assertRaises(VisibleGateError) as raised:
                inspect_artifact(path, "pdf", manifest("latex-vector"), question_count=1)
            self.assertTrue(any(item["code"] == "PDF_FORMULA_DRAW_OPERATOR_MISSING" for item in raised.exception.diagnostics))

    def test_pdf_paint_must_intersect_formula_box_and_text_needs_page_font(self):
        for name, fake in (
            ("outside-path", b"1000 1000 m 1100 1100 l S"),
            ("clipped-away", b"0 0 1 1 re W n 10 762 m 30 782 l S"),
            ("missing-font", b"BT /Missing 12 Tf 10 770 Td (x) Tj ET"),
        ):
            path = self.path(f"{name}.pdf")
            content = b"% GEWU_FORMULA_DRAW 0 10 762 20 20\n" + fake + b"\n% GEWU_FORMULA_DRAW_END 0\n"
            write_pdf(path, content=content)
            with self.assertRaises(VisibleGateError) as raised:
                inspect_artifact(path, "pdf", manifest("latex-vector"), question_count=1)
            self.assertTrue(any(item["code"] == "PDF_FORMULA_DRAW_OPERATOR_MISSING" for item in raised.exception.diagnostics))

    def test_pdf_pending_clip_applies_at_every_path_end(self):
        formula_stroke = b"GEWU_PAINT_BEGIN 10 10 m 30 30 l S GEWU_PAINT_END"
        for path_end in (b"n", b"f"):
            with self.subTest(path_end=path_end):
                stream = b"0 0 1 1 re W " + path_end + b" " + formula_stroke
                self.assertFalse(_pdf_has_visible_paint(stream, (10, 10, 30, 30), set()))

    def test_pdf_fill_requires_nonzero_subpath_area_and_B_keeps_valid_stroke(self):
        box = (10, 10, 30, 30)
        self.assertFalse(_pdf_has_visible_paint(b"10 10 m 30 30 l f", box, set()))
        self.assertFalse(_pdf_has_visible_paint(b"10 10 m 30 30 l f*", box, set()))
        self.assertTrue(_pdf_has_visible_paint(b"10 10 m 30 30 l 10 30 l f", box, set()), "fill implicitly closes an open triangle")
        self.assertTrue(_pdf_has_visible_paint(b"10 10 m 10 30 30 30 30 10 c f", box, set()), "curved fill keeps nonzero geometry")
        self.assertFalse(_pdf_has_visible_paint(b"10 10 m B", box, set()), "a move-only B path has neither fill area nor stroke geometry")
        self.assertTrue(_pdf_has_visible_paint(b"10 10 m 30 30 l B", box, set()), "B remains visible when its stroke geometry is valid")

    def test_pdf_formula_index_set_must_match_manifest_exactly(self):
        path = self.path("extra-pdf-index.pdf")
        content = b"% GEWU_FORMULA_DRAW 0 10 762 20 20\n0 0 m 20 20 l S\n% GEWU_FORMULA_DRAW_END 0\n% GEWU_FORMULA_DRAW 1 40 762 20 20\n0 0 m 20 20 l S\n% GEWU_FORMULA_DRAW_END 1\n"
        write_pdf(path, content=content)
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "pdf", manifest("latex-vector"), question_count=1)
        self.assertTrue(any(item["code"] == "FORMULA_INDEX_SET_MISMATCH" for item in raised.exception.diagnostics))

    def test_pdf_unreferenced_stream_cannot_supply_formula_evidence(self):
        path = self.path("unreferenced-stream.pdf")
        write_pdf(path, include_contents=False, extra_stream=b"% GEWU_FORMULA_DRAW 0 10 762 20 20\n0 0 m 20 20 l S\n% GEWU_FORMULA_DRAW_END 0")
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "pdf", manifest("latex-vector"), question_count=1)
        self.assertTrue(any(item["code"] == "PDF_PAGE_CONTENTS_MISSING" for item in raised.exception.diagnostics))

    def test_pdf_formula_evidence_cannot_be_split_across_pages(self):
        path = self.path("split-pages.pdf")
        write_split_evidence_pdf(path)
        with self.assertRaises(VisibleGateError) as raised:
            inspect_artifact(path, "pdf", manifest("latex-vector"), question_count=1)
        self.assertTrue(any(item["code"] == "PDF_FORMULA_PAGE_EVIDENCE_MISMATCH" for item in raised.exception.diagnostics))


if __name__ == "__main__":
    unittest.main()
