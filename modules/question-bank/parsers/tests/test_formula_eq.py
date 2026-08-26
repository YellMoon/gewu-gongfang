from __future__ import annotations

import sys
import unittest
from pathlib import Path


PARSER_DIR = Path(__file__).resolve().parents[1]
if str(PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(PARSER_DIR))

from formula_eq import collect_eq_fields, convert_eq_to_latex  # noqa: E402
from word_content import TokenSource, WordToken  # noqa: E402


def token(kind: str, text: str | None = None, index: int = 0) -> WordToken:
    return WordToken(kind=kind, text=text, source=TokenSource("word/document.xml", 0, index))


class EqFormulaTests(unittest.TestCase):
    def test_collects_split_instruction_and_visible_result(self):
        tokens = [
            token("field_begin", index=0),
            token("field_instruction", " EQ \\", 1),
            token("field_instruction", "f(a,b) ", 2),
            token("field_separate", index=3),
            token("text", "a/b", 4),
            token("field_end", index=5),
        ]
        fields = collect_eq_fields(tokens)
        self.assertEqual(len(fields), 1)
        self.assertEqual(fields[0].instruction, r"EQ \f(a,b)")
        self.assertEqual(fields[0].visible_result, "a/b")

    def test_collects_simple_and_nested_fields_without_mixing_results(self):
        tokens = [
            token("field_simple", r" EQ \r(3,x) ", 0),
            token("field_begin", index=1),
            token("field_instruction", r" EQ \f(1,2) ", 2),
            token("field_separate", index=3),
            token("field_begin", index=4),
            token("field_instruction", " PAGE ", 5),
            token("field_separate", index=6),
            token("text", "9", 7),
            token("field_end", index=8),
            token("text", "1/2", 9),
            token("field_end", index=10),
        ]
        fields = collect_eq_fields(tokens)
        self.assertEqual([field.instruction for field in fields], [r"EQ \r(3,x)", r"EQ \f(1,2)"])
        self.assertEqual(fields[1].visible_result, "1/2")

    def test_converts_common_eq_constructs_to_canonical_latex(self):
        cases = {
            r"EQ \f(a,b+c)": r"\frac{a}{b+c}",
            r"EQ \r(x+1)": r"\sqrt{x+1}",
            r"EQ \r(3,x)": r"\sqrt[3]{x}",
            r"EQ v\s\do2(0)": r"v_{0}",
            r"EQ x\s\up2(2)": r"x^{2}",
            r"EQ \i(0,1,x dx)": r"\int_{0}^{1}{x dx}",
            r"EQ \i\su(i=1,n,a_i)": r"\sum_{i=1}^{n}{a_i}",
        }
        for instruction, expected in cases.items():
            with self.subTest(instruction=instruction):
                result = convert_eq_to_latex(instruction, visible_result="rendered")
                self.assertEqual(result.status, "complete")
                self.assertEqual(result.canonical_latex, expected)

    def test_converts_known_overlay_forms_without_generalizing_unknown_overlaps(self):
        cases = {
            r"EQ \o(v,\s\up2(-))": r"\vec{v}",
            r"EQ \o\al(2,0)": r"{}^{2}_{0}",
            r"EQ \o\al(2,2)": r"{}^{2}_{2}",
        }
        for instruction, expected in cases.items():
            with self.subTest(instruction=instruction):
                result = convert_eq_to_latex(instruction)
                self.assertEqual(result.status, "complete")
                self.assertEqual(result.canonical_latex, expected)

        unknown = convert_eq_to_latex(r"EQ \o(a,b,c)")
        self.assertEqual(unknown.status, "failed")
        self.assertIn("unsupported EQ overlay", unknown.warnings[0])

    def test_unsupported_field_uses_visible_result_only_and_never_exposes_instruction(self):
        result = convert_eq_to_latex(r"EQ \unknown(secret)", visible_result="rendered equation")
        self.assertEqual(result.status, "preview_only")
        self.assertIsNone(result.canonical_latex)
        self.assertEqual(result.visible_text, "rendered equation")
        self.assertNotIn("unknown", result.visible_text)

        blocked = convert_eq_to_latex(r"EQ \unknown(secret)", visible_result="")
        self.assertEqual(blocked.status, "failed")
        self.assertIsNone(blocked.visible_text)

    def test_converts_left_brace_array_into_piecewise_cases(self):
        instruction = r"EQ f(x)=\b\lc\{(\a\al\co2(x\s\up2(2),x\ge0,-x,x<0))"
        result = convert_eq_to_latex(instruction, visible_result="piecewise-render")

        self.assertEqual(result.status, "complete")
        self.assertEqual(
            result.canonical_latex,
            r"f(x)=\begin{cases}x^{2} & x\ge 0 \\ -x & x<0\end{cases}",
        )


if __name__ == "__main__":
    unittest.main()
