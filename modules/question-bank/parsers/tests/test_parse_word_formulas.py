from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


PARSER_DIR = Path(__file__).resolve().parents[1]
if str(PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(PARSER_DIR))

from docx_fixture import DocxFixture  # noqa: E402


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"


DOCUMENT = f'''<w:document xmlns:w="{W}" xmlns:m="{M}"><w:body><w:p>
  <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
  <w:r><w:t>Find the value </w:t></w:r>
  <m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>
  <w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> EQ \\r(x) </w:instrText></w:r>
  <w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>sqrt x</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>
</w:p></w:body></w:document>'''

NUMBERING = f'''<w:numbering xmlns:w="{W}">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>'''


class ParseWordFormulaIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = DocxFixture().add("word/document.xml", DOCUMENT).add("word/numbering.xml", NUMBERING)
        self.path = self.fixture.write()

    def tearDown(self) -> None:
        self.fixture.cleanup()

    def test_forced_xml_fallback_returns_canonical_formulas_and_quality_counts(self):
        env = dict(os.environ)
        env["GEWU_FORCE_DOCX_XML_FALLBACK"] = "1"
        completed = subprocess.run(
            [sys.executable, str(PARSER_DIR / "parse_word.py"), str(self.path), "lecture"],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            timeout=30,
        )
        result = json.loads(completed.stdout)
        self.assertEqual(result["count"], 1)
        formulas = result["questions"][0]["formulas"]
        self.assertEqual([item["canonical_latex"] for item in formulas], [r"\frac{a}{b}", r"\sqrt{x}"])
        self.assertEqual([item["source"]["source_format"] for item in formulas], ["omml", "eq_field"])
        self.assertEqual(result["quality_report"]["formula_import"]["total"], 2)
        self.assertEqual(result["quality_report"]["formula_import"]["needs_review"], 0)


if __name__ == "__main__":
    unittest.main()
