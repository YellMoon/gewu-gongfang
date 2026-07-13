"""Fail-closed visible-result inspection for generated paper artifacts."""
from __future__ import annotations

import hashlib
import binascii
import json
import posixpath
import re
import sys
import struct
import zipfile
import zlib
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
REL_DOC_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
SOURCE_RESIDUE_RE = re.compile(
    r"(?:\$(?!\s*\d+(?:\.\d+)?\s*\$)[^$\r\n]+\$|\\(?:frac|sqrt|int|sum|prod|alpha|beta|gamma|theta|pi|times|cdot|leq?|geq?|neq|begin|end|left|right|mathrm|mathbf|mathit)\b|</?(?:math|mi|mn|mo|mrow|mfrac|msqrt|msub|msup|m:[A-Za-z][\w.-]*)\b[^>]*>|\bEQ\s+\\[A-Za-z]+)",
    re.I,
)
WINDOWS_PATH_RE = re.compile(r"(?<![\w])(?:[A-Za-z]:\\|\\\\)[^\s<>\"|?*]+")


def _source_residue(value: str) -> re.Match[str] | None:
    return SOURCE_RESIDUE_RE.search(WINDOWS_PATH_RE.sub("", value))


class VisibleGateError(ValueError):
    def __init__(self, diagnostics: list[dict[str, Any]]):
        super().__init__(diagnostics[0]["message"] if diagnostics else "visible-result gate failed")
        self.diagnostics = diagnostics


def _context(manifest: list[dict[str, Any]], code: str, message: str, row: dict[str, Any] | None = None) -> dict[str, Any]:
    source = row or (manifest[0] if manifest else {})
    return {
        "code": code,
        "message": message,
        "questionId": str(source.get("questionId") or ""),
        "location": str(source.get("location") or ""),
        "index": int(source.get("index", 0)),
    }


def _owner_base(relationship_name: str) -> str:
    if relationship_name == "_rels/.rels":
        return ""
    marker = "/_rels/"
    if marker not in relationship_name or not relationship_name.endswith(".rels"):
        return ""
    prefix, leaf = relationship_name.split(marker, 1)
    owner = posixpath.join(prefix, leaf[:-5])
    return posixpath.dirname(owner)


def _relationship_rows(archive: zipfile.ZipFile, manifest: list[dict[str, Any]]) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    names = set(archive.namelist())
    rows: list[dict[str, str]] = []
    diagnostics: list[dict[str, Any]] = []
    for rel_name in sorted(name for name in names if name.endswith(".rels")):
        try:
            root = ET.fromstring(archive.read(rel_name))
        except ET.ParseError as error:
            diagnostics.append(_context(manifest, "DOCX_RELATIONSHIP_XML_INVALID", f"invalid relationship XML {rel_name}: {error}"))
            continue
        base = _owner_base(rel_name)
        for node in root.findall(f"{{{REL_NS}}}Relationship"):
            row = {key: str(value) for key, value in node.attrib.items()}
            row["relationshipPart"] = rel_name
            target = row.get("Target", "")
            if row.get("TargetMode") == "External" or re.match(r"^[a-z]+:", target, re.I):
                rows.append(row)
                continue
            resolved = posixpath.normpath(posixpath.join(base, target)).lstrip("/")
            row["resolvedTarget"] = resolved
            rows.append(row)
            row["targetMissing"] = "true" if resolved not in names else "false"
    return rows, diagnostics


def _visible_text(document: ET.Element) -> str:
    return "".join(node.text or "" for node in document.iter(f"{{{WORD_NS}}}t"))


def _omml_renderable(container: ET.Element | None) -> bool:
    if container is None:
        return False
    allowed = {
        "oMath", "oMathPara", "r", "t", "f", "fPr", "num", "den", "rad", "radPr", "deg", "e",
        "sSub", "sSup", "sSubSup", "sub", "sup", "nary", "naryPr", "limLow", "limUpp", "lim", "func",
        "funcPr", "fName", "acc", "accPr", "bar", "barPr", "d", "dPr", "box", "boxPr", "borderBox",
        "borderBoxPr", "groupChr", "groupChrPr", "m", "mPr", "mr", "mc", "mcPr", "mcJc", "eqArr",
        "eqArrPr", "phant", "phantPr", "ctrlPr", "argPr", "brk", "chr", "grow", "limLoc", "subHide",
        "supHide", "type", "baseJc", "plcHide", "pos", "vertJc", "zeroAsc", "zeroDesc", "zeroWid",
        "count", "sepChr", "begChr", "endChr", "sty", "scr",
    }
    for formula in (node for node in container.iter() if node.tag == f"{{{MATH_NS}}}oMath"):
        math_nodes = [node for node in formula.iter() if node.tag.startswith(f"{{{MATH_NS}}}")]
        if any(node.tag.rsplit("}", 1)[-1] not in allowed for node in math_nodes):
            continue
        for run in (node for node in math_nodes if node.tag.rsplit("}", 1)[-1] == "r"):
            if any(child.tag == f"{{{MATH_NS}}}t" and (child.text or "").strip() for child in run.iter()):
                return True
    return False


