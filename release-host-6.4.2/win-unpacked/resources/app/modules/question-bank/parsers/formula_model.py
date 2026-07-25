"""Canonical question formula contracts shared by Word import adapters."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


DisplayMode = Literal["inline", "block"]
ConversionStatus = Literal["complete", "approximate", "preview_only", "failed"]
SourceFormat = Literal["omml", "eq_field", "mathtype", "latex", "unknown"]

DISPLAY_MODES = {"inline", "block"}
CONVERSION_STATUSES = {"complete", "approximate", "preview_only", "failed"}
SOURCE_FORMATS = {"omml", "eq_field", "mathtype", "latex", "unknown"}


@dataclass(frozen=True)
class FormulaTypography:
    font_size_pt: float | None = None
    baseline_shift_pt: float | None = None
    color: str | None = None
    width_emu: int | None = None
    height_emu: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            key: value
            for key, value in {
                "font_size_pt": self.font_size_pt,
                "baseline_shift_pt": self.baseline_shift_pt,
                "color": self.color,
                "width_emu": self.width_emu,
                "height_emu": self.height_emu,
            }.items()
            if value is not None
        }


@dataclass(frozen=True)
class FormulaSource:
    source_format: SourceFormat
    part_name: str
    paragraph_index: int | None = None
    comment_id: str | None = None
    rel_id: str | None = None
    content_index: int | None = None
    table_row: int | None = None
    table_cell: int | None = None
    cell_paragraph: int | None = None
    payload_hash: str | None = None
    payload_ref: str | None = None
    preview_ref: str | None = None
    raw_payload: bytes | str | None = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        if self.source_format not in SOURCE_FORMATS:
            raise ValueError("unsupported formula source format: %s" % self.source_format)
        if not self.part_name:
            raise ValueError("formula source part_name is required")

    def to_public_dict(self) -> dict[str, Any]:
        # raw_payload is intentionally excluded from API/UI projections.
        return {
            key: value
            for key, value in {
                "source_format": self.source_format,
                "part_name": self.part_name,
                "paragraph_index": self.paragraph_index,
                "comment_id": self.comment_id,
                "rel_id": self.rel_id,
                "content_index": self.content_index,
                "table_row": self.table_row,
                "table_cell": self.table_cell,
                "cell_paragraph": self.cell_paragraph,
                "payload_hash": self.payload_hash,
                "payload_ref": self.payload_ref,
                "preview_ref": self.preview_ref,
            }.items()
            if value is not None
        }


@dataclass(frozen=True)
class FormulaConversionResult:
    status: ConversionStatus
    canonical_latex: str | None = None
    normalized_mathml: str | None = None
    preview_ref: str | None = None
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.status not in CONVERSION_STATUSES:
            raise ValueError("unsupported formula conversion status: %s" % self.status)

    def visible_fallback(self) -> dict[str, str] | None:
        """Return only a renderable fallback; source languages are never visible fallbacks."""
        if self.preview_ref:
            return {"kind": "preview", "ref": self.preview_ref}
        return None


@dataclass(frozen=True)
class FormulaDocument:
    formula_id: str
    canonical_latex: str | None
    normalized_mathml: str | None
    display_mode: DisplayMode
    source: FormulaSource
    conversion_status: ConversionStatus
    typography: FormulaTypography = field(default_factory=FormulaTypography)
    warnings: tuple[str, ...] = ()
    edited: bool = False

    def __post_init__(self) -> None:
        if not self.formula_id:
            raise ValueError("formula_id is required")
        if self.display_mode not in DISPLAY_MODES:
            raise ValueError("unsupported formula display mode: %s" % self.display_mode)
        if self.conversion_status not in CONVERSION_STATUSES:
            raise ValueError("unsupported formula conversion status: %s" % self.conversion_status)
        if self.conversion_status in ("complete", "approximate") and not self.canonical_latex:
            raise ValueError("converted formula requires canonical_latex")

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.formula_id,
            "canonical_latex": self.canonical_latex,
            "normalized_mathml": self.normalized_mathml,
            "display_mode": self.display_mode,
            "typography": self.typography.to_dict(),
            "source": self.source.to_public_dict(),
            "conversion_status": self.conversion_status,
            "warnings": list(self.warnings),
            "edited": self.edited,
        }
