from __future__ import annotations

import sys
import unittest
from pathlib import Path


PARSER_DIR = Path(__file__).resolve().parents[1]
if str(PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(PARSER_DIR))

from docx_fixture import DocxFixture  # noqa: E402
from word_content import read_word_part  # noqa: E402


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
O = "urn:schemas-microsoft-com:office:office"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"


def paragraph_xml(comment: bool = False) -> str:
    body = f"""
      <w:p>
        <w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>velocity</w:t></w:r>
        <m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>
        <w:r><w:fldChar w:fldCharType="begin"/></w:r>
        <w:r><w:instrText xml:space="preserve"> EQ \\</w:instrText></w:r>
        <w:r><w:instrText>f(1,2) </w:instrText></w:r>
        <w:r><w:fldChar w:fldCharType="separate"/></w:r>
        <w:r><w:t>1/2</w:t></w:r>
        <w:r><w:fldChar w:fldCharType="end"/></w:r>
        <w:r><w:object><o:OLEObject ProgID="Equation.DSMT4" r:id="rOle"/></w:object></w:r>
        <w:r><w:drawing><a:blip r:embed="rImage"/></w:drawing></w:r>
      </w:p>
    """
    if comment:
        return f'<w:comments xmlns:w="{W}" xmlns:m="{M}" xmlns:o="{O}" xmlns:r="{R}" xmlns:a="{A}"><w:comment w:id="5">{body}</w:comment></w:comments>'
    return f'<w:document xmlns:w="{W}" xmlns:m="{M}" xmlns:o="{O}" xmlns:r="{R}" xmlns:a="{A}"><w:body>{body}</w:body></w:document>'


REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def relationships_xml(prefix: str) -> str:
    return f"""<Relationships xmlns="{REL_NS}">
      <Relationship Id="rOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/{prefix}.bin"/>
      <Relationship Id="rImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{prefix}.png"/>
    </Relationships>"""


class WordContentWalkerTests(unittest.TestCase):
    def setUp(self) -> None:
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

    def test_document_and_comments_share_ordered_token_capabilities(self):
        document = read_word_part(self.path, "word/document.xml")
        comments = read_word_part(self.path, "word/comments.xml")

        expected = ["text", "omml", "field_begin", "field_instruction", "field_instruction", "field_separate", "text", "field_end", "ole", "image"]
        self.assertEqual([token.kind for token in document[0].tokens], expected)
        self.assertEqual([token.kind for token in comments[0].tokens], expected)
        self.assertTrue(document[0].tokens[0].style.bold)
        self.assertTrue(document[0].tokens[0].style.italic)

    def test_source_coordinates_and_relationship_targets_are_preserved(self):
        document = read_word_part(self.path, "word/document.xml")[0]
        comment = read_word_part(self.path, "word/comments.xml")[0]

        doc_ole = next(token for token in document.tokens if token.kind == "ole")
        comment_ole = next(token for token in comment.tokens if token.kind == "ole")
        comment_image = next(token for token in comment.tokens if token.kind == "image")

        self.assertEqual(doc_ole.source.part_name, "word/document.xml")
        self.assertEqual(doc_ole.source.paragraph_index, 0)
        self.assertIsNone(doc_ole.source.comment_id)
        self.assertEqual(doc_ole.rel_id, "rOle")
        self.assertEqual(doc_ole.target, "word/embeddings/document.bin")
        self.assertEqual(comment_ole.source.comment_id, "5")
        self.assertEqual(comment_ole.target, "word/embeddings/comment.bin")
        self.assertEqual(comment_image.target, "word/media/comment.png")
        self.assertEqual([token.source.content_index for token in comment.tokens], list(range(len(comment.tokens))))


if __name__ == "__main__":
    unittest.main()