def _valid_svg(data: bytes) -> bool:
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return False
    if root.tag.rsplit("}", 1)[-1].lower() != "svg":
        return False
    try:
        view_box = [float(value) for value in re.split(r"[ ,]+", root.attrib.get("viewBox", "").strip()) if value]
    except ValueError:
        return False
    sized = len(view_box) == 4 and view_box[2] > 0 and view_box[3] > 0
    if not sized:
        def dimension(name: str) -> float:
            match = re.match(r"[-+\d.]+", root.attrib.get(name, ""))
            try:
                return float(match.group(0)) if match else 0
            except ValueError:
                return 0
        sized = dimension("width") > 0 and dimension("height") > 0
    def number(node: ET.Element, name: str) -> float:
        match = re.match(r"[-+\d.]+", node.attrib.get(name, ""))
        try:
            return float(match.group(0)) if match else 0
        except ValueError:
            return 0
    def path_geometry(value: str) -> tuple[bool, bool]:
        tokens = re.findall(r"[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?", value)
        index = 0; command = ""; current = (0.0, 0.0); start = current
        previous_control: tuple[float, float] | None = None
        subpaths: list[list[tuple[float, float]]] = []; points: list[tuple[float, float]] = []
        stroke_geometry = False
        arities = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7}
        def add(point: tuple[float, float]) -> None:
            nonlocal current, stroke_geometry
            if abs(point[0] - current[0]) > 1e-9 or abs(point[1] - current[1]) > 1e-9:
                stroke_geometry = True
            points.append(point); current = point
        def finish() -> None:
            nonlocal points
            if points: subpaths.append(points)
            points = []
        try:
            while index < len(tokens):
                if tokens[index].isalpha():
                    command = tokens[index]; index += 1
                    if command in "Zz":
                        add(start); finish(); previous_control = None; continue
                if not command or command.upper() not in arities:
                    return False, False
                upper = command.upper(); arity = arities[upper]
                if index + arity > len(tokens) or any(item.isalpha() for item in tokens[index:index + arity]):
                    return False, False
                values = [float(item) for item in tokens[index:index + arity]]; index += arity
                relative = command.islower(); ox, oy = current
                if upper == "M":
                    finish(); target = (values[0] + (ox if relative else 0), values[1] + (oy if relative else 0))
                    current = start = target; points = [target]; previous_control = None
                    command = "l" if relative else "L"
                elif upper == "L":
                    add((values[0] + (ox if relative else 0), values[1] + (oy if relative else 0))); previous_control = None
                elif upper == "H":
                    add((values[0] + (ox if relative else 0), oy)); previous_control = None
                elif upper == "V":
                    add((ox, values[0] + (oy if relative else 0))); previous_control = None
                elif upper in {"C", "S", "Q", "T"}:
                    if upper == "C":
                        control1 = (values[0] + (ox if relative else 0), values[1] + (oy if relative else 0))
                        control2 = (values[2] + (ox if relative else 0), values[3] + (oy if relative else 0))
                        target = (values[4] + (ox if relative else 0), values[5] + (oy if relative else 0))
                    elif upper == "S":
                        control1 = (2 * ox - previous_control[0], 2 * oy - previous_control[1]) if previous_control else current
                        control2 = (values[0] + (ox if relative else 0), values[1] + (oy if relative else 0))
                        target = (values[2] + (ox if relative else 0), values[3] + (oy if relative else 0))
                    else:
                        control1 = ((2 * ox - previous_control[0], 2 * oy - previous_control[1]) if upper == "T" and previous_control else
                                    ((values[0] + (ox if relative else 0), values[1] + (oy if relative else 0)) if upper == "Q" else current))
                        control2 = control1
                        offset = 2 if upper == "Q" else 0
                        target = (values[offset] + (ox if relative else 0), values[offset + 1] + (oy if relative else 0))
                    origin = current
                    for step in range(1, 13):
                        t = step / 12; u = 1 - t
                        if upper in {"C", "S"}:
                            point = (u**3 * origin[0] + 3*u*u*t*control1[0] + 3*u*t*t*control2[0] + t**3*target[0],
                                     u**3 * origin[1] + 3*u*u*t*control1[1] + 3*u*t*t*control2[1] + t**3*target[1])
                        else:
                            point = (u*u*origin[0] + 2*u*t*control1[0] + t*t*target[0],
                                     u*u*origin[1] + 2*u*t*control1[1] + t*t*target[1])
                        add(point)
                    previous_control = control2 if upper in {"C", "S"} else control1
                else:  # Arc endpoints still establish stroke geometry; curved fill is handled conservatively.
                    target = (values[5] + (ox if relative else 0), values[6] + (oy if relative else 0))
                    rx, ry = abs(values[0]), abs(values[1])
                    if rx > 0 and ry > 0 and target != current:
                        midpoint = ((current[0] + target[0]) / 2 + rx / 2, (current[1] + target[1]) / 2 + ry / 2)
                        add(midpoint)
                    add(target); previous_control = None
            finish()
        except (ValueError, OverflowError):
            return False, False
        fill_geometry = any(abs(sum(path[i][0] * path[(i + 1) % len(path)][1] - path[(i + 1) % len(path)][0] * path[i][1]
                                            for i in range(len(path)))) > 1e-8 for path in subpaths if len(path) >= 3)
        return stroke_geometry, fill_geometry
    def substantial(node: ET.Element, style: dict[str, str], in_defs: bool) -> bool:
        local = node.tag.rsplit("}", 1)[-1].lower()
        if in_defs or style.get("display") == "none" or style.get("visibility") in {"hidden", "collapse"}:
            return False
        try:
            opacity = float(style.get("opacity", "1"))
            fill_opacity = float(style.get("fill-opacity", "1"))
            stroke_opacity = float(style.get("stroke-opacity", "1"))
        except ValueError:
            return False
        def paint_visible(value: str, alpha: float) -> bool:
            normalized = value.strip().lower().replace(" ", "")
            if normalized in {"none", "transparent"} or alpha <= 0:
                return False
            rgba = re.fullmatch(r"rgba\([^,]+,[^,]+,[^,]+,([^)]+)\)", normalized)
            if rgba:
                try:
                    return float(rgba.group(1).rstrip("%")) > 0
                except ValueError:
                    return False
            return not (re.fullmatch(r"#[0-9a-f]{8}", normalized) and normalized[-2:] == "00")
        fill_visible = paint_visible(style.get("fill", "black"), opacity * fill_opacity)
        try:
            stroke_width = float(re.match(r"[-+\d.]+", style.get("stroke-width", "1")).group(0))
        except (AttributeError, ValueError):
            stroke_width = 0
        stroke_visible = paint_visible(style.get("stroke", "none"), opacity * stroke_opacity) and stroke_width > 0
        if local == "path":
            value = node.attrib.get("d", "")
            stroke_geometry, fill_geometry = path_geometry(value)
            return (stroke_visible and stroke_geometry) or (fill_visible and fill_geometry)
        if local == "text":
            return bool("".join(node.itertext()).strip()) and (fill_visible or stroke_visible)
        if local in {"use", "image"}:
            return (fill_visible or stroke_visible) and any(key.rsplit("}", 1)[-1] in {"href", "src"} and str(value).strip() for key, value in node.attrib.items())
        if local == "line":
            return stroke_visible and (number(node, "x1"), number(node, "y1")) != (number(node, "x2"), number(node, "y2"))
        if local == "rect":
            return (fill_visible or stroke_visible) and number(node, "width") > 0 and number(node, "height") > 0
        if local == "circle":
            return (fill_visible or stroke_visible) and number(node, "r") > 0
        if local == "ellipse":
            return (fill_visible or stroke_visible) and number(node, "rx") > 0 and number(node, "ry") > 0
        if local in {"polyline", "polygon"}:
            return (fill_visible or stroke_visible) and len(set(re.findall(r"[-+]?\d+(?:\.\d+)?", node.attrib.get("points", "")))) >= 2
        return False
    def visible_tree(node: ET.Element, inherited: dict[str, str], in_defs: bool = False) -> bool:
        style = dict(inherited)
        parent_opacity = float(style.pop("__effective-opacity", "1"))
        parent_display_hidden = style.pop("__display-hidden", "false") == "true"
        local_style: dict[str, str] = {}
        for declaration in node.attrib.get("style", "").split(";"):
            if ":" in declaration:
                key, value = declaration.split(":", 1); local_style[key.strip().lower()] = value.strip().lower()
        for key in ("display", "visibility", "opacity", "fill", "stroke", "fill-opacity", "stroke-opacity", "stroke-width"):
            if key in node.attrib:
                local_style[key] = node.attrib[key].strip().lower()
        style.update(local_style)
        try:
            local_opacity = float(local_style.get("opacity", "1"))
        except ValueError:
            local_opacity = 0
        style["opacity"] = str(parent_opacity * local_opacity)
        display_hidden = parent_display_hidden or style.get("display") == "none"
        style["__effective-opacity"] = style["opacity"]
        style["__display-hidden"] = "true" if display_hidden else "false"
        if display_hidden:
            style["display"] = "none"
        hidden_defs = in_defs or node.tag.rsplit("}", 1)[-1].lower() in {"defs", "symbol", "clippath", "mask"}
        return substantial(node, style, hidden_defs) or any(visible_tree(child, style, hidden_defs) for child in node)
    drawable = visible_tree(root, {})
    return sized and drawable


