"""Normalize formula tokens from any Word part into public FormulaDocument rows."""

from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from pathlib import Path

from formula_eq import collect_eq_fields, convert_eq_to_latex
from formula_mathtype import convert_mathtype_ole, convert_mathtype_oles_to_mathml_batch
from formula_model import FormulaDocument, FormulaSource
from formula_omml import convert_omml_to_latex
from word_content import WordParagraph, read_word_part


@dataclass(frozen=True)
class ImportedFormulaRow:
    part_name: str
    paragraph_index: int
    comment_id: str | None
    formulas: tuple[dict, ...]


def _digest(data: bytes | str) -> str:
    payload = data.encode("utf-8") if isinstance(data, str) else data
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _formula_id(part_name: str, paragraph_index: int, content_index: int, source_format: str, payload_hash: str) -> str:
    seed = "%s|%d|%d|%s|%s" % (part_name, paragraph_index, content_index, source_format, payload_hash)
    return "formula-" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]


def _document(
    row: WordParagraph,
    content_index: int,
    source_format: str,
    conversion,
    payload: bytes | str,
    payload_ref: str | None = None,
    preview_ref: str | None = None,
    rel_id: str | None = None,
) -> FormulaDocument:
    payload_hash = _digest(payload)
    return FormulaDocument(
        formula_id=_formula_id(row.part_name, row.paragraph_index, content_index, source_format, payload_hash),
        canonical_latex=conversion.canonical_latex,
        normalized_mathml=getattr(conversion, "normalized_mathml", None),
        display_mode="inline",
        source=FormulaSource(
            source_format=source_format,
            part_name=row.part_name,
            paragraph_index=row.paragraph_index,
            comment_id=row.comment_id,
            rel_id=rel_id,
            content_index=content_index,
            payload_hash=payload_hash,
            payload_ref=payload_ref,
            preview_ref=preview_ref,
            raw_payload=payload,
        ),
        conversion_status=conversion.status,
        warnings=conversion.warnings,
    )


def _import_row(archive: zipfile.ZipFile, row: WordParagraph) -> ImportedFormulaRow:
    candidates: list[tuple[int, FormulaDocument]] = []
    images = [token.target for token in row.tokens if token.kind == "image" and token.target]
    preview_ref = images[0] if images else None

    for token in row.tokens:
        if token.kind == "omml" and token.xml:
            conversion = convert_omml_to_latex(ET.fromstring(token.xml))
            candidates.append((token.source.content_index, _document(row, token.source.content_index, "omml", conversion, token.xml)))
        elif token.kind == "ole" and token.target and token.target in archive.namelist():
            ole_data = archive.read(token.target)
            conversion = convert_mathtype_ole(ole_data, preview_ref=preview_ref)
            candidates.append(
                (
                    token.source.content_index,
                    _document(
                        row,
                        token.source.content_index,
                        "mathtype",
                        conversion,
                        ole_data,
                        payload_ref=token.target,
                        preview_ref=preview_ref,
                        rel_id=token.rel_id,
                    ),
                )
            )

    for field in collect_eq_fields(row.tokens):
        conversion = convert_eq_to_latex(field.instruction, field.visible_result)
        candidates.append(
            (
                field.start_index,
                _document(row, field.start_index, "eq_field", conversion, field.instruction),
            )
        )

    candidates.sort(key=lambda item: item[0])
    return ImportedFormulaRow(
        row.part_name,
        row.paragraph_index,
        row.comment_id,
        tuple(formula.to_public_dict() for _index, formula in candidates),
    )


def import_part_formulas(docx_path: str | Path, part_name: str) -> list[ImportedFormulaRow]:
    rows = read_word_part(docx_path, part_name)
    with zipfile.ZipFile(docx_path, "r") as archive:
        ole_payloads = [
            archive.read(token.target)
            for row in rows
            for token in row.tokens
            if token.kind == "ole" and token.target and token.target in archive.namelist()
        ]
        if ole_payloads:
            convert_mathtype_oles_to_mathml_batch(ole_payloads)
        return [_import_row(archive, row) for row in rows]
