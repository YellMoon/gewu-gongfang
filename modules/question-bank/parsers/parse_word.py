#!/usr/bin/env python3
"""Word question parser for the question-bank import pipeline.

Usage: python parse_word.py <file_path> <source_type> [knowledge_tree_path]
source_type: lecture | exam | auto
"""

import io
import base64
import hashlib
import json
import mimetypes
import os
import re
import sys
import uuid
import zipfile
import xml.etree.ElementTree as ET

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


QUESTION_RE = re.compile(r"^(\d+)[\.\u3001\uff0e]\s*(.*)")
OPTION_RE = re.compile(r"^([A-G])[\.\u3001\uff0e]\s*(.*)", re.I)
SUB_QUESTION_RE = re.compile(r"^(?:[\(\uff08](\d+)[\)\uff09]|([\u2460\u2461\u2462\u2463\u2464\u2465\u2466\u2467\u2468\u2469]))\s*(.*)")
EXAM_SECTION_RE = re.compile(r"^[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+[\u3001\uff0e\.\s]*(\u5355\u9009\u9898|\u591a\u9009\u9898|\u9009\u62e9\u9898|\u5b9e\u9a8c\u9898|\u89e3\u7b54\u9898|\u7efc\u5408\u9898|\u586b\u7a7a\u9898)")
ANSWER_TITLE_RE = re.compile(r"^(?:\u300a.*?\u300b\s*)?(?:\u53c2\u8003\u7b54\u6848|\u7b54\u6848\u4e0e\u89e3\u6790|\u7b54\u6848\u53ca\u89e3\u6790|\u7b54\u6848)")
ANALYSIS_MARK_RE = re.compile(r"\u3010(?:\u8be6\u89e3|\u89e3\u6790)\u3011")


def extract_question_number(text):
    match = QUESTION_RE.match(text)
    if match:
        return int(match.group(1)), match.group(2).strip()
    return None, text


def read_numbering_definitions(file_path):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            if "word/numbering.xml" not in archive.namelist():
                return {}
            root = ET.fromstring(archive.read("word/numbering.xml"))
            num_to_abstract = {}
            for num in root.findall("w:num", namespace):
                num_id = num.attrib.get(f"{{{namespace['w']}}}numId")
                abstract = num.find("w:abstractNumId", namespace)
                if num_id and abstract is not None:
                    num_to_abstract[num_id] = abstract.attrib.get(f"{{{namespace['w']}}}val")

            abstract_levels = {}
            for abstract in root.findall("w:abstractNum", namespace):
                abstract_id = abstract.attrib.get(f"{{{namespace['w']}}}abstractNumId")
                levels = {}
                for level in abstract.findall("w:lvl", namespace):
                    ilvl = level.attrib.get(f"{{{namespace['w']}}}ilvl", "0")
                    lvl_text = level.find("w:lvlText", namespace)
                    num_fmt = level.find("w:numFmt", namespace)
                    start = level.find("w:start", namespace)
                    levels[ilvl] = {
                        "text": lvl_text.attrib.get(f"{{{namespace['w']}}}val", "") if lvl_text is not None else "",
                        "format": num_fmt.attrib.get(f"{{{namespace['w']}}}val", "") if num_fmt is not None else "",
                        "start": int(start.attrib.get(f"{{{namespace['w']}}}val", "1")) if start is not None else 1,
                    }
                abstract_levels[abstract_id] = levels

            definitions = {}
            for num_id, abstract_id in num_to_abstract.items():
                definitions[num_id] = abstract_levels.get(abstract_id, {})
            return definitions
    except Exception:
        return {}


def paragraph_numbering(paragraph):
    try:
        num_pr = paragraph._p.pPr.numPr if paragraph._p.pPr is not None else None
        if num_pr is None or num_pr.numId is None:
            return None
        num_id = str(num_pr.numId.val)
        ilvl = str(num_pr.ilvl.val) if num_pr.ilvl is not None else "0"
        return num_id, ilvl
    except Exception:
        return None


def read_docx_comments(file_path):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            if "word/comments.xml" not in archive.namelist():
                return {}
            root = ET.fromstring(archive.read("word/comments.xml"))
            comments = {}
            for comment in root.findall(".//w:comment", namespace):
                comment_id = comment.attrib.get(f"{{{namespace['w']}}}id")
                texts = [node.text or "" for node in comment.findall(".//w:t", namespace)]
                if comment_id:
                    comments[comment_id] = "".join(texts).strip()
            return comments
    except Exception:
        return {}


def read_paragraph_comment_refs(file_path):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            if "word/document.xml" not in archive.namelist():
                return []
            root = ET.fromstring(archive.read("word/document.xml"))
            refs_by_paragraph = []
            for paragraph in root.findall(".//w:p", namespace):
                refs = []
                for node in paragraph.findall(".//w:commentReference", namespace) + paragraph.findall(".//w:commentRangeStart", namespace) + paragraph.findall(".//w:commentRangeEnd", namespace):
                    comment_id = node.attrib.get(f"{{{namespace['w']}}}id")
                    if comment_id and comment_id not in refs:
                        refs.append(comment_id)
                refs_by_paragraph.append(refs)
            return refs_by_paragraph
    except Exception:
        return []


