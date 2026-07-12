from __future__ import annotations

import sys
import unittest
from pathlib import Path


PARSER_DIR = Path(__file__).resolve().parents[1]
if str(PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(PARSER_DIR))

from docx_fixture import DocxFixture  # noqa: E402
from formula_mathtype import clear_mathtype_cache, mathtype_cache_key, set_cached_mathml  # noqa: E402
from test_word_content import paragraph_xml, relationships_xml  # noqa: E402
from word_formula_import import import_part_formulas  # noqa: E402


MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML"><msqrt><mi>x</mi></msqrt></math>'


class WordFormulaImportTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_mathtype_cache()
        set_cached_mathml(mathtype_cache_key(b"DOC-OLE"), MATHML)
        set_cached_mathml(mathtype_cache_key(b"COMMENT-OLE"), MATHML)
        self.fixture = (
            DocxFixture()
            .add("word/document.xml", paragraph_xml())
            .add("word/comments.xml", paragraph_xml(comment=True))
            .add("word/_rels/document.xml.rels", relationships_xml("document"))
            .add("word/_rels/comments.xml.rels", relationships_xml("comment"))
            .add("word/embeddings/document.bin", b"DOC-OLE")
            .add("word/embeddings/comment.bin", b"COMMENT-OLE")
            .add("word/media/document.png", b"DOC-IMAGE")
            .add("word/media/comment.png", b"COMMENT-IMAGE")
        )
        self.path = self.fixture.write()

    def tearDown(self) -> None:
        self.fixture.cleanup()
        clear_mathtype_cache()

    def test_document_and_comment_import_all_three_formula_sources(self):
        document = import_part_formulas(self.path, "word/document.xml")[0]
        comment = import_part_formulas(self.path, "word/comments.xml")[0]

        self.assertEqual([item["source"]["source_format"] for item in document.formulas], ["omml", "eq_field", "mathtype"])
        self.assertEqual([item["canonical_latex"] for item in document.formulas], [r"\frac{a}{b}", r"\frac{1}{2}", r"\sqrt{x}"])
        self.assertEqual([item["canonical_latex"] for item in comment.formulas], [r"\frac{a}{b}", r"\frac{1}{2}", r"\sqrt{x}"])
        self.assertEqual(comment.comment_id, "5")
        self.assertEqual(comment.formulas[2]["source"]["payload_ref"], "word/embeddings/comment.bin")
        self.assertEqual(comment.formulas[2]["source"]["preview_ref"], "word/media/comment.png")

    def test_formula_ids_are_stable_and_raw_ole_never_enters_public_projection(self):
        first = import_part_formulas(self.path, "word/document.xml")[0].formulas
        second = import_part_formulas(self.path, "word/document.xml")[0].formulas

        self.assertEqual([item["id"] for item in first], [item["id"] for item in second])
        self.assertNotIn("DOC-OLE", repr(first))


if __name__ == "__main__":
    unittest.main()
