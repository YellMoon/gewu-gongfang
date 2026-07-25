"""Convert MathML JSON rows to OMML with the Office stylesheet."""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path
from lxml import etree

DEFAULTS = [
    Path(r"C:\Program Files\Microsoft Office\root\Office16\MML2OMML.XSL"),
    Path(r"C:\Program Files (x86)\Microsoft Office\root\Office16\MML2OMML.XSL"),
]

def stylesheet_path() -> Path | None:
    configured = os.environ.get("GEWU_MML2OMML_XSL")
    candidates = ([Path(configured)] if configured else []) + DEFAULTS
    return next((path for path in candidates if path.exists()), None)

def main() -> int:
    rows = json.load(sys.stdin)
    xsl = stylesheet_path()
    if not xsl:
        json.dump({"ok": False, "error": "MML2OMML.XSL unavailable", "rows": [None for _ in rows]}, sys.stdout)
        return 0
    transform = etree.XSLT(etree.parse(str(xsl)))
    output = []
    for mathml in rows:
        try:
            result = transform(etree.fromstring(str(mathml).encode("utf-8")))
            output.append(etree.tostring(result.getroot(), encoding="unicode"))
        except Exception:
            output.append(None)
    json.dump({"ok": True, "rows": output}, sys.stdout, ensure_ascii=False)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
