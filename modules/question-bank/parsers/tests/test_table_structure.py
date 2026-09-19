from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

PARSER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PARSER_DIR))
from docx_fixture import DocxFixture
from parse_word import html_to_rich_document, read_docx_token_rich_blocks

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'


class TableStructureTests(unittest.TestCase):
    def test_nested_tables_and_word_vertical_merges_preserve_order(self):
        def p(text):
            return '<w:p><w:r><w:t>' + text + '</w:t></w:r></w:p>'
        inner = '<w:tbl><w:tr><w:tc>' + p('inner') + '</w:tc></w:tr></w:tbl>'
        table = '<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' + p('merged') + '</w:tc><w:tc>' + p('before') + inner + p('after') + '</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc>' + p('last') + '</w:tc></w:tr></w:tbl>'
        fixture = DocxFixture().add('word/document.xml', f'<w:document xmlns:w="{W}"><w:body>' + p('head') + table + p('tail') + '</w:body></w:document>')
        try:
            rows = read_docx_token_rich_blocks(fixture.write(), collapse_tables=True)
            self.assertEqual([row['block_type'] for row in rows], ['paragraph', 'table', 'paragraph'])
            self.assertEqual(rows[-1]['text'], 'tail')
            self.assertIn('rowspan="2"', rows[1]['text'])
            document = html_to_rich_document(rows[1]['text'])
            cells = document['content'][0]['content'][0]['content']
            self.assertEqual(cells[0]['attrs']['rowspan'], 2)
            self.assertEqual([node['type'] for node in cells[1]['content'] if node.get('content')], ['paragraph', 'table', 'paragraph'])
            self.assertEqual(len(document['content'][0]['content'][1]['content']), 1)
        finally:
            fixture.cleanup()

    def test_rich_document_preserves_cells_and_inline_native_formula(self):
        document = html_to_rich_document('before<table><tr><td>road</td><td>dry</td></tr>'
            '<tr><td>coefficient</td><td><span data-formula-id="f1" data-latex="0.7"></span></td></tr></table>after')
        self.assertEqual([node['type'] for node in document['content']], ['paragraph', 'table', 'paragraph'])
        table = document['content'][1]
        self.assertEqual([len(row['content']) for row in table['content']], [2, 2])
        formula = table['content'][1]['content'][1]['content'][0]['content'][0]
        self.assertEqual(formula['type'], 'formula')
        self.assertEqual(formula['attrs']['canonicalLatex'], '0.7')

    def test_empty_and_merged_cells_do_not_shift_columns(self):
        document = html_to_rich_document('<table><tr><th colspan="2">heading</th></tr>'
            '<tr><td></td><td><strong>value</strong><br />second line</td></tr></table>')
        table = document['content'][0]
        self.assertEqual(table['type'], 'table')
        self.assertEqual(table['content'][0]['content'][0]['attrs']['colspan'], 2)
        self.assertEqual(len(table['content'][1]['content']), 2)
        self.assertEqual(table['content'][1]['content'][0]['content'], [{'type': 'paragraph', 'content': []}])
        text = table['content'][1]['content'][1]['content'][0]['content'][0]
        self.assertEqual(text['marks'], [{'type': 'bold'}])

    def test_actual_lecture_parser_keeps_a_table_between_stem_and_options(self):
        def paragraph(text):
            return '<w:p><w:r><w:t>' + text + '</w:t></w:r></w:p>'
        table = '<w:tbl>' + ''.join('<w:tr>' + ''.join('<w:tc>' + paragraph(value) + '</w:tc>' for value in row) + '</w:tr>'
            for row in [['路面', '干沥青', '碎石', '湿沥青'], ['动摩擦因数', '0.7', '0.6~0.7', '0.32~0.4']]) + '</w:tbl>'
        xml = f'<w:document xmlns:w="{W}" xmlns:m="{M}"><w:body>' + paragraph('1. 根据下表判断安全距离（ ）') + table + ''.join(paragraph(value) for value in ['A. 200 m', 'B. 150 m', 'C. 100 m', 'D. 50 m', '答案：B']) + '</w:body></w:document>'
        xml = xml.replace(paragraph('\u7b54\u6848\uff1aB'), '')
        xml = xml.replace('1. ', '', 1).replace('<w:body><w:p>', '<w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>', 1)
        numbering = f'<w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
        fixture = DocxFixture().add('word/document.xml', xml).add('word/numbering.xml', numbering)
        try:
            result = subprocess.run([sys.executable, str(PARSER_DIR / 'parse_word.py'), str(fixture.write()), 'lecture'],
                env=dict(os.environ, GEWU_FORCE_DOCX_XML_FALLBACK='1'), check=True, capture_output=True, text=True, encoding='utf-8', timeout=30)
            payload = json.loads(result.stdout)
            self.assertEqual(payload['count'], 1)
            question = payload['questions'][0]
            self.assertIn('<table', question['stem'])
            self.assertEqual(question['stem'].count('<td'), 8)
            self.assertEqual(len(question['options']), 4)
            self.assertTrue(any(node['type'] == 'table' for node in question['rich_content']['sections']['stem']['content']))
        finally:
            fixture.cleanup()


if __name__ == '__main__':
    unittest.main()