def _valid_png(data: bytes) -> bool:
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    offset = 8
    chunks: list[tuple[bytes, bytes]] = []
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        end = offset + 12 + length
        if end > len(data):
            return False
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        checksum = struct.unpack(">I", data[offset + 8 + length:end])[0]
        if (binascii.crc32(kind + payload) & 0xFFFFFFFF) != checksum:
            return False
        chunks.append((kind, payload))
        offset = end
        if kind == b"IEND":
            break
    if offset != len(data) or not chunks or chunks[0][0] != b"IHDR" or len(chunks[0][1]) != 13:
        return False
    width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", chunks[0][1])
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color_type, 0)
    valid_depths = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
    idat = b"".join(payload for kind, payload in chunks if kind == b"IDAT")
    if not (width > 0 and height > 0 and channels and bit_depth in valid_depths.get(color_type, set()) and compression == filtering == interlace == 0 and idat and chunks[-1] == (b"IEND", b"")):
        return False
    try:
        pixels = zlib.decompress(idat)
    except zlib.error:
        return False
    row_bytes = (width * channels * bit_depth + 7) // 8
    if len(pixels) != height * (row_bytes + 1):
        return False
    bytes_per_pixel = max(1, (channels * bit_depth + 7) // 8)
    decoded_rows: list[bytes] = []
    previous = bytearray(row_bytes)
    for row in range(height):
        start = row * (row_bytes + 1); filter_type = pixels[start]
        if filter_type > 4:
            return False
        raw = pixels[start + 1:start + 1 + row_bytes]
        current = bytearray(row_bytes)
        for column, value in enumerate(raw):
            left = current[column - bytes_per_pixel] if column >= bytes_per_pixel else 0
            up = previous[column]
            upper_left = previous[column - bytes_per_pixel] if column >= bytes_per_pixel else 0
            if filter_type == 0: predicted = 0
            elif filter_type == 1: predicted = left
            elif filter_type == 2: predicted = up
            elif filter_type == 3: predicted = (left + up) // 2
            else:
                estimate = left + up - upper_left
                distances = (abs(estimate - left), abs(estimate - up), abs(estimate - upper_left))
                predicted = (left, up, upper_left)[distances.index(min(distances))]
            current[column] = (value + predicted) & 0xFF
        decoded_rows.append(bytes(current)); previous = current
    transparency = next((payload for kind, payload in chunks if kind == b"tRNS"), b"")
    def samples(row: bytes):
        if bit_depth == 16:
            return [int.from_bytes(row[offset:offset + 2], "big") for offset in range(0, len(row), 2)]
        if bit_depth == 8:
            return list(row)
        mask = (1 << bit_depth) - 1
        return [(byte >> shift) & mask for byte in row for shift in range(8 - bit_depth, -1, -bit_depth)]
    if color_type == 0:
        if not transparency:
            return True
        if len(transparency) != 2:
            return False
        transparent_gray = int.from_bytes(transparency, "big")
        return any(value != transparent_gray for row in decoded_rows for value in samples(row)[:width])
    if color_type == 2:
        if not transparency:
            return True
        if len(transparency) != 6:
            return False
        transparent_rgb = tuple(int.from_bytes(transparency[offset:offset + 2], "big") for offset in range(0, 6, 2))
        for row in decoded_rows:
            values = samples(row)
            if any(tuple(values[offset:offset + 3]) != transparent_rgb for offset in range(0, width * 3, 3)):
                return True
        return False
    if color_type in {4, 6}:
        sample_bytes = bit_depth // 8; alpha_offset = (channels - 1) * sample_bytes
        return any(any(row[offset + alpha_offset:offset + alpha_offset + sample_bytes] != b"\x00" * sample_bytes for offset in range(0, len(row), channels * sample_bytes)) for row in decoded_rows)
    if not transparency:
        return True
    for row in decoded_rows:
        for index in samples(row)[:width]:
            if index >= len(transparency) or transparency[index] > 0:
                return True
    return False


def _structural_cfb(data: bytes) -> bool:
    free, end, fat_sector = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD
    if len(data) < 1024 or data[:8] != bytes.fromhex("D0CF11E0A1B11AE1") or data[28:30] != b"\xfe\xff":
        return False
    sector_size = 1 << int.from_bytes(data[30:32], "little")
    mini_size = 1 << int.from_bytes(data[32:34], "little")
    if sector_size != 512 or mini_size != 64 or (len(data) - 512) % sector_size:
        return False
    sector_count = (len(data) - 512) // sector_size
    def sector(index: int) -> bytes:
        if index >= sector_count:
            raise ValueError("sector outside compound file")
        start = 512 + index * sector_size
        return data[start:start + sector_size]
    fat_count = int.from_bytes(data[44:48], "little")
    difat = list(struct.unpack("<109I", data[76:512]))
    fat_ids = [value for value in difat if value not in {free, end}]
    next_difat = int.from_bytes(data[68:72], "little")
    difat_count = int.from_bytes(data[72:76], "little")
    try:
        for _ in range(difat_count):
            values = struct.unpack(f"<{sector_size // 4}I", sector(next_difat))
            fat_ids.extend(value for value in values[:-1] if value not in {free, end})
            next_difat = values[-1]
        fat_ids = fat_ids[:fat_count]
        if len(fat_ids) != fat_count or any(value >= sector_count for value in fat_ids):
            return False
        fat = [value for fat_id in fat_ids for value in struct.unpack(f"<{sector_size // 4}I", sector(fat_id))]
        if any(fat[fat_id] != fat_sector for fat_id in fat_ids):
            return False
        def chain(start: int, table: list[int], limit: int) -> list[int]:
            result: list[int] = []; current = start
            while current != end:
                if current in result or current in {free, fat_sector} or current >= limit or len(result) > limit:
                    raise ValueError("invalid compound stream chain")
                result.append(current); current = table[current]
            return result
        directory_ids = chain(int.from_bytes(data[48:52], "little"), fat, sector_count)
        directory = b"".join(sector(value) for value in directory_ids)
        entries: list[dict[str, Any]] = []
        for offset in range(0, len(directory), 128):
            row = directory[offset:offset + 128]
            if len(row) < 128 or row[66] not in {2, 5}:
                continue
            name_length = int.from_bytes(row[64:66], "little")
            if name_length < 2 or name_length > 64 or name_length % 2:
                continue
            entries.append({"name": row[:name_length - 2].decode("utf-16le", errors="strict"), "type": row[66], "start": int.from_bytes(row[116:120], "little"), "size": int.from_bytes(row[120:128], "little")})
        root = next((entry for entry in entries if entry["type"] == 5 and entry["name"] == "Root Entry"), None)
        equation = next((entry for entry in entries if entry["type"] == 2 and ("equation native" in entry["name"].lower() or "mathtype" in entry["name"].lower())), None)
        if not root or not equation or equation["size"] <= 0:
            return False
        cutoff = int.from_bytes(data[56:60], "little")
        def valid_native(payload: bytes) -> bool:
            if len(payload) < 35:
                return False
            header_size = int.from_bytes(payload[0:2], "little")
            version = int.from_bytes(payload[4:8], "little")
            clipboard_format = int.from_bytes(payload[8:10], "little")
            object_size = int.from_bytes(payload[12:16], "little")
            if header_size != 28 or version != 0x00020000 or clipboard_format == 0 or object_size != len(payload) - header_size:
                return False
            mtef = payload[header_size:]
            if len(mtef) < 7 or mtef[0] not in {3, 4, 5} or mtef[1] not in {0, 1} or mtef[2] not in {0, 1}:
                return False
            first_record = mtef[5]
            return first_record in range(1, 20) and 0 in mtef[6:]
        if equation["size"] >= cutoff:
            stream_ids = chain(equation["start"], fat, sector_count)
            payload = b"".join(sector(value) for value in stream_ids)[:equation["size"]]
            return len(payload) == equation["size"] and valid_native(payload)
        mini_fat_count = int.from_bytes(data[64:68], "little")
        mini_fat_ids = chain(int.from_bytes(data[60:64], "little"), fat, sector_count) if mini_fat_count else []
        mini_fat = [value for sid in mini_fat_ids[:mini_fat_count] for value in struct.unpack(f"<{sector_size // 4}I", sector(sid))]
        root_ids = chain(root["start"], fat, sector_count)
        mini_stream = b"".join(sector(value) for value in root_ids)[:root["size"]]
        mini_ids = chain(equation["start"], mini_fat, len(mini_fat))
        payload = b"".join(mini_stream[value * mini_size:(value + 1) * mini_size] for value in mini_ids)
        return len(payload) >= equation["size"] and valid_native(payload[:equation["size"]])
    except (ValueError, IndexError, UnicodeDecodeError, struct.error):
        return False


def _valid_cfb(data: bytes) -> bool:
    """Fail closed until a real MathType-produced fixture/writer is audited."""
    return False


def _pdf_has_visible_paint(data: bytes, expected_rect: tuple[float, float, float, float], valid_fonts: set[bytes]) -> bool:
    tokens: list[Any] = []
    index = 0
    delimiters = b" \t\r\n\x0c\x00()<>[]{}/%"
    while index < len(data):
        byte = data[index]
        if byte in b" \t\r\n\x0c\x00":
            index += 1; continue
        if byte == 0x25:
            newline = re.search(rb"[\r\n]", data[index:])
            index = len(data) if not newline else index + newline.end(); continue
        if byte == 0x28:
            depth = 1; index += 1; value = bytearray()
            while index < len(data) and depth:
                if data[index] == 0x5C:
                    if index + 1 < len(data): value.append(data[index + 1])
                    index += 2; continue
                if data[index] == 0x28: depth += 1
                elif data[index] == 0x29:
                    depth -= 1
                    if not depth: index += 1; break
                if depth: value.append(data[index])
                index += 1
            tokens.append(("string", bytes(value)))
            continue
        if byte == 0x3C and index + 1 < len(data) and data[index + 1] != 0x3C:
            end = data.find(b">", index + 1)
            if end < 0: break
            try: tokens.append(("string", bytes.fromhex(data[index + 1:end].decode("ascii"))))
            except ValueError: tokens.append(("string", b""))
            index = end + 1; continue
        if byte == 0x2F:
            index += 1; start = index
            while index < len(data) and data[index] not in delimiters:
                index += 1
            tokens.append(("name", data[start:index]))
            continue
        if byte in b"[]":
            tokens.append(bytes([byte])); index += 1; continue
        start = index
        while index < len(data) and data[index] not in delimiters:
            index += 1
        token = data[start:index]
        if token == b"BI":
            inline_end = re.search(rb"(?:^|\s)EI(?=\s|$)", data[index:])
            index = len(data) if not inline_end else index + inline_end.end()
            continue
        try: tokens.append(float(token))
        except ValueError: tokens.append(token)
        if index == start:
            index += 1
    def multiply(left, right):
        a, b, c, d, e, f = left; g, h, i, j, k, l = right
        return (a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f)
    def transform(matrix, x, y):
        a, b, c, d, e, f = matrix
        return (a * x + c * y + e, b * x + d * y + f)
    def box(points):
        return None if not points else (min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points))
    def intersection(left, right):
        if left is None: return right
        if right is None: return left
        value = (max(left[0], right[0]), max(left[1], right[1]), min(left[2], right[2]), min(left[3], right[3]))
        return value if value[2] > value[0] and value[3] > value[1] else None
    def hits(value):
        return value is not None and intersection(value, expected_rect) is not None
    def subpath_area(points):
        if len(points) < 3:
            return 0.0
        return abs(sum(
            points[index][0] * points[(index + 1) % len(points)][1]
            - points[(index + 1) % len(points)][0] * points[index][1]
            for index in range(len(points))
        )) / 2.0
    def has_fill_area():
        return any(subpath_area(points) > 1e-9 for points in path_subpaths)
    def stroke_box():
        has_segment = any(
            abs(points[index][0] - points[index - 1][0]) > 1e-9
            or abs(points[index][1] - points[index - 1][1]) > 1e-9
            for points in path_subpaths for index in range(1, len(points))
        )
        if not has_segment:
            return None
        value = box(path_points)
        if value is not None:
            half = max(line_width, 0.01) / 2
            value = (value[0] - half, value[1] - half, value[2] + half, value[3] + half)
        return value

    operands: list[Any] = []
    current: tuple[float, float] | None = None; subpath: tuple[float, float] | None = None; path_points: list[tuple[float, float]] = []; path_subpaths: list[list[tuple[float, float]]] = []
    matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0); clip_box = None; pending_clip = False; stack = []
    line_width = 1.0; in_text = False; font_size = 0.0; font_name = b""; text_position = (0.0, 0.0); text_matrix_visible = True
    active = b"GEWU_PAINT_BEGIN" not in data
    array_depth = 0
    def apply_pending_clip():
        nonlocal clip_box, pending_clip
        if pending_clip:
            clip_box = intersection(clip_box, box(path_points)) if has_fill_area() else (0.0, 0.0, 0.0, 0.0); pending_clip = False
    for token in tokens:
        if token == b"[": array_depth += 1; operands.append(token); continue
        if token == b"]": array_depth = max(0, array_depth - 1); operands.append(token); continue
        if not isinstance(token, bytes) or array_depth or (isinstance(token, tuple)):
            operands.append(token); continue
        numbers = [value for value in operands if isinstance(value, float)]
        if token == b"GEWU_PAINT_BEGIN":
            active = True; path_points = []; path_subpaths = []; current = subpath = None
        elif token == b"q":
            stack.append((matrix, clip_box, line_width, in_text, font_size, font_name, text_position, text_matrix_visible))
        elif token == b"Q":
            if stack: matrix, clip_box, line_width, in_text, font_size, font_name, text_position, text_matrix_visible = stack.pop()
        elif token == b"cm" and len(numbers) >= 6:
            matrix = multiply(matrix, tuple(numbers[-6:]))
        elif token == b"m" and len(numbers) >= 2:
            current = subpath = transform(matrix, numbers[-2], numbers[-1]); path_points.append(current); path_subpaths.append([current])
        elif token == b"l" and len(numbers) >= 2 and current is not None:
            target = transform(matrix, numbers[-2], numbers[-1]); path_points.append(target); path_subpaths[-1].append(target); current = target
        elif token in {b"c", b"v", b"y"} and len(numbers) >= 4 and current is not None:
            coords = numbers[-6:] if token == b"c" else numbers[-4:]
            for offset in range(0, len(coords), 2):
                point = transform(matrix, coords[offset], coords[offset + 1]); path_points.append(point); path_subpaths[-1].append(point)
            current = path_points[-1]
        elif token == b"re" and len(numbers) >= 4:
            x, y, width, height = numbers[-4:]
            rectangle = [transform(matrix, px, py) for px, py in ((x, y), (x + width, y), (x + width, y + height), (x, y + height), (x, y))]
            path_points.extend(rectangle); path_subpaths.append(rectangle); subpath = current = rectangle[0]
        elif token == b"h" and current is not None and subpath is not None:
            path_points.append(subpath); path_subpaths[-1].append(subpath); current = subpath
        elif token == b"w" and numbers:
            line_width = numbers[-1]
        elif token in {b"W", b"W*"}:
            pending_clip = True
        elif token in {b"S", b"s"}:
            value = stroke_box()
            if active and hits(intersection(value, clip_box)): return True
            apply_pending_clip()
            path_points = []; path_subpaths = []; current = subpath = None
        elif token in {b"f", b"f*", b"F"}:
            value = box(path_points)
            if active and has_fill_area() and hits(intersection(value, clip_box)): return True
            apply_pending_clip()
            path_points = []; path_subpaths = []; current = subpath = None
        elif token in {b"B", b"B*", b"b", b"b*"}:
            fill_value = box(path_points) if has_fill_area() else None
            if active and (hits(intersection(fill_value, clip_box)) or hits(intersection(stroke_box(), clip_box))): return True
            apply_pending_clip()
            path_points = []; path_subpaths = []; current = subpath = None
        elif token == b"n":
            apply_pending_clip()
            path_points = []; path_subpaths = []; current = subpath = None
        elif token == b"BT":
            in_text = True; font_size = 0; text_matrix_visible = True
        elif token == b"ET":
            in_text = False
        elif token == b"Tf" and numbers and any(isinstance(value, tuple) and value[0] == "name" for value in operands):
            font_size = numbers[-1]; font_name = next(value[1] for value in reversed(operands) if isinstance(value, tuple) and value[0] == "name")
        elif token == b"Tm" and len(numbers) >= 6:
            a, b, c, d, e, f = numbers[-6:]; text_matrix_visible = any(value != 0 for value in (a, b, c, d)); text_position = transform(matrix, e, f)
        elif token in {b"Td", b"TD"} and len(numbers) >= 2:
            text_position = transform(matrix, numbers[-2], numbers[-1])
        elif token == b"Tj":
            strings = [value[1] for value in operands if isinstance(value, tuple) and value[0] == "string"]
            width = sum(len(value) for value in strings) * font_size * .5
            value = (text_position[0], text_position[1], text_position[0] + width, text_position[1] + font_size)
            if active and font_name in valid_fonts and in_text and font_size > 0 and text_matrix_visible and any(strings) and hits(intersection(value, clip_box)): return True
        elif token == b"TJ":
            strings = [value[1] for value in operands if isinstance(value, tuple) and value[0] == "string"]
            width = sum(len(value) for value in strings) * font_size * .5
            value = (text_position[0], text_position[1], text_position[0] + width, text_position[1] + font_size)
            if active and font_name in valid_fonts and in_text and font_size > 0 and text_matrix_visible and any(strings) and hits(intersection(value, clip_box)): return True
        operands = []
    return False


