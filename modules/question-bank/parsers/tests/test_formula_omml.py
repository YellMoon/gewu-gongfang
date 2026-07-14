from __future__ import annotations

import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


PARSER_DIR = Path(__file__).resolve().parents[1]
if str(PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(PARSER_DIR))

from formula_omml import convert_omml_to_latex  # noqa: E402


M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def omml(body: str) -> ET.Element:
    return ET.fromstring(f'<m:oMath xmlns:m="{M}" xmlns:w="{W}">{body}</m:oMath>')


def run(text: str) -> str:
    return f"<m:r><m:t>{text}</m:t></m:r>"


class OmmlFormulaTests(unittest.TestCase):
    def assertLatex(self, body: str, expected: str) -> None:
        result = convert_omml_to_latex(omml(body))
        self.assertIn(result.status, ("complete", "approximate"))
        self.assertEqual(result.canonical_latex, expected)

    def test_fraction_radical_and_scripts(self):
        self.assertLatex(f"<m:f><m:num>{run('a')}</m:num><m:den>{run('b')}</m:den></m:f>", r"\frac{a}{b}")
        self.assertLatex(f"<m:rad><m:deg>{run('3')}</m:deg><m:e>{run('x')}</m:e></m:rad>", r"\sqrt[3]{x}")
        self.assertLatex(f"<m:sSubSup><m:e>{run('x')}</m:e><m:sub>{run('i')}</m:sub><m:sup>{run('2')}</m:sup></m:sSubSup>", r"x_{i}^{2}")
        self.assertLatex(f"<m:sPre><m:sub>{run('1')}</m:sub><m:sup>{run('2')}</m:sup><m:e>{run('X')}</m:e></m:sPre>", r"{}_{1}^{2}X")

    def test_nary_limits_functions_and_delimiters(self):
        self.assertLatex(
            f'<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>{run("i=1")}</m:sub><m:sup>{run("n")}</m:sup><m:e>{run("a")}</m:e></m:nary>',
            r"\sum_{i=1}^{n}{a}",
        )
        self.assertLatex(f"<m:limLow><m:e>{run('lim')}</m:e><m:lim>{run('x→0')}</m:lim></m:limLow>", r"\lim_{x\to 0}")
        self.assertLatex(f"<m:func><m:fName>{run('sin')}</m:fName><m:e>{run('x')}</m:e></m:func>", r"\sin\left(x\right)")
        self.assertLatex(
            f'<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>{run("x+1")}</m:e></m:d>',
            r"\left[x+1\right]",
        )

    def test_matrix_equation_array_accents_bars_and_grouping(self):
        matrix = f"<m:m><m:mr><m:e>{run('a')}</m:e><m:e>{run('b')}</m:e></m:mr><m:mr><m:e>{run('c')}</m:e><m:e>{run('d')}</m:e></m:mr></m:m>"
        self.assertLatex(matrix, r"\begin{matrix}a & b \\ c & d\end{matrix}")
        self.assertLatex(f"<m:eqArr><m:e>{run('x=1')}</m:e><m:e>{run('y=2')}</m:e></m:eqArr>", r"\begin{aligned}x=1 \\ y=2\end{aligned}")
        self.assertLatex(f'<m:acc><m:accPr><m:chr m:val="ˆ"/></m:accPr><m:e>{run("v")}</m:e></m:acc>', r"\hat{v}")
        self.assertLatex(f'<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>{run("x")}</m:e></m:bar>', r"\underline{x}")
        self.assertLatex(f'<m:groupChr><m:groupChrPr><m:chr m:val="⏞"/><m:pos m:val="top"/></m:groupChrPr><m:e>{run("a+b")}</m:e></m:groupChr>', r"\overbrace{a+b}")

    def test_plain_text_and_unknown_nodes_report_approximation_without_xml_leak(self):
        node = omml(f"<m:unknown><m:e>{run('kg')}</m:e></m:unknown>")
        result = convert_omml_to_latex(node)
        self.assertEqual(result.status, "approximate")
        self.assertEqual(result.canonical_latex, "kg")
        self.assertTrue(result.warnings)
        self.assertNotIn("<m:", result.canonical_latex)


if __name__ == "__main__":
    unittest.main()
