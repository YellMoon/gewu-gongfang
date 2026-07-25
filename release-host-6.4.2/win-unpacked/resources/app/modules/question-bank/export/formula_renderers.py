"""Truthful formula-mode resolution shared by the host export pipeline.

This module deliberately does not manufacture MathType/MTEF bytes.  A caller may
only claim ``mathtype-compatible`` when it supplies evidence for a real OLE
embedding, object relationship and visible preview.  The bundled, audited Ruby
gems are readers, not writers, so the default behavior is an explicit vector
fallback.
"""
from __future__ import annotations

import json
import sys
from typing import Any


FORMULA_MODES = {
    "word-native",
    "eq-field",
    "mathtype-compatible",
    "latex-vector",
}


class FormulaRenderError(ValueError):
    def __init__(self, diagnostics: list[dict[str, Any]]):
        super().__init__(diagnostics[0]["message"] if diagnostics else "formula rendering failed")
        self.diagnostics = diagnostics


def _diagnostic(row: dict[str, Any], code: str, message: str) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "questionId": str(row.get("questionId") or ""),
        "location": str(row.get("location") or ""),
        "index": int(row.get("index", 0)),
    }


def _has_mathtype_evidence(row: dict[str, Any]) -> bool:
    evidence = row.get("mathtypeEvidence") or {}
    return all(bool(evidence.get(key)) for key in ("oleEmbedding", "objectRelationship", "visiblePreview"))


def resolve_formula_manifest(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return a render manifest without ever overstating the effective mode."""
    manifest: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for position, source in enumerate(rows):
        row = dict(source)
        row["index"] = int(row.get("index", position))
        latex = str(row.get("canonicalLatex") or "")
        requested = str(row.get("requestedMode") or "word-native")
        if not latex.strip():
            failures.append(_diagnostic(row, "FORMULA_CANONICAL_LATEX_EMPTY", "canonical LaTeX is empty"))
            continue
        if requested not in FORMULA_MODES:
            failures.append(_diagnostic(row, "FORMULA_MODE_UNSUPPORTED", f"unsupported formula mode: {requested}"))
            continue

        effective = requested
        diagnostics: list[dict[str, Any]] = []
        if requested in {"word-native", "eq-field"} and not bool(row.get("nativeAvailable")):
            effective = "latex-vector"
            diagnostics.append(_diagnostic(row, "OMML_CONVERSION_UNAVAILABLE", f"{requested} conversion unavailable; rendered as LaTeX vector"))
        elif requested == "mathtype-compatible":
            if bool(row.get("mathtypeAvailable")) and not _has_mathtype_evidence(row):
                failures.append(_diagnostic(row, "MATHTYPE_EVIDENCE_REQUIRED", "MathType mode requires OLE embedding, object relationship and visible preview evidence"))
                continue
            if not bool(row.get("mathtypeAvailable")):
                effective = "latex-vector"
                diagnostics.append(_diagnostic(row, "MATHTYPE_WRITER_UNAVAILABLE", "no audited MathType/MTEF writer is available; rendered as LaTeX vector"))

        manifest.append({
            "questionId": str(row.get("questionId") or ""),
            "location": str(row.get("location") or ""),
            "index": row["index"],
            "canonicalLatex": latex,
            "requestedMode": requested,
            "effectiveMode": effective,
            "fallbackUsed": effective != requested,
            "diagnostics": diagnostics,
        })
    if failures:
        raise FormulaRenderError(failures)
    return manifest


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        manifest = resolve_formula_manifest(list(payload.get("rows") or []))
        json.dump({"ok": True, "manifest": manifest}, sys.stdout, ensure_ascii=False)
        return 0
    except FormulaRenderError as error:
        json.dump({"ok": False, "diagnostics": error.diagnostics}, sys.stdout, ensure_ascii=False)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
