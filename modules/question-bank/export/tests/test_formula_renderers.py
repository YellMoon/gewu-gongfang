import sys
import unittest
from pathlib import Path


EXPORT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EXPORT_ROOT))

from formula_renderers import FormulaRenderError, resolve_formula_manifest  # noqa: E402


class FormulaRendererContractTests(unittest.TestCase):
    def test_manifest_preserves_location_and_native_mode(self):
        rows = resolve_formula_manifest(
            [{
                "questionId": "q-1",
                "location": "options[1]",
                "index": 0,
                "canonicalLatex": r"\frac{a}{b}",
                "requestedMode": "word-native",
                "nativeAvailable": True,
            }]
        )
        self.assertEqual(rows[0]["questionId"], "q-1")
        self.assertEqual(rows[0]["location"], "options[1]")
        self.assertEqual(rows[0]["index"], 0)
        self.assertEqual(rows[0]["requestedMode"], "word-native")
        self.assertEqual(rows[0]["effectiveMode"], "word-native")
        self.assertFalse(rows[0]["fallbackUsed"])

    def test_mathtype_without_audited_writer_falls_back_truthfully(self):
        rows = resolve_formula_manifest(
            [{
                "questionId": "q-2",
                "location": "answer",
                "index": 0,
                "canonicalLatex": "x+1",
                "requestedMode": "mathtype-compatible",
                "mathtypeAvailable": False,
            }]
        )
        self.assertEqual(rows[0]["effectiveMode"], "latex-vector")
        self.assertTrue(rows[0]["fallbackUsed"])
        self.assertEqual(rows[0]["diagnostics"][0]["code"], "MATHTYPE_WRITER_UNAVAILABLE")

    def test_mathtype_cannot_be_claimed_from_a_boolean_without_ole_evidence(self):
        with self.assertRaises(FormulaRenderError) as raised:
            resolve_formula_manifest(
                [{
                    "questionId": "q-3",
                    "location": "stem",
                    "index": 0,
                    "canonicalLatex": "x",
                    "requestedMode": "mathtype-compatible",
                    "mathtypeAvailable": True,
                }]
            )
        self.assertEqual(raised.exception.diagnostics[0]["code"], "MATHTYPE_EVIDENCE_REQUIRED")

    def test_empty_canonical_latex_blocks_the_artifact_with_location(self):
        with self.assertRaises(FormulaRenderError) as raised:
            resolve_formula_manifest(
                [{
                    "questionId": "q-empty",
                    "location": "analysis",
                    "index": 4,
                    "canonicalLatex": "  ",
                    "requestedMode": "latex-vector",
                }]
            )
        diagnostic = raised.exception.diagnostics[0]
        self.assertEqual(diagnostic["code"], "FORMULA_CANONICAL_LATEX_EMPTY")
        self.assertEqual(diagnostic["questionId"], "q-empty")
        self.assertEqual(diagnostic["location"], "analysis")
        self.assertEqual(diagnostic["index"], 4)


if __name__ == "__main__":
    unittest.main()
