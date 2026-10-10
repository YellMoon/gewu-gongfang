import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from parse_word import annotate_format_warnings


class FormatWarningTests(unittest.TestCase):
    def warnings(self, text):
        question = {"stem": text}
        annotate_format_warnings(question)
        return question.get("format_warnings", [])

    def test_quantity_variables_and_products_are_not_units(self):
        for text in ["2<i>v</i>", "3<i>k</i>", "2 <i>v</i>", "3 <i>k</i>", "2<i>m</i>", "2<i>mass</i>", "2 <i>kgx</i>"]:
            with self.subTest(text=text):
                self.assertEqual(self.warnings(text), [])

    def test_full_case_sensitive_unit_and_prefix(self):
        for unit in ["V", "K", "kg", "\u03bcC", "kV"]:
            with self.subTest(unit=unit):
                warnings = self.warnings("2 <i>" + unit + "</i>")
                self.assertEqual(len(warnings), 1)
                self.assertIn("\u201c" + unit + "\u201d", warnings[0])
                self.assertIn("\u786e\u8ba4\u8bed\u4e49", warnings[0])

    def test_embedded_formula_is_not_scanned(self):
        self.assertEqual(self.warnings('<span class="legacy-latex" data-latex="2v"></span>'), [])


if __name__ == "__main__":
    unittest.main()
