from __future__ import annotations

import os
import tempfile
import zipfile
from pathlib import Path


class DocxFixture:
    """Small UTF-8 DOCX package builder used by parser tests."""

    def __init__(self) -> None:
        descriptor, raw_path = tempfile.mkstemp(suffix=".docx")
        os.close(descriptor)
        self.path = Path(raw_path)
        self.parts: dict[str, str | bytes] = {}

    def add(self, part_name: str, content: str | bytes) -> "DocxFixture":
        self.parts[part_name] = content
        return self

    def write(self) -> Path:
        with zipfile.ZipFile(self.path, "w") as archive:
            for part_name, content in self.parts.items():
                payload = content.encode("utf-8") if isinstance(content, str) else content
                archive.writestr(part_name, payload)
        return self.path

    def cleanup(self) -> None:
        self.path.unlink(missing_ok=True)

