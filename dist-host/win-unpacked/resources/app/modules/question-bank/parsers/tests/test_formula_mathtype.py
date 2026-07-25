from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


PARSER_DIR = Path(__file__).resolve().parents[1]
if str(PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(PARSER_DIR))

import formula_mathtype as mathtype  # noqa: E402
from formula_mathml import convert_mathml_to_latex  # noqa: E402


MATHML_FRACTION = '<?xml version="1.0"?><math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><msub><mi>v</mi><mn>0</mn></msub><mn>2</mn></mfrac></math>'
MATHML_MATRIX = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfenced open="[" close="]"><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable></mfenced></math>'


class MathTypeFormulaTests(unittest.TestCase):
    def setUp(self) -> None:
        mathtype.clear_mathtype_cache()

    def test_mathml_normalizes_fraction_scripts_and_matrix(self):
        fraction = convert_mathml_to_latex(MATHML_FRACTION)
        matrix = convert_mathml_to_latex(MATHML_MATRIX)
        self.assertEqual(fraction.canonical_latex, r"\frac{v_{0}}{2}")
        self.assertEqual(matrix.canonical_latex, r"\left[\begin{matrix}a & b \\ c & d\end{matrix}\right]")

    def test_batch_deduplicates_ole_payloads_and_parses_sentinel_json(self):
        payload = mathtype.MATHTYPE_BATCH_SENTINEL + json.dumps([MATHML_FRACTION, None])
        completed = Mock(returncode=0, stdout=payload, stderr="")
        runner = Mock(return_value=completed)

        with patch.object(mathtype, "find_ruby_executable", return_value="ruby"):
            results = mathtype.convert_mathtype_oles_to_mathml_batch(
                [b"same", b"same", b"other"], runner=runner
            )

        self.assertEqual(runner.call_count, 1)
        argv = runner.call_args.args[0]
        self.assertEqual(sum(1 for value in argv if str(value).endswith(".bin")), 2)
        self.assertEqual(results[mathtype.mathtype_cache_key(b"same")], MATHML_FRACTION)
        self.assertIsNone(results[mathtype.mathtype_cache_key(b"other")])

    def test_cached_conversion_does_not_start_ruby_again(self):
        key = mathtype.mathtype_cache_key(b"cached")
        mathtype.set_cached_mathml(key, MATHML_FRACTION)
        runner = Mock(side_effect=AssertionError("cache must avoid Ruby"))

        self.assertEqual(mathtype.convert_mathtype_ole_to_mathml(b"cached", runner=runner), MATHML_FRACTION)
        runner.assert_not_called()

    def test_converter_failure_isolated_as_preview_only_not_fake_latex(self):
        runner = Mock(side_effect=TimeoutError("converter timeout"))
        with patch.object(mathtype, "find_ruby_executable", return_value="ruby"):
            result = mathtype.convert_mathtype_ole(b"broken", preview_ref="word/media/equation.emf", runner=runner)

        self.assertEqual(result.status, "preview_only")
        self.assertIsNone(result.canonical_latex)
        self.assertEqual(result.preview_ref, "word/media/equation.emf")
        self.assertTrue(result.warnings)

    def test_successful_ole_conversion_returns_canonical_latex(self):
        completed = Mock(returncode=0, stdout=mathtype.MATHTYPE_BATCH_SENTINEL + json.dumps([MATHML_FRACTION]), stderr="")
        with patch.object(mathtype, "find_ruby_executable", return_value="ruby"):
            result = mathtype.convert_mathtype_ole(b"formula", runner=Mock(return_value=completed))

        self.assertEqual(result.status, "complete")
        self.assertEqual(result.canonical_latex, r"\frac{v_{0}}{2}")
        self.assertEqual(result.normalized_mathml, MATHML_FRACTION)


if __name__ == "__main__":
    unittest.main()
