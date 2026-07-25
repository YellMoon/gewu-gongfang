import re
import sys
import zipfile
from pathlib import Path

source = Path(sys.argv[1])
target = Path(sys.argv[2])
with zipfile.ZipFile(source) as incoming, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as outgoing:
    for info in incoming.infolist():
        data = incoming.read(info.filename)
        if info.filename == 'word/document.xml':
            text = data.decode('utf-8')
            text = re.sub(r'<a:extLst>.*?<asvg:svgBlip[^>]*/>.*?</a:extLst>', '', text)
            data = text.encode('utf-8')
        elif info.filename == 'word/_rels/document.xml.rels':
            text = data.decode('utf-8')
            text = re.sub(r'<Relationship\b[^>]*Target="[^"]+\.svg"[^>]*/>', '', text)
            data = text.encode('utf-8')
        outgoing.writestr(info, data)
