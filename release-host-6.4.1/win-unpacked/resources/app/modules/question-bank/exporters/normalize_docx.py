"""Normalize an OOXML package after raw formula insertion."""
from __future__ import annotations
import sys
from docx import Document

def main() -> int:
    Document(sys.argv[1]).save(sys.argv[2])
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
