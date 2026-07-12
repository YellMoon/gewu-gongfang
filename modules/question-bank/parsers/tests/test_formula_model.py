from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


PARSER_DIR = Path(__file__).resolve().parents[1]
if str(PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(PARSER_DIR))

from formula_model import (  # noqa: E402
    FormulaConversionResult,
    FormulaDocument,
    FormulaSource,
    FormulaTypography,
)


class FormulaModelTests(unittest.TestCase):
    def test_public_projection_keeps_latex_and_traceability_without_binary_payload(self):
        formula = FormulaDocument(
            formula_id="formula-1",
            canonical_latex=r"\frac{a}{b}",
            normalized_mathml="<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>",
            display_mode="inline",
            typography=FormulaTypography(font_size_pt=12.0, baseline_shift_pt=-1.25),
            source=FormulaSource(
                source_format="mathtype",
                part_name="word/comments.xml",
                paragraph_index=4,
                comment_id="7",
                rel_id="rId9",
                content_index=2,
                payload_hash="sha256:abc",
                payload_ref="word/embeddings/oleObject1.bin",
                preview_ref="word/media/image1.emf",
                raw_payload=b"OLE-BINARY-MUST-NOT-LEAK",
            ),
            conversion_status="complete",
            warnings=("normalized operator spacing",),
        )

        public = formula.to_public_dict()
        encoded = json.dumps(public, ensure_ascii=False)

        self.assertEqual(public["canonical_latex"], r"\frac{a}{b}")
        self.assertEqual(public["source"]["part_name"], "word/comments.xml")
        self.assertEqual(public["source"]["comment_id"], "7")
        self.assertEqual(public["source"]["payload_ref"], "word/embeddings/oleObject1.bin")
        self.assertNotIn("raw_payload", public["source"])
        self.assertNotIn("OLE-BINARY-MUST-NOT-LEAK", encoded)

    def test_visible_fallback_never_returns_source_code_or_xml(self):
        result = FormulaConversionResult(
            status="preview_only",
            canonical_latex=None,
            normalized_mathml=None,
            preview_ref="word/media/equation.png",
            warnings=("unsupported MathType record",),
        )

        self.assertEqual(result.visible_fallback(), {"kind": "preview", "ref": "word/media/equation.png"})

        blocked = FormulaConversionResult(
            status="failed",
            canonical_latex=r"\unknown{raw}",
            normalized_mathml="<math/>",
            preview_ref=None,
            warnings=("no visible result",),
        )
        self.assertIsNone(blocked.visible_fallback())

    def test_invalid_display_mode_and_status_are_rejected(self):
        with self.assertRaises(ValueError):
            FormulaDocument(
                formula_id="bad",
                canonical_latex="x",
                normalized_mathml=None,
                display_mode="floating",
                source=FormulaSource(source_format="omml", part_name="word/document.xml"),
                conversion_status="complete",
            )

        with self.assertRaises(ValueError):
            FormulaConversionResult(status="guessed", canonical_latex="x")


if __name__ == "__main__":
    unittest.main()
