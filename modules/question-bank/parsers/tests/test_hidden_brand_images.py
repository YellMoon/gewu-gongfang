from __future__ import annotations
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from docx_fixture import DocxFixture
from parse_word import read_docx_token_rich_blocks, html_to_rich_document

class HiddenBrandImageTests(unittest.TestCase):
    def test_hidden_occurrences_removed_without_removing_normal_reuse(self):
        fixture = DocxFixture()
        drawings = []
        for width, height, description in [(1, 1, ''), (12, 6, '网站标识 www.example.com'), (215, 98, ''), (12, 6, '电路元件')]:
            drawings.append(f'<w:r><w:drawing><wp:inline><wp:extent cx="{width * 9525}" cy="{height * 9525}"/><wp:docPr id="1" name="image" descr="{description}"/><a:blip r:embed="picture"/></wp:inline></w:drawing></w:r>')
        xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>1.题干</w:t></w:r>' + ''.join(drawings) + '</w:p></w:body></w:document>'
        rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture.png"/></Relationships>'
        try:
            fixture.add('word/document.xml', xml).add('word/_rels/document.xml.rels', rels).add('word/media/picture.png', b'image-bytes')
            row = read_docx_token_rich_blocks(fixture.write())[0]
            nodes = html_to_rich_document(row['text'])['content'][0]['content']
            self.assertEqual([(n['attrs']['width'], n['attrs']['height']) for n in nodes if n['type'] == 'image'], [(215, 98), (12, 6)])
            self.assertEqual(len(row['removed_images']), 2)
            self.assertTrue(all(item['source_part'] == 'word/media/picture.png' for item in row['removed_images']))
            self.assertEqual(len(row['assets']), 2, 'normal reuse is preserved per occurrence')
        finally:
            fixture.cleanup()

if __name__ == '__main__':
    unittest.main()
