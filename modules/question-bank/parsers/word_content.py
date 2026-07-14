"""Shared ordered WordprocessingML walker for document and comment parts."""

from __future__ import annotations

import posixpath
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
O = "urn:schemas-microsoft-com:office:office"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
V = "urn:schemas-microsoft-com:vml"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

NS = {"w": W, "m": M, "o": O, "r": R, "a": A, "v": V}

TokenKind = Literal[
    "text",
    "break",
    "omml",
    "field_begin",
    "field_instruction",
    "field_separate",
    "field_end",
    "field_simple",
    "ole",
    "image",
]


def _local_name(node: ET.Element) -> str:
    return node.tag.rsplit("}", 1)[-1]


def _toggle(run: ET.Element, tag: str) -> bool:
    node = run.find("./w:rPr/w:%s" % tag, NS)
    if node is None:
        return False
    value = node.attrib.get("{%s}val" % W, "true").strip().lower()
    return value not in {"0", "false", "off", "no"}


@dataclass(frozen=True)
class TextStyle:
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    vert_align: str | None = None
    font_family: str | None = None
    font_size_half_points: int | None = None
    color: str | None = None


@dataclass(frozen=True)
class TokenSource:
    part_name: str
    paragraph_index: int
    content_index: int
    comment_id: str | None = None
    table_row: int | None = None
    table_cell: int | None = None
    cell_paragraph: int | None = None


@dataclass(frozen=True)
class WordToken:
    kind: TokenKind
    source: TokenSource
    text: str | None = None
    xml: str | None = None
    style: TextStyle = field(default_factory=TextStyle)
    rel_id: str | None = None
    target: str | None = None
    rel_type: str | None = None
    prog_id: str | None = None


@dataclass(frozen=True)
class WordParagraph:
    part_name: str
    paragraph_index: int
    comment_id: str | None
    tokens: tuple[WordToken, ...]


@dataclass(frozen=True)
class Relationship:
    rel_id: str
    target: str
    rel_type: str


def relationships_part_name(part_name: str) -> str:
    directory, filename = posixpath.split(part_name)
    return posixpath.join(directory, "_rels", filename + ".rels")


def read_relationships(archive: zipfile.ZipFile, part_name: str) -> dict[str, Relationship]:
    rels_name = relationships_part_name(part_name)
    if rels_name not in archive.namelist():
        return {}
    root = ET.fromstring(archive.read(rels_name))
    base_dir = posixpath.dirname(part_name)
    relationships: dict[str, Relationship] = {}
    for node in root.findall("{%s}Relationship" % PKG_REL):
        rel_id = node.attrib.get("Id", "")
        raw_target = node.attrib.get("Target", "")
        if not rel_id or not raw_target:
            continue
        target = raw_target if raw_target.startswith("/") else posixpath.normpath(posixpath.join(base_dir, raw_target))
        relationships[rel_id] = Relationship(rel_id, target.lstrip("/"), node.attrib.get("Type", ""))
    return relationships


def _run_style(run: ET.Element) -> TextStyle:
    fonts = run.find("./w:rPr/w:rFonts", NS)
    size = run.find("./w:rPr/w:sz", NS)
    color = run.find("./w:rPr/w:color", NS)
    vert = run.find("./w:rPr/w:vertAlign", NS)
    size_value = size.attrib.get("{%s}val" % W) if size is not None else None
    return TextStyle(
        bold=_toggle(run, "b"),
        italic=_toggle(run, "i"),
        underline=_toggle(run, "u"),
        strike=_toggle(run, "strike"),
        vert_align=vert.attrib.get("{%s}val" % W) if vert is not None else None,
        font_family=(fonts.attrib.get("{%s}eastAsia" % W) or fonts.attrib.get("{%s}ascii" % W)) if fonts is not None else None,
        font_size_half_points=int(size_value) if size_value and size_value.isdigit() else None,
        color=color.attrib.get("{%s}val" % W) if color is not None else None,
    )