def _inspect_docx(path: Path, manifest: list[dict[str, Any]]) -> tuple[int | None, list[dict[str, Any]]]:
    diagnostics: list[dict[str, Any]] = []
    try:
        with zipfile.ZipFile(path) as archive:
            bad_member = archive.testzip()
            if bad_member:
                diagnostics.append(_context(manifest, "DOCX_ZIP_MEMBER_INVALID", f"corrupt DOCX member: {bad_member}"))
            names = set(archive.namelist())
            if "word/document.xml" not in names:
                diagnostics.append(_context(manifest, "DOCX_DOCUMENT_XML_MISSING", "word/document.xml is missing"))
                return None, diagnostics
            relationships, relationship_errors = _relationship_rows(archive, manifest)
            diagnostics.extend(relationship_errors)
            document_xml = archive.read("word/document.xml").decode("utf-8", errors="replace")
            try:
                document = ET.fromstring(document_xml)
            except ET.ParseError as error:
                diagnostics.append(_context(manifest, "DOCX_DOCUMENT_XML_INVALID", f"invalid document XML: {error}"))
                return None, diagnostics

            visible_text = _visible_text(document)
            if "[[GEWU_FORMULA_" in visible_text:
                diagnostics.append(_context(manifest, "FORMULA_PLACEHOLDER_UNRESOLVED", "formula replacement placeholder remains visible"))
            residue = _source_residue(visible_text)
            if residue:
                diagnostics.append(_context(manifest, "FORMULA_SOURCE_RESIDUE_VISIBLE", f"formula source residue remains visible: {residue.group(0)}"))

            document_relationships = {
                row.get("Id", ""): row
                for row in relationships
                if row.get("relationshipPart") == "word/_rels/document.xml.rels"
            }
            formula_containers: dict[int, ET.Element] = {}
            formula_container_counts: dict[int, int] = {}
            parent_map = {child: parent for parent in document.iter() for child in parent}
            for node in document.iter():
                if node.tag.rsplit("}", 1)[-1] not in {"inline", "anchor", "sdt"}:
                    continue
                marker = next((re.search(r"GEWU_FORMULA_(\d+)", str(value)) for child in node.iter() for value in child.attrib.values() if "GEWU_FORMULA_" in str(value)), None)
                if marker:
                    formula_index = int(marker.group(1))
                    ancestor = parent_map.get(node)
                    nested_same = False
                    while ancestor is not None:
                        if any(f"GEWU_FORMULA_{formula_index}" in str(value) for value in ancestor.attrib.values()):
                            nested_same = True; break
                        ancestor = parent_map.get(ancestor)
                    if not nested_same:
                        formula_container_counts[formula_index] = formula_container_counts.get(formula_index, 0) + 1
                        formula_containers.setdefault(formula_index, node)
            manifest_indices = [int(row.get("index", position)) for position, row in enumerate(manifest)]
            expected_indices = set(manifest_indices)
            actual_indices = set(formula_container_counts)
            if len(manifest_indices) != len(expected_indices) or any(count != 1 for count in formula_container_counts.values()):
                diagnostics.append(_context(manifest, "FORMULA_INDEX_DUPLICATE", "formula indices must be unique in both manifest and DOCX containers"))
            if actual_indices != expected_indices:
                diagnostics.append(_context(manifest, "FORMULA_INDEX_SET_MISMATCH", f"DOCX formula index set {sorted(actual_indices)} does not match manifest {sorted(expected_indices)}"))

            relationship_context: dict[str, dict[str, Any]] = {}
            vector_rows = [row for row in manifest if row.get("effectiveMode") == "latex-vector"]
            for row in vector_rows:
                index = int(row.get("index", 0))
                container = formula_containers.get(index)
                if container is None:
                    diagnostics.append(_context(manifest, "FORMULA_INDEX_MAPPING_MISSING", "formula-index mapping is missing from the vector drawing", row))
                    continue
                for child in container.iter():
                    for attribute in (f"{{{REL_DOC_NS}}}embed", f"{{{REL_DOC_NS}}}link", f"{{{REL_DOC_NS}}}id"):
                        if child.attrib.get(attribute):
                            relationship_context[child.attrib[attribute]] = row
                extents = [child for child in container.iter() if child.tag.rsplit("}", 1)[-1] in {"extent", "ext"} and ("cx" in child.attrib or "cy" in child.attrib)]
                if not extents:
                    diagnostics.append(_context(manifest, "FORMULA_RENDER_BOUNDS_MISSING", "formula drawing has no render extent", row))
                elif any(float(child.attrib.get("cx", 0) or 0) <= 0 or float(child.attrib.get("cy", 0) or 0) <= 0 for child in extents):
                    diagnostics.append(_context(manifest, "FORMULA_RENDER_BOUNDS_INVALID", "formula render extent is empty or zero-sized", row))
                if any(child.tag.rsplit("}", 1)[-1] == "srcRect" and any(float(child.attrib.get(key, 0) or 0) != 0 for key in ("l", "t", "r", "b")) for child in container.iter()):
                    diagnostics.append(_context(manifest, "FORMULA_RENDER_CROPPED", "formula source rectangle is cropped", row))
                svg_nodes = [child for child in container.iter() if child.tag.rsplit("}", 1)[-1] == "svgBlip"]
                svg_targets = [document_relationships.get(child.attrib.get(f"{{{REL_DOC_NS}}}embed", ""), {}).get("resolvedTarget", "") for child in svg_nodes]
                svg_valid = any(target.lower().endswith(".svg") for target in svg_targets)
                if not svg_valid:
                    diagnostics.append(_context(manifest, "LATEX_VECTOR_VISIBLE_RESULT_MISSING", "LaTeX vector formula has no SVG relationship", row))
                elif not any(target in names and _valid_svg(archive.read(target)) for target in svg_targets):
                    diagnostics.append(_context(manifest, "LATEX_VECTOR_SVG_INVALID", "LaTeX vector formula SVG is malformed, empty, or has invalid geometry", row))
                png_valid = False
                png_targets: list[str] = []
                for child in container.iter():
                    if child.tag.rsplit("}", 1)[-1] != "blip" or not any(desc.tag.rsplit("}", 1)[-1] == "svgBlip" for desc in child.iter()):
                        continue
                    target = document_relationships.get(child.attrib.get(f"{{{REL_DOC_NS}}}embed", ""), {}).get("resolvedTarget", "").lower()
                    png_valid = png_valid or target.endswith(".png")
                    if target.endswith(".png"):
                        png_targets.append(document_relationships.get(child.attrib.get(f"{{{REL_DOC_NS}}}embed", ""), {}).get("resolvedTarget", ""))
                if not png_valid:
                    diagnostics.append(_context(manifest, "LATEX_VECTOR_PNG_FALLBACK_MISSING", "LaTeX vector formula has no referenced PNG fallback", row))
                elif not any(target in names and _valid_png(archive.read(target)) for target in png_targets):
                    diagnostics.append(_context(manifest, "LATEX_VECTOR_PNG_INVALID", "LaTeX vector PNG fallback is malformed or has invalid dimensions", row))

            native_rows = [row for row in manifest if row.get("effectiveMode") in {"word-native", "eq-field"}]
            for row in native_rows:
                container = formula_containers.get(int(row.get("index", 0)))
                omml_visible = _omml_renderable(container)
                if not omml_visible:
                    code = "EQ_FIELD_VISIBLE_RESULT_MISSING" if row.get("effectiveMode") == "eq-field" else "OMML_VISIBLE_RESULT_MISSING"
                    diagnostics.append(_context(manifest, code, "native/EQ formula has no indexed OMML visible result", row))
                    continue
                if row.get("effectiveMode") == "eq-field":
                    field_visible = any(
                        child.tag == f"{{{WORD_NS}}}fldSimple"
                        and re.match(r"^\s*EQ\b", child.attrib.get(f"{{{WORD_NS}}}instr", ""), re.I)
                        and _omml_renderable(child)
                        for child in container.iter()
                    )
                    if not field_visible:
                        diagnostics.append(_context(manifest, "EQ_FIELD_VISIBLE_RESULT_MISSING", "indexed EQ field instruction or visible OMML result is missing", row))

            mathtype_rows = [row for row in manifest if row.get("effectiveMode") == "mathtype-compatible"]
            for row in mathtype_rows:
                container = formula_containers.get(int(row.get("index", 0)))
                ole_ids = [] if container is None else [
                    node.attrib.get(f"{{{REL_DOC_NS}}}id", "")
                    for node in container.iter()
                    if node.tag.rsplit("}", 1)[-1] == "OLEObject"
                ]
                preview_ids = [] if container is None else [
                    node.attrib.get(f"{{{REL_DOC_NS}}}embed", "") or node.attrib.get(f"{{{REL_DOC_NS}}}id", "")
                    for node in container.iter()
                    if node.tag.rsplit("}", 1)[-1] in {"blip", "imagedata"}
                ]
                for relationship_id in ole_ids + preview_ids:
                    if relationship_id:
                        relationship_context[relationship_id] = row
                ole_targets = [document_relationships.get(relationship_id, {}).get("resolvedTarget", "") for relationship_id in ole_ids if document_relationships.get(relationship_id, {}).get("Type", "").endswith("/oleObject")]
                preview_targets = [document_relationships.get(relationship_id, {}).get("resolvedTarget", "") for relationship_id in preview_ids if document_relationships.get(relationship_id, {}).get("Type", "").endswith("/image")]
                ole_valid = any(target.startswith("word/embeddings/") for target in ole_targets)
                preview_valid = any(target.startswith("word/media/") for target in preview_targets)
                if not ole_valid or not preview_valid:
                    diagnostics.append(_context(manifest, "MATHTYPE_OLE_EVIDENCE_MISSING", "MathType formula is missing an OLE embedding/object relationship or visible preview", row))
                elif not any(target in names and _valid_cfb(archive.read(target)) for target in ole_targets) or not any(target in names and target.lower().endswith(".png") and _valid_png(archive.read(target)) for target in preview_targets):
                    diagnostics.append(_context(manifest, "MATHTYPE_OLE_EVIDENCE_INVALID", "MathType OLE compound file or preview image is structurally invalid", row))

            for relation in relationships:
                if relation.get("targetMissing") != "true":
                    continue
                row = relationship_context.get(relation.get("Id", "")) if relation.get("relationshipPart") == "word/_rels/document.xml.rels" else None
                diagnostics.append(_context(manifest, "DOCX_RELATIONSHIP_TARGET_MISSING", f"relationship target is missing: {relation.get('relationshipPart')} -> {relation.get('resolvedTarget')}", row))
    except (OSError, zipfile.BadZipFile) as error:
        diagnostics.append(_context(manifest, "DOCX_PACKAGE_INVALID", f"invalid DOCX package: {error}"))
    return None, diagnostics


