from __future__ import annotations

import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from parse_word import _display_size_from_container, _image_tag, html_to_rich_document, read_docx_token_rich_blocks
from docx_fixture import DocxFixture


class ImageDisplayGeometryTests(unittest.TestCase):
    def test_real_ordered_token_import_preserves_each_image_occurrence(self):
        fixture = DocxFixture()
        document = '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
          xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:v="urn:schemas-microsoft-com:vml"><w:body><w:p>
          <w:r><w:drawing><wp:inline><wp:extent cx="2047875" cy="933450"/><a:blip r:embed="picture"/></wp:inline></w:drawing></w:r>
          <w:r><w:t>between</w:t></w:r>
          <w:r><w:pict><v:group><v:shape style="width:80.625pt;height:36.75pt"><v:imagedata r:id="picture"/></v:shape>
          <v:shape style="width:40.3125pt;height:18.375pt"><v:imagedata r:id="picture"/></v:shape></v:group></w:pict></w:r>
          </w:p></w:body></w:document>'''
        relationships = '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="picture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture.png"/>
          </Relationships>'''
        try:
            fixture.add('word/document.xml', document).add('word/_rels/document.xml.rels', relationships).add('word/media/picture.png', b'image-bytes')
            rows = read_docx_token_rich_blocks(fixture.write())
            nodes = html_to_rich_document(rows[0]['text'])['content'][0]['content']
            images = [node['attrs'] for node in nodes if node['type'] == 'image']
            self.assertEqual([(image['width'], image['height']) for image in images], [(215, 98), (107.5, 49), (53.75, 24.5)])
        finally:
            fixture.cleanup()

    def test_drawingml_size_survives_as_physical_display_size(self):
        ns = {'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
        container = ET.fromstring(f'<run xmlns:wp="{ns["wp"]}"><wp:extent cx="5276850" cy="1453769"/></run>')
        size = _display_size_from_container(container, ns)
        self.assertAlmostEqual(size['display_width'], 554)
        self.assertAlmostEqual(size['display_height'], 1453769 / 9525)
        tag = _image_tag({'content_hash': 'a' * 64, 'file_name': 'diagram.png', **size})
        attrs = html_to_rich_document(tag)['content'][0]['content'][0]['attrs']
        self.assertAlmostEqual(attrs['width'], 554)
        self.assertAlmostEqual(attrs['height'], 1453769 / 9525)

    def test_vml_fractional_points_and_repeated_image_sizes_survive(self):
        ns = {'v': 'urn:schemas-microsoft-com:vml'}
        container = ET.fromstring('<run xmlns:v="urn:schemas-microsoft-com:vml"><v:shape style="width:161.25pt;height:73.5pt"/></run>')
        size = _display_size_from_container(container, ns)
        tag = _image_tag({'content_hash': 'b' * 64, **size})
        smaller = _image_tag({'content_hash': 'b' * 64, 'display_width': 107.5, 'display_height': 49})
        nodes = html_to_rich_document(tag + 'between' + smaller)['content'][0]['content']
        self.assertEqual([node['type'] for node in nodes], ['image', 'text', 'image'])
        self.assertEqual((nodes[0]['attrs']['width'], nodes[0]['attrs']['height']), (215, 98))
        self.assertEqual((nodes[2]['attrs']['width'], nodes[2]['attrs']['height']), (107.5, 49))

    def test_invalid_dimensions_do_not_enter_rich_content(self):
        for value in ['nan', 'inf', '-1', '0', '10001', '12px']:
            attrs = html_to_rich_document(f'<img src="question-asset://asset" width="{value}" height="{value}">')['content'][0]['content'][0]['attrs']
            self.assertIsNone(attrs['width'])
            self.assertIsNone(attrs['height'])


if __name__ == '__main__':
    unittest.main()