def _paragraph_tokens(
    paragraph: ET.Element,
    part_name: str,
    paragraph_index: int,
    comment_id: str | None,
    relationships: dict[str, Relationship],
    table_row: int | None = None,
    table_cell: int | None = None,
    cell_paragraph: int | None = None,
) -> tuple[WordToken, ...]:
    tokens: list[WordToken] = []

    def append(kind: TokenKind, **values) -> None:
        tokens.append(
            WordToken(
                kind=kind,
                source=TokenSource(part_name, paragraph_index, len(tokens), comment_id, table_row, table_cell, cell_paragraph),
                **values,
            )
        )

    def add_relationship_token(kind: TokenKind, rel_id: str | None, **values) -> None:
        relationship = relationships.get(rel_id or "")
        append(
            kind,
            rel_id=rel_id,
            target=relationship.target if relationship else None,
            rel_type=relationship.rel_type if relationship else None,
            **values,
        )

    def visit(child: ET.Element) -> None:
        tag = _local_name(child)
        if tag in {"oMath", "oMathPara"}:
            append("omml", xml=ET.tostring(child, encoding="unicode"))
            return
        if tag == "fldSimple":
            instruction = child.attrib.get("{%s}instr" % W, "")
            visible_result = "".join(text_node.text or "" for text_node in child.findall(".//w:t", NS))
            if instruction.strip().upper().startswith("EQ"):
                append("field_simple", text=instruction, xml=visible_result)
            else:
                for nested in list(child):
                    visit(nested)
            return
        if tag != "r":
            for nested in list(child):
                visit(nested)
            return

        style = _run_style(child)
        for node in list(child):
            node_tag = _local_name(node)
            if node_tag == "rPr":
                continue
            if node_tag == "fldChar":
                field_type = node.attrib.get("{%s}fldCharType" % W, "")
                kind = {
                    "begin": "field_begin",
                    "separate": "field_separate",
                    "end": "field_end",
                }.get(field_type)
                if kind:
                    append(kind)
                continue
            if node_tag == "instrText":
                append("field_instruction", text=node.text or "", style=style)
                continue
            if node_tag == "t":
                append("text", text=node.text or "", style=style)
                continue
            if node_tag in {"br", "cr"}:
                append("break", text="\f" if node.attrib.get("{%s}type" % W) == "page" else "\n")
                continue

            for math_node in node.findall(".//m:oMath", NS) + node.findall(".//m:oMathPara", NS):
                append("omml", xml=ET.tostring(math_node, encoding="unicode"))
            for ole in node.findall(".//o:OLEObject", NS):
                rel_id = ole.attrib.get("{%s}id" % R)
                add_relationship_token("ole", rel_id, prog_id=ole.attrib.get("ProgID") or ole.attrib.get("Type"))
            for blip in node.findall(".//a:blip", NS):
                add_relationship_token("image", blip.attrib.get("{%s}embed" % R) or blip.attrib.get("{%s}link" % R))
            for image in node.findall(".//v:imagedata", NS):
                add_relationship_token("image", image.attrib.get("{%s}id" % R))
    for child in list(paragraph):
        visit(child)
    return tuple(tokens)


def read_word_part(docx_path: str | Path, part_name: str) -> list[WordParagraph]:
    with zipfile.ZipFile(docx_path, "r") as archive:
        if part_name not in archive.namelist():
            return []
        root = ET.fromstring(archive.read(part_name))
        relationships = read_relationships(archive, part_name)
        rows: list[WordParagraph] = []
        paragraph_index = 0
        if _local_name(root) == "comments":
            for comment in root.findall(".//w:comment", NS):
                comment_id = comment.attrib.get("{%s}id" % W)
                for paragraph in comment.findall(".//w:p", NS):
                    tokens = _paragraph_tokens(paragraph, part_name, paragraph_index, comment_id, relationships)
                    rows.append(WordParagraph(part_name, paragraph_index, comment_id, tokens))
                    paragraph_index += 1
        else:
            body = root.find("./w:body", NS)
            for child in list(body) if body is not None else []:
                if _local_name(child) == "p":
                    tokens = _paragraph_tokens(child, part_name, paragraph_index, None, relationships)
                    rows.append(WordParagraph(part_name, paragraph_index, None, tokens))
                    paragraph_index += 1
                elif _local_name(child) == "tbl":
                    for row_index, table_row in enumerate(child.findall("./w:tr", NS)):
                        for cell_index, cell in enumerate(table_row.findall("./w:tc", NS)):
                            for cell_paragraph, paragraph in enumerate(cell.findall(".//w:p", NS)):
                                tokens = _paragraph_tokens(paragraph, part_name, paragraph_index, None, relationships, row_index, cell_index, cell_paragraph)
                                rows.append(WordParagraph(part_name, paragraph_index, None, tokens))
                                paragraph_index += 1
        return rows