def extract_numbered_items(doc, file_path):
    definitions = read_numbering_definitions(file_path)
    comments = read_docx_comments(file_path)
    counters = {}
    items = []
    xml_items = extract_numbered_items_from_xml(file_path, definitions, comments, counters)
    if xml_items:
        return xml_items

    comment_refs = read_paragraph_comment_refs(file_path)
    for index, paragraph in enumerate(doc.paragraphs):
        text = clean_word_text(paragraph.text)
        numbering = paragraph_numbering(paragraph)
        number_label = ""
        number_kind = ""
        if numbering:
            num_id, ilvl = numbering
            level = definitions.get(num_id, {}).get(ilvl, {})
            lvl_text = level.get("text", "")
            if level.get("format") == "decimal" and "%1" in lvl_text and ilvl == "0":
                key = (num_id, ilvl)
                counters[key] = counters.get(key, level.get("start", 1) - 1) + 1
                number_label = lvl_text.replace("%1", str(counters[key]))
                if lvl_text.startswith("例"):
                    number_kind = "example"
                elif lvl_text in ("%1", "%1.", "%1．"):
                    number_kind = "practice"
        paragraph_comments = [
            comments[comment_id]
            for comment_id in (comment_refs[index] if index < len(comment_refs) else [])
            if comments.get(comment_id)
        ]
        items.append({
            "text": text,
            "number_label": number_label,
            "number_kind": number_kind,
            "comments": paragraph_comments,
        })
    return items


def clean_word_text(text):
    return re.sub(r"[\f\v]+", "", text or "").strip()


def _xml_bytes(node):
    try:
        return ET.tostring(node, encoding="unicode")
    except Exception:
        return ""

def _local_name(node):
    return node.tag.rsplit("}", 1)[-1]

def _first_child(node, name):
    for child in list(node):
        if _local_name(child) == name:
            return child
    return None

def _format_math_token(text):
    if not text:
        return ""
    if re.fullmatch(r"[A-Za-z]", text):
        return "<i>%s</i>" % text
    return re.sub(r"([A-Za-z])", r"<i>\1</i>", text)


UNIT_SYMBOLS = [
    "kg", "mol", "cd", "rad", "sr", "Hz", "Pa", "J", "W", "C", "V", "F", "Ω", "S", "Wb", "T", "H", "lm", "lx", "Bq", "Gy", "Sv", "kat",
    "m", "s", "A", "K", "N", "Pa", "J", "W", "C", "V", "F", "T", "H", "L", "eV", "MeV", "GeV", "min", "h",
]
UNIT_PREFIXES = ["Y", "Z", "E", "P", "T", "G", "M", "k", "h", "da", "d", "c", "m", "μ", "u", "n", "p", "f", "a", "z", "y"]


def _unit_tokens():
    tokens = set(UNIT_SYMBOLS)
    for prefix in UNIT_PREFIXES:
        for unit in UNIT_SYMBOLS:
            if unit in ("kg", "min", "mol", "rad", "sr"):
                continue
            tokens.add(prefix + unit)
    return sorted(tokens, key=len, reverse=True)


UNIT_PATTERN = r"(?:%s)(?:\s*(?:[·⋅*/\/]\s*|\^?-?\d+|<sup>-?\d+</sup>|\s+)(?:%s))*" % (
    "|".join(re.escape(token) for token in _unit_tokens()),
    "|".join(re.escape(token) for token in _unit_tokens()),
)


def normalize_physics_markup(text):
    if not text:
        return ""
    protected_images = []

    def protect_image(match):
        token = "@@QUESTION_IMAGE_%d@@" % len(protected_images)
        protected_images.append(match.group(0))
        return token

    text = re.sub(r"<img\b[^>]*>", protect_image, text, flags=re.I)
    text = re.sub(r"<i>k</i><i>g</i>", "kg", text)
    text = re.sub(r"<i>(N|Pa|J|W|C|V|F|T|H|A|K|Hz|Ω)</i>(?=(?:<sup>|[·⋅.*/\/]))", r"\1", text)
    text = re.sub(r"(?<=[·⋅.*/\/])<i>(m|s|g|A|K|mol|cd|rad|Hz|N|Pa|J|W|C|V|F|T|H|Ω)</i>", r"\1", text)
    text = re.sub(r"<i>(m|s|g|A|K|mol|cd|rad|Hz|N|Pa|J|W|C|V|F|T|H|Ω)</i>(?=<sup>-?\d+</sup>)", r"\1", text)
    def restore_unit(match):
        prefix = match.group(1)
        body = match.group(2)
        return prefix + re.sub(r"</?i>", "", body)

    italic_unit_token = r"(?:<i>[A-Za-zμΩ]+</i>|[·⋅*/\/\s]|\^?-?\d+|<sup>-?\d+</sup>)+"
    text = re.sub(r"(\d(?:[\d.,×xX\-+]*\d)?\s*)(" + italic_unit_token + r")(?=\s|[\u4e00-\u9fff]|[,，。；;、）)]|$)", restore_unit, text)
    text = re.sub(r"(?<=\d)\s*(%s)" % UNIT_PATTERN, lambda m: " " + m.group(1), text)
    text = re.sub(r"@@QUESTION_IMAGE_(\d+)@@", lambda m: protected_images[int(m.group(1))] if int(m.group(1)) < len(protected_images) else "", text)
    return text

