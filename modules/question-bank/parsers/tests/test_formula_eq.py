from __future__ import annotations

import sys
import unittest
from pathlib import Path


PARSER_DIR = Path(__file__).resolve().parents[1]
if str(PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(PARSER_DIR))

from formula_eq import collect_eq_fields, convert_eq_to_latex  # noqa: E402
from word_content import TextStyle, TokenSource, WordToken  # noqa: E402


def token(kind: str, text: str | None = None, index: int = 0, vert_align: str | None = None) -> WordToken:
    return WordToken(kind=kind, text=text, source=TokenSource("word/document.xml", 0, index), style=TextStyle(vert_align=vert_align))


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

    def test_safe_vector_overlay_and_unsupported_overlays(self):
        vector = convert_eq_to_latex(r"EQ \o(v,\s\up2(-))")
        self.assertEqual(vector.status, "complete")
        self.assertEqual(vector.canonical_latex, r"\vec{v}")

        for instruction in (
            r"EQ \o\al(2,0)",
            r"EQ \o\al(2,2)",
        ):
            with self.subTest(instruction=instruction):
                result = convert_eq_to_latex(instruction)
                self.assertEqual(result.status, "failed")
                self.assertIsNone(result.canonical_latex)
                self.assertIn("unsupported EQ overlay", result.warnings[0])

        preview = convert_eq_to_latex(r"EQ \o(a,b,c)", visible_result="rendered overlay")
        self.assertEqual(preview.status, "preview_only")
        self.assertIsNone(preview.canonical_latex)
        self.assertEqual(preview.visible_text, "rendered overlay")

    def test_preserves_word_run_scripts_and_skips_nested_layout_overlay(self):
        tokens = [
            token("field_begin", index=0),
            token("field_instruction", r" EQ \f(H(t", 1),
            token("field_instruction", "0", 2, "subscript"),
            token("field_instruction", ")", 3),
            token("field_instruction", "2", 4, "superscript"),
            token("field_begin", index=5),
            token("field_instruction", r" EQ \o\al(2,0) ", 6),
            token("field_separate", index=7),
            token("text", "0", 8),
            token("field_end", index=9),
            token("field_instruction", ",t) ", 10),
            token("field_separate", index=11),
            token("text", "formula", 12),
            token("field_end", index=13),
        ]
        fields = collect_eq_fields(tokens)
        self.assertEqual(len(fields), 1)
        self.assertEqual(fields[0].instruction, r"EQ \f(H(t0)2,t)")
        self.assertEqual(fields[0].conversion_instruction, r"EQ \f(H(t\s\do2(0))\s\up2(2),t)")
        converted = convert_eq_to_latex(fields[0].conversion_instruction or fields[0].instruction)
        self.assertEqual(converted.status, "complete")
        self.assertEqual(converted.canonical_latex, r"\frac{H(t_{0})^{2}}{t}")

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
