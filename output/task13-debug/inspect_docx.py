import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

DOCX = Path(__file__).with_name('failed-word-native.docx')
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

with zipfile.ZipFile(DOCX) as archive:
    xml = archive.read('word/document.xml')
root = ET.fromstring(xml)

rows = []
for sdt in root.iter(f'{{{W}}}sdt'):
    marker = next((value for node in sdt.iter() for value in node.attrib.values() if 'GEWU_FORMULA_' in value), None)
    if not marker:
        continue
    tags = sorted({node.tag.rsplit('}', 1)[-1] for node in sdt.iter() if node.tag.startswith(f'{{{M}}}')})
    rows.append({
        'marker': marker,
        'math_tags': tags,
        'math_text': ''.join(node.text or '' for node in sdt.iter(f'{{{M}}}t')),
        'word_text': ''.join(node.text or '' for node in sdt.iter(f'{{{W}}}t')),
        'omath_count': sum(1 for _ in sdt.iter(f'{{{M}}}oMath')),
    })

word_text = ''.join(node.text or '' for node in root.iter(f'{{{W}}}t'))
print(json.dumps({'containers': rows, 'word_text_residue': re.findall(r'\\(?:frac|sqrt|begin|int|alpha|beta)\\b', word_text), 'word_text': word_text}, ensure_ascii=False, indent=2))