def _inspect_pdf(path: Path, manifest: list[dict[str, Any]]) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    diagnostics: list[dict[str, Any]] = []
    report_diagnostics: list[dict[str, Any]] = []
    data = path.read_bytes()
    if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-2048:]:
        return 0, [_context(manifest, "PDF_PACKAGE_INVALID", "PDF header or EOF marker is missing")], report_diagnostics
    object_rows = re.findall(rb"(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj", data)
    objects = {int(object_id): block for object_id, _generation, block in object_rows}
    page_rows = [(object_id, block) for object_id, block in objects.items() if re.search(rb"/Type\s*/Page\b", block)]
    page_count = len(page_rows)
    if not page_count:
        diagnostics.append(_context(manifest, "PDF_PAGE_COUNT_INVALID", "PDF contains no page objects"))

    def inherited_box(block: bytes) -> tuple[float, float]:
        visited: set[int] = set()
        current = block
        while current:
            box = re.search(rb"/MediaBox\s*\[\s*([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s*\]", current)
            if box:
                values = [float(value) for value in box.groups()]
                return values[2] - values[0], values[3] - values[1]
            parent = re.search(rb"/Parent\s+(\d+)\s+\d+\s+R", current)
            if not parent or int(parent.group(1)) in visited:
                break
            visited.add(int(parent.group(1)))
            current = objects.get(int(parent.group(1)), b"")
        return 0, 0

    def decoded_stream(object_id: int) -> bytes:
        block = objects.get(object_id, b"")
        match = re.search(rb"stream\r?\n([\s\S]*?)\r?\nendstream", block)
        if not match:
            raise ValueError(f"object {object_id} is not a stream")
        raw = match.group(1)
        if re.search(rb"/Filter\s*/FlateDecode\b", block):
            return zlib.decompress(raw)
        if b"/Filter" in block:
            raise ValueError(f"object {object_id} uses an unsupported content filter")
        return raw

    def page_font_names(page: bytes) -> set[bytes]:
        """Return only font resource names that the page can legally select."""
        resource_blocks = [page]
        resource_ref = re.search(rb"/Resources\s+(\d+)\s+\d+\s+R", page)
        if resource_ref:
            resource_blocks.append(objects.get(int(resource_ref.group(1)), b""))
        names: set[bytes] = set()
        for resources in resource_blocks:
            font_ref = re.search(rb"/Font\s+(\d+)\s+\d+\s+R", resources)
            font_blocks = [objects.get(int(font_ref.group(1)), b"")] if font_ref else []
            font_blocks.extend(match.group(1) for match in re.finditer(rb"/Font\s*<<([\s\S]*?)>>", resources))
            for font_block in font_blocks:
                names.update(re.findall(rb"/([^\s/<>()\[\]]+)\s+(?:\d+\s+\d+\s+R|<<)", font_block))
        return names

    def pdf_literal(raw: bytes) -> bytes:
        return re.sub(
            rb"\\([0-7]{1,3}|[nrtbf()\\])",
            lambda match: bytes([int(match.group(1), 8)]) if match.group(1)[:1].isdigit() else {
                b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f",
                b"(": b"(", b")": b")", b"\\": b"\\",
            }[match.group(1)],
            raw,
        )

    evidence: dict[int, tuple[tuple[float, float, float, float], float, float, int]] = {}
    draw_markers: dict[int, tuple[tuple[float, float, float, float], int]] = {}
    annotation_counts: dict[int, int] = {}
    marker_counts: dict[int, int] = {}
    draw_operator_evidence: set[tuple[int, int]] = set()
    visible_fragments: list[str] = []
    text_requires_renderer = False
    for page_number, (_page_id, page) in enumerate(page_rows):
        width, height = inherited_box(page)
        valid_fonts = page_font_names(page)
        contents_array = re.search(rb"/Contents\s*\[([^\]]*)\]", page)
        contents_single = re.search(rb"/Contents\s+(\d+)\s+\d+\s+R", page)
        content_ids = [int(value) for value in re.findall(rb"(\d+)\s+\d+\s+R", contents_array.group(1))] if contents_array else ([int(contents_single.group(1))] if contents_single else [])
        if not content_ids:
            diagnostics.append(_context(manifest, "PDF_PAGE_CONTENTS_MISSING", f"PDF page {page_number + 1} has no /Contents stream"))
            content = b""
        else:
            try:
                content = b"\n".join(decoded_stream(object_id) for object_id in content_ids)
            except (ValueError, zlib.error) as error:
                diagnostics.append(_context(manifest, "PDF_PAGE_CONTENTS_UNREADABLE", f"PDF page {page_number + 1} content stream cannot be decoded: {error}"))
                content = b""
        annotation_array = re.search(rb"/Annots\s*\[([^\]]*)\]", page)
        annotation_ids = [] if not annotation_array else [int(value) for value in re.findall(rb"(\d+)\s+\d+\s+R", annotation_array.group(1))]
        for annotation_id in annotation_ids:
            annotation = objects.get(annotation_id, b"")
            if not re.search(rb"/Subtype\s*/Link\b", annotation):
                continue
            action_ref = re.search(rb"/A\s+(\d+)\s+\d+\s+R", annotation)
            action = annotation + (objects.get(int(action_ref.group(1)), b"") if action_ref else b"")
            uri_match = re.search(rb"/URI\s*\(([^)]*)\)", action)
            marker = re.fullmatch(rb"gewu-formula:(\d+)", pdf_literal(uri_match.group(1))) if uri_match else None
            rectangle = re.search(rb"/Rect\s*\[\s*([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s*\]", annotation)
            if marker and rectangle:
                formula_index = int(marker.group(1)); annotation_counts[formula_index] = annotation_counts.get(formula_index, 0) + 1
                evidence[formula_index] = (tuple(float(value) for value in rectangle.groups()), width, height, page_number)
        for match in re.findall(rb"GEWU_FORMULA_DRAW\s+(\d+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)", content):
            formula_index = int(match[0]); marker_counts[formula_index] = marker_counts.get(formula_index, 0) + 1
            draw_markers[formula_index] = (tuple(float(value) for value in match[1:]), page_number)
        for begin in re.finditer(rb"%\s*GEWU_FORMULA_DRAW\s+(\d+)\s+[-+\d.]+\s+[-+\d.]+\s+[-+\d.]+\s+[-+\d.]+", content):
            index = int(begin.group(1))
            end = re.search(rb"%\s*GEWU_FORMULA_DRAW_END\s+" + str(index).encode("ascii") + rb"\b", content[begin.end():])
            annotation = evidence.get(index)
            paint_stream = content[:begin.end()] + b"\nGEWU_PAINT_BEGIN\n" + content[begin.end():begin.end() + end.start()] if end else b""
            if end and annotation and annotation[3] == page_number and _pdf_has_visible_paint(paint_stream, annotation[0], valid_fonts):
                draw_operator_evidence.add((page_number, index))
        text_operands = list(re.findall(rb"\(([^()]*)\)\s*Tj", content))
        hex_operands = list(re.findall(rb"<([0-9A-Fa-f]+)>\s*Tj", content))
        for array in re.findall(rb"\[([^\]]*)\]\s*TJ", content):
            text_operands.extend(re.findall(rb"\(([^()]*)\)", array))
            hex_operands.extend(re.findall(rb"<([0-9A-Fa-f]+)>", array))
        for literal in (pdf_literal(value) for value in text_operands):
            if all(byte in (9, 10, 13) or 32 <= byte <= 126 for byte in literal):
                visible_fragments.append(literal.decode("ascii"))
            else:
                text_requires_renderer = True
        for hexadecimal in hex_operands:
            try:
                raw = bytes.fromhex(hexadecimal.decode("ascii"))
                if all(byte in (9, 10, 13) or 32 <= byte <= 126 for byte in raw):
                    visible_fragments.append(raw.decode("ascii"))
                else:
                    text_requires_renderer = True
            except ValueError:
                text_requires_renderer = True
    if text_requires_renderer:
        report_diagnostics.append(_context(manifest, "PDF_SOURCE_TEXT_REQUIRES_RENDERER", "some PDF text uses a font encoding that requires a renderer for complete source-residue inspection"))
    manifest_indices = [int(row.get("index", position)) for position, row in enumerate(manifest)]
    expected_indices = set(manifest_indices)
    actual_indices = set(marker_counts) | set(annotation_counts)
    if len(manifest_indices) != len(expected_indices) or any(count != 1 for count in marker_counts.values()) or any(count != 1 for count in annotation_counts.values()):
        diagnostics.append(_context(manifest, "FORMULA_INDEX_DUPLICATE", "formula indices must be unique in manifest, PDF markers, and PDF annotations"))
    if set(marker_counts) != expected_indices or set(annotation_counts) != expected_indices:
        diagnostics.append(_context(manifest, "FORMULA_INDEX_SET_MISMATCH", f"PDF formula index set {sorted(actual_indices)} does not match manifest {sorted(expected_indices)}"))
    for row in manifest:
        index = int(row.get("index", 0))
        page_evidence = evidence.get(index)
        if page_evidence is None:
            diagnostics.append(_context(manifest, "PDF_FORMULA_VISIBLE_EVIDENCE_MISSING", "PDF formula drawing evidence is missing", row))
            continue
        rectangle, max_width, max_height, annotation_page = page_evidence
        left, bottom, right, top = rectangle
        if right <= left or top <= bottom:
            diagnostics.append(_context(manifest, "PDF_FORMULA_RENDER_BOUNDS_INVALID", "PDF formula evidence has empty or zero-sized geometry", row))
        elif max_width <= 0 or max_height <= 0 or left < 0 or bottom < 0 or right > max_width or top > max_height:
            diagnostics.append(_context(manifest, "PDF_FORMULA_RENDER_CROPPED", "PDF formula geometry lies outside the page bounds", row))
        draw_evidence = draw_markers.get(index)
        if draw_evidence is None:
            diagnostics.append(_context(manifest, "PDF_FORMULA_DRAW_MARKER_MISSING", "PDF formula drawing marker is missing", row))
        else:
            draw, draw_page = draw_evidence
            x, y, width, height = draw
            if draw_page != annotation_page:
                diagnostics.append(_context(manifest, "PDF_FORMULA_PAGE_EVIDENCE_MISMATCH", "PDF formula marker, paint, and annotation are not on the same page", row))
            expected_bottom = max_height - y - height
            expected_top = max_height - y
            if width <= 0 or height <= 0 or any(abs(actual - expected) > 1 for actual, expected in ((left, x), (bottom, expected_bottom), (right, x + width), (top, expected_top))):
                diagnostics.append(_context(manifest, "PDF_FORMULA_DRAW_GEOMETRY_MISMATCH", "PDF formula drawing marker does not match annotation geometry", row))
            if (draw_page, index) not in draw_operator_evidence:
                diagnostics.append(_context(manifest, "PDF_FORMULA_DRAW_OPERATOR_MISSING", "PDF formula marker range contains no visible path/text/image paint operator", row))
    decoded = "".join(visible_fragments)
    residue = _source_residue(decoded)
    if residue:
        diagnostics.append(_context(manifest, "FORMULA_SOURCE_RESIDUE_VISIBLE", f"formula source residue remains in PDF content: {residue.group(0)}"))
    return page_count, diagnostics, report_diagnostics