def _plain_math_text(node):
    if node is None:
        return ""
    tag = _local_name(node)
    if tag == "t":
        return node.text or ""
    return "".join(_plain_math_text(child) for child in list(node))

def _math_text(node):
    if node is None:
        return ""
    tag = _local_name(node)
    if tag == "t":
        return _format_math_token(node.text or "")
    if tag == "r":
        plain_style = False
        rpr = _first_child(node, "rPr")
        if rpr is not None:
            plain_style = any(_local_name(child) in ("nor", "lit") for child in list(rpr))
            plain_style = plain_style or any(_local_name(child) == "sty" and child.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/math}val") in ("p", "plain") for child in list(rpr))
        if plain_style:
            return _plain_math_text(node)
        return "".join(_math_text(child) for child in list(node) if _local_name(child) != "rPr")
    if tag == "fName":
        return _plain_math_text(node)
    if tag in ("oMath", "oMathPara", "e", "num", "den", "deg", "sub", "sup"):
        return "".join(_math_text(child) for child in list(node))
    if tag == "f":
        num = _math_text(_first_child(node, "num"))
        den = _math_text(_first_child(node, "den"))
        return '<span class="omml-frac"><span class="omml-frac-num">%s</span><span class="omml-frac-den">%s</span></span>' % (num, den)
    if tag == "sSub":
        base = _math_text(_first_child(node, "e"))
        sub = _math_text(_first_child(node, "sub"))
        return "%s<sub>%s</sub>" % (base, sub)
    if tag == "sSup":
        base = _math_text(_first_child(node, "e"))
        sup = _math_text(_first_child(node, "sup"))
        return "%s<sup>%s</sup>" % (base, sup)
    if tag == "sSubSup":
        base = _math_text(_first_child(node, "e"))
        sub = _math_text(_first_child(node, "sub"))
        sup = _math_text(_first_child(node, "sup"))
        if not base:
            return '<span class="nuclear-left"><sup>%s</sup><sub>%s</sub></span>' % (sup, sub)
        return "%s<sub>%s</sub><sup>%s</sup>" % (base, sub, sup)
    if tag == "rad":
        deg = _math_text(_first_child(node, "deg"))
        body = _math_text(_first_child(node, "e"))
        return r"$\sqrt{%s}$" % body if not deg else r"$\sqrt[%s]{%s}$" % (deg, body)
    if tag == "nary":
        symbol = "".join(child.attrib.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "") for child in node.iter() if _local_name(child) == "chr") or "∑"
        sub = _math_text(_first_child(node, "sub"))
        sup = _math_text(_first_child(node, "sup"))
        body = _math_text(_first_child(node, "e"))
        return "%s%s%s%s" % (symbol, "<sub>%s</sub>" % sub if sub else "", "<sup>%s</sup>" % sup if sup else "", body)
    if tag == "d":
        body = _math_text(_first_child(node, "e"))
        return "(%s)" % body
    if tag == "bar":
        return r"$\overline{%s}$" % _math_text(_first_child(node, "e"))
    if tag == "groupChr":
        return _math_text(_first_child(node, "e"))
    if tag == "func":
        return "%s(%s)" % (_plain_math_text(_first_child(node, "fName")), _math_text(_first_child(node, "e")))
    return "".join(_math_text(child) for child in list(node))

def _asset_from_run_rel(archive, rels, rid, has_ole_object=False):
    if archive is None or not rid:
        return None
    rel = rels.get(rid or "") if rels else None
    return _asset_from_part(archive, rel.get("target") if rel else "", "formula_preview" if has_ole_object else "image", rid, rel.get("type") if rel else "")


def _paragraph_text_with_markup(paragraph, ns, archive=None, rels=None, has_ole_object=False, inline_assets=None):
    parts = []
    inline_assets = inline_assets if inline_assets is not None else []
    for child in list(paragraph):
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "r":
            if archive is not None and all(key in ns for key in ("a", "v", "r")):
                for blip in child.findall(".//a:blip", ns):
                    rid = blip.attrib.get("{%s}embed" % ns.get("r", "")) or blip.attrib.get("{%s}link" % ns.get("r", ""))
                    asset = _asset_from_run_rel(archive, rels, rid, has_ole_object)
                    if asset:
                        inline_assets.append(asset)
                        parts.append('<img src="%s" alt="%s" />' % (asset.get("data_url", ""), asset.get("file_name", "image")))
                for image in child.findall(".//v:imagedata", ns):
                    rid = image.attrib.get("{%s}id" % ns.get("r", ""))
                    asset = _asset_from_run_rel(archive, rels, rid, has_ole_object)
                    if asset:
                        inline_assets.append(asset)
                        parts.append('<img src="%s" alt="%s" />' % (asset.get("data_url", ""), asset.get("file_name", "image")))
            for math_node in child.findall(".//m:oMath", ns) + child.findall(".//m:oMathPara", ns):
                math_text = _math_text(math_node).strip()
                if math_text:
                    parts.append(math_text)
            run_text = "".join(node.text or "" for node in child.findall(".//w:t", ns))
            instr_text = "".join(node.text or "" for node in child.findall(".//w:instrText", ns))
            text = run_text or instr_text
            if not text:
                continue
            vert = child.find("./w:rPr/w:vertAlign", ns)
            val = vert.attrib.get("{%s}val" % ns["w"]) if vert is not None else ""
            italic = child.find("./w:rPr/w:i", ns) is not None
            bold = child.find("./w:rPr/w:b", ns) is not None
            if val == "subscript":
                parts.append("<sub>%s</sub>" % text)
            elif val == "superscript":
                parts.append("<sup>%s</sup>" % text)
            elif italic:
                parts.append("<i>%s</i>" % text)
            elif bold:
                parts.append("<strong>%s</strong>" % text)
            else:
                parts.append(text)
        elif tag in ("oMath", "oMathPara"):
            math_text = _math_text(child).strip()
            if math_text:
                parts.append(math_text)
    return clean_word_text(normalize_physics_markup("".join(parts)))


