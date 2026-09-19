from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from docx_fixture import DocxFixture
from parse_word import read_docx_token_rich_blocks
from formula_model import FormulaConversionResult


class MathTypePreviewDedupTests(unittest.TestCase):
    def test_standalone_mathtype_wmf_becomes_native_formula_not_image(self):
        document='''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml">
          <w:body><w:p><w:r><w:t>A.</w:t><w:pict><v:shape><v:imagedata r:id="formula"/></v:shape></w:pict></w:r>
          <w:r><w:pict><v:shape><v:imagedata r:id="diagram"/></v:shape></w:pict></w:r></w:p></w:body></w:document>'''
        relationships='''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="formula" Type="image" Target="media/formula.wmf"/>
          <Relationship Id="diagram" Type="image" Target="media/diagram.png"/></Relationships>'''
        fixture=(DocxFixture().add('word/document.xml',document).add('word/_rels/document.xml.rels',relationships)
          .add('word/media/formula.wmf',b'MathTypeUU-payload').add('word/media/diagram.png',b'diagram'))
        source=fixture.write()
        try:
            for status in ('complete','preview_only'):
                result=FormulaConversionResult(status,canonical_latex='v_{1}=v_{2}' if status=='complete' else None)
                with self.subTest(status=status), patch('word_formula_import.convert_mathtype_wmf',return_value=result), patch('word_formula_import.convert_mathtype_oles_to_mathml_batch'):
                    row=read_docx_token_rich_blocks(source)[0]
                self.assertEqual(len(row['formulas']),1,'unconverted formulas must remain in the review inventory')
                self.assertEqual(row['formulas'][0]['conversion_status'],status)
                if status=='complete':
                    self.assertIn('data-latex="v_{1}=v_{2}"',row['text'])
                    self.assertNotIn('alt="formula.',row['text'])
                self.assertEqual(row['text'].count('<img '),1 if status=='complete' else 2)
                self.assertIn('diagram.png',row['text'])
                self.assertEqual(row['formulas'][0]['source']['payload_ref'],'word/media/formula.wmf')
        finally:
            fixture.cleanup()

    def test_converted_formula_does_not_also_render_its_preview_as_a_picture(self):
        document = '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
          xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
          <w:body><w:p><w:r><w:object><v:shape><v:imagedata r:id="preview"/></v:shape>
          <o:OLEObject ProgID="Equation.DSMT4" r:id="ole"/></w:object></w:r>
          <w:r><w:pict><v:shape><v:imagedata r:id="diagram"/></v:shape></w:pict></w:r>
          </w:p></w:body></w:document>'''
        relationships = '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="ole" Type="oleObject" Target="embeddings/formula.bin"/>
          <Relationship Id="preview" Type="image" Target="media/preview.png"/>
          <Relationship Id="diagram" Type="image" Target="media/diagram.png"/>
          </Relationships>'''
        fixture = (DocxFixture().add('word/document.xml', document)
                   .add('word/_rels/document.xml.rels', relationships)
                   .add('word/embeddings/formula.bin', b'formula')
                   .add('word/media/preview.png', b'formula preview')
                   .add('word/media/diagram.png', b'actual diagram'))
        source = fixture.write()
        try:
            for status, images in (('complete', 1), ('preview_only', 2)):
                formula = {'id': 'formula-test', 'canonical_latex': 'a-x' if status == 'complete' else None,
                           'conversion_status': status, 'source': {'source_format': 'mathtype',
                           'preview_ref': 'word/media/preview.png', 'content_index': 0}}
                with self.subTest(status=status), patch('parse_word.import_part_formulas',
                     return_value=[SimpleNamespace(paragraph_index=0, formulas=[formula])]):
                    row = read_docx_token_rich_blocks(source)[0]
                    self.assertEqual(row['text'].count('<img '), images)
                    self.assertIn('diagram.png', row['text'])
                    self.assertEqual(len(row['assets']), 3, 'original preview is retained as an asset, not rendered twice')
        finally:
            fixture.cleanup()


if __name__ == '__main__':
    unittest.main()