def inspect_artifact(path: str | Path, artifact_format: str, manifest: list[dict[str, Any]], question_count: int = 0) -> dict[str, Any]:
    artifact_path = Path(path)
    diagnostics: list[dict[str, Any]] = []
    for row in manifest:
        if not str(row.get("canonicalLatex") or "").strip():
            diagnostics.append(_context(manifest, "FORMULA_CANONICAL_LATEX_EMPTY", "canonical LaTeX is empty", row))
    if diagnostics:
        raise VisibleGateError(diagnostics)
    if not artifact_path.is_file() or artifact_path.stat().st_size <= 0:
        raise VisibleGateError([_context(manifest, "ARTIFACT_FILE_MISSING_OR_EMPTY", "artifact file is missing or empty")])

    normalized_format = str(artifact_format).lower()
    if normalized_format in {"word", "docx"}:
        page_count, package_diagnostics = _inspect_docx(artifact_path, manifest)
        inspection_report_diagnostics: list[dict[str, Any]] = []
    elif normalized_format == "pdf":
        page_count, package_diagnostics, inspection_report_diagnostics = _inspect_pdf(artifact_path, manifest)
    else:
        raise VisibleGateError([_context(manifest, "ARTIFACT_FORMAT_UNSUPPORTED", f"unsupported artifact format: {artifact_format}")])
    diagnostics.extend(package_diagnostics)
    if diagnostics:
        raise VisibleGateError(diagnostics)

    modes = sorted({str(row.get("effectiveMode") or "") for row in manifest if row.get("effectiveMode")})
    fallback_count = sum(1 for row in manifest if bool(row.get("fallbackUsed")) or row.get("requestedMode") != row.get("effectiveMode"))
    report_diagnostics = [item for row in manifest for item in list(row.get("diagnostics") or [])]
    report_diagnostics.extend(inspection_report_diagnostics)
    if normalized_format in {"word", "docx"} and page_count is None:
        report_diagnostics.append({"code": "DOCX_PAGE_COUNT_REQUIRES_RENDERER", "message": "DOCX page count is unknown until rendered by Word/LibreOffice", "questionId": "", "location": "artifact", "index": 0})
    return {
        "sha256": hashlib.sha256(artifact_path.read_bytes()).hexdigest(),
        "questionCount": int(question_count),
        "pageCount": page_count,
        "formulaCount": len(manifest),
        "fallbackCount": fallback_count,
        "effectiveFormulaModes": modes,
        "diagnostics": report_diagnostics,
    }


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        report = inspect_artifact(
            payload["path"],
            payload.get("format") or "docx",
            list(payload.get("manifest") or []),
            int(payload.get("questionCount") or 0),
        )
        json.dump({"ok": True, "report": report}, sys.stdout, ensure_ascii=False)
        return 0
    except VisibleGateError as error:
        json.dump({"ok": False, "diagnostics": error.diagnostics}, sys.stdout, ensure_ascii=False)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