def _rels_for_document(archive):
    rels = {}
    rel_path = "word/_rels/document.xml.rels"
    if rel_path not in archive.namelist():
        return rels
    root = ET.fromstring(archive.read(rel_path))
    for rel in root:
        rid = rel.attrib.get("Id")
        target = rel.attrib.get("Target", "")
        rel_type = rel.attrib.get("Type", "")
        if not rid or not target:
            continue
        if target.startswith("/"):
            full = target.lstrip("/")
        elif target.startswith("word/"):
            full = target
        else:
            full = "word/" + target
        rels[rid] = {"target": full, "type": rel_type}
    return rels


def _asset_from_part(archive, part_name, asset_type, rel_id=None, rel_type=None):
    if not part_name or part_name not in archive.namelist():
        return None
    data = archive.read(part_name)
    mime = mimetypes.guess_type(part_name)[0] or "application/octet-stream"
    digest = hashlib.sha256(data).hexdigest()
    file_name = os.path.basename(part_name)
    return {
        "asset_type": asset_type,
        "file_name": file_name,
        "mime_type": mime,
        "size_bytes": len(data),
        "content_hash": digest,
        "rel_id": rel_id or "",
        "rel_type": rel_type or "",
        "source_part": part_name,
        "data_url": "data:%s;base64,%s" % (mime, base64.b64encode(data).decode("ascii")),
    }


