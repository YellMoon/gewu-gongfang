import json
import posixpath
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

def inspect(path: Path):
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        errors = []
        for name in sorted(names):
            if name.endswith(('.xml', '.rels')):
                try:
                    ET.fromstring(archive.read(name))
                except Exception as error:
                    errors.append([name, str(error)])
        document_xml = archive.read('word/document.xml').decode('utf-8')
        document = ET.fromstring(document_xml)
        rels = ET.fromstring(archive.read('word/_rels/document.xml.rels'))
        rows = [dict(node.attrib) for node in rels]
        ids = [row.get('Id') for row in rows]
        targets = []
        for row in rows:
            target = row.get('Target', '')
            resolved = posixpath.normpath(posixpath.join('word', target))
            targets.append([row.get('Id'), target, resolved in names, row.get('Type', '').rsplit('/', 1)[-1]])
        body_ids = []
        for node in document.iter():
            body_ids.extend(value for key, value in node.attrib.items() if key.startswith(f'{{{R}}}'))
        return {
            'file': path.name,
            'xml_errors': errors,
            'duplicate_rel_ids': [key for key, count in Counter(ids).items() if count > 1],
            'missing_body_rel_ids': sorted(set(body_ids) - set(ids)),
            'orphan_body_rel_counts': Counter(body_ids),
            'targets': targets,
            'media': sorted(name for name in names if name.startswith('word/media/')),
            'document_root_attrib': document.attrib,
            'asvg_declarations': __import__('re').findall(r'xmlns:asvg="[^"]+"', document_xml),
            'a14_declarations': __import__('re').findall(r'xmlns:a14="[^"]+"', document_xml),
            'svg_blip_count': document_xml.count('<asvg:svgBlip'),
            'doc_pr_ids': [node.attrib.get('id') for node in document.iter() if node.tag.rsplit('}', 1)[-1] == 'docPr'],
            'cnv_pr_ids': [node.attrib.get('id') for node in document.iter() if node.tag.rsplit('}', 1)[-1] == 'cNvPr'],
            'content_types': archive.read('[Content_Types].xml').decode('utf-8'),
        }

print(json.dumps([inspect(Path(value)) for value in sys.argv[1:]], ensure_ascii=False, indent=2))