def read_docx_rich_paragraphs(file_path):
    ns = {
        "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        "v": "urn:schemas-microsoft-com:vml",
        "o": "urn:schemas-microsoft-com:office:office",
        "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    }
    rows = []
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            if "word/document.xml" not in archive.namelist():
                return []
            rels = _rels_for_document(archive)
            root = ET.fromstring(archive.read("word/document.xml"))
            for paragraph in root.findall(".//w:p", ns):
                assets = []
                formulas = []

                has_ole_object = bool(paragraph.findall(".//o:OLEObject", ns))
                inline_assets = []
                paragraph_text = _paragraph_text_with_markup(paragraph, ns, archive, rels, has_ole_object, inline_assets)
                assets.extend(inline_assets)

                for blip in paragraph.findall(".//a:blip", ns):
                    rid = blip.attrib.get("{%s}embed" % ns["r"]) or blip.attrib.get("{%s}link" % ns["r"])
                    rel = rels.get(rid or "")
                    asset = _asset_from_part(archive, rel.get("target") if rel else "", "formula_preview" if has_ole_object else "image", rid, rel.get("type") if rel else "")
                    if asset and asset.get("content_hash") not in {item.get("content_hash") for item in assets}:
                        assets.append(asset)

                for image in paragraph.findall(".//v:imagedata", ns):
                    rid = image.attrib.get("{%s}id" % ns["r"])
                    rel = rels.get(rid or "")
                    asset = _asset_from_part(archive, rel.get("target") if rel else "", "formula_preview" if has_ole_object else "image", rid, rel.get("type") if rel else "")
                    if asset and asset.get("content_hash") not in {item.get("content_hash") for item in assets}:
                        assets.append(asset)

                for obj in paragraph.findall(".//o:OLEObject", ns):
                    rid = obj.attrib.get("{%s}id" % ns["r"])
                    prog_id = obj.attrib.get("ProgID") or obj.attrib.get("Type") or "OLEObject"
                    rel = rels.get(rid or "")
                    asset = _asset_from_part(archive, rel.get("target") if rel else "", "formula_ole", rid, rel.get("type") if rel else "")
                    if asset:
                        asset["prog_id"] = prog_id
                        assets.append(asset)
                        formulas.append({
                            "format": "mathtype_ole",
                            "text": prog_id,
                            "asset_hash": asset["content_hash"],
                            "rel_id": rid or "",
                            "source_part": asset["source_part"],
                        })

                for math_node in paragraph.findall(".//m:oMath", ns) + paragraph.findall(".//m:oMathPara", ns):
                    math_text = _math_text(math_node).strip()
                    omml = _xml_bytes(math_node)
                    formulas.append({
                        "format": "omml",
                        "text": math_text,
                        "omml": omml,
                    })

                field_text = " ".join(node.text or "" for node in paragraph.findall(".//w:instrText", ns)).strip()
                if field_text:
                    formulas.append({
                        "format": "field_code",
                        "text": field_text,
                        "field_code": field_text,
                    })

                rows.append({
                    "text": paragraph_text,
                    "assets": assets,
                    "formulas": formulas,
                })
    except Exception:
        return []
    return rows


def attach_rich_content(question, rich):
    if not question or not rich:
        return
    question.setdefault("assets", [])
    question.setdefault("formulas", [])
    for asset in rich.get("assets", []):
        if asset and asset.get("content_hash") not in {item.get("content_hash") for item in question["assets"]}:
            question["assets"].append(asset)
    for formula in rich.get("formulas", []):
        if formula and formula not in question["formulas"]:
            question["formulas"].append(formula)
    question["has_image"] = any(asset.get("asset_type") == "image" for asset in question["assets"])
    question["has_formula"] = bool(question["formulas"]) or any(str(asset.get("asset_type", "")).startswith("formula_") for asset in question["assets"])


def extract_numbered_items_from_xml(file_path, definitions, comments, counters):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            if "word/document.xml" not in archive.namelist():
                return []
            root = ET.fromstring(archive.read("word/document.xml"))
            items = []
            rich_rows = read_docx_rich_paragraphs(file_path)
            for paragraph_index, paragraph in enumerate(root.findall(".//w:p", namespace)):
                rich = rich_rows[paragraph_index] if paragraph_index < len(rich_rows) else {}
                text = rich.get("text") or _paragraph_text_with_markup(paragraph, {
                    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
                })
                refs = []
                for node in paragraph.findall(".//w:commentReference", namespace) + paragraph.findall(".//w:commentRangeStart", namespace) + paragraph.findall(".//w:commentRangeEnd", namespace):
                    comment_id = node.attrib.get(f"{{{namespace['w']}}}id")
                    if comment_id and comment_id not in refs:
                        refs.append(comment_id)
                num_pr = paragraph.find("./w:pPr/w:numPr", namespace)
                number_label = ""
                number_kind = ""
                if num_pr is not None:
                    num_id_node = num_pr.find("w:numId", namespace)
                    ilvl_node = num_pr.find("w:ilvl", namespace)
                    num_id = num_id_node.attrib.get(f"{{{namespace['w']}}}val") if num_id_node is not None else None
                    ilvl = ilvl_node.attrib.get(f"{{{namespace['w']}}}val") if ilvl_node is not None else "0"
                    level = definitions.get(num_id, {}).get(ilvl, {}) if num_id else {}
                    lvl_text = level.get("text", "")
                    if level.get("format") == "decimal" and "%1" in lvl_text and ilvl == "0":
                        key = (num_id, ilvl)
                        counters[key] = counters.get(key, level.get("start", 1) - 1) + 1
                        number_label = lvl_text.replace("%1", str(counters[key]))
                        if lvl_text.startswith("例"):
                            number_kind = "example"
                        elif lvl_text in ("%1", "%1.", "%1．"):
                            number_kind = "practice"
                paragraph_comments = [comments[comment_id] for comment_id in refs if comments.get(comment_id)]
                items.append({
                    "text": text,
                    "number_label": number_label,
                    "number_kind": number_kind,
                    "comments": paragraph_comments,
                    "rich": rich,
                })
            return items
    except Exception:
        return []


def extract_option(text):
    match = OPTION_RE.match(text)
    if match:
        return match.group(1).upper(), match.group(2).strip()
    return None, text


def extract_sub_question(text):
    match = SUB_QUESTION_RE.match(text)
    if match:
        if match.group(1):
            return int(match.group(1)), match.group(3).strip()
        circled = match.group(2)
        number = "\u2460\u2461\u2462\u2463\u2464\u2465\u2466\u2467\u2468\u2469".find(circled) + 1
        return number, match.group(3).strip()
    return None, text


def extract_meta(text):
    meta = {}
    year = re.search(r"(?:19|20)\d{2}", text)
    if year:
        meta["year"] = year.group(0)
    for grade in ["高一", "高二", "高三", "初一", "初二", "初三"]:
        if grade in text:
            meta["grade"] = grade
            break
    for region in ["全国", "北京", "上海", "天津", "浙江", "江苏", "山东", "广东", "湖北", "湖南", "四川"]:
        if region in text:
            meta["region"] = region
            break
    if "高考" in text:
        meta["exam_type"] = "高考真题"
    elif "模拟" in text or "联考" in text or "适应性" in text:
        meta["exam_type"] = "模拟题"
    elif "期中" in text:
        meta["exam_type"] = "期中考试"
    elif "期末" in text:
        meta["exam_type"] = "期末考试"
    elif "月考" in text:
        meta["exam_type"] = "月考"
    return meta


def extract_types_from_text(text, options=None):
    mapping = {
        "多选": "multi",
        "单选": "single",
        "选择": "single",
        "填空": "fill",
        "实验": "experiment",
        "计算": "calculation",
        "解答": "problem",
        "简答": "short",
        "作图": "drawing",
        "判断": "judge",
    }
    types = [value for key, value in mapping.items() if key in text]
    if not types and options:
        types = ["single"]
    return types or ["fill"]


def answer_letters(answer):
    text = re.sub(r"【.*?】", "", str(answer or "")).upper()
    return re.findall(r"[A-G]", text)


def classify_question(stem, options=None, answer=""):
    letters = answer_letters(answer)
    if options or re.search(r"[（(]\s*[　\s]{2,}[）)]", stem or ""):
        return ["multi" if len(set(letters)) >= 2 else "single"]
    if re.search(r"实验", stem or ""):
        return ["experiment"]
    if re.search(r"解答|计算|综合", stem or ""):
        return ["problem"]
    return extract_types_from_text(stem or "", options)


def finalize_question_type(question):
    question["question_types"] = classify_question(question.get("stem", ""), question.get("options", []), question.get("answer", ""))
    return question


def derive_topic_from_filename(file_path):
    base = os.path.splitext(os.path.basename(file_path))[0]
    patterns = [
        r"专题\d+[-：:](.+)$",
        r"实验专题\d+[-：:](.+)$",
        r"解答题专题\d+[-：:](.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, base)
        if match:
            return match.group(1).strip()
    return ""


def is_topic_heading(text):
    if not text:
        return False
    generic = ["选择题", "非选择题", "填空题", "实验题", "计算题", "解答题", "答案", "解析", "参考答案"]
    if any(word in text for word in generic):
        return False
    return bool(re.match(r"^(专题\d+|实验专题\d+|解答题专题\d+|[一二三四五六七八九十]+[、.．])", text))


def normalize_heading_text(text):
    text = re.sub(r"<[^>]+>", "", text or "")
    text = text.replace("\u3000", " ")
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[:：]+$", "", text)
    return text

def is_pure_question_type_title(text):
    text = normalize_heading_text(text)
    return bool(re.match(r"^(?:\d+[\u3001\uff0e\.、]?|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+[\u3001\uff0e\.、]?)?(\u5355\u9009\u9898|\u591a\u9009\u9898|\u9009\u62e9\u9898|\u5b9e\u9a8c\u9898|\u89e3\u7b54\u9898|\u7efc\u5408\u9898|\u586b\u7a7a\u9898)$", text))


def is_exam_section_heading(text):
    text = normalize_heading_text(text)
    return is_pure_question_type_title(text) or bool(EXAM_SECTION_RE.match(text)) or bool(re.match(r"^\d+[\u3001\uff0e\.\s]*(\u5355\u9009\u9898|\u591a\u9009\u9898|\u9009\u62e9\u9898|\u5b9e\u9a8c\u9898|\u89e3\u7b54\u9898|\u7efc\u5408\u9898|\u586b\u7a7a\u9898)$", text))


def clean_topic_heading(text):
    text = re.sub(r"^(专题\d+|实验专题\d+|解答题专题\d+)[-：:、.\s]*", "", text).strip()
    text = re.sub(r"^[一二三四五六七八九十]+[、.．]\s*", "", text).strip()
    return text[:80]


def new_question(stem, index=None, knowledge_point=None):
    knowledge_points = [knowledge_point] if knowledge_point else []
    return {
        "id": str(uuid.uuid4()),
        "index": index,
        "stem": stem.strip(),
        "options": [],
        "sub_questions": [],
        "answer": "",
        "analysis": "",
        "knowledge_point": knowledge_point or "",
        "knowledge_points": knowledge_points,
        "question_types": extract_types_from_text(stem),
        "assets": [],
        "formulas": [],
        "has_image": False,
        "has_formula": False,
    }


def append_text(question, text):
    question["stem"] = (question["stem"] + "\n" + text).strip()
    if question["sub_questions"]:
        question["sub_questions"][-1]["content"] += "\n" + text


def parse_question_block(paragraphs, default_topic=None):
    questions = []
    current = None
    current_topic = default_topic or ""
    for paragraph in paragraphs:
        text = paragraph.strip()
        if not text:
            continue
        if is_topic_heading(text):
            topic = clean_topic_heading(text)
            if topic:
                current_topic = topic
            continue
        if is_pure_question_type_title(text):
            continue
        number, content = extract_question_number(text)
        if number is not None:
            if is_pure_question_type_title(content):
                continue
            if current:
                questions.append(finalize_question_type(current))
            current = new_question(content, len(questions), current_topic)
            continue
        if not current:
            continue
        option, option_content = extract_option(text)
        if option:
            current["options"].append({"label": option, "content": option_content, "is_correct": False})
            continue
        sub_number, sub_content = extract_sub_question(text)
        if sub_number:
            current["sub_questions"].append({"title": f"({sub_number})", "content": sub_content, "answer": ""})
            current["stem"] = (current["stem"] + "\n" + f"({sub_number}) {sub_content}").strip()
            continue
        append_text(current, text)
    if current:
        questions.append(finalize_question_type(current))
    return questions


def split_answer_section(paragraphs):
    markers = ("\u53c2\u8003\u7b54\u6848", "\u7b54\u6848\u4e0e\u89e3\u6790", "\u7b54\u6848\u53ca\u89e3\u6790")
    for index, paragraph in enumerate(paragraphs):
        text = paragraph.strip()
        if ANSWER_TITLE_RE.search(text) or any(marker in text for marker in markers):
            return paragraphs[:index], paragraphs[index + 1 :]
    return paragraphs, []

def parse_answers(paragraphs):
    answers = []
    current = None
    for paragraph in paragraphs:
        text = paragraph.strip()
        if not text:
            continue
        number, content = extract_question_number(text)
        if number is not None:
            if current:
                answers.append(current)
            current = {"number": number, "answer": content, "explanation": ""}
            continue
        if current:
            if current["explanation"]:
                current["explanation"] += "\n"
            current["explanation"] += text
    if current:
        answers.append(current)
    return answers


def parse_exam_answer_blocks(paragraphs):
    answers = []
    current = None
    mode = "answer"
    for paragraph in paragraphs:
        text = paragraph.strip()
        if not text:
            continue
        if ANSWER_TITLE_RE.match(text):
            continue
        number, content = extract_question_number(text)
        if number is not None:
            if current:
                answers.append(current)
            current = {"number": number, "answer": "", "explanation": ""}
            mode = "answer"
            marker = ANALYSIS_MARK_RE.search(content)
            if marker:
                current["answer"] = content[: marker.start()].strip()
                current["explanation"] = content[marker.end() :].strip()
                mode = "analysis"
            else:
                current["answer"] = content.strip()
            continue
        if not current:
            continue
        marker = ANALYSIS_MARK_RE.search(text)
        if marker:
            before = text[: marker.start()].strip()
            after = text[marker.end() :].strip()
            if before:
                current["answer"] = (current["answer"] + "\n" + before).strip()
            if after:
                current["explanation"] = (current["explanation"] + "\n" + after).strip()
            mode = "analysis"
            continue
        if mode == "answer":
            current["answer"] = (current["answer"] + "\n" + text).strip()
        else:
            current["explanation"] = (current["explanation"] + "\n" + text).strip()
    if current:
        answers.append(current)
    return answers


def parse_exam_question_block(paragraphs):
    questions = []
    current = None
    expected_number = None
    current_section = ""
    for paragraph in paragraphs:
        text = paragraph.strip()
        if not text:
            continue
        if is_exam_section_heading(text):
            if current:
                questions.append(finalize_question_type(current))
                current = None
            expected_number = None
            current_section = text
            continue
        number, content = extract_question_number(text)
        if number is not None and (expected_number is None or number == expected_number):
            if is_pure_question_type_title(content):
                current_section = content
                expected_number = None
                continue
            if current:
                questions.append(finalize_question_type(current))
            current = new_question(content, len(questions), "")
            current["number"] = number
            current["section_title"] = current_section
            expected_number = number + 1
            continue
        if not current:
            continue
        option, option_content = extract_option(text)
        if option:
            if any(word in current_section for word in ("\u5b9e\u9a8c\u9898", "\u89e3\u7b54\u9898", "\u7efc\u5408\u9898")) or current["sub_questions"]:
                append_text(current, text)
            else:
                current["options"].append({"label": option, "content": option_content, "is_correct": False})
            continue
        sub_number, sub_content = extract_sub_question(text)
        if sub_number:
            current["sub_questions"].append({"title": f"({sub_number})", "content": sub_content, "answer": ""})
            current["stem"] = (current["stem"] + "\n" + f"({sub_number}) {sub_content}").strip()
            continue
        append_text(current, text)
    if current:
        questions.append(finalize_question_type(current))
    return questions


def parse_lecture_questions(paragraphs, default_topic=None):
    return parse_question_block(paragraphs, default_topic)


def parse_lecture_numbered_items(items, default_topic=None):
    questions = []
    current = None
    current_topic = default_topic or ""

    def finish_current():
        nonlocal current
        if current:
            comments = [comment for comment in current.pop("_comments", []) if comment]
            if comments and not current.get("answer"):
                current["answer"] = "\n".join(comments)
            questions.append(finalize_question_type(current))
            current = None

    for item in items:
        text = item.get("text", "").strip()
        rich = item.get("rich", {})
        number_kind = item.get("number_kind", "")
        number_label = item.get("number_label", "")
        if not text and not number_kind:
            if current and (rich.get("assets") or rich.get("formulas")):
                attach_rich_content(current, rich)
            continue
        if text and is_topic_heading(text):
            finish_current()
            topic = clean_topic_heading(text)
            if topic:
                current_topic = topic
            continue
        if text and is_pure_question_type_title(text):
            finish_current()
            continue
        if number_kind in ("example", "practice"):
            finish_current()
            stem = f"{number_label} {text}".strip()
            current = new_question(stem, len(questions), current_topic)
            current["source_type"] = number_kind
            current["_comments"] = list(item.get("comments", []))
            attach_rich_content(current, rich)
            continue
        if not current or not text:
            if current:
                current.setdefault("_comments", []).extend(item.get("comments", []))
                attach_rich_content(current, rich)
            continue
        current.setdefault("_comments", []).extend(item.get("comments", []))
        attach_rich_content(current, rich)
        option, option_content = extract_option(text)
        if option:
            current["options"].append({"label": option, "content": option_content, "is_correct": False})
            continue
        sub_number, sub_content = extract_sub_question(text)
        if sub_number:
            current["sub_questions"].append({"title": f"({sub_number})", "content": sub_content, "answer": ""})
            current["stem"] = (current["stem"] + "\n" + f"({sub_number}) {sub_content}").strip()
            continue
        append_text(current, text)

    finish_current()
    return questions


def parse_exam_questions(paragraphs, default_topic=None, rich_rows=None):
    question_part, answer_part = split_answer_section(paragraphs)
    question_rich = rich_rows[: len(question_part)] if rich_rows else None
    questions = parse_exam_question_block(question_part)
    if question_rich:
        current_index = -1
        expected_number = None
        for paragraph_index, text in enumerate(question_part):
            rich = question_rich[paragraph_index] if paragraph_index < len(question_rich) else {}
            stripped = (text or "").strip()
            number, _content = extract_question_number(stripped)
            if number is not None and (expected_number is None or number == expected_number):
                current_index += 1
                expected_number = number + 1
            if 0 <= current_index < len(questions) and (rich.get("assets") or rich.get("formulas")):
                attach_rich_content(questions[current_index], rich)
    answers = parse_exam_answer_blocks(answer_part)
    by_index = {idx: answer for idx, answer in enumerate(answers)}
    by_number = {answer["number"]: answer for answer in answers}
    for idx, question in enumerate(questions):
        answer = by_number.get(question.get("number") or idx + 1) or by_index.get(idx)
        if answer:
            question["answer"] = answer.get("answer", "")
            question["analysis"] = answer.get("explanation", "")
            finalize_question_type(question)
    return questions


def extract_comments(file_path):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            if "word/comments.xml" not in archive.namelist():
                return []
            root = ET.fromstring(archive.read("word/comments.xml"))
            comments = []
            for comment in root.findall(".//w:comment", namespace):
                texts = [node.text or "" for node in comment.findall(".//w:t", namespace)]
                comments.append("".join(texts).strip())
            return comments
    except Exception:
        return []


def extract_paragraphs_from_docx(file_path):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs = []
    with zipfile.ZipFile(file_path, "r") as archive:
        if "word/document.xml" not in archive.namelist():
            raise ValueError("word/document.xml not found")
        root = ET.fromstring(archive.read("word/document.xml"))
        for paragraph in root.findall(".//w:p", namespace):
            text = _paragraph_text_with_markup(paragraph, {
                "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
            })
            if text:
                paragraphs.append(text)
    return paragraphs


def extract_topics(paragraphs):
    topics = []
    for paragraph in paragraphs:
        text = paragraph.strip()
        if text and is_topic_heading(text):
            topic = clean_topic_heading(text)
            if topic and topic not in topics:
                topics.append(topic)
    return topics


def quality_report(questions):
    warnings = {}
    for question in questions:
        if not question.get("stem"):
            warnings["missing_stem"] = warnings.get("missing_stem", 0) + 1
        if not question.get("answer"):
            warnings["missing_answer"] = warnings.get("missing_answer", 0) + 1
        if question.get("options") and len(question["options"]) < 2:
            warnings["few_options"] = warnings.get("few_options", 0) + 1
    return {"warnings": warnings, "parsed_items": len(questions)}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: parse_word.py <file_path> <source_type> [knowledge_tree]"}, ensure_ascii=False))
        sys.exit(1)

    file_path = sys.argv[1]
    source_type = sys.argv[2]
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"file not found: {file_path}"}, ensure_ascii=False))
        sys.exit(1)

    try:
        if os.environ.get("GEWU_FORCE_DOCX_XML_FALLBACK") == "1":
            raise ImportError("forced docx xml fallback")
        from docx import Document
        doc = Document(file_path)
        rich_rows = read_docx_rich_paragraphs(file_path)
        paragraphs = [row.get("text", "") for row in rich_rows] or [paragraph.text for paragraph in doc.paragraphs]
        numbered_items = extract_numbered_items(doc, file_path)
    except ImportError:
        try:
            paragraphs = extract_paragraphs_from_docx(file_path)
            rich_rows = read_docx_rich_paragraphs(file_path)
            numbered_items = []
        except Exception as exc:
            print(json.dumps({"error": f"cannot open Word document without python-docx: {exc}"}, ensure_ascii=False))
            sys.exit(1)
    except Exception as exc:
        try:
            paragraphs = extract_paragraphs_from_docx(file_path)
            rich_rows = read_docx_rich_paragraphs(file_path)
            numbered_items = []
        except Exception:
            print(json.dumps({"error": f"cannot open Word document: {exc}"}, ensure_ascii=False))
            sys.exit(1)
    if source_type == "auto":
        source_type = "exam" if any("参考答案" in paragraph or "答案" in paragraph for paragraph in paragraphs) else "lecture"

    default_topic = derive_topic_from_filename(file_path) if source_type == "lecture" else ""
    if source_type == "exam":
        questions = parse_exam_questions(paragraphs, default_topic, rich_rows)
    elif numbered_items:
        questions = parse_lecture_numbered_items(numbered_items, default_topic)
    else:
        questions = []

    result = {
        "success": True,
        "source_type": source_type,
        "count": len(questions),
        "questions": questions,
        "topics": extract_topics(paragraphs) or ([default_topic] if default_topic else []),
        "knowledge_points": sorted({kp for question in questions for kp in question.get("knowledge_points", []) if kp}),
        "quality_report": quality_report(questions),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
